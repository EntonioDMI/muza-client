// Клиентский движок добычи (Stage 3): yt-dlp + горячий рецепт (Ed25519) +
// LRU-кэш аудио. Резолв и скачивание идут на IP пользователя — сервер байтов
// не трогает (architecture.md, «клиент-мускулы»). Ретрай-лестница из спайка
// Stage 0: клиенты YouTube по рецепту (tv → web_music), затем следующий
// источник (soundcloud и т.д.).

use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::Read as _;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Manager, State};
use url::{Host, Url};

/// Ed25519-pubkey рецепта, SPKI DER в base64 (пара к RECIPE_PRIVATE_KEY
/// сервера). Вшит в бинарь — сервер его не раздаёт, иначе подпись бессмысленна.
/// Raw-ключ — последние 32 байта DER.
const RECIPE_PUBKEY_SPKI_B64: &str = "MCowBQYDK2VwAyEAtWMO3fH/dJ53pP26jQJUzu6dhDRb2uG3rV2Dhqz9dpQ=";

/// Bundled-дефолт рецепта: движок работает и до первого похода на сервер
/// (оффлайн-старт). Копия recipe.config.ts сервера на момент сборки.
///
/// v6 (2026-07-15): лестница начинается с android_vr. Порядок клиентов — это
/// не косметика, а ГЛАВНАЯ цена времени на кэш-миссе: клиенты tv/tv_embedded/
/// web_embedded требуют n-sig JS-challenge (yt-dlp качает и исполняет player JS
/// в deno) — резолв 10–12с против 3.6с у JS-free android_vr. Плюс tv ловит
/// DRM-эксперимент (#12563) и ПАДАЕТ «Requested format is not available» (4 из
/// 4 треков замера), то есть 4–12с уходили в мусор ДО первой удачной попытки.
/// Замер лестницы целиком (4 трека): v5 9.8–25.7с (в среднем 14.8с) → v6
/// 4.3–4.6с, ×3.3; формат и байты идентичны (itag 251, тот же размер).
/// Подробности — docs/notes/2026-07-15-почему-песни-грузятся-долго.md.
///
/// v7 (2026-07-19): блок youtube.innertube — ступень 0 (прямой POST /player
/// клиентом ANDROID_VR, ~171 мс против ~3.6 с у yt-dlp, замер ×21). Значения
/// клиента живут в рецепте как аварийный рубильник: YouTube выпилит
/// android_vr → сервер шлёт enabled:false или новую версию, клиент сам
/// откатывается на yt-dlp-лестницу без релиза. clientVersion строго 1.65.10:
/// выше — SABR-only (yt-dlp ff459e5). Замер и инварианты —
/// docs/notes/2026-07-19-прямой-innertube-резолв-замер.md.
const DEFAULT_RECIPE_JSON: &str = r#"{
  "recipe_version": 7,
  "youtube": {
    "player_clients": ["android_vr", "tv_embedded", "web_embedded", "tv"],
    "format_priority": [251, 140, "bestaudio"],
    "js_runtime": "deno",
    "innertube": {
      "enabled": true,
      "client_name": "ANDROID_VR",
      "client_version": "1.65.10",
      "client_name_id": 28
    }
  }
}"#;

/// Сколько ждать yt-dlp на одну попытку (резолв + скачивание одного трека).
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_YTDLP_OUTPUT_BYTES: u64 = 512 * 1024 * 1024;

const DEFAULT_CACHE_LIMIT_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 ГБ, как в Prefs

// ── Состояние ─────────────────────────────────────────────────────

/// Счётчики добычи для анонимной агрегированной аналитики (KPI SABR/403-rate).
#[derive(Debug, Default, Clone, Serialize)]
pub struct EngineStats {
    pub resolve_ok: u64,
    pub resolve_fail: u64,
    pub attempts: u64,
    pub cache_hits: u64,
    /// Классификация неудачных попыток по маркерам stderr.
    pub fail_403: u64,
    pub fail_bot: u64,
    pub fail_format: u64,
    pub fail_other: u64,
    /// Провалы ступени 0 (прямой InnerTube): SABR-сессия без прямых url и
    /// бот-гейт LOGIN_REQUIRED. Рост — сигнал, что android_vr деградирует и
    /// пора бампить youtube.innertube в горячем рецепте.
    pub fail_sabr: u64,
    pub fail_login: u64,
}

pub struct EngineState {
    /// Текущий рецепт (уже верифицированный или bundled-дефолт).
    recipe: Mutex<serde_json::Value>,
    cache_limit_bytes: Mutex<u64>,
    stats: Mutex<EngineStats>,
    /// Single-flight: один yt-dlp на трек, параллельный резолв того же трека ждёт.
    inflight: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Оффлайн-пины (Stage 4): id треков, чьи файлы кэша не эвиктятся LRU
    /// и переживают «Очистить кэш». Персист — audio-cache/<ns>/offline-pins.json
    /// (per-namespace: id уникален только внутри БД конкретного окружения, см.
    /// validate_cache_ns). Грузятся лениво первым же командным вызовом с ns.
    pins: Mutex<HashSet<String>>,
    /// Неймспейс, которому принадлежит текущее содержимое `pins`.
    pins_ns: Mutex<Option<String>>,
    /// Прогрев резолва (2026-07-16): метаданные добычи, разрешённые заранее
    /// через `yt-dlp --simulate` (0 байт трафика). Ключ включает ns по той же
    /// причине, что и кэш файлов (баг «чужая песня»). Только в памяти, без
    /// персиста: добытый URL живёт ~6 часов, перезапуск приложения редок, а
    /// файл-состояние с протухающими URL был бы третьим после
    /// recipe-cache.json/offline-pins.json.
    warm: Mutex<HashMap<(String, String), WarmEntry>>,
    /// Живые стримы (Фаза 2): закачка пишет .part и публикует прогресс,
    /// handler протокола muza-stream ждёт нужные байты. Ключ — (ns, track_id).
    streams: Mutex<HashMap<(String, String), StreamHandle>>,
    /// visitorData гостевой InnerTube-сессии (ступень 0). Без него бот-гейт
    /// отбивает 5 из 6 запросов /player (замер 2026-07-19); приходит в каждом
    /// ответе (даже LOGIN_REQUIRED) — кэшируем и переиспользуем до TTL.
    youtube_visitor: Mutex<Option<VisitorData>>,
    /// Негативный кэш ступени 0: video_id → момент свежего провала. Один клик
    /// зовёт ступень 0 из engine_stream_start И engine_resolve — без этой
    /// памяти провал оплачивался бы дважды (до 4 POST / 2 таймаута до
    /// лестницы, корень жалобы «стало медленнее» 2026-07-19).
    stage0_recent_fail: Mutex<HashMap<String, SystemTime>>,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            recipe: Mutex::new(
                serde_json::from_str(DEFAULT_RECIPE_JSON).expect("дефолтный рецепт валиден"),
            ),
            cache_limit_bytes: Mutex::new(DEFAULT_CACHE_LIMIT_BYTES),
            stats: Mutex::new(EngineStats::default()),
            inflight: Mutex::new(HashMap::new()),
            pins: Mutex::new(HashSet::new()),
            pins_ns: Mutex::new(None),
            warm: Mutex::new(HashMap::new()),
            streams: Mutex::new(HashMap::new()),
            youtube_visitor: Mutex::new(None),
            stage0_recent_fail: Mutex::new(HashMap::new()),
        }
    }
}

/// При старте поднимаем последний доверенный рецепт из оффлайн-кэша
/// (подпись перепроверяется — файл мог подменить кто угодно). Оффлайн-пины
/// сюда НЕ грузятся: они per-namespace (см. EngineState.pins) и поднимаются
/// лениво первой командой, знающей cache_ns; корневой offline-pins.json —
/// легаси до неймспейсов, игнорируется.
pub fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let path = dir.join("recipe-cache.json");
    let Ok(raw) = fs::read_to_string(&path) else {
        return;
    };
    let Ok(cached) = serde_json::from_str::<CachedEnvelope>(&raw) else {
        return;
    };
    if verify_recipe(&cached.recipe_json, &cached.sig).is_ok() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&cached.recipe_json) {
            let state = app.state::<EngineState>();
            let mut current = state.recipe.lock().unwrap();
            // Тот же анти-даунгрейд, что в recipe_apply: подписанный, но
            // УСТАРЕВШИЙ кэш не имеет права откатывать бандл-дефолт, который
            // приехал с обновлением приложения (см. cached_recipe_wins).
            let cached_version = value["recipe_version"].as_u64().unwrap_or(0);
            let default_version = current["recipe_version"].as_u64().unwrap_or(0);
            if cached_recipe_wins(cached_version, default_version) {
                *current = value;
            }
        }
    }
}

/// Применять ли оффлайн-кэш рецепта поверх бандл-дефолта. Кэш новее или равен
/// — да (у него настоящая подпись сервера, дефолт лишь копия на момент сборки);
/// кэш старее — нет, иначе `recipe-cache.json` от прошлой версии молча
/// откатывал бы рецепт, приехавший с обновлением приложения.
fn cached_recipe_wins(cached_version: u64, default_version: u64) -> bool {
    cached_version >= default_version
}

fn persist_pins(app: &AppHandle, ns: &str, pins: &HashSet<String>) {
    if let Ok(base) = cache_base(app) {
        if let Ok(path) = pins_file(&base, ns) {
            if let Ok(raw) = serde_json::to_string(pins) {
                let _ = fs::write(path, raw);
            }
        }
    }
}

/// Ленивая подгрузка пинов нужного неймспейса: содержимое `state.pins`
/// принадлежит ровно одному ns; смена ns (теоретическая) перечитывает файл.
fn ensure_pins_loaded(app: &AppHandle, state: &State<'_, EngineState>, ns: &str) {
    {
        let current = state.pins_ns.lock().unwrap();
        if current.as_deref() == Some(ns) {
            return;
        }
    }
    let loaded: HashSet<String> = cache_base(app)
        .and_then(|base| pins_file(&base, ns))
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    *state.pins.lock().unwrap() = loaded;
    *state.pins_ns.lock().unwrap() = Some(ns.to_string());
}

#[derive(Serialize, Deserialize)]
struct CachedEnvelope {
    recipe_json: String,
    sig: String,
}

// ── Рецепт ────────────────────────────────────────────────────────

fn verify_recipe(recipe_json: &str, sig_b64: &str) -> Result<(), String> {
    let spki = base64::engine::general_purpose::STANDARD
        .decode(RECIPE_PUBKEY_SPKI_B64)
        .map_err(|e| format!("pubkey не декодировался: {e}"))?;
    if spki.len() < 32 {
        return Err("pubkey короче 32 байт".into());
    }
    let key_bytes: [u8; 32] = spki[spki.len() - 32..].try_into().unwrap();
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|e| format!("pubkey битый: {e}"))?;
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(sig_b64)
        .map_err(|e| format!("подпись не декодировалась: {e}"))?;
    let sig = Signature::try_from(sig_bytes.as_slice())
        .map_err(|e| format!("подпись не 64 байта: {e}"))?;
    key.verify(recipe_json.as_bytes(), &sig)
        .map_err(|_| "подпись рецепта не сошлась — рецепт отвергнут".to_string())
}

/// Применить конверт рецепта с сервера: проверить подпись вшитым pubkey,
/// защититься от отката версии, запомнить в state и оффлайн-кэш.
/// recipe_json — сырой JSON.stringify(recipe) с клиента (байты подписи).
#[tauri::command]
pub fn recipe_apply(
    app: AppHandle,
    state: State<'_, EngineState>,
    recipe_json: String,
    sig_b64: String,
) -> Result<serde_json::Value, String> {
    verify_recipe(&recipe_json, &sig_b64)?;
    let value: serde_json::Value =
        serde_json::from_str(&recipe_json).map_err(|e| format!("рецепт не JSON: {e}"))?;
    let new_version = value["recipe_version"].as_u64().unwrap_or(0);

    {
        let mut current = state.recipe.lock().unwrap();
        let current_version = current["recipe_version"].as_u64().unwrap_or(0);
        // Анти-даунгрейд: старый (но валидно подписанный) рецепт не затирает новый
        if new_version < current_version {
            return Ok(current.clone());
        }
        *current = value.clone();
    }

    // Оффлайн-кэш последнего доверенного (подпись хранится и перепроверяется при загрузке)
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = fs::create_dir_all(&dir);
        let cached = CachedEnvelope {
            recipe_json,
            sig: sig_b64,
        };
        if let Ok(raw) = serde_json::to_string(&cached) {
            let _ = fs::write(dir.join("recipe-cache.json"), raw);
        }
    }
    Ok(value)
}

/// Текущий рецепт (для фиче-флагов и отладки в UI).
#[tauri::command]
pub fn recipe_current(state: State<'_, EngineState>) -> serde_json::Value {
    state.recipe.lock().unwrap().clone()
}

// ── Резолв и кэш ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "provider", rename_all = "lowercase", deny_unknown_fields)]
pub enum SourceRef {
    Youtube {
        #[serde(rename = "sourceId")]
        source_id: String,
    },
    Soundcloud {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "canonicalUrl")]
        canonical_url: String,
    },
    Bandcamp {
        #[serde(rename = "sourceId")]
        source_id: String,
        #[serde(rename = "canonicalUrl")]
        canonical_url: String,
    },
}

impl SourceRef {
    fn provider(&self) -> &'static str {
        match self {
            Self::Youtube { .. } => "youtube",
            Self::Soundcloud { .. } => "soundcloud",
            Self::Bandcamp { .. } => "bandcamp",
        }
    }
}

fn valid_youtube_id(value: &str) -> bool {
    value.len() == 11
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_opaque_id(value: &str) -> bool {
    value == value.trim() && !value.is_empty() && value.len() <= 256
}

fn lower_alnum(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit()
}

/// SoundCloud/Bandcamp path component: 1..=128 lowercase ASCII bytes.
fn valid_path_slug(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 128
        && lower_alnum(bytes[0])
        && lower_alnum(*bytes.last().unwrap())
        && bytes
            .iter()
            .all(|byte| lower_alnum(*byte) || matches!(*byte, b'-' | b'_'))
}

/// SoundCloud numeric track id: 1..=20 ASCII digits, no leading zero.
fn valid_numeric_track_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 20
        && bytes.iter().all(|byte| byte.is_ascii_digit())
        && (bytes.len() == 1 || bytes[0] != b'0')
}

/// One DNS label before `.bandcamp.com`: 1..=63, no underscore.
fn valid_domain_slug(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 63
        && lower_alnum(bytes[0])
        && lower_alnum(*bytes.last().unwrap())
        && bytes.iter().all(|byte| lower_alnum(*byte) || *byte == b'-')
}

/// Provider locators are accepted only in one byte-canonical spelling. `Url`
/// deliberately normalizes default ports, userinfo, controls and dot segments;
/// reconstructing and comparing raw bytes prevents that normalization from
/// turning hostile input into an apparently trusted destination.
fn byte_canonical_locator(provider: &str, raw: &str) -> Result<Url, String> {
    if !raw.is_ascii()
        || raw
            .bytes()
            .any(|byte| matches!(byte, b'\t' | b'\n' | b'\r' | b'\\'))
    {
        return Err("forbidden raw URL syntax".into());
    }

    let parsed = Url::parse(raw).map_err(|_| "invalid provider URL".to_string())?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("noncanonical provider URL".into());
    }

    let host = match parsed.host() {
        Some(Host::Domain(host)) => host,
        _ => return Err("provider host must be a domain".into()),
    };
    let segments: Vec<&str> = parsed
        .path_segments()
        .ok_or_else(|| "provider URL has no path".to_string())?
        .collect();

    let reconstructed = match provider {
        "soundcloud"
            if host == "soundcloud.com"
                && segments.len() == 2
                && segments.iter().all(|segment| valid_path_slug(segment)) =>
        {
            format!("https://soundcloud.com/{}/{}", segments[0], segments[1])
        }
        // Числовая API-форма: каталог до 2026-07-16 сохранял SoundCloud-источники
        // как api.soundcloud.com/tracks/<URN> — миграция сервера переписала их в
        // /tracks/<цифры> (64% SoundCloud-каталога, иначе «нет живых источников»
        // у половины главной). yt-dlp резолвит форму нативно. Грамматика ровно
        // одна: хост api.soundcloud.com, путь tracks/<1..=20 цифр без ведущего
        // нуля> — ни api-v2, ни URN, ни слэшей сверх того.
        "soundcloud"
            if host == "api.soundcloud.com"
                && segments.len() == 2
                && segments[0] == "tracks"
                && valid_numeric_track_id(segments[1]) =>
        {
            format!("https://api.soundcloud.com/tracks/{}", segments[1])
        }
        "bandcamp"
            if segments.len() == 2 && segments[0] == "track" && valid_path_slug(segments[1]) =>
        {
            let artist = host
                .strip_suffix(".bandcamp.com")
                .filter(|artist| !artist.contains('.') && valid_domain_slug(artist))
                .ok_or_else(|| "invalid Bandcamp artist host".to_string())?;
            format!("https://{artist}.bandcamp.com/track/{}", segments[1])
        }
        _ => return Err("provider URL does not match its canonical grammar".into()),
    };

    if raw.as_bytes() != reconstructed.as_bytes() {
        return Err("provider URL changed during parsing".into());
    }
    Url::parse(&reconstructed).map_err(|_| "reconstructed URL is invalid".to_string())
}

const BLOCKED_V4: &[([u8; 4], u8)] = &[
    ([0, 0, 0, 0], 8),
    ([10, 0, 0, 0], 8),
    ([100, 64, 0, 0], 10),
    ([127, 0, 0, 0], 8),
    ([169, 254, 0, 0], 16),
    ([172, 16, 0, 0], 12),
    ([192, 0, 0, 0], 24),
    ([192, 0, 2, 0], 24),
    ([192, 31, 196, 0], 24),
    ([192, 52, 193, 0], 24),
    ([192, 88, 99, 0], 24),
    ([192, 168, 0, 0], 16),
    ([192, 175, 48, 0], 24),
    ([198, 18, 0, 0], 15),
    ([198, 51, 100, 0], 24),
    ([203, 0, 113, 0], 24),
    ([224, 0, 0, 0], 4),
    ([240, 0, 0, 0], 4),
];

const GLOBAL_V6: (u128, u8) = (0x2000_0000_0000_0000_0000_0000_0000_0000, 3);
const BLOCKED_V6: &[(u128, u8)] = &[
    (0x2001_0000_0000_0000_0000_0000_0000_0000, 23),
    (0x2001_0db8_0000_0000_0000_0000_0000_0000, 32),
    (0x2002_0000_0000_0000_0000_0000_0000_0000, 16),
    (0x3fff_0000_0000_0000_0000_0000_0000_0000, 20),
    (0x5f00_0000_0000_0000_0000_0000_0000_0000, 16),
];

fn in_v4_prefix(ip: Ipv4Addr, base: [u8; 4], prefix: u8) -> bool {
    let mask = u32::MAX << (32_u32 - u32::from(prefix));
    u32::from(ip) & mask == u32::from_be_bytes(base) & mask
}

fn in_v6_prefix(ip: Ipv6Addr, base: u128, prefix: u8) -> bool {
    let mask = u128::MAX << (128_u32 - u32::from(prefix));
    u128::from(ip) & mask == base & mask
}

/// Explicit conservative policy: stable across Rust releases and intentionally
/// stricter than a best-effort `is_global` classification.
fn is_public_ip(ip: IpAddr) -> bool {
    let canonical = match ip {
        IpAddr::V4(ip) => IpAddr::V4(ip),
        IpAddr::V6(ip) => ip.to_canonical(),
    };
    match canonical {
        IpAddr::V4(ip) => !BLOCKED_V4
            .iter()
            .any(|(base, prefix)| in_v4_prefix(ip, *base, *prefix)),
        IpAddr::V6(ip) => {
            in_v6_prefix(ip, GLOBAL_V6.0, GLOBAL_V6.1)
                && !BLOCKED_V6
                    .iter()
                    .any(|(base, prefix)| in_v6_prefix(ip, *base, *prefix))
        }
    }
}

type LookupResult = Result<Vec<IpAddr>, String>;

fn canonical_target_with_lookup(
    source: &SourceRef,
    lookup: &mut impl FnMut(&str, u16) -> LookupResult,
) -> Result<Url, String> {
    let target = match source {
        SourceRef::Youtube { source_id } => {
            if !valid_youtube_id(source_id) {
                return Err("invalid YouTube source id".into());
            }
            let mut target =
                Url::parse("https://www.youtube.com/watch").expect("static YouTube URL is valid");
            target.query_pairs_mut().append_pair("v", source_id);
            let pairs: Vec<_> = target.query_pairs().collect();
            if pairs.len() != 1 || pairs[0].0 != "v" || pairs[0].1 != source_id.as_str() {
                return Err("invalid YouTube target query".into());
            }
            target
        }
        SourceRef::Soundcloud {
            source_id,
            canonical_url,
        } => {
            if !valid_opaque_id(source_id) {
                return Err("invalid SoundCloud source id".into());
            }
            byte_canonical_locator("soundcloud", canonical_url)?
        }
        SourceRef::Bandcamp {
            source_id,
            canonical_url,
        } => {
            if !valid_opaque_id(source_id) {
                return Err("invalid Bandcamp source id".into());
            }
            byte_canonical_locator("bandcamp", canonical_url)?
        }
    };

    let host = target
        .host_str()
        .ok_or_else(|| "provider target has no host".to_string())?;
    // Best-effort, а не гейт. Хост здесь — уже константа грамматики выше
    // (youtube.com / soundcloud.com / <slug>.bandcamp.com), подставить чужой
    // адрес неоткуда, а пин ответов всё равно невозможен — yt-dlp резолвит
    // заново (см. док к canonical_target). Зато ЭТОТ резолвер не видит
    // системный/env-прокси: за DPI-обходом, VPN или корпоративным прокси
    // getaddrinfo отдаёт NXDOMAIN, тогда как yt-dlp тем же хостом ходит через
    // прокси и добывает трек. Поэтому «не смогли узнать адрес» = молчим и
    // пускаем попытку; режем только когда DNS реально ответил приватным
    // адресом. Регрессия «Couldn't fetch the track» 2026-07-15.
    if let Ok(answers) = lookup(host, 443) {
        if !answers.is_empty() && answers.iter().copied().any(|answer| !is_public_ip(answer)) {
            return Err("provider DNS returned a non-public address".into());
        }
    }
    Ok(target)
}

/// Production DNS preflight. It prevents renderer-selected private/local
/// destinations, but does not pin these answers: yt-dlp resolves again and can
/// follow redirects. Per-hop enforcement still belongs in an egress proxy or
/// process/network sandbox.
fn canonical_target(source: &SourceRef) -> Result<Url, String> {
    let mut lookup = |host: &str, port: u16| {
        debug_assert_eq!(port, 443);
        (host, 443)
            .to_socket_addrs()
            .map(|answers| answers.map(|answer| answer.ip()).collect())
            .map_err(|error| format!("DNS lookup failed: {error}"))
    };
    canonical_target_with_lookup(source, &mut lookup)
}

#[derive(Debug, Serialize)]
pub struct ResolveOut {
    /// Абсолютный путь к файлу в кэше — JS оборачивает его в convertFileSrc.
    pub path: String,
    pub from_cache: bool,
    /// Провайдер, из которого добыли (None у кэш-хита — уже не важно).
    pub provider: Option<String>,
}

/// Неймспейс кэша: короткий слаг окружения API (фронт передаёт хэш origin'а).
/// Причина (баг «чужая песня», 2026-07-14): track_id уникален только ВНУТРИ
/// конкретной БД; один общий каталог по голому id отравлялся при смене
/// окружения (dev localhost ↔ prod) — клик по треку играл аудио одноимённого
/// id из другой базы. Кэш и пины живут в audio-cache/<ns>/.
fn validate_cache_ns(ns: &str) -> Result<(), String> {
    let ok = !ns.is_empty()
        && ns.len() <= 32
        && ns.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && ns
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok {
        Ok(())
    } else {
        Err(format!("некорректный cache_ns: {ns:?}"))
    }
}

/// Легаси-файл до неймспейсов: аудио с числовым stem (`<track_id>.<ext>`)
/// или обломок yt-dlp. Такие файлы в КОРНЕ audio-cache ядовиты (окружение
/// неизвестно) — выметаются при каждом старте.
fn is_legacy_root_cache_file(name: &str) -> bool {
    if name.ends_with(".part") || name.ends_with(".ytdl") {
        return true;
    }
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    const AUDIO_EXTS: [&str; 6] = ["webm", "m4a", "mp3", "opus", "ogg", "aac"];
    !stem.is_empty()
        && stem.chars().all(|c| c.is_ascii_digit())
        && AUDIO_EXTS.contains(&ext.to_ascii_lowercase().as_str())
}

fn namespaced_cache_dir(base: &Path, ns: &str) -> Result<PathBuf, String> {
    validate_cache_ns(ns)?;
    // одноразовая (идемпотентная) зачистка ядовитого легаси в корне
    if let Ok(entries) = fs::read_dir(base) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name();
            if is_legacy_root_cache_file(&name.to_string_lossy()) {
                let _ = fs::remove_file(&path);
            }
        }
    }
    let dir = base.join(ns);
    fs::create_dir_all(&dir).map_err(|e| format!("не создался кэш-каталог: {e}"))?;
    Ok(dir)
}

fn pins_file(base: &Path, ns: &str) -> Result<PathBuf, String> {
    Ok(namespaced_cache_dir(base, ns)?.join("offline-pins.json"))
}

fn cache_base(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("нет app_data_dir: {e}"))?
        .join("audio-cache");
    fs::create_dir_all(&dir).map_err(|e| format!("не создался кэш-каталог: {e}"))?;
    Ok(dir)
}

fn cache_dir(app: &AppHandle, ns: &str) -> Result<PathBuf, String> {
    namespaced_cache_dir(&cache_base(app)?, ns)
}

/// Файл кэша трека: `<track_id>.<ext>` (ext заранее неизвестен — webm/m4a/…).
fn find_cached(dir: &Path, track_id: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // .part/.ytdl — недокачанные обломки yt-dlp, их не отдаём
        if name.ends_with(".part") || name.ends_with(".ytdl") {
            continue;
        }
        if path
            .file_stem()
            .map(|s| s.to_string_lossy() == track_id)
            .unwrap_or(false)
        {
            return Some(path);
        }
    }
    None
}

#[derive(Clone, Debug)]
struct SidecarPaths {
    ytdlp: PathBuf,
    deno: PathBuf,
}

fn regular_sidecar(path: &Path, label: &str) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("{label} sidecar недоступен ({}): {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(format!(
            "{label} sidecar должен быть обычным файлом без symlink ({})",
            path.display()
        ));
    }
    Ok(path.to_path_buf())
}

/// Release доверяет только двум обычным файлам рядом с текущим exe. Эта
/// функция намеренно не читает env/PATH и также используется диагностикой.
fn release_sidecar_paths(exe_path: &Path) -> Result<SidecarPaths, String> {
    if !exe_path.is_absolute() {
        return Err("путь приложения для release sidecar должен быть абсолютным".into());
    }
    let dir = exe_path
        .parent()
        .ok_or_else(|| "у пути приложения нет родительского каталога".to_string())?;
    Ok(SidecarPaths {
        ytdlp: regular_sidecar(&dir.join("yt-dlp.exe"), "yt-dlp")?,
        deno: regular_sidecar(&dir.join("deno.exe"), "Deno")?,
    })
}

#[cfg(debug_assertions)]
fn canonical_debug_sidecar(path: &Path, label: &str) -> Result<PathBuf, String> {
    regular_sidecar(path, label)?;
    let canonical = fs::canonicalize(path).map_err(|error| {
        format!(
            "не удалось канонизировать {label} debug sidecar ({}): {error}",
            path.display()
        )
    })?;
    regular_sidecar(&canonical, label)
}

#[cfg(debug_assertions)]
fn debug_sidecar_path(
    adjacent: &Path,
    env_key: &str,
    executable_name: &str,
    label: &str,
) -> Result<PathBuf, String> {
    if let Ok(path) = canonical_debug_sidecar(adjacent, label) {
        return Ok(path);
    }

    if let Some(raw) = std::env::var_os(env_key) {
        if !raw.is_empty() {
            return canonical_debug_sidecar(&PathBuf::from(raw), label);
        }
    }

    if let Some(path_value) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_value) {
            let candidate = dir.join(executable_name);
            if let Ok(path) = canonical_debug_sidecar(&candidate, label) {
                return Ok(path);
            }
        }
    }

    Err(format!(
        "{label} debug sidecar не найден рядом с приложением, в {env_key} или PATH"
    ))
}

fn sidecar_paths() -> Result<SidecarPaths, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("не удалось определить путь приложения: {error}"))?;
    match release_sidecar_paths(&exe) {
        Ok(paths) => Ok(paths),
        Err(release_error) => {
            #[cfg(debug_assertions)]
            {
                let dir = exe
                    .parent()
                    .ok_or_else(|| "у пути приложения нет родительского каталога".to_string())?;
                let debug_paths: Result<SidecarPaths, String> = (|| {
                    Ok(SidecarPaths {
                        ytdlp: debug_sidecar_path(
                            &dir.join("yt-dlp.exe"),
                            "MUZA_YTDLP_PATH",
                            "yt-dlp.exe",
                            "yt-dlp",
                        )?,
                        deno: debug_sidecar_path(
                            &dir.join("deno.exe"),
                            "MUZA_DENO_PATH",
                            "deno.exe",
                            "Deno",
                        )?,
                    })
                })();
                debug_paths.map_err(|debug_error| {
                    format!("{release_error}; debug fallback: {debug_error}")
                })
            }
            #[cfg(not(debug_assertions))]
            {
                Err(release_error)
            }
        }
    }
}

/// Запуск дочернего процесса без консольного окна (Windows).
fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Подождать ребёнка не дольше timeout; на таймауте — убить.
fn wait_with_timeout(
    child: &mut Child,
    timeout: Duration,
) -> Result<std::process::ExitStatus, String> {
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("yt-dlp не уложился в таймаут".into());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(format!("ожидание yt-dlp: {e}")),
        }
    }
}

/// Классификация провала попытки по stderr — для KPI аналитики (SABR/403/бот).
fn classify_failure(stats: &mut EngineStats, stderr: &str) {
    let low = stderr.to_lowercase();
    if low.contains("403") || low.contains("forbidden") {
        stats.fail_403 += 1;
    } else if low.contains("sign in to confirm") || low.contains("bot") {
        stats.fail_bot += 1;
    } else if low.contains("requested format is not available") || low.contains("no video formats")
    {
        // SABR-only сессия отдаёт форматы без URL — yt-dlp видит «нет форматов»
        stats.fail_format += 1;
    } else {
        stats.fail_other += 1;
    }
}

struct Attempt {
    provider: String,
    url: Url,
    /// Для youtube — конкретный player_client из рецепта; иначе None.
    client: Option<String>,
}

/// Лестница попыток + причины, по которым источники были отброшены. Причины
/// нужны, когда попыток не осталось вовсе: без них наружу уходит безликое «у
/// трека нет живых источников», и отладка идёт вслепую (регрессия 2026-07-15 —
/// целая сессия расследования на молчаливый `continue`).
struct Attempts {
    attempts: Vec<Attempt>,
    drops: Vec<String>,
}

fn build_attempts_from_targets(
    sources: &[SourceRef],
    clients: &[String],
    mut target_for: impl FnMut(&SourceRef) -> Result<Url, String>,
) -> Attempts {
    let mut attempts = Vec::new();
    let mut drops = Vec::new();
    for source in sources {
        let url = match target_for(source) {
            Ok(url) => url,
            Err(reason) => {
                drops.push(format!("{}: {reason}", source.provider()));
                continue;
            }
        };
        let provider = source.provider().to_string();
        match source {
            SourceRef::Youtube { .. } => {
                for client in clients {
                    attempts.push(Attempt {
                        provider: provider.clone(),
                        url: url.clone(),
                        client: Some(client.clone()),
                    });
                }
            }
            SourceRef::Soundcloud { .. } | SourceRef::Bandcamp { .. } => {
                attempts.push(Attempt {
                    provider,
                    url,
                    client: None,
                });
            }
        }
    }
    Attempts { attempts, drops }
}

#[cfg(test)]
fn build_attempts_with_lookup(
    sources: &[SourceRef],
    clients: &[String],
    lookup: &mut impl FnMut(&str, u16) -> LookupResult,
) -> Vec<Attempt> {
    build_attempts_from_targets(sources, clients, |source| {
        canonical_target_with_lookup(source, lookup)
    })
    .attempts
}

fn build_attempts(sources: &[SourceRef], clients: &[String]) -> Attempts {
    build_attempts_from_targets(sources, clients, canonical_target)
}

fn build_ytdlp_args(
    dir: &Path,
    track_id: &str,
    attempt: &Attempt,
    format_str: &str,
    deno_path: &Path,
) -> Vec<OsString> {
    let mut args = vec![
        OsString::from("--ignore-config"),
        OsString::from("--no-playlist"),
        OsString::from("--max-downloads"),
        OsString::from("1"),
        OsString::from("--max-filesize"),
        OsString::from("512M"),
        OsString::from("--js-runtimes"),
        OsString::from(format!("deno:{}", deno_path.display())),
        OsString::from("-f"),
        OsString::from(format_str),
        OsString::from("--no-warnings"),
        OsString::from("--no-progress"),
        OsString::from("--socket-timeout"),
        OsString::from("15"),
        OsString::from("--retries"),
        OsString::from("2"),
        OsString::from("--print"),
        OsString::from("after_move:filepath"),
        OsString::from("--no-simulate"),
        OsString::from("-P"),
        dir.as_os_str().to_os_string(),
        OsString::from("-o"),
        OsString::from(format!("{track_id}.%(ext)s")),
    ];
    if let Some(client) = &attempt.client {
        args.push(OsString::from("--extractor-args"));
        args.push(OsString::from(format!("youtube:player_client={client}")));
    }
    args.push(OsString::from(attempt.url.as_str()));
    args
}

fn validate_ytdlp_output_with_canonicalizer(
    cache_dir: &Path,
    candidate: &Path,
    canonicalize: &mut impl FnMut(&Path) -> std::io::Result<PathBuf>,
) -> Result<PathBuf, String> {
    let canonical_cache = canonicalize(cache_dir).map_err(|error| {
        format!(
            "не удалось канонизировать кэш-каталог ({}): {error}",
            cache_dir.display()
        )
    })?;
    let canonical_candidate = canonicalize(candidate).map_err(|error| {
        format!(
            "yt-dlp вернул недоступный путь ({}): {error}",
            candidate.display()
        )
    })?;

    if canonical_candidate == canonical_cache || !canonical_candidate.starts_with(&canonical_cache)
    {
        return Err(format!(
            "yt-dlp вернул путь вне кэша: {}",
            canonical_candidate.display()
        ));
    }

    let cache_metadata = fs::metadata(&canonical_cache)
        .map_err(|error| format!("не удалось проверить кэш-каталог: {error}"))?;
    if !cache_metadata.is_dir() {
        return Err("канонический путь кэша не является каталогом".into());
    }

    let supplied_metadata = fs::symlink_metadata(candidate)
        .map_err(|error| format!("не удалось проверить путь результата yt-dlp: {error}"))?;
    if supplied_metadata.file_type().is_symlink() {
        return Err("yt-dlp вернул symlink вместо аудиофайла".into());
    }

    let metadata = fs::symlink_metadata(&canonical_candidate)
        .map_err(|error| format!("не удалось проверить результат yt-dlp: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err("результат yt-dlp не является обычным файлом".into());
    }
    if metadata.len() == 0 {
        return Err("скачанный файл пуст".into());
    }
    if metadata.len() > MAX_YTDLP_OUTPUT_BYTES {
        return Err("скачанный файл превышает лимит 512 МиБ".into());
    }

    Ok(canonical_candidate)
}

fn validate_ytdlp_output(cache_dir: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let mut canonicalize = |path: &Path| fs::canonicalize(path);
    validate_ytdlp_output_with_canonicalizer(cache_dir, candidate, &mut canonicalize)
}

/// yt-dlp упирается в `--max-downloads` РОВНО ПОСЛЕ успешного скачивания
/// единственного видео и выходит кодом 101 (MaxDownloadsReached). Это не
/// ошибка: файл уже на диске, путь напечатан в stdout. Считать 101 провалом =
/// выбрасывать КАЖДУЮ удачную добычу.
///
/// Регрессия `48b845b` (security-хардening добавил `--max-downloads 1`).
/// Маскировалась кэш-хитами — `engine_resolve` отдаёт кэш ДО лестницы, поэтому
/// уже скачанное играло. Смена неймспейса кэша в v0.1.1 обнулила кэш → пошла
/// свежая добыча → «Couldn't fetch the track» на ВСЕХ источниках сразу
/// (флаг общий для youtube/soundcloud/bandcamp). Радио = 100% cache-miss,
/// поэтому вскрыло мгновенно.
const YTDLP_MAX_DOWNLOADS_REACHED: i32 = 101;

fn ytdlp_exit_ok(code: Option<i32>) -> bool {
    matches!(code, Some(0) | Some(YTDLP_MAX_DOWNLOADS_REACHED))
}

/// Одна попытка yt-dlp: скачать лучший аудио-формат по рецепту в кэш-каталог.
/// Успех — абсолютный путь скачанного файла (--print after_move:filepath).
fn run_ytdlp_once(
    ytdlp: &Path,
    deno: &Path,
    dir: &Path,
    track_id: &str,
    attempt: &Attempt,
    format_str: &str,
) -> Result<PathBuf, String> {
    let mut cmd = command(ytdlp);
    cmd.args(build_ytdlp_args(dir, track_id, attempt, format_str, deno));
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("yt-dlp не запустился ({}): {e}", ytdlp.display()))?;
    let status = wait_with_timeout(&mut child, RESOLVE_TIMEOUT)?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout);
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr);
    }

    if !ytdlp_exit_ok(status.code()) {
        // Последняя строка stderr — обычно самое осмысленное сообщение yt-dlp
        let last = stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("yt-dlp упал без stderr");
        return Err(last.to_string());
    }
    let path_line = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .ok_or("yt-dlp не вернул путь к файлу")?;
    let path = PathBuf::from(path_line.trim());
    validate_ytdlp_output(dir, &path)
}

/// LRU-эвикция: суммарный размер кэша держим в пределах лимита,
/// первыми уходят самые давно не игравшие (mtime — touch при каждом хите).
/// Оффлайн-пины (Stage 4) не эвиктятся — «сохранить оффлайн» и означает
/// «файл живёт, пока пользователь сам не передумал».
fn evict_lru(dir: &Path, limit_bytes: u64, keep: &Path, pins: &HashSet<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if !path.is_file() {
                return None;
            }
            let meta = e.metadata().ok()?;
            Some((path, meta.len(), meta.modified().ok()?))
        })
        .collect();
    let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
    if total <= limit_bytes {
        return;
    }
    files.sort_by_key(|(_, _, mtime)| *mtime);
    for (path, size, _) in files {
        if total <= limit_bytes {
            break;
        }
        // Свежий .part — возможно, живой стрим Фазы 2: не сносим на ходу
        // (старый .part — мусор, идёт под общую уборку)
        if path == keep || is_pinned(&path, pins) || is_live_stream_part(&path) {
            continue;
        }
        // Файл может быть занят плеером — просто пропускаем, удалим в другой раз
        if fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

fn is_pinned(path: &Path, pins: &HashSet<String>) -> bool {
    path.file_stem()
        .map(|s| pins.contains(s.to_string_lossy().as_ref()))
        .unwrap_or(false)
}

// ── Прогрев резолва (Фаза 1, 2026-07-16) ──────────────────────────
// Разбивка 4.5с кэш-мисса (замер 2026-07-15): 1.2с старт yt-dlp + ~2.1с
// сеть-резолв + 1.2с байты. Добытый googlevideo-URL живёт ~6ч, а
// `--simulate --print` резолвит метаданные за 0 байт трафика — значит резолв
// можно сделать заранее (engine_warm), а на клике оставить только байты
// (fetch_to_cache): ~4.5с → ~1.2с. Дизайн и инварианты безопасности —
// docs/notes/2026-07-16-прогрев-и-стрим-дизайн.md.

/// Запас до `expire` URL: не начинаем скачивание впритык к протуханию.
const WARM_EXPIRY_MARGIN: Duration = Duration::from_secs(300);
/// TTL записи без `expire` в URL (SoundCloud/Bandcamp): консервативно коротко.
const WARM_FALLBACK_TTL: Duration = Duration::from_secs(600);
/// Потолок записей прогрева (защита памяти от многочасовой сессии).
const WARM_MAX_ENTRIES: usize = 512;

/// Прогретые метаданные одного трека: прямой CDN-URL + размер + расширение.
/// Провайдер — для ResolveOut быстрого пути (той же формы, что у лестницы).
#[derive(Debug, Clone)]
struct WarmEntry {
    url: Url,
    size: u64,
    ext: String,
    provider: String,
    expires_at: SystemTime,
}

/// Разобранный выхлоп `--print` прогрева (см. build_ytdlp_simulate_args).
#[derive(Debug, PartialEq)]
struct SimulatedFormat {
    url: String,
    size: u64,
    ext: String,
}

/// Прогресс живого стрима (Фаза 2): публикуется закачкой после каждого чанка.
/// total здесь, а не в StreamHandle: warm-оценка (filesize_approx) могла
/// разойтись с настоящим размером из Content-Range — handler обязан считать
/// Content-Range ответа по ПОСЛЕДНЕЙ правде, иначе <audio> ждал бы байты,
/// которых не существует.
#[derive(Debug, Clone, Copy)]
struct StreamProgress {
    written: u64,
    total: u64,
    /// rename прошёл — файл стал валидным кэшем.
    finalized: bool,
    failed: bool,
}

/// Живой стрим в реестре EngineState.streams: пути + канал прогресса.
#[derive(Clone)]
struct StreamHandle {
    part: PathBuf,
    final_path: PathBuf,
    progress: tokio::sync::watch::Receiver<StreamProgress>,
}

/// argv прогрева — ОТДЕЛЬНАЯ функция, а не правка build_ytdlp_args: боевой
/// argv security-hardened и покрыт своими тестами, смешивать режимы флагом
/// значило бы перепроверять оба пути на каждую правку. Отличия от боя:
/// `--simulate` вместо `--no-simulate` (0 байт трафика), `--print` метаданных
/// вместо пути файла, нет `--max-downloads` (без скачивания бессмыслен, а его
/// exit-101 маскировал бы ошибки — см. simulate_exit_ok), нет `-P`/`-o`
/// (выходного файла не будет). `--max-filesize` ОСТАЁТСЯ: он фильтрует
/// лестницу форматов на резолве, прогрев обязан видеть ту же лестницу, что бой.
fn build_ytdlp_simulate_args(
    attempt: &Attempt,
    format_str: &str,
    deno_path: &Path,
) -> Vec<OsString> {
    let mut args = vec![
        OsString::from("--ignore-config"),
        OsString::from("--no-playlist"),
        OsString::from("--max-filesize"),
        OsString::from("512M"),
        OsString::from("--js-runtimes"),
        OsString::from(format!("deno:{}", deno_path.display())),
        OsString::from("-f"),
        OsString::from(format_str),
        OsString::from("--no-warnings"),
        OsString::from("--no-progress"),
        OsString::from("--socket-timeout"),
        OsString::from("15"),
        OsString::from("--retries"),
        OsString::from("2"),
        OsString::from("--simulate"),
        OsString::from("--print"),
        // protocol — 4-м полем не для красоты: hls/dash-форматы (SoundCloud
        // без progressive) печатают в %(url)s МАНИФЕСТ; скачав его, прогрев
        // положил бы в кэш текст вместо аудио (см. parse_simulate_output).
        OsString::from("%(url)s\t%(filesize,filesize_approx)s\t%(ext)s\t%(protocol)s"),
    ];
    if let Some(client) = &attempt.client {
        args.push(OsString::from("--extractor-args"));
        args.push(OsString::from(format!("youtube:player_client={client}")));
    }
    args.push(OsString::from(attempt.url.as_str()));
    args
}

/// Успех simulate — ТОЛЬКО 0. Переиспользовать ytdlp_exit_ok нельзя: боевой
/// 101 (MaxDownloadsReached) означает «скачал и упёрся в --max-downloads», у
/// simulate скачивания нет и 101 может быть только ошибкой.
fn simulate_exit_ok(code: Option<i32>) -> bool {
    code == Some(0)
}

/// Расширение станет именем файла кэша `<id>.<ext>` — грамматика жёсткая:
/// 1..=8 строчных ASCII-букв/цифр, никаких точек/слэшей (yt-dlp отдаёт
/// webm/m4a/opus/mp3 — всё влезает).
fn valid_warm_ext(ext: &str) -> bool {
    !ext.is_empty()
        && ext.len() <= 8
        && ext
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// Разбор `--print "%(url)s\t%(filesize,filesize_approx)s\t%(ext)s\t%(protocol)s"`.
/// Как run_ytdlp_once: наша строка — последняя непустая в stdout. Протокол
/// принимается только "https" (прямой файл): hls/dash кладут в %(url)s
/// манифест, скачивание которого отравило бы кэш текстом вместо аудио и
/// сделало трек неиграбельным — прямое нарушение инварианта прогрева.
/// Размер обязателен (не "NA"): без него не построить явный Range, а без
/// Range googlevideo троттлит до 32 КБ/с (замер 2026-07-15).
fn parse_simulate_output(stdout: &str) -> Result<SimulatedFormat, String> {
    let line = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .ok_or("yt-dlp --simulate не напечатал метаданные")?;
    let fields: Vec<&str> = line.split('\t').collect();
    let [url, size, ext, protocol] = fields.as_slice() else {
        return Err(format!("неожиданный выхлоп simulate: {line:?}"));
    };
    if *protocol != "https" {
        return Err(format!("формат с протоколом {protocol:?} не прогревается (нужен прямой https)"));
    }
    let size: u64 = size
        .parse()
        .map_err(|_| format!("simulate не отдал размер файла: {size:?}"))?;
    if !valid_warm_ext(ext) {
        return Err(format!("подозрительное расширение из simulate: {ext:?}"));
    }
    if url.trim().is_empty() {
        return Err("simulate отдал пустой URL".into());
    }
    Ok(SimulatedFormat {
        url: (*url).to_string(),
        size,
        ext: (*ext).to_string(),
    })
}

/// Срок жизни warm-записи: `expire` из query URL (unix-секунды у googlevideo)
/// минус запас — не начинаем скачивание впритык к протуханию. Нет/битый
/// expire (SoundCloud/Bandcamp) — консервативный короткий TTL.
fn warm_expires_at(url: &Url, now: SystemTime) -> SystemTime {
    let expire = url
        .query_pairs()
        .find(|(k, _)| k == "expire")
        .and_then(|(_, v)| v.parse::<u64>().ok());
    match expire {
        Some(secs) => SystemTime::UNIX_EPOCH + Duration::from_secs(secs) - WARM_EXPIRY_MARGIN,
        None => now + WARM_FALLBACK_TTL,
    }
}

/// Новая граница доверия (по сравнению с боевым путём): по добытому URL ходит
/// не yt-dlp, а МЫ (reqwest в fetch_to_cache). Валидация: только https, без
/// credentials, хост — домен (не IP-литерал), DNS-ответ — публичный по той же
/// prefix-policy (is_public_ip), что и canonical_target. Домен CDN намеренно
/// НЕ whitelist-ится: список хостов googlevideo/SoundCloud плавает, whitelist
/// ломал бы прогрев молча, а планку не поднимает — yt-dlp и сегодня резолвит
/// домен заново и следует редиректам (см. «Остаточный риск» ниже).
///
/// Остаточный риск (честно): это валидация ответа, а не пиннинг —
/// reqwest резолвит заново и следует редиректам; полностью SSRF закрывается
/// только egress-proxy/firewall, как и было записано про yt-dlp.
fn validate_warm_url_with_lookup(
    raw: &str,
    lookup: &mut impl FnMut(&str, u16) -> LookupResult,
) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|_| "warm-URL не парсится".to_string())?;
    if parsed.scheme() != "https" {
        return Err("warm-URL не https".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("warm-URL с credentials".into());
    }
    let host = match parsed.host() {
        Some(Host::Domain(host)) => host.to_string(),
        _ => return Err("warm-URL хост — не домен".into()),
    };
    // Best-effort, не гейт — та же философия, что DNS-преflight
    // canonical_target: за DPI-обходом/прокси локальный getaddrinfo врёт
    // NXDOMAIN, тогда как reqwest тем же хостом ходит через прокси. Режем
    // только реальный приватный ответ.
    if let Ok(answers) = lookup(&host, 443) {
        if !answers.is_empty() && answers.iter().copied().any(|answer| !is_public_ip(answer)) {
            return Err("warm-URL резолвится в непубличный адрес".into());
        }
    }
    Ok(parsed)
}

fn validate_warm_url(raw: &str) -> Result<Url, String> {
    let mut lookup = |host: &str, port: u16| {
        debug_assert_eq!(port, 443);
        (host, 443)
            .to_socket_addrs()
            .map(|answers| answers.map(|answer| answer.ip()).collect())
            .map_err(|error| format!("DNS lookup failed: {error}"))
    };
    validate_warm_url_with_lookup(raw, &mut lookup)
}

/// Заявленный размер: >0 и в лимите кэша (тот же 512 МиБ, что у yt-dlp-пути).
fn content_length_ok(len: u64) -> bool {
    len > 0 && len <= MAX_YTDLP_OUTPUT_BYTES
}

/// `Content-Range: bytes 0-<end>/<total>` 206-ответа. total — ИСТИННЫЙ размер
/// файла (filesize_approx из simulate мог наврать; обрезанный файл в кэше
/// хуже медленного старта — см. fetch_to_cache). Диапазоны не с нуля и
/// звёздочки не принимаем: мы всегда просим bytes=0-…
fn parse_content_range(value: &str) -> Option<(u64, u64)> {
    let rest = value.strip_prefix("bytes ")?;
    let (range, total) = rest.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    if start != "0" {
        return None;
    }
    Some((end.parse().ok()?, total.parse().ok()?))
}

/// `Range: bytes=<start>-[<end>]` запроса `<audio>` (протокол muza-stream,
/// Фаза 2). Поддержан ровно тот диалект, которым говорят медиа-стеки:
/// одиночный диапазон от start. Мульти-диапазон и суффиксную форму
/// (`bytes=-500`) не поддерживаем: None = «отвечай 200 целиком» — законно.
fn parse_range_header(value: &str) -> Option<(u64, Option<u64>)> {
    let rest = value.strip_prefix("bytes=")?;
    let (start, end) = rest.split_once('-')?;
    if end.contains(',') {
        return None;
    }
    let start: u64 = start.parse().ok()?;
    if end.is_empty() {
        return Some((start, None));
    }
    let end: u64 = end.parse().ok()?;
    if end < start {
        return None;
    }
    Some((start, Some(end)))
}

fn warm_key(ns: &str, track_id: &str) -> (String, String) {
    (ns.to_string(), track_id.to_string())
}

fn store_warm_entry(state: &EngineState, ns: &str, track_id: &str, entry: WarmEntry) {
    let mut warm = state.warm.lock().unwrap();
    if warm.len() >= WARM_MAX_ENTRIES {
        // сперва дёшево выкидываем протухшие; если живых всё ещё потолок —
        // жертвуем самой близкой к протуханию (она наименее ценна)
        let now = SystemTime::now();
        warm.retain(|_, e| e.expires_at > now);
        if warm.len() >= WARM_MAX_ENTRIES {
            if let Some(key) = warm
                .iter()
                .min_by_key(|(_, e)| e.expires_at)
                .map(|(k, _)| k.clone())
            {
                warm.remove(&key);
            }
        }
    }
    warm.insert(warm_key(ns, track_id), entry);
}

/// Изъятие ОДНОРАЗОВОЕ: быстрый путь engine_resolve берёт запись и либо
/// доводит её до файла в кэше, либо она уже выброшена — «молча выбросить и
/// упасть на лестницу» получается самим take. Протухшее удаляется на месте.
fn take_live_warm_entry(
    state: &EngineState,
    ns: &str,
    track_id: &str,
    now: SystemTime,
) -> Option<WarmEntry> {
    let mut warm = state.warm.lock().unwrap();
    let key = warm_key(ns, track_id);
    let entry = warm.remove(&key)?;
    if entry.expires_at > now {
        Some(entry)
    } else {
        None
    }
}

/// Неразрушающая проверка для engine_warm: живая запись уже есть — греть
/// нечего. Протухшая выбрасывается сразу (иначе бы врала до первого take).
fn has_live_warm_entry(state: &EngineState, ns: &str, track_id: &str, now: SystemTime) -> bool {
    let mut warm = state.warm.lock().unwrap();
    let key = warm_key(ns, track_id);
    match warm.get(&key) {
        Some(entry) if entry.expires_at > now => true,
        Some(_) => {
            warm.remove(&key);
            false
        }
        None => false,
    }
}

/// Одна попытка прогрева: тот же процесс yt-dlp, что run_ytdlp_once, но
/// `--simulate --print` — метаданные без единого байта аудио (~2-4с против
/// ~4.5с полной добычи; трафик 0). Успех — прямой CDN-URL + размер + ext.
fn run_ytdlp_simulate(
    ytdlp: &Path,
    deno: &Path,
    attempt: &Attempt,
    format_str: &str,
) -> Result<SimulatedFormat, String> {
    let mut cmd = command(ytdlp);
    cmd.args(build_ytdlp_simulate_args(attempt, format_str, deno));
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("yt-dlp не запустился ({}): {e}", ytdlp.display()))?;
    let status = wait_with_timeout(&mut child, RESOLVE_TIMEOUT)?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout);
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr);
    }

    if !simulate_exit_ok(status.code()) {
        let last = stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("yt-dlp --simulate упал без stderr");
        return Err(last.to_string());
    }
    parse_simulate_output(&stdout)
}

/// Общий HTTP-клиент прогрева: пул соединений/тлс-сессий между прогревом и
/// кликом (тот же CDN-хост) экономит рукопожатие на пути «клик → звук».
fn warm_http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client строится")
    })
}

/// Скачивание по прогретому URL в кэш — замена всего процесса yt-dlp на один
/// GET, когда метаданные уже разрешены прогревом.
///
/// Инварианты боевого пути сохраняются ЗДЕСЬ (см. таблицу в
/// docs/notes/2026-07-16-прогрев-и-стрим-дизайн.md):
/// - явный `Range: bytes=0-<size-1>` обязателен — обычный GET по googlevideo
///   троттлится до 32 КБ/с (замер 2026-07-15: 802 КБ за 25с против 1.2с);
/// - лимит 512 МиБ трижды: заявленный размер до запроса, Content-Length /
///   Content-Range до чтения тела, счётчик байт при записи (заголовки врут
///   бесплатно);
/// - целостность: сколько CDN заявил (total из Content-Range/Content-Length),
///   столько и записали — иначе .part удаляется (filesize_approx из simulate
///   мог наврать, обрезанное аудио в кэше хуже медленного старта);
/// - результат становится кэшем только атомарным rename ПОСЛЕ полной записи;
///   `.part` не может стать кэш-хитом (find_cached, тест part_file_is_not_a_cache_hit);
/// - `validate_ytdlp_output` на финальном пути — буквально та же функция.
async fn fetch_to_cache(dir: &Path, track_id: &str, entry: &WarmEntry) -> Result<PathBuf, String> {
    fetch_to_cache_with_progress(dir, track_id, entry, None).await
}

/// То же скачивание, но с публикацией прогресса для протокола muza-stream
/// (Фаза 2): стрим и заполнение кэша — ОДНА закачка, не две.
async fn fetch_to_cache_with_progress(
    dir: &Path,
    track_id: &str,
    entry: &WarmEntry,
    progress: Option<&tokio::sync::watch::Sender<StreamProgress>>,
) -> Result<PathBuf, String> {
    if !content_length_ok(entry.size) {
        return Err(format!("warm-размер вне лимита: {}", entry.size));
    }
    let resp = warm_http_client()
        .get(entry.url.clone())
        .header("Range", format!("bytes=0-{}", entry.size - 1))
        .timeout(RESOLVE_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("warm GET не ушёл: {e}"))?;

    let status = resp.status();
    // total — сколько байт СУЩЕСТВУЕТ у CDN: у 206 — из Content-Range (наш
    // Range мог попросить меньше или больше реального), у 200 — Content-Length.
    let total = match status.as_u16() {
        206 => {
            let (end, total) = resp
                .headers()
                .get("Content-Range")
                .and_then(|v| v.to_str().ok())
                .and_then(parse_content_range)
                .ok_or("206 без разборчивого Content-Range")?;
            if end + 1 != total {
                // CDN отдаёт кусок меньше файла (настоящий размер больше
                // simulate-оценки) — привезли бы обрезанное аудио
                return Err(format!("warm-ответ неполный: {end}+1 из {total}"));
            }
            total
        }
        200 => resp
            .content_length()
            .ok_or("200 без Content-Length — размер не проверить")?,
        other => return Err(format!("warm GET: статус {other}")),
    };
    if !content_length_ok(total) {
        return Err(format!("warm Content-Length вне лимита: {total}"));
    }
    if let Some(tx) = progress {
        // настоящий total из заголовков — правим warm-оценку до первого байта
        tx.send_replace(StreamProgress {
            written: 0,
            total,
            finalized: false,
            failed: false,
        });
    }

    let part = dir.join(format!("{track_id}.{}.part", entry.ext));
    let final_path = dir.join(format!("{track_id}.{}", entry.ext));
    let written = write_body_to_part(resp, &part, total, progress).await;
    match written {
        Ok(()) => {}
        Err(e) => {
            let _ = fs::remove_file(&part);
            return Err(e);
        }
    }
    // На Windows rename поверх существующего файла падает — а yt-dlp мог
    // оставить одноимённый файл от прошлой жизни. Кэш-промах уже установлен
    // (engine_resolve смотрел find_cached), так что снести безопасно.
    let _ = fs::remove_file(&final_path);
    if let Err(e) = fs::rename(&part, &final_path) {
        let _ = fs::remove_file(&part);
        return Err(format!("rename .part не прошёл: {e}"));
    }
    validate_ytdlp_output(dir, &final_path)
}

/// Тело ответа → `.part`, с подсчётом байт (Content-Length врёт бесплатно,
/// проверяем и по факту) и жёсткой сверкой с total по завершении. progress —
/// для протокола muza-stream: handler ждёт written, а не опрашивает диск.
async fn write_body_to_part(
    mut resp: reqwest::Response,
    part: &Path,
    total: u64,
    progress: Option<&tokio::sync::watch::Sender<StreamProgress>>,
) -> Result<(), String> {
    use std::io::Write as _;
    let mut file = fs::File::create(part).map_err(|e| format!("не создался .part: {e}"))?;
    let mut written: u64 = 0;
    loop {
        let chunk = resp
            .chunk()
            .await
            .map_err(|e| format!("обрыв warm-скачивания: {e}"))?;
        let Some(bytes) = chunk else { break };
        written += bytes.len() as u64;
        if written > total {
            return Err(format!("CDN прислал больше заявленного: {written} > {total}"));
        }
        file.write_all(&bytes)
            .map_err(|e| format!("запись .part: {e}"))?;
        if let Some(tx) = progress {
            // читатель срезов ждёт БАЙТЫ НА ДИСКЕ — публикуем после write
            tx.send_replace(StreamProgress {
                written,
                total,
                finalized: false,
                failed: false,
            });
        }
    }
    if written != total {
        return Err(format!("warm-скачивание неполное: {written} из {total}"));
    }
    file.flush().map_err(|e| format!("flush .part: {e}"))?;
    Ok(())
}

// ── Ступень 0: прямой InnerTube-резолв (2026-07-19) ───────────────
// Один POST youtubei/v1/player клиентом ANDROID_VR отдаёт прямой CDN-URL
// (itag 251/140) + размер + expire за ~171 мс против ~3.6 с у yt-dlp (замер
// ×21 — docs/notes/2026-07-19-прямой-innertube-резолв-замер.md). Это НЕ
// замена yt-dlp-лестницы, а быстрая ступень ПЕРЕД ней: любой провал
// (SABR-сессия без url, LOGIN_REQUIRED, UNPLAYABLE, сеть, таймаут) молча
// уступает лестнице — ценность yt-dlp в скорости починки сообществом.
// Гочи (замер 2026-07-19, не переоткрывать):
//  - visitorData ОБЯЗАТЕЛЕН: без него бот-гейт отбивает 5 из 6 запросов;
//    значение приходит в КАЖДОМ ответе /player (даже LOGIN_REQUIRED) —
//    кэшируем в EngineState и переиспользуем;
//  - clientVersion строго 1.65.10 (выше — SABR-only, yt-dlp ff459e5);
//    живёт в горячем рецепте — бампается деплоем сервера без релиза;
//  - выходная форма = WarmEntry: всё ниже (validate_warm_url, fetch_to_cache,
//    warm-кэш, muza-stream) переиспользуется байт-в-байт.

/// Таймаут одного POST /player: ступень 0 либо быстрая, либо сразу уступает
/// лестнице (не общий RESOLVE_TIMEOUT 180 с — столько ждать нечего).
const INNERTUBE_TIMEOUT: Duration = Duration::from_secs(8);
/// TTL кэшированного visitorData гостевой сессии (эмпирически живёт часами;
/// протухший лечится одним лишним повтором — цена ошибки мала).
const INNERTUBE_VISITOR_TTL: Duration = Duration::from_secs(6 * 3600);
const INNERTUBE_ENDPOINT: &str = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
/// Приоритет itag ступени 0 (только форматы с прямым url).
const INNERTUBE_ITAGS_DEFAULT: &[u64] = &[251, 140];
/// Эконом-приоритет — те же малые форматы, что ECONOM_FORMATS лестницы.
const INNERTUBE_ITAGS_ECONOM: &[u64] = &[250, 249, 139, 251, 140];

/// visitorData гостевой сессии + момент получения (для TTL).
struct VisitorData {
    value: String,
    obtained_at: SystemTime,
}

/// Блок `youtube.innertube` горячего рецепта — аварийный рубильник ступени 0:
/// enabled:false или бамп client_version деплоем сервера, без релиза клиента.
#[derive(Debug, Clone, PartialEq)]
struct InnertubeConfig {
    client_name: String,
    client_version: String,
    client_name_id: u64,
}

/// Провал ступени 0: LoginRequired лечится свежим visitorData (один повтор),
/// остальное — сразу фолбэк на лестницу. Классы — ещё и маркеры KPI
/// (fail_sabr/fail_login): по ним видно, что android_vr начал деградировать.
#[derive(Debug, PartialEq)]
enum InnertubeFail {
    LoginRequired(String),
    Sabr(String),
    Other(String),
}

/// Успешный разбор ответа /player — та же тройка, что у SimulatedFormat.
#[derive(Debug, PartialEq)]
struct InnertubeFormat {
    url: String,
    size: u64,
    ext: String,
}

/// Рубильник + значения клиента из горячего рецепта. Любая неполнота блока
/// (нет блока, enabled≠true, битые поля) — ступень 0 выключена: аварийное
/// отключение обязано срабатывать и на «сервер прислал урезанный блок».
fn innertube_from_recipe(recipe: &serde_json::Value) -> Option<InnertubeConfig> {
    let block = &recipe["youtube"]["innertube"];
    if block["enabled"].as_bool() != Some(true) {
        return None;
    }
    Some(InnertubeConfig {
        client_name: block["client_name"].as_str()?.to_string(),
        client_version: block["client_version"].as_str()?.to_string(),
        client_name_id: block["client_name_id"].as_u64()?,
    })
}

/// itag → расширение файла кэша (`{track_id}.{ext}`, понимает find_cached).
fn innertube_ext_for_itag(itag: u64) -> Option<&'static str> {
    match itag {
        249 | 250 | 251 => Some("webm"),
        139 | 140 => Some("m4a"),
        _ => None,
    }
}

/// Разбор ответа /player: playability-гейт + выбор аудиоформата с прямым url
/// по приоритету itag. contentLength в живом ответе — СТРОКА («3433755»).
fn parse_innertube_player(
    raw: &serde_json::Value,
    itag_priority: &[u64],
) -> Result<InnertubeFormat, InnertubeFail> {
    let status = raw["playabilityStatus"]["status"]
        .as_str()
        .unwrap_or("НЕТ_СТАТУСА");
    if status != "OK" {
        let reason = raw["playabilityStatus"]["reason"].as_str().unwrap_or("");
        let msg = format!("{status}: {reason}");
        return Err(if status == "LOGIN_REQUIRED" {
            InnertubeFail::LoginRequired(msg)
        } else {
            InnertubeFail::Other(msg)
        });
    }
    let formats = raw["streamingData"]["adaptiveFormats"]
        .as_array()
        .ok_or_else(|| InnertubeFail::Sabr("нет adaptiveFormats".into()))?;
    for want in itag_priority {
        for f in formats {
            if f["itag"].as_u64() != Some(*want) {
                continue;
            }
            if !f["mimeType"].as_str().unwrap_or("").starts_with("audio/") {
                continue;
            }
            let Some(url) = f["url"].as_str().filter(|u| !u.is_empty()) else {
                continue;
            };
            let Some(ext) = innertube_ext_for_itag(*want) else {
                continue;
            };
            let Some(size) = f["contentLength"]
                .as_str()
                .and_then(|s| s.parse::<u64>().ok())
            else {
                continue;
            };
            return Ok(InnertubeFormat {
                url: url.to_string(),
                size,
                ext: ext.to_string(),
            });
        }
    }
    // Ничего не выбрано. Форматы есть, а прямых url нет ни у одного — это
    // SABR-сессия (главный ожидаемый режим деградации android_vr).
    let any_url = formats
        .iter()
        .any(|f| f["url"].as_str().map(|u| !u.is_empty()).unwrap_or(false));
    if !formats.is_empty() && !any_url {
        return Err(InnertubeFail::Sabr(
            "adaptiveFormats без прямых url (SABR-сессия)".into(),
        ));
    }
    Err(InnertubeFail::Other(
        "нет подходящего аудиоформата с прямым url".into(),
    ))
}

/// visitorData из ответа: приходит даже при LOGIN_REQUIRED/UNPLAYABLE.
fn innertube_visitor(raw: &serde_json::Value) -> Option<String> {
    raw["responseContext"]["visitorData"]
        .as_str()
        .filter(|v| !v.is_empty())
        .map(String::from)
}

/// InnertubeFormat → WarmEntry: та же граница доверия, что у прогрева
/// (validate_warm_url, лимит 512 МиБ, грамматика ext), expire — из самой
/// ссылки. Дальше запись обслуживают fetch_to_cache/warm-кэш без изменений.
fn innertube_warm_entry_with_lookup(
    fmt: &InnertubeFormat,
    now: SystemTime,
    lookup: &mut impl FnMut(&str, u16) -> LookupResult,
) -> Result<WarmEntry, String> {
    if !content_length_ok(fmt.size) {
        return Err(format!("innertube-размер вне лимита: {}", fmt.size));
    }
    if !valid_warm_ext(&fmt.ext) {
        return Err(format!("подозрительное расширение: {:?}", fmt.ext));
    }
    let url = validate_warm_url_with_lookup(&fmt.url, lookup)?;
    let expires_at = warm_expires_at(&url, now);
    if expires_at <= now {
        return Err("innertube-URL уже протух".into());
    }
    Ok(WarmEntry {
        url,
        size: fmt.size,
        ext: fmt.ext.clone(),
        provider: "youtube".into(),
        expires_at,
    })
}

fn innertube_warm_entry(fmt: &InnertubeFormat, now: SystemTime) -> Result<WarmEntry, String> {
    let mut lookup = |host: &str, port: u16| {
        debug_assert_eq!(port, 443);
        (host, 443)
            .to_socket_addrs()
            .map(|answers| answers.map(|answer| answer.ip()).collect())
            .map_err(|error| format!("DNS lookup failed: {error}"))
    };
    innertube_warm_entry_with_lookup(fmt, now, &mut lookup)
}

/// Ступень 0 — только когда ВЕДУЩИЙ источник YouTube с валидным id:
/// приоритет источников сервера не переворачиваем (SoundCloud/Bandcamp
/// первым — сразу лестница; их прямой резолв — отдельная будущая задача).
fn stage0_youtube_id(sources: &[SourceRef]) -> Option<String> {
    match sources.first()? {
        SourceRef::Youtube { source_id } if valid_youtube_id(source_id) => Some(source_id.clone()),
        _ => None,
    }
}

fn classify_innertube_failure(stats: &mut EngineStats, fail: &InnertubeFail) {
    match fail {
        InnertubeFail::Sabr(_) => stats.fail_sabr += 1,
        InnertubeFail::LoginRequired(_) => stats.fail_login += 1,
        InnertubeFail::Other(_) => stats.fail_other += 1,
    }
}

/// TTL негативного кэша ступени 0: покрывает окно «stream_start → resolve»
/// одного клика и повторные клики по тому же треку, но не хоронит видео
/// надолго — причина провала (бот-гейт, сеть) за минуту может рассосаться.
const STAGE0_FAIL_TTL: Duration = Duration::from_secs(60);

/// Свежий провал ступени 0 для этого видео? now — параметром (тестируемость).
fn stage0_recently_failed(state: &EngineState, video_id: &str, now: SystemTime) -> bool {
    state
        .stage0_recent_fail
        .lock()
        .unwrap()
        .get(video_id)
        .map(|at| {
            now.duration_since(*at)
                .map(|age| age < STAGE0_FAIL_TTL)
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// Запомнить провал; заодно проредить протухшие записи (карта не растёт).
fn stage0_note_fail(state: &EngineState, video_id: &str, now: SystemTime) {
    let mut map = state.stage0_recent_fail.lock().unwrap();
    map.retain(|_, at| {
        now.duration_since(*at)
            .map(|age| age < STAGE0_FAIL_TTL)
            .unwrap_or(true)
    });
    map.insert(video_id.to_string(), now);
}

/// Успех ступени 0 стирает память о провале — видео снова в деле сразу.
fn stage0_note_success(state: &EngineState, video_id: &str) {
    state.stage0_recent_fail.lock().unwrap().remove(video_id);
}

/// Тело POST /player. Значения client — из рецепта; остальные поля
/// (deviceMake и пр.) — обязательные константы ANDROID_VR из yt-dlp ff459e5
/// (без них клиент не признаётся «своим»).
fn build_innertube_body(
    cfg: &InnertubeConfig,
    video_id: &str,
    visitor: Option<&str>,
) -> serde_json::Value {
    let mut client = serde_json::json!({
        "clientName": cfg.client_name,
        "clientVersion": cfg.client_version,
        "deviceMake": "Oculus",
        "deviceModel": "Quest 3",
        "androidSdkVersion": 32,
        "osName": "Android",
        "osVersion": "12L",
        "hl": "en",
        "gl": "US",
    });
    if let Some(v) = visitor {
        client["visitorData"] = serde_json::Value::String(v.to_string());
    }
    serde_json::json!({
        "context": { "client": client },
        "videoId": video_id,
        "contentCheckOk": true,
        "racyCheckOk": true,
    })
}

/// Оркестрация visitorData вокруг одного вызова /player (транспорт
/// инъецируется — тестируется без сети):
///  1) свежий visitor из состояния идёт в первый запрос;
///  2) visitorData из ЛЮБОГО ответа освежает состояние;
///  3) LOGIN_REQUIRED лечится ровно ОДНИМ повтором с новым visitor
///     (замер 2026-07-19: с ним 5/6 OK) — нечем повторять или снова отказ →
///     наружу, фолбэк решает вызывающий.
async fn resolve_via_innertube_with<F, Fut>(
    state: &EngineState,
    itag_priority: &[u64],
    mut call: F,
) -> Result<InnertubeFormat, InnertubeFail>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<serde_json::Value, String>>,
{
    let now = SystemTime::now();
    let visitor = {
        let guard = state.youtube_visitor.lock().unwrap();
        guard
            .as_ref()
            .filter(|v| {
                now.duration_since(v.obtained_at)
                    .map(|age| age < INNERTUBE_VISITOR_TTL)
                    .unwrap_or(false)
            })
            .map(|v| v.value.clone())
    };
    let resp = call(visitor.clone()).await.map_err(InnertubeFail::Other)?;
    let fresh = innertube_visitor(&resp);
    if let Some(v) = &fresh {
        *state.youtube_visitor.lock().unwrap() = Some(VisitorData {
            value: v.clone(),
            obtained_at: SystemTime::now(),
        });
    }
    match parse_innertube_player(&resp, itag_priority) {
        Err(InnertubeFail::LoginRequired(msg)) => {
            // повторяем только если появился ДРУГОЙ visitor — слать тот же
            // значит получить тот же отказ
            let Some(retry_visitor) = fresh.filter(|v| Some(v.as_str()) != visitor.as_deref())
            else {
                return Err(InnertubeFail::LoginRequired(msg));
            };
            let resp2 = call(Some(retry_visitor))
                .await
                .map_err(InnertubeFail::Other)?;
            if let Some(v2) = innertube_visitor(&resp2) {
                *state.youtube_visitor.lock().unwrap() = Some(VisitorData {
                    value: v2,
                    obtained_at: SystemTime::now(),
                });
            }
            parse_innertube_player(&resp2, itag_priority)
        }
        other => other,
    }
}

/// Сетевой транспорт ступени 0: один POST /player клиентом из рецепта.
/// Форма запроса проверена живьём 2026-07-19 (~171 мс медианы); UA и
/// заголовки X-YouTube-* обязательны. reqwest собран без фичи gzip —
/// Accept-Encoding: identity делает ответ детерминированно несжатым.
async fn innertube_player_call(
    cfg: &InnertubeConfig,
    video_id: &str,
    visitor: Option<&str>,
) -> Result<serde_json::Value, String> {
    let body = build_innertube_body(cfg, video_id, visitor);
    let ua = format!(
        "com.google.android.apps.youtube.vr.oculus/{} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
        cfg.client_version
    );
    let mut req = warm_http_client()
        .post(INNERTUBE_ENDPOINT)
        .header("Content-Type", "application/json")
        .header("User-Agent", ua)
        .header("X-YouTube-Client-Name", cfg.client_name_id.to_string())
        .header("X-YouTube-Client-Version", &cfg.client_version)
        .header("Origin", "https://www.youtube.com")
        .header("Accept-Encoding", "identity")
        .timeout(INNERTUBE_TIMEOUT)
        .body(serde_json::to_vec(&body).map_err(|e| format!("сериализация body: {e}"))?);
    if let Some(v) = visitor {
        req = req.header("X-Goog-Visitor-Id", v);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("POST /player не ушёл: {e}"))?;
    let status = resp.status();
    if status.as_u16() != 200 {
        return Err(format!("POST /player: статус {status}"));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("чтение ответа /player: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("ответ /player не JSON: {e}"))
}

/// Боевая ступень 0 целиком: POST → разбор → WarmEntry той же формы, что у
/// прогрева. Err любого класса = «молча уступи лестнице» у вызывающего.
async fn resolve_via_innertube(
    state: &EngineState,
    cfg: &InnertubeConfig,
    video_id: &str,
    itag_priority: &[u64],
) -> Result<WarmEntry, InnertubeFail> {
    let cfg_owned = cfg.clone();
    let vid = video_id.to_string();
    let fmt = resolve_via_innertube_with(state, itag_priority, move |visitor| {
        let cfg = cfg_owned.clone();
        let vid = vid.clone();
        async move { innertube_player_call(&cfg, &vid, visitor.as_deref()).await }
    })
    .await?;
    innertube_warm_entry(&fmt, SystemTime::now()).map_err(InnertubeFail::Other)
}

/// Валидация id трека: имя каталога/файла кэша (общая для resolve и warm).
fn validate_track_id(track_id: &str) -> Result<(), String> {
    if track_id.is_empty()
        || !track_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("некорректный id трека".into());
    }
    Ok(())
}

/// Лестница из рецепта: player_clients + формат-строка (общая для resolve и
/// warm — прогрев обязан резолвить ровно тот формат, который скачал бы бой).
fn ladder_from_recipe(state: &EngineState, quality: Option<&str>) -> (Vec<String>, String) {
    let recipe = state.recipe.lock().unwrap();
    let clients: Vec<String> = recipe["youtube"]["player_clients"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .filter(|v: &Vec<String>| !v.is_empty())
        .unwrap_or_else(|| vec!["tv".into(), "web_music".into()]);
    let mut format_str = recipe["youtube"]["format_priority"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|v| match v {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_else(|| "251/140/bestaudio".to_string());
    if quality == Some("econom") {
        format_str = format!("{ECONOM_FORMATS}/{format_str}");
    }
    (clients, format_str)
}

#[derive(Serialize)]
pub struct WarmOut {
    /// Живая warm-запись есть (уже была или только что добыта).
    pub warm: bool,
    /// Файл уже в кэше — греть нечего (и warm=false).
    pub cached: bool,
}

/// Прогрев резолва: та же лестница «источники × player_clients», но
/// `--simulate --print` вместо скачивания — 0 байт трафика, только метаданные.
/// Результат — WarmEntry в памяти; клик по треку заберёт её быстрым путём
/// engine_resolve (fetch_to_cache) и оставит от 4.5с только ~1.2с байтов.
///
/// Ошибка прогрева НЕ трогает счётчики EngineStats: KPI (SABR/403-rate) мерит
/// боевые добычи, фоновый прогрев размывал бы сигнал.
#[tauri::command]
pub async fn engine_warm(
    app: AppHandle,
    state: State<'_, EngineState>,
    track_id: String,
    sources: Vec<SourceRef>,
    quality: Option<String>,
    cache_ns: String,
) -> Result<WarmOut, String> {
    validate_track_id(&track_id)?;
    let dir = cache_dir(&app, &cache_ns)?;

    // Тот же single-flight, что у engine_resolve: если резолв этого трека уже
    // идёт, прогрев подождёт и увидит кэш-хит вместо второго yt-dlp.
    let gate = {
        let mut inflight = state.inflight.lock().unwrap();
        inflight
            .entry(track_id.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };
    let _guard = gate.lock().await;

    if find_cached(&dir, &track_id).is_some() {
        return Ok(WarmOut {
            warm: false,
            cached: true,
        });
    }
    if has_live_warm_entry(&state, &cache_ns, &track_id, SystemTime::now()) {
        return Ok(WarmOut {
            warm: true,
            cached: false,
        });
    }

    // Ступень 0 (2026-07-19): прогрев тем же прямым InnerTube-резолвом —
    // ~171 мс вместо ~2–4 с процесса yt-dlp (дешёвый прогрев = можно греть
    // смелее). Провал молча уступает yt-dlp --simulate ниже; счётчики KPI
    // прогрев не трогает (см. док-коммент команды).
    let innertube_cfg = innertube_from_recipe(&state.recipe.lock().unwrap());
    if let Some(cfg) = innertube_cfg {
        if let Some(video_id) = stage0_youtube_id(&sources) {
            if stage0_recently_failed(&state, &video_id, SystemTime::now()) {
                // свежий провал (клик/стрим/прошлый прогрев) — не дёргаем
                // POST заново, сразу simulate-ветка ниже
            } else {
                let itags = if quality.as_deref() == Some("econom") {
                    INNERTUBE_ITAGS_ECONOM
                } else {
                    INNERTUBE_ITAGS_DEFAULT
                };
                match resolve_via_innertube(&state, &cfg, &video_id, itags).await {
                    Ok(entry) => {
                        stage0_note_success(&state, &video_id);
                        store_warm_entry(&state, &cache_ns, &track_id, entry);
                        return Ok(WarmOut {
                            warm: true,
                            cached: false,
                        });
                    }
                    // счётчики KPI прогрев не трогает (см. док-коммент
                    // команды) — но негативный кэш общий: клик после
                    // неудачного прогрева не должен платить тот же POST
                    Err(_) => stage0_note_fail(&state, &video_id, SystemTime::now()),
                }
            }
        }
    }

    let (clients, format_str) = ladder_from_recipe(&state, quality.as_deref());
    let Attempts { attempts, drops } =
        tauri::async_runtime::spawn_blocking(move || build_attempts(&sources, &clients))
            .await
            .map_err(|error| format!("source policy spawn_blocking: {error}"))?;
    if attempts.is_empty() {
        return Err(if drops.is_empty() {
            "у трека нет живых источников".to_string()
        } else {
            format!("у трека нет живых источников ({})", drops.join("; "))
        });
    }

    let sidecars = sidecar_paths()?;
    let mut last_error = String::new();
    for attempt in attempts {
        let fmt = format_str.clone();
        let ytdlp_clone = sidecars.ytdlp.clone();
        let deno_clone = sidecars.deno.clone();
        let attempt_provider = attempt.provider.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            run_ytdlp_simulate(&ytdlp_clone, &deno_clone, &attempt, &fmt)
        })
        .await
        .map_err(|e| format!("spawn_blocking: {e}"))?;

        match result {
            Ok(sim) => {
                if !content_length_ok(sim.size) {
                    last_error = format!("warm-размер вне лимита: {}", sim.size);
                    continue;
                }
                let url = match validate_warm_url(&sim.url) {
                    Ok(url) => url,
                    Err(e) => {
                        last_error = e;
                        continue;
                    }
                };
                let now = SystemTime::now();
                let entry = WarmEntry {
                    expires_at: warm_expires_at(&url, now),
                    url,
                    size: sim.size,
                    ext: sim.ext,
                    provider: attempt_provider,
                };
                if entry.expires_at <= now {
                    last_error = "warm-URL уже протух".into();
                    continue;
                }
                store_warm_entry(&state, &cache_ns, &track_id, entry);
                return Ok(WarmOut {
                    warm: true,
                    cached: false,
                });
            }
            Err(e) => last_error = e,
        }
    }
    Err(format!("прогрев не удался: {last_error}"))
}

// ── Протокол muza-stream (Фаза 2): стрим с первых килобайт ────────
// Спайк 2026-07-16 подтвердил: WebView2 шлёт `Range` кастомному протоколу
// (`bytes=0-` на старте, дальше по мере проигрывания/сика). Схема: клик по
// прогретому некэшированному треку → engine_stream_start запускает ту же
// fetch_to_cache (ОДНА закачка: стрим и кэш не дублируют трафик), ждёт
// первые 128 КиБ и отдаёт фронту добро; <audio> играет с
// muza-stream://localhost/<ns>/<id> (Windows: http://muza-stream.localhost),
// handler отвечает 206-чанками, дожидаясь нужных байт по watch-каналу.
// По завершении — тот же атомарный rename, файл становится валидным кэшем.

/// Сколько ждать ПЕРВЫЕ байты в engine_stream_start: протухший warm-URL
/// отваливается за секунды, а дольше ждать нет смысла — обычная лестница
/// на фронте не медленнее.
const STREAM_START_TIMEOUT: Duration = Duration::from_secs(15);
/// Сколько handler ждёт байты одного чанка (закачка обычно опережает
/// playback на порядок; ожидание дольше значит закачка умерла).
const STREAM_CHUNK_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Serialize)]
pub struct StreamStartOut {
    /// true — закачка идёт и первые килобайты уже на диске: фронт может
    /// отдавать <audio> stream-URL. false — стрим не нужен/недоступен
    /// (файл уже в кэше, warm-записи нет, закачка не завелась) — фронт
    /// молча идёт обычным путём. Ошибок наружу нет НАМЕРЕННО: стрим —
    /// best-effort, любой провал обязан выглядеть как «играй как раньше».
    pub stream: bool,
}

/// Начать (или подхватить) стрим трека. Подтверждает готовность только когда
/// первый чанк уже в .part — провалы схлопываются в {stream:false} ДО того,
/// как <audio> закоммитится на stream-URL.
///
/// Источник метаданных — прогрев ЛИБО ступень 0 прямо здесь (2026-07-19).
/// Почему второе добавлено: прогрев покрывает только то, на что навели мышь
/// или что стоит в очереди, а обычный клик по холодному треку шёл мимо
/// стрима — ждал ПОЛНУЮ закачку (замер 19.07: резолв 0.75с + байты 0.9–1.4с
/// ≈ 2.5–3с до звука; жалоба владельца «ускорения не чувствуется»). Ступень 0
/// стоит те же ~0.75с, что и в лестнице, но после неё звук идёт с первых
/// 128 КиБ вместо ожидания всех мегабайт — это и есть выигрыш.
#[tauri::command]
pub async fn engine_stream_start(
    app: AppHandle,
    state: State<'_, EngineState>,
    track_id: String,
    sources: Vec<SourceRef>,
    quality: Option<String>,
    cache_ns: String,
) -> Result<StreamStartOut, String> {
    validate_track_id(&track_id)?;
    let dir = cache_dir(&app, &cache_ns)?;
    let key = warm_key(&cache_ns, &track_id);
    let no_stream = Ok(StreamStartOut { stream: false });

    // уже стримится (повторный клик по треку) — подхватываем тот же канал
    let existing = state.streams.lock().unwrap().get(&key).cloned();
    let handle = if let Some(handle) = existing {
        handle
    } else {
        if find_cached(&dir, &track_id).is_some() {
            return no_stream; // кэш-хит быстрее обычным путём
        }
        // Прогрет — метаданные уже есть. Нет — добываем их ступенью 0 прямо
        // здесь: она быстрая (~0.75с) и не требует yt-dlp, а дальше звук идёт
        // с первых килобайт. Провал ступени 0 (SABR/бот-гейт/UNPLAYABLE/не
        // youtube) — молча no_stream: фронт уйдёт обычной лестницей, как
        // раньше. Единственная дисциплина стрима: он не имеет права сделать
        // трек неиграбельным.
        let warm = take_live_warm_entry(&state, &cache_ns, &track_id, SystemTime::now());
        let entry = match warm {
            Some(entry) => entry,
            None => {
                let cfg = innertube_from_recipe(&state.recipe.lock().unwrap());
                let (Some(cfg), Some(video_id)) = (cfg, stage0_youtube_id(&sources)) else {
                    return no_stream;
                };
                if stage0_recently_failed(&state, &video_id, SystemTime::now()) {
                    return no_stream; // провал уже оплачен — сразу лестница
                }
                let itags = if quality.as_deref() == Some("econom") {
                    INNERTUBE_ITAGS_ECONOM
                } else {
                    INNERTUBE_ITAGS_DEFAULT
                };
                match resolve_via_innertube(&state, &cfg, &video_id, itags).await {
                    Ok(entry) => {
                        stage0_note_success(&state, &video_id);
                        entry
                    }
                    Err(fail) => {
                        classify_innertube_failure(&mut state.stats.lock().unwrap(), &fail);
                        stage0_note_fail(&state, &video_id, SystemTime::now());
                        return no_stream;
                    }
                }
            }
        };
        let part = dir.join(format!("{track_id}.{}.part", entry.ext));
        let final_path = dir.join(format!("{track_id}.{}", entry.ext));
        let (tx, rx) = tokio::sync::watch::channel(StreamProgress {
            written: 0,
            total: entry.size,
            finalized: false,
            failed: false,
        });
        let handle = StreamHandle {
            part,
            final_path,
            progress: rx,
        };
        state.streams.lock().unwrap().insert(key.clone(), handle.clone());

        let app_task = app.clone();
        let ns_task = cache_ns.clone();
        let id_task = track_id.clone();
        let key_task = key.clone();
        tauri::async_runtime::spawn(async move {
            let result = match cache_dir(&app_task, &ns_task) {
                Ok(dir) => {
                    fetch_to_cache_with_progress(&dir, &id_task, &entry, Some(&tx)).await
                }
                Err(e) => Err(e),
            };
            match result {
                Ok(path) => {
                    // тот же хвост, что у быстрого пути engine_resolve
                    let state = app_task.state::<EngineState>();
                    let limit = *state.cache_limit_bytes.lock().unwrap();
                    ensure_pins_loaded(&app_task, &state, &ns_task);
                    let pins = state.pins.lock().unwrap().clone();
                    if let Ok(dir) = cache_dir(&app_task, &ns_task) {
                        evict_lru(&dir, limit, &path, &pins);
                    }
                    let total = tx.borrow().total;
                    tx.send_replace(StreamProgress {
                        written: total,
                        total,
                        finalized: true,
                        failed: false,
                    });
                }
                Err(_) => {
                    // молча: стрим best-effort, фронт уйдёт обычной лестницей;
                    // .part уже удалён самим fetch_to_cache_with_progress
                    let p = *tx.borrow();
                    tx.send_replace(StreamProgress {
                        failed: true,
                        finalized: false,
                        ..p
                    });
                }
            }
            // запись уходит из реестра ПОСЛЕ финального сигнала; handler'ы
            // с клоном receiver'а доживут своё
            app_task
                .state::<EngineState>()
                .streams
                .lock()
                .unwrap()
                .remove(&key_task);
        });
        handle
    };

    // добро фронту — только с первыми килобайтами на диске
    let mut rx = handle.progress.clone();
    let wait = async {
        loop {
            let p = *rx.borrow();
            if p.failed {
                return false;
            }
            if p.finalized || p.written >= STREAM_FIRST_CHUNK.min(p.total.max(1)) {
                return true;
            }
            if rx.changed().await.is_err() {
                // sender умер без финального сигнала — считаем провалом
                let p = *rx.borrow();
                return p.finalized || p.written >= STREAM_FIRST_CHUNK.min(p.total.max(1));
            }
        }
    };
    match tokio::time::timeout(STREAM_START_TIMEOUT, wait).await {
        Ok(true) => Ok(StreamStartOut { stream: true }),
        _ => no_stream,
    }
}

/// Первый ответ стрима — он и есть «клик → звук»: 128 КиБ с запасом на
/// заголовки контейнера и первые кадры, чтобы декодер точно завёлся.
const STREAM_FIRST_CHUNK: u64 = 128 * 1024;
/// Последующие — 512 КиБ ≈ 32с opus: playback закачку не догонит (весь файл
/// едет ~1.2с). Чанк — гранулярность ответа <audio>, НЕ отдельный запрос в
/// сеть: закачка одна и идёт на полной скорости.
const STREAM_NEXT_CHUNK: u64 = 512 * 1024;

/// Конец окна ответа на Range-запрос стрима. Отдавать всё до конца файла
/// нельзя: спайк 2026-07-16 показал, что на `bytes=0-` WebView2 буферизует
/// ответ целиком и больше Range не шлёт — дробление держит стрим стримом.
fn stream_chunk_end(start: u64, total: u64) -> u64 {
    let want = if start == 0 {
        STREAM_FIRST_CHUNK
    } else {
        STREAM_NEXT_CHUNK
    };
    (start + want - 1).min(total - 1)
}

/// Свежий `.part` — возможно, ЖИВОЙ стрим (Фаза 2): его не трогают ни
/// LRU-эвикция, ни «Очистить кэш» (риск из спеки: снести на ходу). Старше
/// grace-периода — мусор упавшей закачки, подлежит обычной уборке.
const STREAM_PART_GRACE: Duration = Duration::from_secs(600);

fn is_live_stream_part(path: &Path) -> bool {
    if !path.to_string_lossy().ends_with(".part") {
        return false;
    }
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|mtime| {
            SystemTime::now()
                .duration_since(mtime)
                .map(|age| age < STREAM_PART_GRACE)
                .unwrap_or(true) // mtime из будущего — часы прыгнули, не трогаем
        })
        .unwrap_or(false)
}

fn stream_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("webm") | Some("opus") => "audio/webm",
        Some("m4a") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        _ => "application/octet-stream",
    }
}

/// Срез файла [start..=end] — File::seek + read_exact, без чтения целиком.
fn read_slice(path: &Path, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    use std::io::{Read as _, Seek as _, SeekFrom};
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0u8; (end - start + 1) as usize];
    file.read_exact(&mut buf)?;
    Ok(buf)
}

/// Async-протокол: handler может ЖДАТЬ байты живого стрима (watch-канал) —
/// синхронной регистрации это не под силу. Ответ отдаётся целым телом
/// (responder Tauri не умеет стримить), поэтому дробление — через Range.
pub fn handle_stream_request(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        responder.respond(build_stream_response(&app, &request).await);
    });
}

/// CORS во всех ответах протокола обязателен: слоты AudioEngine создаются с
/// crossOrigin="anonymous" (под Web Audio-граф — EQ/визуализатор), и без
/// Access-Control-Allow-Origin медиастек WebView2 молча бросал загрузку после
/// первого чанка (стенд 16.07: изолированный <audio> без crossOrigin играл,
/// слот приложения — нет). Asset-протокол Tauri отвечает так же.
fn stream_error(code: u16, msg: &str) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(code)
        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(tauri::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

fn stream_206(
    file: &Path,
    start: u64,
    end: u64,
    total: u64,
) -> tauri::http::Response<Vec<u8>> {
    let Ok(body) = read_slice(file, start, end) else {
        return stream_error(500, "срез не читается");
    };
    eprintln!(
        "[muza-stream] 206 bytes {start}-{end}/{total} ({})",
        file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    );
    tauri::http::Response::builder()
        .status(206)
        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            tauri::http::header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{total}"),
        )
        .header(tauri::http::header::ACCEPT_RANGES, "bytes")
        .header(tauri::http::header::CONTENT_TYPE, stream_content_type(file))
        .body(body)
        .unwrap()
}

async fn build_stream_response(
    app: &AppHandle,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    // путь: /<ns>/<track_id> — те же валидации, что у команд движка
    let path = request.uri().path();
    let mut parts = path.trim_matches('/').split('/');
    let (Some(ns), Some(id), None) = (parts.next(), parts.next(), parts.next()) else {
        return stream_error(400, "ожидается /<ns>/<track_id>");
    };
    if validate_cache_ns(ns).is_err() || validate_track_id(id).is_err() {
        return stream_error(400, "некорректный ns или id");
    }
    let Ok(dir) = cache_dir(app, ns) else {
        return stream_error(500, "кэш-каталог недоступен");
    };
    let range = request
        .headers()
        .get(tauri::http::header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_range_header);

    // 1) Файл уже в кэше целиком — отдаём срезы из него. Тоже ЧАНКАМИ:
    // спайк показал, что полный ответ на bytes=0- буферизуется целиком
    // и Range больше не приходит — а нам нужен живой запрос под сик.
    if let Some(file) = find_cached(&dir, id) {
        let total = match fs::metadata(&file).map(|m| m.len()) {
            Ok(len) if len > 0 => len,
            _ => return stream_error(500, "файл кэша не читается"),
        };
        return match range {
            Some((start, end_opt)) if start < total => {
                let end = stream_chunk_end(start, total).min(end_opt.unwrap_or(u64::MAX));
                stream_206(&file, start, end, total)
            }
            Some(_) => stream_error(416, "range вне файла"),
            // без Range — целиком (законный 200; media-стек WebView2 так не
            // делает, ветка для честности HTTP)
            None => match fs::read(&file) {
                Ok(bytes) => tauri::http::Response::builder()
                    .status(200)
                    .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(tauri::http::header::ACCEPT_RANGES, "bytes")
                    .header(tauri::http::header::CONTENT_TYPE, stream_content_type(&file))
                    .body(bytes)
                    .unwrap(),
                Err(_) => stream_error(500, "файл кэша не читается"),
            },
        };
    }

    // 2) Живой стрим: ждём, пока .part наберёт байты окна, отдаём срез.
    let handle = app
        .state::<EngineState>()
        .streams
        .lock()
        .unwrap()
        .get(&warm_key(ns, id))
        .cloned();
    let Some(handle) = handle else {
        return stream_error(404, "трека нет ни в кэше, ни в стриме");
    };
    let mut rx = handle.progress.clone();
    let (start, end_opt) = match range {
        Some((s, e)) => (s, e),
        None => (0, None), // не должен случаться (спайк), но 206 с нуля законен
    };

    let wait = async {
        loop {
            let p = *rx.borrow();
            if p.failed {
                return Err(stream_error(502, "закачка стрима оборвалась"));
            }
            if start >= p.total {
                return Err(stream_error(416, "range вне файла"));
            }
            let end = stream_chunk_end(start, p.total).min(end_opt.unwrap_or(u64::MAX));
            if p.finalized || p.written >= end + 1 {
                return Ok((end, p.total, p.finalized));
            }
            if rx.changed().await.is_err() {
                // sender умер: перечитываем финальное состояние в голове цикла
                let p = *rx.borrow();
                if !(p.finalized || p.failed) {
                    return Err(stream_error(502, "закачка стрима пропала"));
                }
            }
        }
    };
    let (end, total, finalized) = match tokio::time::timeout(STREAM_CHUNK_TIMEOUT, wait).await {
        Ok(Ok(win)) => win,
        Ok(Err(resp)) => return resp,
        Err(_) => return stream_error(504, "байты стрима не пришли вовремя"),
    };

    // rename мог пройти между сигналом и чтением — пробуем .part, затем финал
    let source = if !finalized && handle.part.exists() {
        handle.part.clone()
    } else if handle.final_path.exists() {
        handle.final_path.clone()
    } else {
        handle.part.clone()
    };
    stream_206(&source, start, end, total)
}

/// Эконом-лестница форматов: низкий битрейт в голове (250/249 = opus 64/48k,
/// 139 = AAC 48k), обычная лестница рецепта в хвосте — не-YouTube источники
/// и треки без низкобитрейтных форматов не ломаются.
const ECONOM_FORMATS: &str = "250/249/139/bestaudio[abr<=64]";

/// Резолв трека: кэш → yt-dlp по лестнице «источники × player_clients из
/// рецепта». sources приходят с сервера уже по убыванию priority.
/// quality: "econom" — сначала эконом-форматы (кэш общий: добытый HQ-файл
/// играет и в экономе — ключ кэша только track_id).
#[tauri::command]
pub async fn engine_resolve(
    app: AppHandle,
    state: State<'_, EngineState>,
    track_id: String,
    sources: Vec<SourceRef>,
    quality: Option<String>,
    cache_ns: String,
) -> Result<ResolveOut, String> {
    // id каталога числовой; заодно это защита имени файла кэша
    validate_track_id(&track_id)?;
    let dir = cache_dir(&app, &cache_ns)?;

    // Single-flight: параллельный резолв того же трека (play + преднагрузка)
    // ждёт первый, а не запускает второй yt-dlp
    let gate = {
        let mut inflight = state.inflight.lock().unwrap();
        inflight
            .entry(track_id.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };
    let _guard = gate.lock().await;

    if let Some(path) = find_cached(&dir, &track_id) {
        // touch: mtime = сейчас, файл уходит в конец очереди LRU-эвикции
        let now = filetime::FileTime::now();
        let _ = filetime::set_file_mtime(&path, now);
        state.stats.lock().unwrap().cache_hits += 1;
        return Ok(ResolveOut {
            path: path.to_string_lossy().into_owned(),
            from_cache: true,
            provider: None,
        });
    }

    // Трек прямо сейчас стримится (Фаза 2): клик и стрим — одна закачка,
    // второй yt-dlp/GET на те же байты не запускаем. Дожидаемся финала и
    // отдаём готовый файл; стрим упал — честно идём лестницей ниже.
    let streaming = state
        .streams
        .lock()
        .unwrap()
        .get(&warm_key(&cache_ns, &track_id))
        .map(|h| h.progress.clone());
    if let Some(mut rx) = streaming {
        loop {
            let p = *rx.borrow();
            if p.finalized || p.failed {
                break;
            }
            if rx.changed().await.is_err() {
                break;
            }
        }
        if let Some(path) = find_cached(&dir, &track_id) {
            let now = filetime::FileTime::now();
            let _ = filetime::set_file_mtime(&path, now);
            state.stats.lock().unwrap().cache_hits += 1;
            return Ok(ResolveOut {
                path: path.to_string_lossy().into_owned(),
                from_cache: true,
                provider: None,
            });
        }
    }

    // Быстрый путь прогрева (Фаза 1): метаданные уже разрешены engine_warm —
    // вместо процесса yt-dlp остаётся один GET (~4.5с → ~1.2с). Любая ошибка
    // (URL протух, CDN отказал, размер не сошёлся) — запись уже выброшена
    // самим take, молча падаем на обычную лестницу ниже: прогрев не имеет
    // права сделать трек неиграбельным.
    if let Some(entry) = take_live_warm_entry(&state, &cache_ns, &track_id, SystemTime::now()) {
        if let Ok(path) = fetch_to_cache(&dir, &track_id, &entry).await {
            let limit = *state.cache_limit_bytes.lock().unwrap();
            ensure_pins_loaded(&app, &state, &cache_ns);
            let pins = state.pins.lock().unwrap().clone();
            evict_lru(&dir, limit, &path, &pins);
            state.stats.lock().unwrap().resolve_ok += 1;
            return Ok(ResolveOut {
                path: path.to_string_lossy().into_owned(),
                from_cache: false,
                provider: Some(entry.provider),
            });
        }
    }

    // Ступень 0 (2026-07-19): прямой InnerTube-резолв — один POST вместо
    // процесса yt-dlp (~171 мс против ~3.6 с, полный путь ~4.5 с → ~1.4 с).
    // Только когда ведущий источник YouTube. Та же дисциплина, что у warm-пути
    // выше: любой провал (SABR, бот-гейт, UNPLAYABLE, сеть, 403 на байтах)
    // МОЛЧА уступает лестнице — ступень 0 не имеет права сделать трек
    // неиграбельным. Провалы метятся в KPI (fail_sabr/fail_login) — по ним
    // видно, что android_vr деградирует и пора бампить рецепт.
    let innertube_cfg = innertube_from_recipe(&state.recipe.lock().unwrap());
    if let Some(cfg) = innertube_cfg {
        if let Some(video_id) = stage0_youtube_id(&sources) {
            // Свежий провал (обычно — engine_stream_start ЭТОГО ЖЕ клика
            // секунду назад) — не платим за тот же POST/таймаут второй раз,
            // сразу лестница ниже.
            if stage0_recently_failed(&state, &video_id, SystemTime::now()) {
                // ничего: проваливаемся в лестницу
            } else {
                let itags = if quality.as_deref() == Some("econom") {
                    INNERTUBE_ITAGS_ECONOM
                } else {
                    INNERTUBE_ITAGS_DEFAULT
                };
                match resolve_via_innertube(&state, &cfg, &video_id, itags).await {
                    Ok(entry) => {
                        stage0_note_success(&state, &video_id);
                        match fetch_to_cache(&dir, &track_id, &entry).await {
                            Ok(path) => {
                                let limit = *state.cache_limit_bytes.lock().unwrap();
                                ensure_pins_loaded(&app, &state, &cache_ns);
                                let pins = state.pins.lock().unwrap().clone();
                                evict_lru(&dir, limit, &path, &pins);
                                state.stats.lock().unwrap().resolve_ok += 1;
                                return Ok(ResolveOut {
                                    path: path.to_string_lossy().into_owned(),
                                    from_cache: false,
                                    provider: Some(entry.provider),
                                });
                            }
                            // байты не доехали (протухло/смена IP → 403) —
                            // лестница; маркеры ошибки понимает существующий
                            // классификатор
                            Err(e) => classify_failure(&mut state.stats.lock().unwrap(), &e),
                        }
                    }
                    Err(fail) => {
                        classify_innertube_failure(&mut state.stats.lock().unwrap(), &fail);
                        stage0_note_fail(&state, &video_id, SystemTime::now());
                    }
                }
            }
        }
    }

    // Лестница попыток из рецепта (спайк Stage 0: tv → web_music → след. источник)
    let (clients, format_str) = ladder_from_recipe(&state, quality.as_deref());

    // URL parsing + DNS are blocking work. Move owned renderer input and the
    // recipe client list off the async Tauri thread before any child process
    // can be created; only validated owned attempts return.
    let Attempts { attempts, drops } =
        tauri::async_runtime::spawn_blocking(move || build_attempts(&sources, &clients))
            .await
            .map_err(|error| format!("source policy spawn_blocking: {error}"))?;
    if attempts.is_empty() {
        // Причины отбраковки — наружу: «нет живых источников» без них не
        // отличить от сломанного DNS, битого url'а или пустого списка.
        return Err(if drops.is_empty() {
            "у трека нет живых источников".to_string()
        } else {
            format!("у трека нет живых источников ({})", drops.join("; "))
        });
    }

    let sidecars = sidecar_paths()?;
    let mut last_error = String::new();
    for attempt in attempts {
        state.stats.lock().unwrap().attempts += 1;
        let dir_clone = dir.clone();
        let id_clone = track_id.clone();
        let fmt = format_str.clone();
        let ytdlp_clone = sidecars.ytdlp.clone();
        let deno_clone = sidecars.deno.clone();
        let attempt_provider = attempt.provider.clone();
        // Процесс — блокирующий; уводим с async-потока Tauri
        let result = tauri::async_runtime::spawn_blocking(move || {
            run_ytdlp_once(
                &ytdlp_clone,
                &deno_clone,
                &dir_clone,
                &id_clone,
                &attempt,
                &fmt,
            )
        })
        .await
        .map_err(|e| format!("spawn_blocking: {e}"))?;

        match result {
            Ok(path) => {
                let limit = *state.cache_limit_bytes.lock().unwrap();
                ensure_pins_loaded(&app, &state, &cache_ns);
                let pins = state.pins.lock().unwrap().clone();
                evict_lru(&dir, limit, &path, &pins);
                state.stats.lock().unwrap().resolve_ok += 1;
                return Ok(ResolveOut {
                    path: path.to_string_lossy().into_owned(),
                    from_cache: false,
                    provider: Some(attempt_provider),
                });
            }
            Err(e) => {
                classify_failure(&mut state.stats.lock().unwrap(), &e);
                last_error = e;
            }
        }
    }
    state.stats.lock().unwrap().resolve_fail += 1;
    Err(format!("не удалось добыть трек: {last_error}"))
}

// ── Кэш и диагностика ─────────────────────────────────────────────

#[derive(Serialize)]
pub struct CacheStats {
    pub bytes: u64,
    pub files: u32,
    pub limit_bytes: u64,
    /// Из них закреплено оффлайн (Stage 4).
    pub pinned_bytes: u64,
    pub pinned_files: u32,
}

#[tauri::command]
pub fn engine_cache_stats(
    app: AppHandle,
    state: State<'_, EngineState>,
    cache_ns: String,
) -> Result<CacheStats, String> {
    let dir = cache_dir(&app, &cache_ns)?;
    ensure_pins_loaded(&app, &state, &cache_ns);
    let pins = state.pins.lock().unwrap().clone();
    let mut bytes = 0u64;
    let mut files = 0u32;
    let mut pinned_bytes = 0u64;
    let mut pinned_files = 0u32;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                bytes += size;
                files += 1;
                if is_pinned(&path, &pins) {
                    pinned_bytes += size;
                    pinned_files += 1;
                }
            }
        }
    }
    Ok(CacheStats {
        bytes,
        files,
        limit_bytes: *state.cache_limit_bytes.lock().unwrap(),
        pinned_bytes,
        pinned_files,
    })
}

/// Экспорт кэш-файла с человеческим именем (drag-out на рабочий стол):
/// копия во временный каталог `muza-export` → путь отдаётся нативному drag.
/// Ошибка «нет в кэше» честная — тащить можно то, что уже добыто.
#[tauri::command]
pub fn engine_export_cached(
    app: AppHandle,
    track_id: String,
    file_name: String,
    cache_ns: String,
) -> Result<String, String> {
    let dir = cache_dir(&app, &cache_ns)?;
    let src = find_cached(&dir, &track_id).ok_or("Трека нет в кэше — сначала сыграй его")?;
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("webm")
        .to_string();
    // чистим запрещённые для имён Windows символы
    let clean: String = file_name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { ' ' } else { c })
        .collect();
    let clean = clean.trim();
    let stem = if clean.is_empty() {
        track_id.as_str()
    } else {
        clean
    };
    let out_dir = app
        .path()
        .temp_dir()
        .map_err(|e| format!("нет temp_dir: {e}"))?
        .join("muza-export");
    fs::create_dir_all(&out_dir).map_err(|e| format!("не создался экспорт-каталог: {e}"))?;
    let dest = out_dir.join(format!("{stem}.{ext}"));
    fs::copy(&src, &dest).map_err(|e| format!("копия не удалась: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Выбить один трек из кэша (Stage 4): пользователь выбрал другую
/// версию/источник — старый файл не должен отдаваться кэш-хитом.
#[tauri::command]
pub fn engine_cache_remove(
    app: AppHandle,
    track_id: String,
    cache_ns: String,
) -> Result<(), String> {
    let dir = cache_dir(&app, &cache_ns)?;
    if let Some(path) = find_cached(&dir, &track_id) {
        // Файл может играть прямо сейчас — не смертельно: удалится позже
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
pub fn engine_cache_clear(
    app: AppHandle,
    state: State<'_, EngineState>,
    cache_ns: String,
) -> Result<(), String> {
    let dir = cache_dir(&app, &cache_ns)?;
    ensure_pins_loaded(&app, &state, &cache_ns);
    let pins = state.pins.lock().unwrap().clone();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            // Оффлайн-пины переживают чистку; занятые плеером файлы пропускаем;
            // свежий .part — возможно, живой стрим Фазы 2 (не рвать на ходу)
            if path.is_file() && !is_pinned(&path, &pins) && !is_live_stream_part(&path) {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(())
}

// ── Оффлайн-пины (Stage 4) ────────────────────────────────────────

#[derive(Serialize)]
pub struct PinInfo {
    pub track_id: String,
    /// Файл уже в кэше (скачан) — иначе докачается при ensure/первом плее.
    pub cached: bool,
}

/// Закрепить/открепить трек оффлайн. Само скачивание — через engine_resolve
/// (клиент зовёт его следом; single-flight не даст задвоить работу).
#[tauri::command]
pub fn engine_pin(
    app: AppHandle,
    state: State<'_, EngineState>,
    track_id: String,
    pinned: bool,
    cache_ns: String,
) -> Result<(), String> {
    validate_cache_ns(&cache_ns)?;
    ensure_pins_loaded(&app, &state, &cache_ns);
    let mut pins = state.pins.lock().unwrap();
    if pinned {
        pins.insert(track_id);
    } else {
        pins.remove(&track_id);
    }
    persist_pins(&app, &cache_ns, &pins);
    Ok(())
}

/// Все пины с их статусом в кэше (для настроек/индикаторов).
#[tauri::command]
pub fn engine_pins(
    app: AppHandle,
    state: State<'_, EngineState>,
    cache_ns: String,
) -> Result<Vec<PinInfo>, String> {
    let dir = cache_dir(&app, &cache_ns)?;
    ensure_pins_loaded(&app, &state, &cache_ns);
    let pins = state.pins.lock().unwrap().clone();
    Ok(pins
        .into_iter()
        .map(|track_id| {
            let cached = find_cached(&dir, &track_id).is_some();
            PinInfo { track_id, cached }
        })
        .collect())
}

/// Лимит кэша из Prefs (слайдер в настройках; JS зовёт на старте и при смене).
#[tauri::command]
pub fn engine_set_cache_limit(state: State<'_, EngineState>, gb: f64) {
    let bytes = (gb.clamp(0.5, 512.0) * 1024.0 * 1024.0 * 1024.0) as u64;
    *state.cache_limit_bytes.lock().unwrap() = bytes;
}

/// Снять и обнулить счётчики добычи — для периодической отправки
/// анонимного агрегата (KPI SABR/403-rate, заметка аналитики).
#[tauri::command]
pub fn engine_stats_take(state: State<'_, EngineState>) -> EngineStats {
    std::mem::take(&mut *state.stats.lock().unwrap())
}

#[derive(Serialize)]
pub struct Doctor {
    pub ytdlp: Option<String>,
    pub deno: Option<String>,
}

/// Диагностика окружения добычи (вкладка «Система» / отладка).
#[tauri::command]
pub async fn engine_doctor() -> Doctor {
    fn version_of(program: &Path) -> Option<String> {
        let mut cmd = command(program);
        cmd.arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = cmd.spawn().ok()?;
        let status = wait_with_timeout(&mut child, Duration::from_secs(20)).ok()?;
        if !status.success() {
            return None;
        }
        let mut out = String::new();
        child.stdout.take()?.read_to_string(&mut out).ok()?;
        out.lines().next().map(|l| l.trim().to_string())
    }
    tauri::async_runtime::spawn_blocking(|| {
        let paths = std::env::current_exe()
            .ok()
            .and_then(|exe| release_sidecar_paths(&exe).ok());
        Doctor {
            ytdlp: paths.as_ref().and_then(|value| version_of(&value.ytdlp)),
            deno: paths.as_ref().and_then(|value| version_of(&value.deno)),
        }
    })
    .await
    .unwrap_or(Doctor {
        ytdlp: None,
        deno: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Клиенты YouTube, которым yt-dlp обязан скачать и исполнить player JS
    /// (n-sig challenge) в deno. Список — из замера 2026-07-15: в логе
    /// `yt-dlp -v` у них есть «Downloading player <id>-main», у android_vr его
    /// нет. Цена challenge (трек dQw4w9WgXcQ, аргументы движка байт-в-байт,
    /// резолв метаданных БЕЗ единого байта аудио):
    ///
    ///   tv 12.5с | tv_embedded 11.8с | web_embedded 10.1с | android_vr 3.6с
    ///
    /// Байты тут ни при чём: те же 3.4 МБ едут 1.2с (Range, 2.9 МБ/с).
    const JS_CHALLENGE_CLIENTS: &[&str] = &[
        "tv",
        "tv_embedded",
        "web",
        "web_embedded",
        "web_music",
        "web_creator",
        "mweb",
    ];

    fn needs_js_challenge(client: &str) -> bool {
        JS_CHALLENGE_CLIENTS.contains(&client)
    }

    /// Оффлайн-кэш НЕ должен откатывать бандл-дефолт, приехавший с обновлением
    /// приложения. Поймано 2026-07-15 на правке лестницы: у всех живых
    /// пользователей в `recipe-cache.json` лежит подписанный сервером v5, а
    /// `init()` затирал им свежий бандл-дефолт v6 БЕЗ сравнения версий (в
    /// отличие от `recipe_apply`, где анти-даунгрейд был). То есть клиентская
    /// половина фикса скорости не доехала бы вообще — только после деплоя
    /// сервера.
    #[test]
    fn stale_cached_recipe_does_not_downgrade_bundled_default() {
        // старый кэш против свежего дефолта — выигрывает дефорт приложения
        assert!(
            !cached_recipe_wins(5, 6),
            "кэшированный v5 не имеет права затирать бандл-дефолт v6"
        );
        // равные — кэш (у него настоящая подпись сервера, дефолт лишь копия)
        assert!(cached_recipe_wins(6, 6), "равные версии — кэш применяется");
        // горячий фикс сервера новее дефолта — обязан выигрывать
        assert!(
            cached_recipe_wins(7, 6),
            "горячий рецепт новее дефолта обязан применяться"
        );
    }

    /// Бандл-рецепт (оффлайн-старт до первого похода за горячим) обязан
    /// начинать лестницу с JS-free клиента.
    ///
    /// Регрессия 2026-07-15 («песни грузятся 5–10с»): v5 держал "tv" первым,
    /// хотя про tv уже было известно, что он ловит DRM-эксперимент (yt-dlp
    /// #12563). Лестница фолбэков чинила КОРРЕКТНОСТЬ, но цену времени никто
    /// не мерил: каждая неудачная попытка — отдельный процесс yt-dlp с полным
    /// n-sig challenge, то есть 4–12с в мусор ДО первой удачной. Замер
    /// лестницы целиком: было 6.7–8.6с, стало 4.5с.
    #[test]
    fn default_recipe_ladder_starts_with_js_free_client() {
        let recipe: serde_json::Value = serde_json::from_str(DEFAULT_RECIPE_JSON).unwrap();
        let clients: Vec<&str> = recipe["youtube"]["player_clients"]
            .as_array()
            .expect("player_clients — массив")
            .iter()
            .map(|v| v.as_str().expect("клиент — строка"))
            .collect();
        let first = *clients.first().expect("лестница не пуста");
        assert!(
            !needs_js_challenge(first),
            "лестница бандл-рецепта начинается с «{first}» — ему нужен n-sig \
             JS-challenge (~10-12с на резолв против ~3.6с у JS-free). Первым \
             обязан идти клиент без challenge (android_vr)."
        );
    }

    /// Анти-даунгрейд `recipe_apply` сравнивает `recipe_version`: рецепт с
    /// версией НЕ БОЛЬШЕ уже известной не применяется. Если бандл-дефолт
    /// обгонит серверный, горячий рецепт перестанет доезжать — эти два числа
    /// обязаны двигаться вместе (см. recipe.config.ts на сервере).
    #[test]
    fn default_recipe_version_matches_server_ladder_fix() {
        let recipe: serde_json::Value = serde_json::from_str(DEFAULT_RECIPE_JSON).unwrap();
        assert_eq!(
            recipe["recipe_version"].as_u64(),
            Some(7),
            "бандл-рецепт обязан быть v7 (ступень 0 innertube 2026-07-19); \
             серверный recipe.config.ts обязан быть той же версии"
        );
    }

    /// Подпись сервера сходится с вшитым pubkey; подделка отвергается.
    /// Конверт кладётся в файл заранее (curl /api/recipe), путь — в env:
    /// `MUZA_TEST_ENVELOPE=path cargo test verify_server_envelope -- --ignored`
    #[test]
    #[ignore = "нужен файл конверта с работающего сервера"]
    fn verify_server_envelope() {
        let path = std::env::var("MUZA_TEST_ENVELOPE").expect("MUZA_TEST_ENVELOPE не задан");
        let raw = fs::read_to_string(path).expect("файл конверта читается");
        let envelope: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let recipe_json = serde_json::to_string(&envelope["recipe"]).unwrap();
        let sig = envelope["sig"].as_str().unwrap();

        verify_recipe(&recipe_json, sig).expect("настоящая подпись должна сходиться");

        let tampered = recipe_json.replace("recipe_version", "recipe_versioX");
        assert!(
            verify_recipe(&tampered, sig).is_err(),
            "подделка обязана отвергаться"
        );
    }

    /// Живая добыча по лестнице клиентов рецепта (как engine_resolve):
    /// tv-сессии периодически ловят DRM-эксперимент — фолбэки обязаны спасать.
    /// Сеть + два adjacent/debug sidecar; известный источник из каталога dev-сервера.
    /// `cargo test resolve_real_track -- --ignored --nocapture`
    #[test]
    #[ignore = "сеть + yt-dlp + deno"]
    fn resolve_real_track() {
        let dir = std::env::temp_dir().join("muza-engine-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let recipe: serde_json::Value = serde_json::from_str(DEFAULT_RECIPE_JSON).unwrap();
        let clients: Vec<String> = recipe["youtube"]["player_clients"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();

        let source = SourceRef::Youtube {
            source_id: "4D7u5KF7SP8".into(),
        };
        let attempts = build_attempts(&[source], &clients).attempts;
        let sidecars = sidecar_paths().expect("sidecar-файлы доступны");
        let mut result = None;
        for attempt in attempts {
            let client = attempt.client.as_deref().unwrap_or("unknown").to_string();
            match run_ytdlp_once(
                &sidecars.ytdlp,
                &sidecars.deno,
                &dir,
                "test1",
                &attempt,
                "251/140/bestaudio",
            ) {
                Ok(path) => {
                    println!("клиент {client}: OK");
                    result = Some(path);
                    break;
                }
                Err(e) => println!("клиент {client}: {e}"),
            }
        }
        let path = result.expect("ни один клиент лестницы не добыл трек");
        let size = fs::metadata(&path).unwrap().len();
        println!("скачано: {} ({} байт)", path.display(), size);
        assert!(size > 100_000, "файл подозрительно мал");
    }
}

#[cfg(test)]
mod source_policy_tests {
    use super::*;
    use serde_json::{json, Value};
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    const PUBLIC_V4: IpAddr = IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8));

    fn provider(source: &SourceRef) -> &'static str {
        match source {
            SourceRef::Youtube { .. } => "youtube",
            SourceRef::Soundcloud { .. } => "soundcloud",
            SourceRef::Bandcamp { .. } => "bandcamp",
        }
    }

    fn youtube(source_id: &str) -> SourceRef {
        SourceRef::Youtube {
            source_id: source_id.to_string(),
        }
    }

    fn soundcloud(source_id: &str, canonical_url: &str) -> SourceRef {
        SourceRef::Soundcloud {
            source_id: source_id.to_string(),
            canonical_url: canonical_url.to_string(),
        }
    }

    fn bandcamp(source_id: &str, canonical_url: &str) -> SourceRef {
        SourceRef::Bandcamp {
            source_id: source_id.to_string(),
            canonical_url: canonical_url.to_string(),
        }
    }

    fn target_with_answers(source: &SourceRef, answers: &[IpAddr]) -> Result<String, String> {
        let mut lookup = |_host: &str, port: u16| {
            assert_eq!(port, 443);
            Ok(answers.to_vec())
        };
        canonical_target_with_lookup(source, &mut lookup).map(|url| url.to_string())
    }

    fn assert_rejected_before_dns(source: &SourceRef) {
        let mut calls = 0;
        let mut lookup = |_host: &str, _port: u16| {
            calls += 1;
            Ok(vec![PUBLIC_V4])
        };
        assert!(canonical_target_with_lookup(source, &mut lookup).is_err());
        assert_eq!(calls, 0, "invalid source must fail before DNS lookup");
    }

    #[test]
    fn source_policy_deserialization_accepts_exact_variants() {
        let fixtures = [
            (
                "youtube",
                r#"{"provider":"youtube","sourceId":"dQw4w9WgXcQ"}"#,
            ),
            (
                "soundcloud",
                r#"{"provider":"soundcloud","sourceId":"123","canonicalUrl":"https://soundcloud.com/artist/song"}"#,
            ),
            (
                "bandcamp",
                r#"{"provider":"bandcamp","sourceId":"456","canonicalUrl":"https://artist.bandcamp.com/track/song"}"#,
            ),
        ];

        for (expected_provider, raw) in fixtures {
            let direct = serde_json::from_str::<SourceRef>(raw).expect("exact raw variant");
            assert_eq!(provider(&direct), expected_provider);

            let value = serde_json::from_str::<Value>(raw).unwrap();
            let through_value =
                serde_json::from_value::<SourceRef>(value).expect("exact Value variant");
            assert_eq!(provider(&through_value), expected_provider);
        }
    }

    #[test]
    fn source_policy_deserialization_rejects_unknown_variants_and_fields() {
        let rejected = [
            r#"{"provider":"local","sourceId":"abc"}"#,
            r#"{"provider":"unknown","sourceId":"abc"}"#,
            r#"{"provider":"youtube","sourceId":"dQw4w9WgXcQ","url":"https://evil.test/private"}"#,
            r#"{"provider":"youtube","sourceId":"dQw4w9WgXcQ","canonicalUrl":"https://evil.test/private"}"#,
            r#"{"provider":"soundcloud","sourceId":"123","canonicalUrl":"https://soundcloud.com/artist/song","url":"https://evil.test/private"}"#,
            r#"{"provider":"bandcamp","sourceId":"456","canonicalUrl":"https://artist.bandcamp.com/track/song","extra":true}"#,
        ];

        for raw in rejected {
            assert!(
                serde_json::from_str::<SourceRef>(raw).is_err(),
                "raw accepted: {raw}"
            );
            let value = serde_json::from_str::<Value>(raw).unwrap();
            assert!(
                serde_json::from_value::<SourceRef>(value).is_err(),
                "Value accepted: {raw}"
            );
        }
    }

    #[test]
    fn source_policy_raw_json_rejects_duplicate_fields() {
        let duplicates = [
            r#"{"provider":"youtube","sourceId":"dQw4w9WgXcQ","sourceId":"aaaaaaaaaaa"}"#,
            r#"{"provider":"soundcloud","sourceId":"123","canonicalUrl":"https://soundcloud.com/artist/song","canonicalUrl":"https://soundcloud.com/other/song"}"#,
            r#"{"provider":"youtube","provider":"bandcamp","sourceId":"dQw4w9WgXcQ"}"#,
        ];

        for raw in duplicates {
            assert!(
                serde_json::from_str::<SourceRef>(raw).is_err(),
                "duplicate accepted: {raw}"
            );
        }

        // serde_json::Value is intentionally not used here: a map cannot retain
        // duplicate JSON keys, just like an ordinary JavaScript invoke object.
    }

    #[test]
    fn source_policy_validates_provider_ids_before_dns() {
        assert_eq!(
            target_with_answers(&youtube("dQw4w9WgXcQ"), &[PUBLIC_V4]).unwrap(),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        );

        for invalid in [
            "dQw4w9WgX",
            "dQw4w9WgXcQx",
            "dQw4w9WgXc!",
            "dQw4w9WgXcé",
            "           ",
        ] {
            assert_rejected_before_dns(&youtube(invalid));
        }

        for invalid in ["", " ", " 123", "123 "] {
            assert_rejected_before_dns(&soundcloud(invalid, "https://soundcloud.com/artist/song"));
            assert_rejected_before_dns(&bandcamp(
                invalid,
                "https://artist.bandcamp.com/track/song",
            ));
        }

        let too_long = "x".repeat(257);
        assert_rejected_before_dns(&soundcloud(&too_long, "https://soundcloud.com/artist/song"));
        assert_rejected_before_dns(&bandcamp(
            &too_long,
            "https://artist.bandcamp.com/track/song",
        ));
    }

    #[test]
    fn source_policy_accepts_only_exact_provider_locators() {
        let mut lookups = Vec::new();
        let mut lookup = |host: &str, port: u16| {
            lookups.push((host.to_string(), port));
            Ok(vec![PUBLIC_V4])
        };

        let sc = canonical_target_with_lookup(
            &soundcloud("123", "https://soundcloud.com/artist/song"),
            &mut lookup,
        )
        .unwrap();
        let bc = canonical_target_with_lookup(
            &bandcamp("456", "https://artist.bandcamp.com/track/song"),
            &mut lookup,
        )
        .unwrap();

        assert_eq!(sc.as_str(), "https://soundcloud.com/artist/song");
        assert_eq!(bc.as_str(), "https://artist.bandcamp.com/track/song");
        assert_eq!(
            lookups,
            vec![
                ("soundcloud.com".to_string(), 443),
                ("artist.bandcamp.com".to_string(), 443),
            ]
        );
    }

    #[test]
    fn source_policy_accepts_numeric_api_soundcloud_locator() {
        // Числовая API-форма — норма каталога после миграции URN→цифры
        // (20260716143000_soundcloud_urn_urls_to_numeric на сервере).
        let mut lookup = |_: &str, _: u16| Ok(vec![PUBLIC_V4]);
        let sc = canonical_target_with_lookup(
            &soundcloud("123", "https://api.soundcloud.com/tracks/254111945"),
            &mut lookup,
        )
        .unwrap();
        assert_eq!(sc.as_str(), "https://api.soundcloud.com/tracks/254111945");
    }

    #[test]
    fn source_policy_rejects_noncanonical_api_soundcloud_locators_before_dns() {
        let cases = vec![
            // URN-форма, отравлявшая каталог до миграции, — навсегда вне грамматики
            "https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A254111945".to_string(),
            "https://api.soundcloud.com/tracks/soundcloud:tracks:254111945".to_string(),
            "https://api-v2.soundcloud.com/tracks/254111945".to_string(),
            "https://api.soundcloud.com/tracks/254111945/".to_string(),
            "https://api.soundcloud.com/tracks".to_string(),
            "https://api.soundcloud.com/tracks/254111945/extra".to_string(),
            "https://api.soundcloud.com/playlists/254111945".to_string(),
            "https://api.soundcloud.com/tracks/0254111945".to_string(),
            "https://api.soundcloud.com/tracks/25411x945".to_string(),
            "https://api.soundcloud.com/tracks/254111945?x=1".to_string(),
            format!("https://api.soundcloud.com/tracks/{}", "9".repeat(21)),
        ];
        for raw in cases {
            assert_rejected_before_dns(&soundcloud("123", &raw));
        }
    }

    #[test]
    fn source_policy_rejects_noncanonical_soundcloud_locators_before_dns() {
        let overlong = "a".repeat(129);
        let cases = vec![
            "HTTPS://soundcloud.com/artist/song".to_string(),
            " https://soundcloud.com/artist/song".to_string(),
            "https://soundcloud.com/artist/song ".to_string(),
            "http://soundcloud.com/artist/song".to_string(),
            "https://soundcloud.com:443/artist/song".to_string(),
            "https://soundcloud.com:8443/artist/song".to_string(),
            "https:////soundcloud.com/artist/song".to_string(),
            "https://SoundCloud.com/artist/song".to_string(),
            "https://www.soundcloud.com/artist/song".to_string(),
            "https://soundcloud.com.evil.test/artist/song".to_string(),
            "https://evil-soundcloud.com/artist/song".to_string(),
            "https://127.0.0.1/artist/song".to_string(),
            "https://@soundcloud.com/artist/song".to_string(),
            "https://:@soundcloud.com/artist/song".to_string(),
            "https://user@soundcloud.com/artist/song".to_string(),
            "https://user:pass@soundcloud.com/artist/song".to_string(),
            "https://soundcloud.com/artist/song?x=1".to_string(),
            "https://soundcloud.com/artist/song?".to_string(),
            "https://soundcloud.com/artist/song#x".to_string(),
            "https://soundcloud.com/artist/song#".to_string(),
            "https://soundcloud.com/artist/song/".to_string(),
            "https://soundcloud.com/artist/./song".to_string(),
            "https://soundcloud.com/artist/../song".to_string(),
            "https://soundcloud.com/artist/%2e".to_string(),
            "https://soundcloud.com/artist/%2e%2e".to_string(),
            "https://soundcloud.com/artist%2fsong/track".to_string(),
            "https://soundcloud.com/artist/%40song".to_string(),
            "https://soundcloud%2ecom/artist/song".to_string(),
            "https://soundcloud.com\\@evil.test/artist/song".to_string(),
            "https://soundcloud.com/artist\\song".to_string(),
            "https://soundcloud.com/art\tist/song".to_string(),
            "https://soundcloud.com/art\nist/song".to_string(),
            "https://soundcloud.com/art\rist/song".to_string(),
            "https://soundcloud.com/Artist/song".to_string(),
            "https://soundcloud.com/-artist/song".to_string(),
            "https://soundcloud.com/artist-/song".to_string(),
            "https://soundcloud.com/_artist/song".to_string(),
            "https://soundcloud.com/artist_/song".to_string(),
            "https://soundcloud.com/artist/-song".to_string(),
            "https://soundcloud.com/artist/song-".to_string(),
            "https://soundcloud.com/artist/песня".to_string(),
            "https://soundcloud.com//song".to_string(),
            "https://soundcloud.com/artist".to_string(),
            format!("https://soundcloud.com/{overlong}/song"),
            format!("https://soundcloud.com/artist/{overlong}"),
        ];

        for raw in cases {
            assert_rejected_before_dns(&soundcloud("123", &raw));
        }
    }

    #[test]
    fn source_policy_rejects_noncanonical_bandcamp_locators_before_dns() {
        let overlong_path = "a".repeat(129);
        let overlong_host = "a".repeat(64);
        let cases = vec![
            "HTTPS://artist.bandcamp.com/track/song".to_string(),
            " https://artist.bandcamp.com/track/song".to_string(),
            "https://artist.bandcamp.com/track/song ".to_string(),
            "http://artist.bandcamp.com/track/song".to_string(),
            "https://artist.bandcamp.com:443/track/song".to_string(),
            "https://artist.bandcamp.com:8443/track/song".to_string(),
            "https:////artist.bandcamp.com/track/song".to_string(),
            "https://Artist.bandcamp.com/track/song".to_string(),
            "https://artist.Bandcamp.com/track/song".to_string(),
            "https://www.artist.bandcamp.com/track/song".to_string(),
            "https://artist.bandcamp.com.evil.test/track/song".to_string(),
            "https://evil-bandcamp.com/track/song".to_string(),
            "https://127.0.0.1/track/song".to_string(),
            "https://@artist.bandcamp.com/track/song".to_string(),
            "https://:@artist.bandcamp.com/track/song".to_string(),
            "https://user@artist.bandcamp.com/track/song".to_string(),
            "https://user:pass@artist.bandcamp.com/track/song".to_string(),
            "https://artist.bandcamp.com/track/song?x=1".to_string(),
            "https://artist.bandcamp.com/track/song?".to_string(),
            "https://artist.bandcamp.com/track/song#x".to_string(),
            "https://artist.bandcamp.com/track/song#".to_string(),
            "https://artist.bandcamp.com/track/song/".to_string(),
            "https://artist.bandcamp.com/track/./song".to_string(),
            "https://artist.bandcamp.com/track/../song".to_string(),
            "https://artist.bandcamp.com/track/%2e".to_string(),
            "https://artist.bandcamp.com/track/%2e%2e".to_string(),
            "https://artist.bandcamp.com/track%2fsong/other".to_string(),
            "https://artist.bandcamp.com/track/%40song".to_string(),
            "https://artist%2ebandcamp.com/track/song".to_string(),
            "https://artist.bandcamp.com\\@evil.test/track/song".to_string(),
            "https://artist.bandcamp.com/track\\song".to_string(),
            "https://artist.bandcamp.com/tra\tck/song".to_string(),
            "https://artist.bandcamp.com/tra\nck/song".to_string(),
            "https://artist.bandcamp.com/tra\rck/song".to_string(),
            "https://artist.bandcamp.com/Track/song".to_string(),
            "https://Artist.bandcamp.com/track/song".to_string(),
            "https://-artist.bandcamp.com/track/song".to_string(),
            "https://artist-.bandcamp.com/track/song".to_string(),
            "https://artist_name.bandcamp.com/track/song".to_string(),
            "https://artist.other.bandcamp.com/track/song".to_string(),
            "https://artist.bandcamp.com/track/-song".to_string(),
            "https://artist.bandcamp.com/track/song-".to_string(),
            "https://artist.bandcamp.com/track/песня".to_string(),
            "https://artist.bandcamp.com//song".to_string(),
            "https://artist.bandcamp.com/album/song".to_string(),
            format!("https://{overlong_host}.bandcamp.com/track/song"),
            format!("https://artist.bandcamp.com/track/{overlong_path}"),
        ];

        for raw in cases {
            assert_rejected_before_dns(&bandcamp("456", &raw));
        }
    }

    #[test]
    fn source_policy_rejects_every_ascii_control_byte_before_dns() {
        let fixtures = [
            ("soundcloud", "https://soundcloud.com/artist/song"),
            ("bandcamp", "https://artist.bandcamp.com/track/song"),
        ];

        for (provider, base) in fixtures {
            for byte in (0_u8..=31).chain(std::iter::once(127)) {
                for position in [0, 8, base.len() / 2, base.len()] {
                    let mut raw = base.to_string();
                    raw.insert(position, char::from(byte));
                    let source = match provider {
                        "soundcloud" => soundcloud("123", &raw),
                        "bandcamp" => bandcamp("456", &raw),
                        _ => unreachable!(),
                    };
                    assert_rejected_before_dns(&source);
                }
            }
        }
    }

    fn desired_public_v4(value: u32, blocked: &[(u32, u8)]) -> bool {
        !blocked.iter().any(|(base, prefix)| {
            let mask = u32::MAX << (32 - u32::from(*prefix));
            value & mask == *base & mask
        })
    }

    #[test]
    fn source_policy_ipv4_prefix_boundaries_are_fail_closed() {
        let blocked = [
            (u32::from_be_bytes([0, 0, 0, 0]), 8),
            (u32::from_be_bytes([10, 0, 0, 0]), 8),
            (u32::from_be_bytes([100, 64, 0, 0]), 10),
            (u32::from_be_bytes([127, 0, 0, 0]), 8),
            (u32::from_be_bytes([169, 254, 0, 0]), 16),
            (u32::from_be_bytes([172, 16, 0, 0]), 12),
            (u32::from_be_bytes([192, 0, 0, 0]), 24),
            (u32::from_be_bytes([192, 0, 2, 0]), 24),
            (u32::from_be_bytes([192, 31, 196, 0]), 24),
            (u32::from_be_bytes([192, 52, 193, 0]), 24),
            (u32::from_be_bytes([192, 88, 99, 0]), 24),
            (u32::from_be_bytes([192, 168, 0, 0]), 16),
            (u32::from_be_bytes([192, 175, 48, 0]), 24),
            (u32::from_be_bytes([198, 18, 0, 0]), 15),
            (u32::from_be_bytes([198, 51, 100, 0]), 24),
            (u32::from_be_bytes([203, 0, 113, 0]), 24),
            (u32::from_be_bytes([224, 0, 0, 0]), 4),
            (u32::from_be_bytes([240, 0, 0, 0]), 4),
        ];

        for (base, prefix) in blocked {
            let host_bits = 32 - u32::from(prefix);
            let last = base | ((1_u32 << host_bits) - 1);
            for value in [base, last] {
                assert!(!is_public_ip(IpAddr::V4(Ipv4Addr::from(value))));
            }
            if let Some(before) = base.checked_sub(1) {
                assert_eq!(
                    is_public_ip(IpAddr::V4(Ipv4Addr::from(before))),
                    desired_public_v4(before, &blocked),
                    "IPv4 before {}/{}",
                    Ipv4Addr::from(base),
                    prefix
                );
            }
            if let Some(after) = last.checked_add(1) {
                assert_eq!(
                    is_public_ip(IpAddr::V4(Ipv4Addr::from(after))),
                    desired_public_v4(after, &blocked),
                    "IPv4 after {}/{}",
                    Ipv4Addr::from(base),
                    prefix
                );
            }
        }

        for public in [Ipv4Addr::new(8, 8, 8, 8), Ipv4Addr::new(1, 1, 1, 1)] {
            assert!(is_public_ip(IpAddr::V4(public)));
        }
    }

    fn prefix_mask_v6(prefix: u8) -> u128 {
        u128::MAX << (128 - u32::from(prefix))
    }

    fn desired_public_v6(value: u128, blocked: &[(u128, u8)]) -> bool {
        let global_base = u128::from("2000::".parse::<Ipv6Addr>().unwrap());
        let in_global = value & prefix_mask_v6(3) == global_base & prefix_mask_v6(3);
        in_global
            && !blocked.iter().any(|(base, prefix)| {
                value & prefix_mask_v6(*prefix) == *base & prefix_mask_v6(*prefix)
            })
    }

    #[test]
    fn source_policy_ipv6_prefix_boundaries_and_canonical_mappings_are_fail_closed() {
        let blocked = [
            (u128::from("2001::".parse::<Ipv6Addr>().unwrap()), 23),
            (u128::from("2001:db8::".parse::<Ipv6Addr>().unwrap()), 32),
            (u128::from("2002::".parse::<Ipv6Addr>().unwrap()), 16),
            (u128::from("3fff::".parse::<Ipv6Addr>().unwrap()), 20),
            (u128::from("5f00::".parse::<Ipv6Addr>().unwrap()), 16),
        ];

        let global_first = u128::from("2000::".parse::<Ipv6Addr>().unwrap());
        let global_last = global_first | ((1_u128 << 125) - 1);
        assert!(is_public_ip(IpAddr::V6(Ipv6Addr::from(global_first))));
        assert!(is_public_ip(IpAddr::V6(Ipv6Addr::from(global_last))));
        assert!(!is_public_ip(IpAddr::V6(Ipv6Addr::from(global_first - 1))));
        assert!(!is_public_ip(IpAddr::V6(Ipv6Addr::from(global_last + 1))));

        for (base, prefix) in blocked {
            let host_bits = 128 - u32::from(prefix);
            let last = base | ((1_u128 << host_bits) - 1);
            for value in [base, last] {
                assert!(!is_public_ip(IpAddr::V6(Ipv6Addr::from(value))));
            }
            if let Some(before) = base.checked_sub(1) {
                assert_eq!(
                    is_public_ip(IpAddr::V6(Ipv6Addr::from(before))),
                    desired_public_v6(before, &blocked),
                    "IPv6 before {}/{}",
                    Ipv6Addr::from(base),
                    prefix
                );
            }
            if let Some(after) = last.checked_add(1) {
                assert_eq!(
                    is_public_ip(IpAddr::V6(Ipv6Addr::from(after))),
                    desired_public_v6(after, &blocked),
                    "IPv6 after {}/{}",
                    Ipv6Addr::from(base),
                    prefix
                );
            }
        }

        for rejected in [
            "64:ff9b::7f00:1",
            "64:ff9b:1::1",
            "100::1",
            "2001::1",
            "2001:db8::1",
            "2002:7f00:1::1",
            "3fff::1",
            "5f00::1",
            "fc00::1",
            "fe80::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.1.1",
        ] {
            assert!(
                !is_public_ip(IpAddr::V6(rejected.parse().unwrap())),
                "accepted {rejected}"
            );
        }

        for accepted in ["2606:4700:4700::1111", "::ffff:8.8.8.8"] {
            assert!(
                is_public_ip(IpAddr::V6(accepted.parse().unwrap())),
                "rejected {accepted}"
            );
        }
    }

    #[test]
    fn source_policy_dns_rejects_private_and_mixed_answers() {
        let source = youtube("dQw4w9WgXcQ");

        for answers in [
            vec![IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))],
            vec![PUBLIC_V4, IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))],
        ] {
            assert!(target_with_answers(&source, &answers).is_err());
        }

        for answer in [
            PUBLIC_V4,
            IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
            IpAddr::V6("2606:4700:4700::1111".parse().unwrap()),
            IpAddr::V6("::ffff:8.8.8.8".parse().unwrap()),
        ] {
            assert!(target_with_answers(&source, &[answer]).is_ok());
        }
    }

    /// Регрессия «Couldn't fetch the track» (2026-07-15). У пользователя за
    /// DPI-обходом провайдер перехватывает DNS и отдаёт NXDOMAIN на
    /// youtube.com, а yt-dlp ходит через системный прокси и резолвит хост САМ,
    /// удалённо. Преflight не пинит ответы (yt-dlp резолвит заново), т.е. это
    /// не egress-контроль — и он НЕ имеет права убивать источник только потому,
    /// что локальный резолвер не смог узнать адрес.
    #[test]
    fn source_policy_dns_failure_keeps_source() {
        let source = youtube("dQw4w9WgXcQ");
        let mut lookup = |_host: &str, _port: u16| Err("DNS lookup failed: NXDOMAIN".to_string());

        assert_eq!(
            canonical_target_with_lookup(&source, &mut lookup).map(|url| url.to_string()),
            Ok("https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string())
        );
    }

    /// Пустой ответ = «адресов не узнали», а не «адресов нет»: та же логика.
    #[test]
    fn source_policy_dns_empty_answer_keeps_source() {
        let source = youtube("dQw4w9WgXcQ");
        assert!(target_with_answers(&source, &[]).is_ok());
    }

    /// Сквозной срез того же: сломанный локальный DNS не должен обнулять
    /// лестницу попыток — иначе engine_resolve вернёт «у трека нет живых
    /// источников», ни разу не запустив yt-dlp.
    #[test]
    fn source_policy_dns_failure_still_builds_attempts() {
        let sources = vec![
            youtube("dQw4w9WgXcQ"),
            soundcloud("123", "https://soundcloud.com/artist/song"),
        ];
        let clients = vec!["tv".to_string()];
        let mut lookup = |_host: &str, _port: u16| Err("DNS lookup failed: NXDOMAIN".to_string());

        let attempts = build_attempts_with_lookup(&sources, &clients, &mut lookup);
        assert_eq!(
            attempts.len(),
            2,
            "источники не должны исчезать из-за отказа локального резолвера"
        );
    }

    #[test]
    fn source_policy_attempt_order_and_client_expansion_are_stable() {
        let sources = vec![
            soundcloud("123", "https://soundcloud.com/artist/song"),
            youtube("dQw4w9WgXcQ"),
            bandcamp("456", "https://artist.bandcamp.com/track/song"),
        ];
        let clients = vec!["tv".to_string(), "web_music".to_string()];
        let mut lookup = |_host: &str, port: u16| {
            assert_eq!(port, 443);
            Ok(vec![PUBLIC_V4])
        };

        let attempts = build_attempts_with_lookup(&sources, &clients, &mut lookup);
        let actual: Vec<(String, String, Option<String>)> = attempts
            .iter()
            .map(|attempt| {
                (
                    attempt.provider.clone(),
                    attempt.url.as_str().to_string(),
                    attempt.client.clone(),
                )
            })
            .collect();
        assert_eq!(
            actual,
            vec![
                (
                    "soundcloud".to_string(),
                    "https://soundcloud.com/artist/song".to_string(),
                    None,
                ),
                (
                    "youtube".to_string(),
                    "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
                    Some("tv".to_string()),
                ),
                (
                    "youtube".to_string(),
                    "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
                    Some("web_music".to_string()),
                ),
                (
                    "bandcamp".to_string(),
                    "https://artist.bandcamp.com/track/song".to_string(),
                    None,
                ),
            ]
        );
    }

    #[test]
    fn source_policy_rejected_refs_create_no_attempts() {
        let sources = vec![
            youtube("short"),
            soundcloud(
                "123",
                "https://soundcloud.com/artist/song?next=http://127.0.0.1",
            ),
            bandcamp("456", "https://127.0.0.1/track/song"),
        ];
        let clients = vec!["tv".to_string()];
        let mut lookup = |_host: &str, _port: u16| Ok(vec![PUBLIC_V4]);

        assert!(build_attempts_with_lookup(&sources, &clients, &mut lookup).is_empty());
    }

    #[test]
    fn source_policy_value_fixture_matches_tauri_object_shape() {
        let value = json!({
            "provider": "soundcloud",
            "sourceId": "123",
            "canonicalUrl": "https://soundcloud.com/artist/song"
        });
        assert!(serde_json::from_value::<SourceRef>(value).is_ok());
    }

    /// Регрессия `48b845b` → «Couldn't fetch the track» на всех источниках.
    /// `--max-downloads 1` заставляет yt-dlp выйти кодом 101 РОВНО ПОСЛЕ
    /// успешного скачивания. Трактовать 101 как провал = выбрасывать каждую
    /// удачную добычу; настоящие ошибки (1/2) обязаны остаться ошибками.
    #[test]
    fn ytdlp_exit_101_max_downloads_is_success() {
        assert!(ytdlp_exit_ok(Some(0)), "0 — обычный успех");
        assert!(
            ytdlp_exit_ok(Some(101)),
            "101 = MaxDownloadsReached, файл скачан"
        );

        assert!(!ytdlp_exit_ok(Some(1)), "1 — настоящая ошибка yt-dlp");
        assert!(!ytdlp_exit_ok(Some(2)), "2 — настоящая ошибка yt-dlp");
        assert!(!ytdlp_exit_ok(None), "убит сигналом/таймаутом — не успех");
    }
}

#[cfg(test)]
mod sidecar_policy_tests {
    use super::*;
    use std::ffi::OsString;
    use std::fs::{self, OpenOptions};
    use std::io;
    use std::sync::atomic::{AtomicU64, Ordering};

    const MAX_OUTPUT_BYTES: u64 = 512 * 1024 * 1024;
    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(label: &str) -> Self {
            let suffix = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "muza-sidecar-policy-{label}-{}-{suffix}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct EnvRestore {
        key: &'static str,
        value: Option<OsString>,
    }

    impl EnvRestore {
        fn set(key: &'static str, value: &Path) -> Self {
            let previous = std::env::var_os(key);
            std::env::set_var(key, value);
            Self {
                key,
                value: previous,
            }
        }
    }

    impl Drop for EnvRestore {
        fn drop(&mut self) {
            if let Some(value) = &self.value {
                std::env::set_var(self.key, value);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    fn write_file(path: &Path, contents: &[u8]) {
        fs::write(path, contents).unwrap();
    }

    fn materialize_sidecars(root: &Path) -> (PathBuf, PathBuf, PathBuf) {
        let exe = root.join("muza.exe");
        let ytdlp = root.join("yt-dlp.exe");
        let deno = root.join("deno.exe");
        write_file(&exe, b"app");
        write_file(&ytdlp, b"yt-dlp");
        write_file(&deno, b"deno");
        (exe, ytdlp, deno)
    }

    fn os_strings(args: Vec<OsString>) -> Vec<String> {
        args.into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn sidecar_policy_release_paths_require_both_adjacent_regular_files() {
        let root = TempRoot::new("adjacent");
        let (exe, ytdlp, deno) = materialize_sidecars(root.path());
        let paths = release_sidecar_paths(&exe).unwrap();
        assert_eq!(paths.ytdlp, ytdlp);
        assert_eq!(paths.deno, deno);

        fs::remove_file(&ytdlp).unwrap();
        assert!(release_sidecar_paths(&exe).is_err());
        write_file(&ytdlp, b"yt-dlp");
        fs::remove_file(&deno).unwrap();
        assert!(release_sidecar_paths(&exe).is_err());

        fs::create_dir(&deno).unwrap();
        assert!(release_sidecar_paths(&exe).is_err());
        fs::remove_dir(&deno).unwrap();
        fs::remove_file(&ytdlp).unwrap();
        fs::create_dir(&ytdlp).unwrap();
        assert!(release_sidecar_paths(&exe).is_err());
    }

    #[test]
    fn sidecar_policy_release_helper_never_consults_debug_env_fallbacks() {
        let _lock = ENV_LOCK.lock().unwrap();
        let adjacent = TempRoot::new("release-no-env");
        let fallback = TempRoot::new("debug-env");
        let exe = adjacent.path().join("muza.exe");
        write_file(&exe, b"app");
        let fallback_ytdlp = fallback.path().join("yt-dlp.exe");
        let fallback_deno = fallback.path().join("deno.exe");
        write_file(&fallback_ytdlp, b"yt-dlp");
        write_file(&fallback_deno, b"deno");
        let _yt_restore = EnvRestore::set("MUZA_YTDLP_PATH", &fallback_ytdlp);
        let _deno_restore = EnvRestore::set("MUZA_DENO_PATH", &fallback_deno);

        assert!(release_sidecar_paths(&exe).is_err());
    }

    #[test]
    fn sidecar_policy_release_paths_reject_symlinks_when_available() {
        let root = TempRoot::new("sidecar-link");
        let outside = TempRoot::new("sidecar-link-target");
        let (exe, ytdlp, deno) = materialize_sidecars(root.path());
        let target = outside.path().join("real.exe");
        write_file(&target, b"outside");

        fs::remove_file(&ytdlp).unwrap();
        match create_file_symlink(&target, &ytdlp) {
            Ok(()) => {
                assert!(release_sidecar_paths(&exe).is_err());
                assert!(ytdlp.exists());
                assert_eq!(fs::read(&target).unwrap(), b"outside");
            }
            Err(error) if link_creation_unavailable(&error) => {
                println!("sidecar symlink unavailable: {error}");
            }
            Err(error) => panic!("unexpected symlink error: {error}"),
        }

        let _ = fs::remove_file(&ytdlp);
        write_file(&ytdlp, b"yt-dlp");
        fs::remove_file(&deno).unwrap();
        match create_file_symlink(&target, &deno) {
            Ok(()) => assert!(release_sidecar_paths(&exe).is_err()),
            Err(error) if link_creation_unavailable(&error) => {
                println!("Deno symlink unavailable: {error}");
            }
            Err(error) => panic!("unexpected symlink error: {error}"),
        }
    }

    #[test]
    fn sidecar_policy_build_args_have_exact_guard_prefix_and_url_last() {
        let root = TempRoot::new("args");
        let deno = root.path().join("deno.exe");
        write_file(&deno, b"deno");
        let attempt = Attempt {
            provider: "youtube".into(),
            url: Url::parse("https://www.youtube.com/watch?v=dQw4w9WgXcQ").unwrap(),
            client: Some("tv".into()),
        };

        let args = os_strings(build_ytdlp_args(
            root.path(),
            "42",
            &attempt,
            "251/140/bestaudio",
            &deno,
        ));
        assert_eq!(
            &args[..8],
            [
                "--ignore-config",
                "--no-playlist",
                "--max-downloads",
                "1",
                "--max-filesize",
                "512M",
                "--js-runtimes",
                &format!("deno:{}", deno.display()),
            ]
        );
        let target = attempt.url.as_str();
        assert_eq!(args.last().map(String::as_str), Some(target));
        assert_eq!(args.iter().filter(|arg| arg.as_str() == target).count(), 1);
        for guard in [
            "--ignore-config",
            "--no-playlist",
            "--max-downloads",
            "--max-filesize",
            "--js-runtimes",
        ] {
            assert!(args.iter().position(|arg| arg == guard).unwrap() < args.len() - 1);
        }
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--extractor-args", "youtube:player_client=tv"]));
    }

    #[test]
    fn sidecar_policy_output_accepts_only_contained_regular_size_range() {
        let root = TempRoot::new("output-size");
        let cache = root.path().join("cache");
        fs::create_dir(&cache).unwrap();

        let exact = cache.join("exact.webm");
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&exact)
            .unwrap()
            .set_len(MAX_OUTPUT_BYTES)
            .unwrap();
        assert_eq!(
            validate_ytdlp_output(&cache, &exact).unwrap(),
            fs::canonicalize(&exact).unwrap()
        );

        let empty = cache.join("empty.webm");
        write_file(&empty, b"");
        assert!(validate_ytdlp_output(&cache, &empty).is_err());

        let oversized = cache.join("oversized.webm");
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&oversized)
            .unwrap()
            .set_len(MAX_OUTPUT_BYTES + 1)
            .unwrap();
        assert!(validate_ytdlp_output(&cache, &oversized).is_err());

        let directory = cache.join("directory.webm");
        fs::create_dir(&directory).unwrap();
        write_file(&directory.join("keep.txt"), b"keep");
        assert!(validate_ytdlp_output(&cache, &directory).is_err());
        assert_eq!(fs::read(directory.join("keep.txt")).unwrap(), b"keep");
    }

    #[test]
    fn sidecar_policy_output_rejects_outside_and_dotdot_without_touching_targets() {
        let root = TempRoot::new("output-containment");
        let cache = root.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let outside = root.path().join("outside.webm");
        write_file(&outside, b"outside-unchanged");

        assert!(validate_ytdlp_output(&cache, &outside).is_err());
        assert!(validate_ytdlp_output(&cache, &cache.join("..").join("outside.webm")).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"outside-unchanged");
    }

    #[test]
    fn sidecar_policy_injected_canonical_escape_rejects_before_any_deletion() {
        let root = TempRoot::new("canonical-injection");
        let cache = root.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let candidate = cache.join("candidate.webm");
        let outside = root.path().join("outside.webm");
        write_file(&candidate, b"candidate-unchanged");
        write_file(&outside, b"outside-unchanged");
        let canonical_outside = fs::canonicalize(&outside).unwrap();
        let candidate_for_lookup = candidate.clone();
        let mut canonicalize = move |path: &Path| -> io::Result<PathBuf> {
            if path == candidate_for_lookup {
                Ok(canonical_outside.clone())
            } else {
                fs::canonicalize(path)
            }
        };

        assert!(
            validate_ytdlp_output_with_canonicalizer(&cache, &candidate, &mut canonicalize,)
                .is_err()
        );
        assert_eq!(fs::read(&candidate).unwrap(), b"candidate-unchanged");
        assert_eq!(fs::read(&outside).unwrap(), b"outside-unchanged");
    }

    #[test]
    fn sidecar_policy_actual_output_symlink_escape_keeps_link_and_target_when_available() {
        let root = TempRoot::new("output-link");
        let cache = root.path().join("cache");
        fs::create_dir(&cache).unwrap();
        let outside = root.path().join("outside.webm");
        let link = cache.join("linked.webm");
        write_file(&outside, b"outside-unchanged");

        match create_file_symlink(&outside, &link) {
            Ok(()) => {
                assert!(validate_ytdlp_output(&cache, &link).is_err());
                assert!(fs::symlink_metadata(&link)
                    .unwrap()
                    .file_type()
                    .is_symlink());
                assert_eq!(fs::read(&outside).unwrap(), b"outside-unchanged");
            }
            Err(error) if link_creation_unavailable(&error) => {
                println!("output symlink unavailable: {error}");
            }
            Err(error) => panic!("unexpected symlink error: {error}"),
        }
    }

    #[cfg(windows)]
    fn create_file_symlink(target: &Path, link: &Path) -> io::Result<()> {
        std::os::windows::fs::symlink_file(target, link)
    }

    #[cfg(unix)]
    fn create_file_symlink(target: &Path, link: &Path) -> io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    fn link_creation_unavailable(error: &io::Error) -> bool {
        error.raw_os_error() == Some(1314)
            || matches!(
                error.kind(),
                io::ErrorKind::PermissionDenied | io::ErrorKind::Unsupported
            )
    }

    // ── Неймспейс кэша добычи (баг «чужая песня»: track_id из РАЗНЫХ БД
    //    коллидировали в одном каталоге; кэш обязан жить в подкаталоге
    //    окружения API) ─────────────────────────────────────────────────
    fn ns_test_base(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "muza-ns-test-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn namespaced_cache_dir_builds_subdir() {
        let base = ns_test_base("subdir");
        let dir = namespaced_cache_dir(&base, "a1b2c3d4").unwrap();
        assert_eq!(dir, base.join("a1b2c3d4"));
        assert!(dir.is_dir());
    }

    #[test]
    fn namespaced_cache_dir_rejects_bad_namespace() {
        let base = ns_test_base("badns");
        for bad in [
            "",
            "../evil",
            "a/b",
            "A B",
            "имя",
            &"x".repeat(40),
            ".hidden",
        ] {
            assert!(
                namespaced_cache_dir(&base, bad).is_err(),
                "должен отвергать ns={bad:?}"
            );
        }
    }

    #[test]
    fn namespaced_cache_dir_sweeps_legacy_root_audio() {
        let base = ns_test_base("sweep");
        // ядовитое легаси: аудио по голому track_id в корне + обломки yt-dlp
        for name in [
            "7.webm",
            "123.m4a",
            "5.mp3",
            "9.opus",
            "44.webm.part",
            "44.webm.ytdl",
        ] {
            fs::write(base.join(name), b"x").unwrap();
        }
        // НЕ трогаем: не-аудио, нечисловые имена, файлы в ns-подкаталогах
        fs::write(base.join("keep.txt"), b"x").unwrap();
        fs::write(base.join("intro.webm"), b"x").unwrap();
        let dir = namespaced_cache_dir(&base, "deadbeef").unwrap();
        fs::write(dir.join("7.webm"), b"fresh").unwrap();
        // повторный вызов (каждый старт) не должен трогать ns-файлы
        namespaced_cache_dir(&base, "deadbeef").unwrap();
        for gone in [
            "7.webm",
            "123.m4a",
            "5.mp3",
            "9.opus",
            "44.webm.part",
            "44.webm.ytdl",
        ] {
            assert!(
                !base.join(gone).exists(),
                "легаси {gone} должен быть удалён"
            );
        }
        assert!(base.join("keep.txt").exists());
        assert!(base.join("intro.webm").exists());
        assert!(
            dir.join("7.webm").exists(),
            "файл внутри ns должен пережить sweep"
        );
    }

    #[test]
    fn pins_file_lives_inside_namespace() {
        let base = ns_test_base("pins");
        let p = pins_file(&base, "a1b2c3d4").unwrap();
        assert_eq!(p, base.join("a1b2c3d4").join("offline-pins.json"));
        assert!(pins_file(&base, "../evil").is_err());
    }
}

#[cfg(test)]
mod warm_tests {
    use super::*;

    fn yt_attempt() -> Attempt {
        Attempt {
            provider: "youtube".into(),
            url: Url::parse("https://www.youtube.com/watch?v=dQw4w9WgXcQ").unwrap(),
            client: Some("android_vr".into()),
        }
    }

    fn simulate_args() -> Vec<String> {
        build_ytdlp_simulate_args(&yt_attempt(), "251/140/bestaudio", Path::new("C:/t/deno.exe"))
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    /// `--max-filesize` фильтрует лестницу ФОРМАТОВ уже на резолве, а не только
    /// обрывает скачивание — прогрев обязан видеть ту же лестницу, что бой,
    /// иначе warm-URL укажет на формат, который боевой путь отверг бы.
    #[test]
    fn simulate_args_keep_max_filesize() {
        let args = simulate_args();
        let i = args
            .iter()
            .position(|a| a == "--max-filesize")
            .expect("--max-filesize обязан остаться в argv прогрева");
        assert_eq!(args[i + 1], "512M");
    }

    /// При `--simulate` скачивания нет — `--max-downloads` бессмыслен, а его
    /// exit-101 в боевом пути особый (успех). Прогреву флаг только мешает.
    #[test]
    fn simulate_args_have_no_max_downloads() {
        assert!(
            !simulate_args().iter().any(|a| a == "--max-downloads"),
            "у simulate-argv не должно быть --max-downloads"
        );
    }

    /// Прогрев — это `--simulate` + `--print` метаданных; боевого
    /// `--no-simulate`/`after_move:filepath` быть не должно. Клиент лестницы и
    /// URL — как в боевом argv.
    #[test]
    fn simulate_args_are_simulate_only() {
        let args = simulate_args();
        assert!(args.iter().any(|a| a == "--simulate"));
        assert!(!args.iter().any(|a| a == "--no-simulate"));
        assert!(!args.iter().any(|a| a.contains("after_move")));
        let i = args.iter().position(|a| a == "--print").expect("--print");
        assert_eq!(
            args[i + 1],
            "%(url)s\t%(filesize,filesize_approx)s\t%(ext)s\t%(protocol)s"
        );
        assert!(args.iter().any(|a| a == "youtube:player_client=android_vr"));
        assert_eq!(
            args.last().map(String::as_str),
            Some("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        );
        // выходной файл не пишется — шаблонов вывода в argv нет
        assert!(!args.iter().any(|a| a == "-P" || a == "-o"));
    }

    /// В боевом пути 101 (MaxDownloadsReached) — успех ПОСЛЕ скачивания.
    /// В simulate скачивания нет, 101 там может значить только ошибку —
    /// переиспользовать ytdlp_exit_ok нельзя (ловушка из спеки).
    #[test]
    fn simulate_exit_ok_rejects_101() {
        assert!(simulate_exit_ok(Some(0)));
        assert!(!simulate_exit_ok(Some(YTDLP_MAX_DOWNLOADS_REACHED)));
        assert!(!simulate_exit_ok(Some(1)));
        assert!(!simulate_exit_ok(None));
    }

    #[test]
    fn parse_simulate_output_happy_path() {
        let out = "https://rr4---sn-abc.googlevideo.com/videoplayback?expire=1780000000&itag=251\t3433755\topus\thttps\n";
        let f = parse_simulate_output(out).expect("валидный выхлоп разбирается");
        assert_eq!(
            f,
            SimulatedFormat {
                url: "https://rr4---sn-abc.googlevideo.com/videoplayback?expire=1780000000&itag=251"
                    .into(),
                size: 3_433_755,
                ext: "opus".into(),
            }
        );
    }

    /// yt-dlp может печатать служебные строки до нашей — берём последнюю
    /// непустую (как run_ytdlp_once берёт путь).
    #[test]
    fn parse_simulate_output_takes_last_nonempty_line() {
        let out = "WARNING: что-то\nhttps://cdn.example.com/a?x=1\t100\tm4a\thttps\n\n";
        let f = parse_simulate_output(out).expect("последняя непустая строка");
        assert_eq!(f.url, "https://cdn.example.com/a?x=1");
    }

    /// Без размера warm-запись бесполезна: явный Range строится по size
    /// (без Range googlevideo троттлит до 32 КБ/с — замер 2026-07-15).
    #[test]
    fn parse_simulate_output_rejects_na_size() {
        let out = "https://cdn.example.com/a\tNA\topus\thttps\n";
        assert!(parse_simulate_output(out).is_err());
    }

    #[test]
    fn parse_simulate_output_rejects_missing_fields() {
        assert!(parse_simulate_output("").is_err());
        assert!(parse_simulate_output("\n\n").is_err());
        assert!(parse_simulate_output("https://cdn.example.com/a\t123\n").is_err());
    }

    /// ext становится именем файла кэша `<id>.<ext>` — грамматика жёсткая.
    #[test]
    fn parse_simulate_output_rejects_weird_ext() {
        for ext in ["", "OPUS", "op us", "we..bm", "a/b", "оченьдлинное", "webm2000x"] {
            let out = format!("https://cdn.example.com/a\t123\t{ext}\thttps\n");
            assert!(
                parse_simulate_output(&out).is_err(),
                "ext {ext:?} обязан отвергаться"
            );
        }
    }

    /// hls/dash печатают протокол m3u8_native/http_dash_segments, а их «url» —
    /// манифест: скачав его, мы положили бы в кэш ТЕКСТ вместо аудио и сделали
    /// трек неиграбельным (нарушение главного инварианта прогрева). Принимаем
    /// только прямой https.
    #[test]
    fn parse_simulate_output_rejects_non_https_protocol() {
        for proto in ["m3u8_native", "http_dash_segments", "http", "ftp"] {
            let out = format!("https://cdn.example.com/manifest\t123\tm4a\t{proto}\n");
            assert!(
                parse_simulate_output(&out).is_err(),
                "протокол {proto:?} обязан отвергаться"
            );
        }
    }

    /// `expire` в googlevideo-URL — unix-секунды; запись живёт до него минус
    /// запас (не начинаем скачивание впритык к протуханию).
    #[test]
    fn warm_url_expire_parsed_from_query() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let url =
            Url::parse("https://r4.googlevideo.com/videoplayback?a=1&expire=1021000&b=2").unwrap();
        assert_eq!(
            warm_expires_at(&url, now),
            SystemTime::UNIX_EPOCH + Duration::from_secs(1_021_000) - WARM_EXPIRY_MARGIN
        );
    }

    /// Нет/битый expire (SoundCloud, Bandcamp) — консервативный короткий TTL.
    #[test]
    fn warm_url_expire_fallback_without_param() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        for raw in [
            "https://cdn.example.com/a.mp3",
            "https://cdn.example.com/a.mp3?expire=abc",
        ] {
            let url = Url::parse(raw).unwrap();
            assert_eq!(warm_expires_at(&url, now), now + WARM_FALLBACK_TTL);
        }
    }

    fn entry_with_expiry(expires_at: SystemTime) -> WarmEntry {
        WarmEntry {
            url: Url::parse("https://cdn.example.com/a").unwrap(),
            size: 100,
            ext: "opus".into(),
            provider: "youtube".into(),
            expires_at,
        }
    }

    /// Протухшая запись не имеет права попасть в быстрый путь: URL умер,
    /// скачивание по нему только съело бы время до фолбэка на лестницу.
    #[test]
    fn expired_warm_entry_is_not_used() {
        let state = EngineState::default();
        let now = SystemTime::now();
        store_warm_entry(
            &state,
            "ns1",
            "42",
            entry_with_expiry(now - Duration::from_secs(1)),
        );
        assert!(take_live_warm_entry(&state, "ns1", "42", now).is_none());
        assert!(!has_live_warm_entry(&state, "ns1", "42", now));
    }

    /// take — одноразовое изъятие (ошибка скачивания = запись уже выброшена);
    /// ключ включает ns (баг «чужая песня» — id уникален только внутри БД).
    #[test]
    fn live_warm_entry_is_taken_once_and_namespaced() {
        let state = EngineState::default();
        let now = SystemTime::now();
        let live = now + Duration::from_secs(3600);
        store_warm_entry(&state, "ns1", "42", entry_with_expiry(live));
        assert!(
            !has_live_warm_entry(&state, "ns2", "42", now),
            "чужой ns не видит запись"
        );
        assert!(take_live_warm_entry(&state, "ns2", "42", now).is_none());
        assert!(has_live_warm_entry(&state, "ns1", "42", now));
        assert!(take_live_warm_entry(&state, "ns1", "42", now).is_some());
        assert!(
            take_live_warm_entry(&state, "ns1", "42", now).is_none(),
            "повторное изъятие пусто — запись одноразовая"
        );
    }

    fn no_lookup(_host: &str, _port: u16) -> LookupResult {
        panic!("до DNS дойти не должны");
    }

    /// Новая граница доверия: по добытому URL теперь ходим МЫ (reqwest), а не
    /// yt-dlp — валидация обязана быть не слабее канонической (https, без
    /// credentials, не IP-литерал, публичный DNS-ответ).
    #[test]
    fn validate_warm_url_rejects_http() {
        assert!(validate_warm_url_with_lookup("http://cdn.example.com/a", &mut no_lookup).is_err());
    }

    #[test]
    fn validate_warm_url_rejects_credentials() {
        for raw in [
            "https://user:pass@cdn.example.com/a",
            "https://user@cdn.example.com/a",
        ] {
            assert!(
                validate_warm_url_with_lookup(raw, &mut no_lookup).is_err(),
                "{raw:?} обязан отвергаться"
            );
        }
    }

    #[test]
    fn validate_warm_url_rejects_ip_literal() {
        for raw in [
            "https://142.250.74.14/videoplayback",
            "https://[2a00:1450:4010:c05::5f]/videoplayback",
        ] {
            assert!(
                validate_warm_url_with_lookup(raw, &mut no_lookup).is_err(),
                "{raw:?} обязан отвергаться"
            );
        }
    }

    #[test]
    fn validate_warm_url_rejects_private_dns_answer() {
        let mut lookup =
            |_host: &str, _port: u16| -> LookupResult { Ok(vec![IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5))]) };
        assert!(validate_warm_url_with_lookup("https://cdn.example.com/a", &mut lookup).is_err());
    }

    /// Та же философия, что у DNS-преflight canonical_target: best-effort, не
    /// гейт. За DPI-обходом/прокси локальный getaddrinfo может врать
    /// NXDOMAIN, тогда как reqwest тем же хостом сходит через прокси. Режем
    /// только реальный приватный ответ.
    #[test]
    fn validate_warm_url_is_best_effort_on_dns_failure() {
        let mut failing = |_h: &str, _p: u16| -> LookupResult { Err("nx".into()) };
        assert!(validate_warm_url_with_lookup("https://cdn.example.com/a", &mut failing).is_ok());
        let mut empty = |_h: &str, _p: u16| -> LookupResult { Ok(vec![]) };
        assert!(validate_warm_url_with_lookup("https://cdn.example.com/a", &mut empty).is_ok());
        let mut public = |_h: &str, _p: u16| -> LookupResult {
            Ok(vec![IpAddr::V4(Ipv4Addr::new(142, 250, 74, 14))])
        };
        assert!(validate_warm_url_with_lookup("https://cdn.example.com/a", &mut public).is_ok());
    }

    /// Content-Length врёт бесплатно, но заведомый перебор лимита режем ДО
    /// чтения тела (по факту байты пересчитываются ещё раз при записи).
    #[test]
    fn content_length_over_limit_rejected() {
        assert!(content_length_ok(1));
        assert!(content_length_ok(MAX_YTDLP_OUTPUT_BYTES));
        assert!(!content_length_ok(MAX_YTDLP_OUTPUT_BYTES + 1));
        assert!(!content_length_ok(0));
    }

    /// Content-Range 206-ответа — источник ИСТИННОГО размера файла:
    /// filesize_approx мог наврать, и обрезанный файл в кэше хуже медленного
    /// старта. Формат: `bytes 0-<end>/<total>`.
    #[test]
    fn content_range_total_parsed() {
        assert_eq!(parse_content_range("bytes 0-99/1234"), Some((99, 1234)));
        assert_eq!(
            parse_content_range("bytes 0-3433754/3433755"),
            Some((3_433_754, 3_433_755))
        );
        assert_eq!(parse_content_range("bytes */1234"), None);
        assert_eq!(parse_content_range("bytes 0-99/*"), None);
        assert_eq!(parse_content_range("garbage"), None);
        assert_eq!(
            parse_content_range("bytes 5-99/1234"),
            None,
            "начало не с нуля"
        );
    }

    /// Окно ответа стрима: первый чанк 128 КиБ (он и есть «клик → звук»:
    /// с запасом на заголовки контейнера, чтобы декодер завёлся), дальше
    /// 512 КиБ (~32с opus — playback закачку не догонит). Отдавать ВЕСЬ файл
    /// на `bytes=0-` нельзя: спайк 2026-07-16 показал, что WebView2 тогда
    /// буферизует целиком одним ответом и больше Range не шлёт — чанки
    /// обязаны резать ответ, чтобы стрим оставался стримом.
    #[test]
    fn stream_chunk_end_first_and_next() {
        let total = 4_605_080;
        assert_eq!(stream_chunk_end(0, total), 128 * 1024 - 1);
        assert_eq!(stream_chunk_end(128 * 1024, total), 128 * 1024 + 512 * 1024 - 1);
        // хвост не вылезает за файл
        assert_eq!(stream_chunk_end(total - 10, total), total - 1);
        // крошечный файл — первый чанк упирается в конец
        assert_eq!(stream_chunk_end(0, 1000), 999);
    }

    /// `Range` запроса от <audio> (Фаза 2): `bytes=<start>-[<end>]`.
    /// Мульти-диапазоны и суффиксную форму (`bytes=-500`) не поддерживаем —
    /// None означает «отвечай 200 целиком», это законно по HTTP.
    #[test]
    fn parse_range_header_start_only() {
        assert_eq!(parse_range_header("bytes=0-"), Some((0, None)));
        assert_eq!(parse_range_header("bytes=131072-"), Some((131_072, None)));
    }

    #[test]
    fn parse_range_header_start_end() {
        assert_eq!(parse_range_header("bytes=100-511"), Some((100, Some(511))));
        assert_eq!(parse_range_header("bytes=0-0"), Some((0, Some(0))));
        assert_eq!(parse_range_header("bytes=511-100"), None, "конец раньше начала");
    }

    #[test]
    fn parse_range_header_rejects_garbage() {
        for raw in ["", "items=0-", "bytes=", "bytes=a-b", "bytes=0-1,5-9", "bytes=-500", "bytes=0"] {
            assert_eq!(parse_range_header(raw), None, "{raw:?} обязан отвергаться");
        }
    }

    /// Живой A/B-замер «клик → файл готов» (сеть + sidecar-бинари):
    /// ДО = полная лестница run_ytdlp_once; ПОСЛЕ = fetch_to_cache по
    /// прогретой записи (стоимость прогрева печатается отдельно — на клик
    /// она не ложится). Те же 4 трека, что в замере 2026-07-15. Сеть шумная —
    /// серии с чередованием порядка, одиночному прогону не верить.
    /// `MUZA_AB_SERIES=3 cargo test warm_ab_real_tracks -- --ignored --nocapture`
    #[test]
    #[ignore = "сеть + yt-dlp + deno"]
    fn warm_ab_real_tracks() {
        let series: u32 = std::env::var("MUZA_AB_SERIES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3);
        let tracks = ["dQw4w9WgXcQ", "kJQP7kiw5Fk", "9bZkp7q19f0", "JGwWNGJdvx8"];
        let dir = std::env::temp_dir().join("muza-warm-ab");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let recipe: serde_json::Value = serde_json::from_str(DEFAULT_RECIPE_JSON).unwrap();
        let clients: Vec<String> = recipe["youtube"]["player_clients"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let sidecars = sidecar_paths().expect("sidecar-файлы доступны");
        let fmt = "251/140/bestaudio";

        let cold = |vid: &str, tag: &str| -> f64 {
            let source = SourceRef::Youtube {
                source_id: vid.into(),
            };
            let attempts = build_attempts(&[source], &clients).attempts;
            let t0 = Instant::now();
            for attempt in attempts {
                if let Ok(path) =
                    run_ytdlp_once(&sidecars.ytdlp, &sidecars.deno, &dir, tag, &attempt, fmt)
                {
                    let secs = t0.elapsed().as_secs_f64();
                    let _ = fs::remove_file(path);
                    return secs;
                }
            }
            panic!("лестница не добыла {vid}");
        };
        let warm = |vid: &str, tag: &str| -> (f64, f64) {
            let source = SourceRef::Youtube {
                source_id: vid.into(),
            };
            let attempts = build_attempts(&[source], &clients).attempts;
            let t0 = Instant::now();
            for attempt in attempts {
                let Ok(sim) = run_ytdlp_simulate(&sidecars.ytdlp, &sidecars.deno, &attempt, fmt)
                else {
                    continue;
                };
                let warm_secs = t0.elapsed().as_secs_f64();
                let url = validate_warm_url(&sim.url).expect("warm-URL валиден");
                let now = SystemTime::now();
                let entry = WarmEntry {
                    expires_at: warm_expires_at(&url, now),
                    url,
                    size: sim.size,
                    ext: sim.ext,
                    provider: "youtube".into(),
                };
                let t1 = Instant::now();
                let path = tauri::async_runtime::block_on(fetch_to_cache(&dir, tag, &entry))
                    .expect("fetch_to_cache по свежему warm-URL");
                let fetch_secs = t1.elapsed().as_secs_f64();
                let _ = fs::remove_file(path);
                return (warm_secs, fetch_secs);
            }
            panic!("simulate не разрешил {vid}");
        };

        println!("серия;трек;порядок;cold_лестница_с;warm_simulate_с;warm_fetch_с");
        for s in 0..series {
            for (i, vid) in tracks.iter().enumerate() {
                let tag = format!("ab{s}x{i}");
                // чередуем порядок: чётные серии cold→warm, нечётные warm→cold,
                // чтобы дрейф сети не работал систематически на одну сторону
                if s % 2 == 0 {
                    let c = cold(vid, &tag);
                    let (w, f) = warm(vid, &tag);
                    println!("{s};{vid};cold→warm;{c:.2};{w:.2};{f:.2}");
                } else {
                    let (w, f) = warm(vid, &tag);
                    let c = cold(vid, &tag);
                    println!("{s};{vid};warm→cold;{c:.2};{w:.2};{f:.2}");
                }
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// Свежий `.part` — это, возможно, ЖИВОЙ стрим (Фаза 2): эвикция и
    /// «Очистить кэш» не имеют права снести его на ходу (спека помечала это
    /// явным риском — на Windows спасал бы открытый хэндл записи, но читатель
    /// открывает файл на каждый чанк, и окно есть). Старый `.part` — мусор
    /// упавшей закачки, его эвиктить МОЖНО и НУЖНО.
    #[test]
    fn evict_and_clear_spare_fresh_part_only() {
        let dir = std::env::temp_dir().join(format!("muza-warm-evict-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let fresh = dir.join("1.opus.part");
        let stale = dir.join("2.opus.part");
        fs::write(&fresh, vec![0u8; 1000]).unwrap();
        fs::write(&stale, vec![0u8; 1000]).unwrap();
        let old = filetime::FileTime::from_unix_time(
            filetime::FileTime::now().unix_seconds() - 3600,
            0,
        );
        filetime::set_file_mtime(&stale, old).unwrap();
        let keep = dir.join("нет-такого");
        evict_lru(&dir, 0, &keep, &HashSet::new());
        assert!(fresh.exists(), "свежий .part (живой стрим) пережил эвикцию");
        assert!(!stale.exists(), "старый .part (мусор) эвиктнут");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Регресс-защита от огрызков: `.part` недокачки не имеет права стать
    /// кэш-хитом (двойная защита: find_cached пропускает .part явно, плюс
    /// file_stem у `<id>.<ext>.part` — это `<id>.<ext>`, не `<id>`).
    #[test]
    fn part_file_is_not_a_cache_hit() {
        let dir = std::env::temp_dir().join(format!("muza-warm-part-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("42.opus.part"), b"partial").unwrap();
        assert!(
            find_cached(&dir, "42").is_none(),
            ".part не имеет права быть кэш-хитом"
        );
        fs::write(dir.join("42.opus"), b"full").unwrap();
        assert!(find_cached(&dir, "42").is_some(), "полный файл — хит");
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod innertube_tests {
    use super::*;
    use std::collections::VecDeque;
    use std::net::{IpAddr, Ipv4Addr};

    /// Живые ответы /player от 2026-07-19, санитизированные для публичного
    /// репо (IP/ei/id/sig/visitorData заменены синтетикой, форма полей — как
    /// в живом ответе: contentLength — СТРОКА, и т.д.). Снято probe-скриптом,
    /// методика — docs/notes/2026-07-19-прямой-innertube-резолв-замер.md.
    fn ok_fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../testdata/innertube_player_ok.json")).unwrap()
    }

    fn unplayable_fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../testdata/innertube_player_unplayable.json")).unwrap()
    }

    fn login_fixture() -> serde_json::Value {
        serde_json::from_str(include_str!(
            "../testdata/innertube_player_login_required.json"
        ))
        .unwrap()
    }

    /// visitorData из санитизированных фикстур.
    const SYNTH_VISITOR: &str = "CgtTWU5USF9WSVNJVE9SKPKm89IGMmIKAlVTElwSWA%3D%3D";

    fn public_lookup(_host: &str, _port: u16) -> LookupResult {
        Ok(vec![IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))])
    }

    // ── Разбор ответа ──────────────────────────────────────────────

    /// opus 251 предпочтён m4a 140; размер — из строкового contentLength.
    #[test]
    fn parse_prefers_opus_251() {
        let fmt = parse_innertube_player(&ok_fixture(), INNERTUBE_ITAGS_DEFAULT).unwrap();
        assert_eq!(fmt.ext, "webm");
        assert_eq!(fmt.size, 3_433_755);
        assert!(fmt.url.contains("itag=251"), "{}", fmt.url);
    }

    /// Нет opus — берём m4a 140 (вторая ступень приоритета).
    #[test]
    fn parse_falls_back_to_m4a_without_opus() {
        let mut raw = ok_fixture();
        raw["streamingData"]["adaptiveFormats"]
            .as_array_mut()
            .unwrap()
            .retain(|f| {
                !f["mimeType"]
                    .as_str()
                    .unwrap_or("")
                    .starts_with("audio/webm")
            });
        let fmt = parse_innertube_player(&raw, INNERTUBE_ITAGS_DEFAULT).unwrap();
        assert_eq!(fmt.ext, "m4a");
        assert!(fmt.url.contains("itag=140"), "{}", fmt.url);
    }

    /// Эконом-приоритет — малые форматы (тот же смысл, что ECONOM_FORMATS
    /// лестницы): из фикстуры берётся 249 (250 в ней нет).
    #[test]
    fn parse_econom_prefers_small_formats() {
        let fmt = parse_innertube_player(&ok_fixture(), INNERTUBE_ITAGS_ECONOM).unwrap();
        assert!(fmt.url.contains("itag=249"), "{}", fmt.url);
        assert_eq!(fmt.ext, "webm");
        assert_eq!(fmt.size, 1_231_355);
    }

    /// Видео-форматы — не кандидаты, даже когда аудио в ответе нет вовсе.
    #[test]
    fn parse_ignores_video_formats() {
        let mut raw = ok_fixture();
        raw["streamingData"]["adaptiveFormats"]
            .as_array_mut()
            .unwrap()
            .retain(|f| {
                f["mimeType"]
                    .as_str()
                    .unwrap_or("")
                    .starts_with("video/")
            });
        assert!(parse_innertube_player(&raw, INNERTUBE_ITAGS_DEFAULT).is_err());
    }

    /// Реальная блокировка правообладателем (живой ответ: Bohemian Rhapsody,
    /// SME) — провал, годный для фолбэка; повтором не лечится.
    #[test]
    fn parse_unplayable_is_error() {
        let err =
            parse_innertube_player(&unplayable_fixture(), INNERTUBE_ITAGS_DEFAULT).unwrap_err();
        match err {
            InnertubeFail::Other(msg) => assert!(msg.contains("UNPLAYABLE"), "{msg}"),
            other => panic!("ожидали Other(UNPLAYABLE), получили {other:?}"),
        }
    }

    /// Бот-гейт «Sign in to confirm…» — отдельный класс: его лечит один
    /// повтор со свежим visitorData (замер: без visitorData 5 отказов из 6).
    #[test]
    fn parse_login_required_is_login_class() {
        let err = parse_innertube_player(&login_fixture(), INNERTUBE_ITAGS_DEFAULT).unwrap_err();
        assert!(matches!(err, InnertubeFail::LoginRequired(_)), "{err:?}");
    }

    /// SABR-сессия: playability OK, форматы есть, а прямых url нет — отдельный
    /// класс для KPI (рост fail_sabr = сигнал бампить рецепт).
    #[test]
    fn parse_formats_without_url_is_sabr() {
        let mut raw = ok_fixture();
        for f in raw["streamingData"]["adaptiveFormats"]
            .as_array_mut()
            .unwrap()
        {
            f.as_object_mut().unwrap().remove("url");
        }
        let err = parse_innertube_player(&raw, INNERTUBE_ITAGS_DEFAULT).unwrap_err();
        assert!(matches!(err, InnertubeFail::Sabr(_)), "{err:?}");
    }

    /// itag → расширение файла кэша (грамматика valid_warm_ext).
    #[test]
    fn ext_table_matches_itags() {
        assert_eq!(innertube_ext_for_itag(251), Some("webm"));
        assert_eq!(innertube_ext_for_itag(250), Some("webm"));
        assert_eq!(innertube_ext_for_itag(249), Some("webm"));
        assert_eq!(innertube_ext_for_itag(140), Some("m4a"));
        assert_eq!(innertube_ext_for_itag(139), Some("m4a"));
        assert_eq!(innertube_ext_for_itag(22), None);
    }

    // ── WarmEntry из ответа ────────────────────────────────────────

    /// Форма наружу — WarmEntry: expire из САМОЙ ссылки (не константа 6ч),
    /// провайдер youtube; всё ниже (fetch_to_cache и т.д.) переиспользуется.
    #[test]
    fn warm_entry_takes_expire_from_url() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let fmt = InnertubeFormat {
            url: "https://rr1---sn-example.googlevideo.com/videoplayback?expire=1021000&itag=251"
                .into(),
            size: 3_433_755,
            ext: "webm".into(),
        };
        let entry = innertube_warm_entry_with_lookup(&fmt, now, &mut public_lookup).unwrap();
        assert_eq!(
            entry.expires_at,
            SystemTime::UNIX_EPOCH + Duration::from_secs(1_021_000) - WARM_EXPIRY_MARGIN
        );
        assert_eq!(entry.size, 3_433_755);
        assert_eq!(entry.ext, "webm");
        assert_eq!(entry.provider, "youtube");
    }

    /// Граница доверия validate_warm_url наследуется без ослаблений.
    #[test]
    fn warm_entry_rejects_invalid_url() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        for raw in [
            "http://rr1---sn-example.googlevideo.com/videoplayback?expire=1021000",
            "https://user:pass@rr1---sn-example.googlevideo.com/videoplayback?expire=1021000",
        ] {
            let fmt = InnertubeFormat {
                url: raw.into(),
                size: 100,
                ext: "webm".into(),
            };
            assert!(
                innertube_warm_entry_with_lookup(&fmt, now, &mut public_lookup).is_err(),
                "{raw:?} обязан отвергаться"
            );
        }
    }

    /// Уже протухший expire — мертворождённая запись: Err сразу.
    #[test]
    fn warm_entry_rejects_already_expired() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(2_000_000);
        let fmt = InnertubeFormat {
            url: "https://rr1---sn-example.googlevideo.com/videoplayback?expire=1021000".into(),
            size: 100,
            ext: "webm".into(),
        };
        assert!(innertube_warm_entry_with_lookup(&fmt, now, &mut public_lookup).is_err());
    }

    /// Лимит 512 МиБ — тот же, что у yt-dlp-пути (проверка ДО запроса байт).
    #[test]
    fn warm_entry_rejects_oversize() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        for size in [0u64, MAX_YTDLP_OUTPUT_BYTES + 1] {
            let fmt = InnertubeFormat {
                url: "https://rr1---sn-example.googlevideo.com/videoplayback?expire=1021000"
                    .into(),
                size,
                ext: "webm".into(),
            };
            assert!(
                innertube_warm_entry_with_lookup(&fmt, now, &mut public_lookup).is_err(),
                "size {size} обязан отвергаться"
            );
        }
    }

    // ── visitorData и тело запроса ─────────────────────────────────

    /// visitorData приходит в КАЖДОМ ответе — даже LOGIN_REQUIRED и
    /// UNPLAYABLE (на этом стоит бутстрап).
    #[test]
    fn visitor_captured_from_any_response() {
        for raw in [ok_fixture(), login_fixture(), unplayable_fixture()] {
            assert_eq!(innertube_visitor(&raw).as_deref(), Some(SYNTH_VISITOR));
        }
    }

    /// Тело запроса: значения client — из рецепта (бампаются деплоем сервера
    /// без релиза клиента); visitorData кладётся только когда он есть.
    #[test]
    fn body_builder_uses_recipe_values_and_visitor() {
        let cfg = InnertubeConfig {
            client_name: "ANDROID_VR".into(),
            client_version: "1.65.10".into(),
            client_name_id: 28,
        };
        let body = build_innertube_body(&cfg, "dQw4w9WgXcQ", None);
        assert_eq!(body["context"]["client"]["clientName"], "ANDROID_VR");
        assert_eq!(body["context"]["client"]["clientVersion"], "1.65.10");
        assert_eq!(body["context"]["client"]["deviceMake"], "Oculus");
        assert_eq!(body["videoId"], "dQw4w9WgXcQ");
        assert_eq!(body["contentCheckOk"], true);
        assert_eq!(body["racyCheckOk"], true);
        assert!(body["context"]["client"].get("visitorData").is_none());
        let with = build_innertube_body(&cfg, "dQw4w9WgXcQ", Some("V1"));
        assert_eq!(with["context"]["client"]["visitorData"], "V1");
    }

    // ── Рецепт ─────────────────────────────────────────────────────

    /// Рубильник: блока нет, enabled:false или битые поля — ступень 0
    /// выключена (клиент откатывается на yt-dlp сам, без релиза).
    #[test]
    fn innertube_config_from_recipe_with_kill_switch() {
        let on = serde_json::json!({"youtube": {"innertube": {
            "enabled": true, "client_name": "ANDROID_VR",
            "client_version": "1.65.10", "client_name_id": 28}}});
        assert_eq!(
            innertube_from_recipe(&on),
            Some(InnertubeConfig {
                client_name: "ANDROID_VR".into(),
                client_version: "1.65.10".into(),
                client_name_id: 28,
            })
        );
        let off = serde_json::json!({"youtube": {"innertube": {
            "enabled": false, "client_name": "ANDROID_VR",
            "client_version": "1.65.10", "client_name_id": 28}}});
        assert_eq!(innertube_from_recipe(&off), None);
        let absent = serde_json::json!({"youtube": {}});
        assert_eq!(innertube_from_recipe(&absent), None);
        let broken = serde_json::json!({"youtube": {"innertube": {"enabled": true}}});
        assert_eq!(innertube_from_recipe(&broken), None);
    }

    /// Бандл-рецепт обязан включать ступень 0 — иначе она не работает
    /// оффлайн и до первого горячего рецепта.
    #[test]
    fn default_recipe_enables_innertube_stage0() {
        let recipe: serde_json::Value = serde_json::from_str(DEFAULT_RECIPE_JSON).unwrap();
        let cfg = innertube_from_recipe(&recipe).expect("ступень 0 включена в бандл-рецепте");
        assert_eq!(cfg.client_name, "ANDROID_VR");
        assert_eq!(
            cfg.client_version, "1.65.10",
            "clientVersion>1.65 может отдавать SABR-only (yt-dlp ff459e5) — \
             бампить только через рецепт с проверкой"
        );
        assert_eq!(cfg.client_name_id, 28);
    }

    // ── Выбор источника и KPI ──────────────────────────────────────

    /// Ступень 0 — только когда ПЕРВЫЙ источник YouTube с валидным id:
    /// приоритет источников сервера не переворачиваем, SoundCloud/Bandcamp
    /// идут лестницей.
    #[test]
    fn stage0_only_for_leading_valid_youtube_source() {
        let yt = SourceRef::Youtube {
            source_id: "dQw4w9WgXcQ".into(),
        };
        let sc = SourceRef::Soundcloud {
            source_id: "12345".into(),
            canonical_url: "https://soundcloud.com/a/b".into(),
        };
        let bad = SourceRef::Youtube {
            source_id: "../слишком-кривой-id".into(),
        };
        assert_eq!(stage0_youtube_id(&[yt]).as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(
            stage0_youtube_id(&[
                sc,
                SourceRef::Youtube {
                    source_id: "dQw4w9WgXcQ".into()
                }
            ]),
            None,
            "SoundCloud первый — приоритет сервера не переворачиваем"
        );
        assert_eq!(stage0_youtube_id(&[bad]), None, "кривой id — лестница");
        assert_eq!(stage0_youtube_id(&[]), None);
    }

    // ── Негативный кэш ступени 0 ───────────────────────────────────
    // Один клик зовёт ступень 0 дважды (engine_stream_start, затем
    // engine_resolve при фолбэке) — без памяти о свежем провале второй
    // вызов оплачивал бы тот же POST/таймаут заново (до 4 POST / 2×8с
    // до лестницы — корень жалобы «стало медленнее» 2026-07-19).

    /// Свежий провал помнится, старше TTL — забывается; чужой id не задет.
    #[test]
    fn stage0_fail_memory_respects_ttl() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        assert!(!stage0_recently_failed(&state, "vid-a", t0));
        stage0_note_fail(&state, "vid-a", t0);
        assert!(stage0_recently_failed(
            &state,
            "vid-a",
            t0 + STAGE0_FAIL_TTL - Duration::from_secs(1)
        ));
        assert!(!stage0_recently_failed(&state, "vid-a", t0 + STAGE0_FAIL_TTL));
        assert!(!stage0_recently_failed(&state, "vid-b", t0), "чужой id не задет");
    }

    /// Успех стирает память о провале — видео снова в деле сразу.
    #[test]
    fn stage0_success_clears_fail_memory() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        stage0_note_fail(&state, "vid-a", t0);
        stage0_note_success(&state, "vid-a");
        assert!(!stage0_recently_failed(&state, "vid-a", t0));
    }

    /// Запись нового провала прореживает протухшие — карта не растёт вечно.
    #[test]
    fn stage0_fail_memory_prunes_expired() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        stage0_note_fail(&state, "vid-old", t0);
        stage0_note_fail(&state, "vid-new", t0 + STAGE0_FAIL_TTL + Duration::from_secs(1));
        let map = state.stage0_recent_fail.lock().unwrap();
        assert!(!map.contains_key("vid-old"), "протухшая запись прорежена");
        assert!(map.contains_key("vid-new"));
    }

    /// Маркеры KPI прямого пути: по ним видно деградацию android_vr.
    #[test]
    fn classify_innertube_counters() {
        let mut stats = EngineStats::default();
        classify_innertube_failure(&mut stats, &InnertubeFail::Sabr("нет url".into()));
        classify_innertube_failure(&mut stats, &InnertubeFail::LoginRequired("бот-гейт".into()));
        classify_innertube_failure(&mut stats, &InnertubeFail::Other("UNPLAYABLE".into()));
        assert_eq!(stats.fail_sabr, 1);
        assert_eq!(stats.fail_login, 1);
        assert_eq!(stats.fail_other, 1);
    }

    // ── Оркестрация visitorData (инъекция транспорта) ──────────────

    fn run_orchestration(
        state: &EngineState,
        responses: Vec<Result<serde_json::Value, String>>,
    ) -> (Result<InnertubeFormat, InnertubeFail>, Vec<Option<String>>) {
        let calls: Mutex<Vec<Option<String>>> = Mutex::new(Vec::new());
        let queue: Mutex<VecDeque<Result<serde_json::Value, String>>> =
            Mutex::new(VecDeque::from(responses));
        let result = tauri::async_runtime::block_on(resolve_via_innertube_with(
            state,
            INNERTUBE_ITAGS_DEFAULT,
            |visitor| {
                calls.lock().unwrap().push(visitor);
                let resp = queue
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("лишний вызов транспорта");
                async move { resp }
            },
        ));
        (result, calls.into_inner().unwrap())
    }

    /// Бутстрап: без visitorData первый ответ — бот-гейт, но visitorData в
    /// нём есть; ОДИН повтор с ним обязан спасти запрос, а значение — осесть
    /// в состоянии для следующих резолвов.
    #[test]
    fn orchestration_bootstraps_visitor_and_retries_once() {
        let state = EngineState::default();
        let (result, calls) =
            run_orchestration(&state, vec![Ok(login_fixture()), Ok(ok_fixture())]);
        let fmt = result.expect("повтор со свежим visitorData обязан спасти");
        assert_eq!(fmt.size, 3_433_755);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0], None);
        assert_eq!(calls[1].as_deref(), Some(SYNTH_VISITOR));
        let stored = state.youtube_visitor.lock().unwrap();
        assert_eq!(
            stored.as_ref().map(|v| v.value.as_str()),
            Some(SYNTH_VISITOR),
            "visitor остаётся в состоянии"
        );
    }

    /// Свежий visitor из состояния идёт уже в ПЕРВЫЙ запрос (обычный путь —
    /// один POST, ~171 мс); ответ освежает значение.
    #[test]
    fn orchestration_reuses_fresh_visitor() {
        let state = EngineState::default();
        *state.youtube_visitor.lock().unwrap() = Some(VisitorData {
            value: "V-СВОЙ".into(),
            obtained_at: SystemTime::now(),
        });
        let (result, calls) = run_orchestration(&state, vec![Ok(ok_fixture())]);
        assert!(result.is_ok());
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].as_deref(), Some("V-СВОЙ"));
        assert_eq!(
            state
                .youtube_visitor
                .lock()
                .unwrap()
                .as_ref()
                .map(|v| v.value.as_str()),
            Some(SYNTH_VISITOR),
            "ответ освежает visitor"
        );
    }

    /// Протухший visitor не переиспользуется — идём бутстрапом (None).
    #[test]
    fn orchestration_ignores_stale_visitor() {
        let state = EngineState::default();
        *state.youtube_visitor.lock().unwrap() = Some(VisitorData {
            value: "V-СТАРЫЙ".into(),
            obtained_at: SystemTime::now() - INNERTUBE_VISITOR_TTL - Duration::from_secs(1),
        });
        let (result, calls) = run_orchestration(&state, vec![Ok(ok_fixture())]);
        assert!(result.is_ok());
        assert_eq!(calls[0], None, "протухший visitor не шлём");
    }

    /// Два бот-гейта подряд — сдаёмся: не больше ОДНОГО повтора, наружу
    /// LoginRequired (фолбэк на лестницу, счётчик fail_login).
    #[test]
    fn orchestration_gives_up_after_second_login() {
        let state = EngineState::default();
        let (result, calls) =
            run_orchestration(&state, vec![Ok(login_fixture()), Ok(login_fixture())]);
        assert!(matches!(result, Err(InnertubeFail::LoginRequired(_))));
        assert_eq!(calls.len(), 2);
    }

    /// Бот-гейт БЕЗ visitorData в ответе — повторять нечем, сдаёмся сразу.
    #[test]
    fn orchestration_login_without_visitor_gives_up() {
        let state = EngineState::default();
        let mut login = login_fixture();
        login["responseContext"]
            .as_object_mut()
            .unwrap()
            .remove("visitorData");
        let (result, calls) = run_orchestration(&state, vec![Ok(login)]);
        assert!(matches!(result, Err(InnertubeFail::LoginRequired(_))));
        assert_eq!(calls.len(), 1);
    }

    /// UNPLAYABLE повтором не лечится — один вызов и сразу фолбэк.
    #[test]
    fn orchestration_no_retry_on_unplayable() {
        let state = EngineState::default();
        let (result, calls) = run_orchestration(&state, vec![Ok(unplayable_fixture())]);
        assert!(matches!(result, Err(InnertubeFail::Other(_))));
        assert_eq!(calls.len(), 1);
    }

    /// Сеть/таймаут — Other без повтора: ступень 0 либо быстрая, либо сразу
    /// уступает лестнице.
    #[test]
    fn orchestration_network_error_is_other() {
        let state = EngineState::default();
        let (result, calls) = run_orchestration(&state, vec![Err("сеть упала".into())]);
        assert!(matches!(result, Err(InnertubeFail::Other(_))));
        assert_eq!(calls.len(), 1);
    }

    /// Живой сквозной прогон ступени 0: POST /player → WarmEntry →
    /// fetch_to_cache. Закрывает и «НЕ проверено» из ресёрча 2026-07-19:
    /// скачивание байтов по прямому googlevideo-URL нашим reqwest (из Node
    /// его резал DPI). `cargo test innertube_real -- --ignored --nocapture`
    #[test]
    #[ignore = "сеть: живые POST /player и GET байтов"]
    fn innertube_real_resolve_and_fetch() {
        let dir = std::env::temp_dir().join("muza-innertube-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let state = EngineState::default();
        let recipe: serde_json::Value = serde_json::from_str(DEFAULT_RECIPE_JSON).unwrap();
        let cfg = innertube_from_recipe(&recipe).expect("ступень 0 включена");

        let started = std::time::Instant::now();
        let entry = tauri::async_runtime::block_on(resolve_via_innertube(
            &state,
            &cfg,
            "dQw4w9WgXcQ",
            INNERTUBE_ITAGS_DEFAULT,
        ))
        .expect("прямой резолв обязан пройти");
        println!(
            "резолв: {} мс, ext {}, size {}",
            started.elapsed().as_millis(),
            entry.ext,
            entry.size
        );

        let started = std::time::Instant::now();
        let path = tauri::async_runtime::block_on(fetch_to_cache(&dir, "smoke1", &entry))
            .expect("байты по прямому URL обязаны доехать");
        let size = fs::metadata(&path).unwrap().len();
        println!(
            "байты: {} мс, {} байт, {}",
            started.elapsed().as_millis(),
            size,
            path.display()
        );
        assert_eq!(size, entry.size, "скачали ровно столько, сколько заявлено");
        assert!(size > 1_000_000, "полноразмерное аудио");
        let _ = fs::remove_dir_all(&dir);
    }
}
