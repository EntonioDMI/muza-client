// Клиентский движок добычи (Stage 3): yt-dlp + горячий рецепт (Ed25519) +
// LRU-кэш аудио. Резолв и скачивание идут на IP пользователя — сервер байтов
// не трогает (architecture.md, «клиент-мускулы»). Ретрай-лестница из спайка
// Stage 0: клиенты YouTube по рецепту (tv → web_music), затем следующий
// источник (soundcloud и т.д.).

use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::OsString;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
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
/// Суммарный бюджет ВСЕЙ лестницы клика (все источники × все клиенты).
///
/// До аудита 2026-08-02 потолок был только у ОДНОЙ попытки: четыре клиента ×
/// 180с = до 12 минут «клик висит», причём молча. Общий бюджет делает худший
/// случай клика равным худшему случаю одной попытки — дальше честный отказ и
/// сообщение об ошибке, которое пользователь хотя бы видит.
const RESOLVE_LADDER_BUDGET: Duration = Duration::from_secs(180);
/// Потолок ОДНОЙ попытки `--simulate`: метаданные без единого байта аудио.
/// 180с здесь бессмысленны — дольше 40с simulate не бывает даже с n-sig
/// challenge в deno (замер 2026-07-15: худший клиент 12.5с).
const SIMULATE_TIMEOUT: Duration = Duration::from_secs(40);
/// Суммарный бюджет лестницы ПРОГРЕВА. Прогрев фоновый и держит тот же
/// single-flight-гейт, что клик: затянувшийся прогрев = клик по той же строке
/// стоит в очереди (аудит 2026-08-02, п.2). Поэтому бюджет короткий.
const WARM_LADDER_BUDGET: Duration = Duration::from_secs(60);
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
    /// Circuit-breaker ступени 0: глобальные провалы подряд → кулдаун
    /// (см. блок «Circuit-breaker ступени 0» у хелперов).
    stage0_breaker: Mutex<Stage0Breaker>,
    /// client_id SC-ступени (2026-07-19): добыт из JS-бандлов soundcloud.com,
    /// живёт неделями (TTL 7 суток); 401/403 на api-v2 сбрасывает и
    /// передобывает один раз (образец оркестрации — visitorData выше).
    /// С 2026-08-03 переживает перезапуск (soundcloud_cid_path ниже): владелец
    /// слушает в основном SC, а холодный старт оплачивал главную + до 12
    /// бандлов прямо на пути «клик → звук» первого SC-трека сессии.
    soundcloud_client_id: Mutex<Option<(String, SystemTime)>>,
    /// Момент свежего провала добычи client_id: пока soundcloud.com лежит или
    /// сменил вёрстку, каждый клик не имеет права заново тянуть главную и
    /// мегабайтные бандлы — минутный кулдаун, дальше лестница yt-dlp.
    /// НЕ персистится нарочно: минутный предохранитель не должен переживать
    /// перезапуск, иначе перезапуск «чтобы починилось» ничего не чинит.
    soundcloud_cid_fail: Mutex<Option<SystemTime>>,
    /// Путь файла-персиста ключа SC (app_data/soundcloud-cid.json, сеется в
    /// init() по образцу stage0_log_path); None — тесты/ранний старт, ключ
    /// живёт только в памяти.
    soundcloud_cid_path: Mutex<Option<PathBuf>>,
    /// Журнал ступени 0 (2026-07-20, жалоба «через два часа всё стало
    /// медленно»): предохранители срабатывали МОЛЧА, и жалобу нельзя было
    /// разобрать постфактум. Кольцо последних событий (переходы breaker'а,
    /// классы провалов, кулдаун SC-ключа) + зеркало в файл ниже; наружу —
    /// engine_stage0_status → Настройки → Система → «Диагностика добычи».
    stage0_events: Mutex<VecDeque<Stage0Event>>,
    /// Путь файла-зеркала журнала (app_data/engine-events.log, сеется в
    /// init()); None — тесты/ранний старт, живёт только кольцо.
    stage0_log_path: Mutex<Option<PathBuf>>,
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
            stage0_breaker: Mutex::new(Stage0Breaker::default()),
            soundcloud_client_id: Mutex::new(None),
            soundcloud_cid_fail: Mutex::new(None),
            soundcloud_cid_path: Mutex::new(None),
            stage0_events: Mutex::new(VecDeque::new()),
            stage0_log_path: Mutex::new(None),
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
    // Файл-зеркало журнала ступени 0 — ДО ранних return'ов рецепта ниже:
    // диагностика обязана жить и без recipe-cache.json
    *app.state::<EngineState>().stage0_log_path.lock().unwrap() =
        Some(dir.join("engine-events.log"));
    // Системный прокси Windows (отчёт O, 22.07): обнаружение — ОДИН раз за
    // сессию, здесь, а не на каждый реальный запрос (proxy_for сам не имеет
    // доступа к EngineState/stage0_log нарочно — чистая функция без Tauri).
    // Без прокси — молчание; хост:порт БЕЗ кредов (parse_proxy_string их и
    // не несёт — WinHTTP отдаёт голый адрес).
    if let Some(proxy) = crate::sysproxy::proxy_for("https://www.youtube.com/") {
        stage0_log(
            &app.state::<EngineState>(),
            SystemTime::now(),
            format!("сеть: найден системный прокси {proxy} — добыча идёт через него"),
        );
    }
    // Ключ SoundCloud — тоже ДО ранних return'ов рецепта. Без персиста первый
    // же SC-трек КАЖДОГО запуска заново тянул главную soundcloud.com и до 12
    // JS-бандлов, и всё это лежало прямо на пути «клик → звук». Поднятое из
    // файла значение перепроверяется грамматикой и TTL (parse_stored_sc_cid);
    // не сошлось — ведём себя ровно как при отсутствии файла.
    let cid_path = dir.join("soundcloud-cid.json");
    {
        let state = app.state::<EngineState>();
        *state.soundcloud_cid_path.lock().unwrap() = Some(cid_path.clone());
        if let Some(restored) = fs::read_to_string(&cid_path)
            .ok()
            .and_then(|raw| parse_stored_sc_cid(&raw, SystemTime::now()))
        {
            *state.soundcloud_client_id.lock().unwrap() = Some(restored);
        }
    }
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

/// ПОФАЗОВЫЙ ЗАМЕР ДОБЫЧИ: «метка → сколько заняла ЭТА работа», миллисекунды.
///
/// Зачем. У фронта на всю добычу была ОДНА цифра (urlMs), а внутри неё у
/// SoundCloud четыре последовательных сетевых шага подряд — по одной цифре
/// невозможно сказать, который из них длинный, и оптимизировать приходилось
/// вслепую. Значение метки — ДЛИТЕЛЬНОСТЬ ШАГА, а не момент времени: мгновения
/// клика Rust не знает и знать не должен, оно живёт на фронте (startTelemetry).
///
/// ⚠️ ФОРМА СБОРА ВЫБРАНА НАРОЧНО. Пара `Instant::now()` вокруг каждого вызова
/// расползлась бы по всей ступени 0 — пять шагов в трёх функциях плюс два в
/// командах, — и любой рефакторинг ронял бы половину меток МОЛЧА: забытый
/// `elapsed()` не ошибка компиляции, а просто исчезнувшая строка в журнале.
/// Поэтому единственный обычный способ поставить метку — `measure`, обёрнутый
/// ВОКРУГ БЛОКА: метка и измеряемая работа физически не могут разъехаться,
/// потому что это одно выражение. `since` — единственная лазейка, и она
/// заведена ровно под два случая: таймер уже есть по другой причине (бюджет
/// лестницы) либо метка ставится по РЕЗУЛЬТАТУ работы, а не по факту её
/// выполнения (warm_hit — попадание, у промаха измерять нечего).
///
/// Перечень меток НЕ закрыт и нигде не проверяется: незнакомую фронт печатает
/// как есть (normalizeTimings в src/lib/startLog.ts) — это дешевле, чем держать
/// в согласии две копии списка по разные стороны IPC.
#[derive(Debug, Default)]
struct Timings(Vec<(String, u32)>);

/// Потолок числа отметок за один вызов — тот же, что у приёмника (TIMINGS_MAX
/// в src/lib/startLog.ts). Ограничение не про размер IPC, а про повтор с
/// ошибкой: метка внутри цикла не имеет права раздуть журнал стартов.
const TIMINGS_MAX: usize = 32;

impl Timings {
    /// Измерить БЛОК и записать его длительность под меткой. Основная форма.
    async fn measure<T>(
        &mut self,
        label: &'static str,
        work: impl std::future::Future<Output = T>,
    ) -> T {
        let started = Instant::now();
        let out = work.await;
        self.since(label, started);
        out
    }

    /// Записать длительность, измеренную ЧУЖИМ таймером (см. ⚠️ выше — форм
    /// сбора нарочно всего две, и эта вторая).
    fn since(&mut self, label: &'static str, started: Instant) {
        if self.0.len() >= TIMINGS_MAX {
            return;
        }
        // Насыщение вместо приведения по кругу: в u32 мс укладываются сутки с
        // запасом, но замер не имеет права соврать даже на зависшем шаге.
        let ms = started.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
        self.0.push((label.to_string(), ms));
    }

    /// Забрать накопленное в ответ фронту; коллектор остаётся пустым — одна и
    /// та же отметка не должна уехать дважды (команда может отвечать из
    /// нескольких точек выхода).
    fn take(&mut self) -> Vec<(String, u32)> {
        std::mem::take(&mut self.0)
    }
}

#[derive(Debug, Serialize)]
pub struct ResolveOut {
    /// Абсолютный путь к файлу в кэше — JS оборачивает его в convertFileSrc.
    pub path: String,
    pub from_cache: bool,
    /// Провайдер, из которого добыли (None у кэш-хита — уже не важно).
    pub provider: Option<String>,
    /// Пофазовые отметки добычи (см. Timings). serde сериализует кортеж
    /// массивом — `[["sc_api_v2",340],…]`, ровно та форма, которую разбирает
    /// normalizeTimings на фронте. Пустой список — законный ответ (кэш-хит).
    pub timings: Vec<(String, u32)>,
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

/// Тип записи каталога БЕЗ лишнего обращения к диску.
///
/// `path.is_file()` открывает файл заново (на Windows —
/// CreateFile + GetFileInformation + CloseHandle на КАЖДУЮ запись), хотя
/// перечисление каталога уже принесло атрибуты. Обход кэша на 500 файлов
/// (дефолтный лимит 2 ГиБ / типичный opus ~4 МБ) стоил ~1500 лишних
/// системных вызовов, а обходы идут на каждой смене трека, после каждой
/// закачки и на каждом Range-запросе стрима.
///
/// Почему не просто `entry.file_type().map(|t| t.is_file())`: `file_type()`
/// НЕ разыменовывает симлинк, а `path.is_file()` разыменовывает. Быстрый
/// ответ берём только там, где он заведомо совпадает с прежним (обычный файл
/// и каталог — 100% реальных записей кэша); всё прочее (симлинк, reparse
/// point, ошибка чтения атрибутов) перепроверяем старым вызовом. Иначе на
/// путях удаления («Очистить кэш») файл мог бы молча остаться, а в
/// `find_cached` запись превратилась бы в промах кэша — то есть в повторную
/// закачку и слышимую паузу вместо мгновенного старта.
fn entry_is_file(entry: &fs::DirEntry) -> bool {
    match entry.file_type() {
        Ok(t) if t.is_file() => true,
        Ok(t) if t.is_dir() => false,
        _ => entry.path().is_file(),
    }
}

/// Корни audio-cache, уже подметённые в этом процессе (см. `namespaced_cache_dir`).
static SWEPT_ROOTS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

/// Отметить корень подметённым; `true` — этот путь встретился впервые.
/// Ключ — САМ ПУТЬ, а не «первый вызов за процесс»: в одном тест-бинаре у
/// каждого теста своя временная база, и флаг-на-процесс отдавался бы первому
/// же тесту, а `namespaced_cache_dir_sweeps_legacy_root_audio` краснел бы в
/// зависимости от порядка выполнения.
fn mark_root_swept(base: &Path) -> bool {
    SWEPT_ROOTS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap()
        .insert(base.to_path_buf())
}

/// Зачистка ядовитого легаси в КОРНЕ audio-cache (файлы до неймспейсов).
fn sweep_legacy_root(base: &Path) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry_is_file(&entry) {
            continue;
        }
        let name = entry.file_name();
        if is_legacy_root_cache_file(&name.to_string_lossy()) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn namespaced_cache_dir(base: &Path, ns: &str) -> Result<PathBuf, String> {
    validate_cache_ns(ns)?;
    // Зачистка легаси — ОДИН РАЗ НА КАТАЛОГ за сессию (раньше комментарий
    // обещал «одноразовая», а по факту полный read_dir корня шёл на КАЖДЫЙ
    // вызов: на каждом Range-запросе стрима, резолве, прогреве, сохранении
    // пинов). Легаси-файлы в корне может оставить только СТАРАЯ версия
    // приложения, то есть они существуют ещё до старта процесса — повторные
    // проходы за сессию заведомо ничего нового не находят.
    if mark_root_swept(base) {
        sweep_legacy_root(base);
    }
    let dir = base.join(ns);
    // create_dir_all НЕ гейтить ни здесь, ни в cache_base: каталог может
    // исчезнуть при работающем приложении (чистильщик диска, антивирус, сам
    // пользователь), и тогда клик по некэшированному треку не смог бы открыть
    // .part — вместо музыки ошибка добычи. Сейчас каталог молча пересоздаётся.
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

/// Расширения, которые `find_cached` пробует ПРЯМЫМ именем до полного обхода,
/// и одновременно приоритет выбора при дублях stem.
///
/// `.part`/`.ytdl` сюда не добавлять НИКОГДА: это обломки недокачки
/// (инвариант теста `part_file_is_not_a_cache_hit`).
const CACHE_PROBE_EXTS: [&str; 6] = ["webm", "m4a", "mp3", "opus", "ogg", "aac"];

/// Приоритет расширения при выборе файла кэша; незнакомые — последними.
///
/// Нужен, чтобы быстрая проба прямых имён и полный обход выбирали ОДИН И ТОТ
/// ЖЕ файл, если в каталоге окажутся два полных файла с одним stem и разными
/// расширениями (теоретически: «выбрать другую версию» сносит через
/// `find_cached` ровно один файл). Раньше выбор определял порядок `read_dir`
/// — на NTFS алфавитный, то есть случайный побочный эффект ФС; теперь правило
/// записано явно и сторожится `cache_probe_matches_full_scan`.
fn cache_ext_rank(path: &Path) -> usize {
    path.extension()
        .and_then(|e| e.to_str())
        .and_then(|ext| {
            let lower = ext.to_ascii_lowercase();
            CACHE_PROBE_EXTS.iter().position(|known| *known == lower)
        })
        .unwrap_or(CACHE_PROBE_EXTS.len())
}

/// Файл кэша трека: `<track_id>.<ext>` (ext заранее неизвестен — webm/m4a/…).
fn find_cached(dir: &Path, track_id: &str) -> Option<PathBuf> {
    // Быстрая проба известных расширений: ~6 обращений по точному имени
    // вместо перечисления сотен записей. Ради этого пути функция и правилась —
    // WebView2 просит следующее окно стрима примерно дважды в минуту всё
    // время фонового воспроизведения, и каждый такой запрос перебирал кэш
    // целиком. Проба только для id, прошедшего валидацию: `format!` с чужой
    // строкой в `join` — это выход за каталог, а полный обход ниже к такому
    // невосприимчив по построению (сравнивает уже перечисленные имена).
    if validate_track_id(track_id).is_ok() {
        for ext in CACHE_PROBE_EXTS {
            let candidate = dir.join(format!("{track_id}.{ext}"));
            // именно is_file(), не exists(): каталог с таким именем полный
            // обход отсекает, ложного попадания быть не должно
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    // Полный обход — фолбэк, УДАЛЯТЬ НЕЛЬЗЯ: расширение задаёт yt-dlp через
    // `-o "{track_id}.%(ext)s"`, шестёркой выше оно не ограничено, а матч идёт
    // по `file_stem()` — то есть находится и файл вообще без расширения.
    // Уберут фолбэк «чтобы было чище» — промах кэша на легаси-файле, повторная
    // закачка и слышимая пауза вместо мгновенного старта.
    let entries = fs::read_dir(dir).ok()?;
    let mut best: Option<(usize, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !entry_is_file(&entry) {
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
            // Выбор при дублях — по cache_ext_rank, а не по порядку read_dir:
            // так полный обход и проба выше сходятся на одном файле.
            let rank = cache_ext_rank(&path);
            if best.as_ref().map(|(r, _)| rank < *r).unwrap_or(true) {
                best = Some((rank, path));
            }
        }
    }
    best.map(|(_, path)| path)
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

/// Длина ОДНОГО захода ожидания на хендле процесса, мс.
///
/// Приведение НАСЫЩАЮЩЕЕ и зажатое в 1..=1000. INFINITE (0xFFFF_FFFF) не
/// передаётся никогда и ни при какой арифметике: поток блокирующего пула,
/// зависший на хендле, держит single-flight-гейт трека — человек кликнул бы по
/// строке и не получил ни звука, ни ошибки до перезапуска приложения. Верхняя
/// граница 1000 мс делает худший случай деградации «1 пробуждение в секунду»,
/// то есть всё равно лучше нынешних 16/с.
fn wait_chunk_ms(remaining: Duration) -> u32 {
    u32::try_from(remaining.as_millis())
        .unwrap_or(1000)
        .clamp(1, 1000)
}

/// Ожидание на хендле дочернего процесса вместо сна (Windows).
///
/// `true` — заход состоялся (процесс завершился либо истёк кусок бюджета),
/// вызывающему спать не нужно. `false` — ждать на хендле не вышло, вызывающий
/// спит по-старому.
///
/// Хендл берётся ВНУТРИ итерации, не переживает `Child` и не закрывается
/// вручную: владелец — `std::process::Child`. Код выхода по-прежнему забирает
/// `child.try_wait()`; `GetExitCodeProcess` руками не читаем, иначе разъедется
/// учёт внутри std.
#[cfg(windows)]
fn park_on_child(child: &Child, remaining: Duration, broken: &mut bool) -> bool {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::WaitForSingleObject;

    if *broken {
        return false;
    }
    let handle = HANDLE(child.as_raw_handle());
    let result = unsafe { WaitForSingleObject(handle, wait_chunk_ms(remaining)) };
    if result == WAIT_OBJECT_0 || result == WAIT_TIMEOUT {
        return true;
    }
    // WAIT_FAILED и всё прочее: до конца ЭТОГО вызова падаем на сон. Повторно
    // Wait не зовём — иначе ошибка превратилась бы в спин на 100% CPU, ровно
    // наоборот к цели правки.
    *broken = true;
    false
}

#[cfg(not(windows))]
fn park_on_child(_child: &Child, _remaining: Duration, _broken: &mut bool) -> bool {
    false
}

/// Подождать ребёнка не дольше timeout; на таймауте — убить.
///
/// Цикл с `try_wait()` и пересчётом дедлайна от `started.elapsed()` на КАЖДОМ
/// проходе остаётся единственным авторитетом по таймауту — он же страховка,
/// если ожидание на хендле откажет. Заменён только сон: раньше поток
/// блокирующего пула просыпался каждые 5 мс первые 2 с и каждые 60 мс дальше
/// (≈1400 пробуждений на минутную закачку, и так на каждой попытке лестницы —
/// включая ФОНОВЫЙ прогрев очереди, когда человек просто слушает). Пробуждения
/// не дают ядру уйти в глубокие C-состояния — это и есть «греется в фоне».
fn wait_with_timeout(
    child: &mut Child,
    timeout: Duration,
) -> Result<std::process::ExitStatus, String> {
    let started = Instant::now();
    let mut handle_wait_broken = false;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {
                let elapsed = started.elapsed();
                if elapsed > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("yt-dlp не уложился в таймаут".into());
                }
                let remaining = timeout.saturating_sub(elapsed);
                if !park_on_child(child, remaining, &mut handle_wait_broken) {
                    // Адаптивный шаг (И3 2026-07-22): прежний фикс-шаг 120 мс
                    // добавлял в среднем ~60 мс к КАЖДОМУ ladder-резолву чисто на
                    // детект завершения процесса. Первые 2 с опрашиваем часто
                    // (быстрые прогоны — simulate, probe — ловятся за единицы мс),
                    // дальше крупнее: длинные закачки не жгут CPU опросом.
                    let step = if elapsed < Duration::from_secs(2) { 5 } else { 60 };
                    std::thread::sleep(Duration::from_millis(step));
                }
            }
            Err(e) => return Err(format!("ожидание yt-dlp: {e}")),
        }
    }
}

/// Сколько выхлопа процесса храним (ХВОСТ, не голова): и `run_ytdlp_once`, и
/// `run_ytdlp_simulate` берут ПОСЛЕДНЮЮ непустую строку — путь к файлу или
/// сообщение об ошибке. Всё сверх лимита вычитывается и выбрасывается, но
/// вычитывается обязательно (см. `wait_capturing`).
const CHILD_CAPTURE_TAIL_BYTES: usize = 256 * 1024;

/// Поток-водоотвод одного канала процесса: читает до EOF, хранит последние
/// `CHILD_CAPTURE_TAIL_BYTES`.
fn spawn_pipe_reader(
    mut pipe: impl std::io::Read + Send + 'static,
) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut tail: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 8 * 1024];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // Канал вычитывается ДО КОНЦА при любом объёме — иначе
                    // процесс заблокируется на записи. Лишнее просто не храним.
                    let over = (tail.len() + n).saturating_sub(CHILD_CAPTURE_TAIL_BYTES);
                    if over > 0 {
                        tail.drain(..over.min(tail.len()));
                    }
                    tail.extend_from_slice(&chunk[..n]);
                }
            }
        }
        String::from_utf8_lossy(&tail).into_owned()
    })
}

/// Ожидание процесса С ОДНОВРЕМЕННЫМ вычитыванием stdout/stderr.
///
/// Гоча (аудит 2026-08-02, критическая). Анонимный канал Windows держит ~4 КиБ.
/// Прежний порядок был «сначала `wait_with_timeout`, потом `read_to_string`»:
/// стоило yt-dlp напечатать в stderr больше буфера (traceback питона, серия
/// ошибок фрагментов при `--retries 2`, ошибка запуска deno), как он
/// блокировался на записи НАВСЕГДА — `try_wait()` вечно отдавал `Ok(None)`, и
/// попытка стоила полного таймаута вместо мгновенного отказа. Дальше бралась
/// следующая ступень лестницы, и «клик висит минуты» складывался именно так.
/// Каналы обязаны читаться ПАРАЛЛЕЛЬНО ожиданию — отсюда два потока.
fn wait_capturing(
    child: &mut Child,
    timeout: Duration,
) -> Result<(std::process::ExitStatus, String, String), String> {
    let out = child.stdout.take().map(spawn_pipe_reader);
    let err = child.stderr.take().map(spawn_pipe_reader);
    let status = wait_with_timeout(child, timeout);
    // join после kill/выхода: каналы закрыты, потоки уже завершаются
    let stdout = out.and_then(|h| h.join().ok()).unwrap_or_default();
    let stderr = err.and_then(|h| h.join().ok()).unwrap_or_default();
    status.map(|status| (status, stdout, stderr))
}

/// Остаток общего бюджета лестницы. `None` — бюджет исчерпан, следующую
/// попытку начинать уже нельзя.
fn ladder_remaining(started: Instant, budget: Duration) -> Option<Duration> {
    budget.checked_sub(started.elapsed()).filter(|left| !left.is_zero())
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
    // Системный прокси Windows (отчёт O, 22.07): yt-dlp сам его не видит —
    // без --proxy добыча падает у пользователей с DPI-обходчиком/прокси,
    // хотя браузер (читающий ту же системную настройку через WinINET)
    // работает штатно. Нет прокси/не-Windows — флаг не добавляется,
    // поведение как раньше.
    if let Some(proxy) = crate::sysproxy::proxy_for(attempt.url.as_str()) {
        args.push(OsString::from("--proxy"));
        args.push(OsString::from(proxy));
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
    timeout: Duration,
) -> Result<PathBuf, String> {
    let mut cmd = command(ytdlp);
    cmd.args(build_ytdlp_args(dir, track_id, attempt, format_str, deno));
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("yt-dlp не запустился ({}): {e}", ytdlp.display()))?;
    let (status, stdout, stderr) = wait_capturing(&mut child, timeout)?;

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
            if !entry_is_file(&e) {
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
        if same_cache_file(&path, keep)
            || is_cache_bookkeeping(&path)
            || is_pinned(&path, pins)
            || is_live_stream_part(&path)
        {
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

/// Тот же файл внутри каталога кэша — сверяем по ИМЕНИ, а не по строке пути.
///
/// Гоча Windows (поймана разбором 2026-08-02): `keep` приходит канонизированным
/// (`validate_ytdlp_output` → `fs::canonicalize`, то есть с префиксом `\\?\`), а
/// пути обхода каталога такого префикса не имеют — строковое сравнение
/// `path == keep` не совпадало НИКОГДА. Пока в кэше есть что удалять, это
/// незаметно; когда почти всё закреплено оффлайн или занято плеером, уборка
/// сносила только что скачанный файл ДО того, как его отдадут плееру: трек
/// «скачался», но не играл, и повтор клика давал ровно то же самое.
/// Имя файла внутри одной папки кэша уникально (это `<track_id>.<ext>`),
/// поэтому его достаточно и оно не зависит от формы пути.
fn same_cache_file(path: &Path, keep: &Path) -> bool {
    match (path.file_name(), keep.file_name()) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

/// Служебные файлы каталога кэша: не музыка, уборке не подлежат.
///
/// `offline-pins.json` лежит в одной папке с треками, и обе уборки — и LRU по
/// лимиту, и «Очистить кэш» — сносили его наравне с музыкой. Сами закреплённые
/// файлы они щадят, а СПИСОК закреплённых — нет; после перезапуска список пуст,
/// значки «сохранено оффлайн» пропадают, файлы теряют защиту и уходят при
/// первой же уборке. То есть человек терял ровно то, что специально просил
/// сохранить. Переносить файл наружу не стали: это потребовало бы переезда
/// данных у существующих пользователей ради того же результата.
fn is_cache_bookkeeping(path: &Path) -> bool {
    path.file_name()
        .map(|n| n == "offline-pins.json")
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
    /// AAC HLS SoundCloud (отчёт H): непустой список = по `url` лежит
    /// МАНИФЕСТ, а аудио собирается склейкой этих кусков по порядку
    /// (init-сегмент уже первым). Пусто — прямой файл, как у всех прочих
    /// провайдеров. `size` у HLS — ОЦЕНКА по длительности и битрейту
    /// пресета: настоящий размер известен только после скачивания.
    hls_segments: Vec<String>,
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

/// Доступ к живой закачке для нативного аудио-движка.
///
/// Движок читает растущий `.part` напрямую, вместо того чтобы ходить за теми
/// же байтами по HTTP через `muza-stream`: та петля существует ради `<audio>`
/// в WebView2, которому нужен именно сетевой источник. Нативному читателю она
/// не нужна — он открывает файл.
/// Clone — потому что нативный движок обязан уметь ПЕРЕОТКРЫТЬ источник: когда
/// читатель не смог перемотаться (см. Outcome::Rebuild в audio.rs), он строится
/// с нуля из той же закачки.
#[derive(Clone)]
pub struct LiveStream {
    /// Растущий файл. После завершения закачки переименовывается в final_path,
    /// но уже открытый дескриптор остаётся валидным.
    pub part: PathBuf,
    pub final_path: PathBuf,
    progress: tokio::sync::watch::Receiver<StreamProgress>,
}

impl LiveStream {
    /// Сколько байт уже на диске.
    pub fn written(&self) -> u64 {
        self.progress.borrow().written
    }

    /// Ожидаемый размер целиком; 0 — пока неизвестен.
    pub fn total(&self) -> u64 {
        self.progress.borrow().total
    }

    /// Закачка дошла до конца и файл стал полноценным кэшем.
    pub fn finalized(&self) -> bool {
        self.progress.borrow().finalized
    }

    /// Закачка сорвалась — ждать новых байт бессмысленно.
    pub fn failed(&self) -> bool {
        self.progress.borrow().failed
    }
}

/// Собрать `LiveStream` вручную — только для тестов нативного движка: реестр
/// живых закачек наполняет добыча, а чтение растущего файла надо проверять без
/// неё. Возвращает ещё и «писателя», которым тест изображает ход закачки.
#[cfg(test)]
pub(crate) fn live_stream_for_test(
    part: PathBuf,
    final_path: PathBuf,
) -> (LiveStream, TestStreamWriter) {
    let (tx, rx) = tokio::sync::watch::channel(StreamProgress {
        written: 0,
        total: 0,
        finalized: false,
        failed: false,
    });
    (LiveStream { part, final_path, progress: rx }, TestStreamWriter { tx })
}

#[cfg(test)]
pub(crate) struct TestStreamWriter {
    tx: tokio::sync::watch::Sender<StreamProgress>,
}

#[cfg(test)]
impl TestStreamWriter {
    /// Закачка дописала до `bytes` и продолжается.
    pub(crate) fn wrote(&self, bytes: u64) {
        let _ = self.tx.send(StreamProgress {
            written: bytes,
            total: 0,
            finalized: false,
            failed: false,
        });
    }

    /// Закачка завершилась: файл целиком на диске.
    pub(crate) fn finish(&self, bytes: u64) {
        let _ = self.tx.send(StreamProgress {
            written: bytes,
            total: bytes,
            finalized: true,
            failed: false,
        });
    }

    /// Закачка сорвалась — ждать нечего.
    pub(crate) fn fail(&self) {
        let _ = self.tx.send(StreamProgress {
            written: 0,
            total: 0,
            finalized: false,
            failed: true,
        });
    }
}

/// Найти живую закачку по паре «источник, идентификатор трека».
pub fn live_stream(app: &AppHandle, ns: &str, id: &str) -> Option<LiveStream> {
    let state = app.state::<EngineState>();
    let streams = state.streams.lock().ok()?;
    let handle = streams.get(&(ns.to_string(), id.to_string()))?;
    Some(LiveStream {
        part: handle.part.clone(),
        final_path: handle.final_path.clone(),
        progress: handle.progress.clone(),
    })
}

/// Живой стрим в реестре EngineState.streams: пути + канал прогресса.
#[derive(Clone)]
struct StreamHandle {
    part: PathBuf,
    final_path: PathBuf,
    progress: tokio::sync::watch::Receiver<StreamProgress>,
    /// Снос НЕподтверждённой закачки (первый чанк не пришёл за
    /// STREAM_START_TIMEOUT): notify_one хранит разрешение, поэтому отмена
    /// не теряется, даже если закачка в этот момент не ждёт (между чанками).
    /// После stream:true никто её не дёргает — играющий стрим неприкосновенен.
    cancel: Arc<tokio::sync::Notify>,
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
    // Системный прокси Windows (отчёт O, 22.07) — та же дисциплина, что у
    // build_ytdlp_args: прогрев бьёт по тому же хосту, что и боевая закачка.
    if let Some(proxy) = crate::sysproxy::proxy_for(attempt.url.as_str()) {
        args.push(OsString::from("--proxy"));
        args.push(OsString::from(proxy));
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
///
/// Только checked-арифметика (аудит 2026-08-02): `secs` — ЧУЖОЕ число из
/// добытой ссылки, а `SystemTime: Add<Duration>` внутри делает
/// `.expect("overflow…")`. Ответ с `expire=18446744073709551615` ронял
/// async-команду паникой, и промис `invoke` на фронте не резолвился НИКОГДА —
/// не ошибка, а именно вечное зависание кнопки. Переполнение = «expire
/// бессмысленный», ведём себя как при его отсутствии.
fn warm_expires_at(url: &Url, now: SystemTime) -> SystemTime {
    let fallback = now.checked_add(WARM_FALLBACK_TTL).unwrap_or(now);
    let expire = url
        .query_pairs()
        .find(|(k, _)| k == "expire")
        .and_then(|(_, v)| v.parse::<u64>().ok());
    match expire {
        Some(secs) => SystemTime::UNIX_EPOCH
            .checked_add(Duration::from_secs(secs))
            .and_then(|at| at.checked_sub(WARM_EXPIRY_MARGIN))
            .unwrap_or(fallback),
        None => fallback,
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
    timeout: Duration,
) -> Result<SimulatedFormat, String> {
    let mut cmd = command(ytdlp);
    cmd.args(build_ytdlp_simulate_args(attempt, format_str, deno));
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("yt-dlp не запустился ({}): {e}", ytdlp.display()))?;
    let (status, stdout, stderr) = wait_capturing(&mut child, timeout)?;

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
/// Единственный билдер reqwest во всём движке (InnerTube POST, SC api-v2/CDN,
/// fetch_to_cache) — прокси из системных настроек Windows (отчёт O, 22.07)
/// подключается здесь ОДИН раз и покрывает все три пути разом.
fn warm_http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .proxy(reqwest::Proxy::custom(|url| {
                crate::sysproxy::proxy_for(url.as_str())
            }))
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
    fetch_to_cache_with_progress(dir, track_id, entry, None, None).await
}

/// То же скачивание, но с публикацией прогресса для протокола muza-stream
/// (Фаза 2): стрим и заполнение кэша — ОДНА закачка, не две. cancel — снос
/// НЕподтверждённой закачки из ветки таймаута engine_stream_start (К4):
/// срабатывает и когда CDN молчит (select оборачивает сам await сети).
async fn fetch_to_cache_with_progress(
    dir: &Path,
    track_id: &str,
    entry: &WarmEntry,
    progress: Option<&tokio::sync::watch::Sender<StreamProgress>>,
    cancel: Option<&tokio::sync::Notify>,
) -> Result<PathBuf, String> {
    // ⚠️ size == 0 — «размер НЕИЗВЕСТЕН» (SoundCloud с 13.08, проба снята),
    // а не «нулевой файл». Проверять заявленный размер тогда нечем, и из трёх
    // рубежей лимита содержимого остаются два — оба на РЕАЛЬНЫХ данных:
    // Content-Length/Content-Range до чтения тела и счётчик байт при записи.
    // Решающий рубеж не тронут: заголовки врут бесплатно, счётчик — нет.
    if entry.size > 0 && !content_length_ok(entry.size) {
        return Err(format!("warm-размер вне лимита: {}", entry.size));
    }
    // AAC HLS SoundCloud: аудио не лежит одним файлом — собираем из кусков.
    if !entry.hls_segments.is_empty() {
        return fetch_hls_to_cache(dir, track_id, entry, progress, cancel).await;
    }
    // ⚠️ ДИАПАЗОН ПРОСИМ ВСЕГДА, ДАЖЕ НЕ ЗНАЯ РАЗМЕРА (13.08, вторая правка за
    // день — первая была неполной и замерена как ухудшение).
    //
    // Что показал живой замер владельца. Сняв пробу размера, я отправил
    // бесдиапазонный GET — и стоимость не исчезла, а ПЕРЕЕХАЛА: sc_probe
    // пропал (−745 мс), но first_chunk_wait вырос с 704 до 1710 мс, а на
    // повторных кликах держался 780–950. Это ~160 КБ/с на первые 128 КиБ —
    // в двадцать раз медленнее, чем тот же движок получает от googlevideo.
    // То есть CloudFront (cf-media.sndcdn.com) бесдиапазонную отдачу пейсит,
    // и правило «явный Range обязателен» оказалось не особенностью Google.
    //
    // Ключ к решению: чтобы попросить ОГРАНИЧЕННЫЙ диапазон, размер знать не
    // нужно. По RFC 7233 конец диапазона за пределами файла легален — сервер
    // отвечает 206 и отдаёт до конца, а НАСТОЯЩИЙ размер приезжает в
    // Content-Range. Значит первый же запрос закачки сам работает пробой, и
    // отдельный обход не нужен: диапазон получаем, RTT не платим.
    //
    // Верхняя граница — лимит содержимого: файл больше него нам всё равно
    // нельзя, а проверка «end + 1 == total» ниже ловит недоотдачу как прежде.
    let range_end = if entry.size > 0 {
        entry.size - 1
    } else {
        MAX_YTDLP_OUTPUT_BYTES - 1
    };
    let send = warm_http_client()
        .get(entry.url.clone())
        .header("Range", format!("bytes=0-{range_end}"))
        .timeout(RESOLVE_TIMEOUT)
        .send();
    let resp = match cancel {
        Some(n) => tokio::select! {
            _ = n.notified() => return Err("стрим отменён до ответа CDN".into()),
            r = send => r,
        },
        None => send.await,
    }
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
    let written = write_body_to_part(resp, &part, total, progress, cancel).await;
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
    cancel: Option<&tokio::sync::Notify>,
) -> Result<(), String> {
    use std::io::Write as _;
    let mut file = fs::File::create(part).map_err(|e| format!("не создался .part: {e}"))?;
    let mut written: u64 = 0;
    loop {
        let chunk = match cancel {
            // notify_one хранит разрешение: отмена между чанками не теряется
            Some(n) => tokio::select! {
                _ = n.notified() => return Err("стрим отменён (первый чанк не подтвердился)".into()),
                c = resp.chunk() => c,
            },
            None => resp.chunk().await,
        }
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

/// AAC HLS SoundCloud (отчёт H) → файл кэша. Куски качаются ПОСЛЕДОВАТЕЛЬНО и
/// дописываются в один `.part`: конкатенация init+сегменты и есть готовый
/// фрагментированный mp4 (живая проверка 22.07: ftyp iso5 → moov в начале —
/// Chromium такое играет, ремукс не нужен). Параллелить куски нельзя —
/// порядок байт в файле обязан повторять порядок в плейлисте.
///
/// Размер здесь не сверяется с заявленным: у манифеста нет Content-Length
/// всего трека, `entry.size` — оценка по битрейту. Границей служит тот же
/// лимит содержимого, что и у прямой закачки, но по факту записанного.
async fn fetch_hls_to_cache(
    dir: &Path,
    track_id: &str,
    entry: &WarmEntry,
    progress: Option<&tokio::sync::watch::Sender<StreamProgress>>,
    cancel: Option<&tokio::sync::Notify>,
) -> Result<PathBuf, String> {
    let part = dir.join(format!("{track_id}.{}.part", entry.ext));
    let final_path = dir.join(format!("{track_id}.{}", entry.ext));
    if let Err(e) = write_hls_to_part(&entry.hls_segments, &part, entry.size, progress, cancel).await
    {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    // Предохранитель склейки: смотрим начало .part ДО того, как файл станет
    // кэшем. Без этой проверки испорченная склейка ложилась в кэш КАК УСПЕХ, а
    // это худший исход из возможных: кэш-хит считается готовым файлом, лестница
    // yt-dlp больше не включается, и трек молчит до ручной очистки кэша — о
    // которой пользователь догадаться не может. Провал здесь, наоборот, ведёт
    // себя как любой другой сбой закачки: classify_failure и уход на лестницу.
    match hls_part_head(&part) {
        Ok(head) if hls_head_looks_playable(&head) => {}
        Ok(_) => {
            let _ = fs::remove_file(&part);
            return Err("склейка HLS не похожа на mp4: нет ftyp/moov в начале".into());
        }
        Err(e) => {
            let _ = fs::remove_file(&part);
            return Err(format!("чтение начала склейки HLS: {e}"));
        }
    }
    // Тот же порядок финализации, что у прямой закачки: снести чужой
    // одноимённый файл (yt-dlp мог оставить), затем rename.
    let _ = fs::remove_file(&final_path);
    if let Err(e) = fs::rename(&part, &final_path) {
        let _ = fs::remove_file(&part);
        return Err(format!("rename .part не прошёл: {e}"));
    }
    validate_ytdlp_output(dir, &final_path)
}

/// Сколько байт начала склейки читаем на проверку. `ftyp` стоит в первых
/// восьми, `moov` приходит в init-сегменте (у SoundCloud это единицы КБ);
/// 64 КБ — с большим запасом и всё ещё одно чтение с диска.
const HLS_HEAD_PROBE: usize = 64 * 1024;

/// Начало только что склеенного `.part`, не более `HLS_HEAD_PROBE` байт.
/// Отдельно от `read_slice` нарочно: тот требует точный диапазон и падает на
/// коротком файле, а короткий файл здесь — как раз один из ожидаемых исходов.
fn hls_part_head(part: &Path) -> std::io::Result<Vec<u8>> {
    use std::io::Read as _;
    let mut file = fs::File::open(part)?;
    let mut buf = vec![0u8; HLS_HEAD_PROBE];
    let mut filled = 0usize;
    while filled < buf.len() {
        match file.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    buf.truncate(filled);
    Ok(buf)
}

/// Признаки играбельной склейки fMP4: файл начинается боксом `ftyp` (сигнатура
/// стоит со смещения 4, первые четыре байта — размер бокса) и несёт `moov` в
/// начале. Именно потому, что у SoundCloud `moov` лежит в init-сегменте, а не в
/// хвосте, Chromium играет склейку без ремукса — развилка отчёта H, 27.07.
/// Тот же критерий проверяет живой smoke `sc_hls_first_segments_are_fmp4`.
fn hls_head_looks_playable(head: &[u8]) -> bool {
    head.len() >= 8 && &head[4..8] == b"ftyp" && head.windows(4).any(|w| w == b"moov")
}

/// Склейка сегментов в `.part`. `estimate` — только для прогресса: пока
/// записанное меньше оценки, total показываем оценкой, дальше — фактом
/// (иначе полоса прогресса уезжала бы за 100%).
async fn write_hls_to_part(
    segments: &[String],
    part: &Path,
    estimate: u64,
    progress: Option<&tokio::sync::watch::Sender<StreamProgress>>,
    cancel: Option<&tokio::sync::Notify>,
) -> Result<(), String> {
    use std::io::Write as _;
    let mut file = fs::File::create(part).map_err(|e| format!("не создался .part: {e}"))?;
    let mut written: u64 = 0;
    for (index, segment) in segments.iter().enumerate() {
        let send = warm_http_client()
            .get(segment)
            .header("User-Agent", SOUNDCLOUD_UA)
            .timeout(SOUNDCLOUD_TIMEOUT)
            .send();
        let resp = match cancel {
            Some(n) => tokio::select! {
                _ = n.notified() => return Err("стрим отменён до ответа CDN".into()),
                r = send => r,
            },
            None => send.await,
        }
        .map_err(|e| format!("сегмент {index} не ушёл: {e}"))?;
        let status = resp.status().as_u16();
        if status != 200 {
            return Err(format!("сегмент {index}: статус {status}"));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("чтение сегмента {index}: {e}"))?;
        written += bytes.len() as u64;
        if !content_length_ok(written) {
            return Err(format!("склейка HLS вне лимита: {written}"));
        }
        file.write_all(&bytes)
            .map_err(|e| format!("запись .part: {e}"))?;
        if let Some(tx) = progress {
            tx.send_replace(StreamProgress {
                written,
                total: estimate.max(written),
                finalized: false,
                failed: false,
            });
        }
    }
    if written == 0 {
        return Err("склейка HLS пуста".into());
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
/// Было 8с (2026-07-19 → 4с): норма ~0.75с даже с бутстрапом visitorData,
/// дольше 4с — лестница выгоднее; worst-case клика при бот-гейте
/// (2 POST × таймаут) падает с 16с до 8с, дальше негативный кэш.
const INNERTUBE_TIMEOUT: Duration = Duration::from_secs(4);
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
/// Network (транспорт: сеть/таймаут/не-200) отделён от Other потому, что
/// circuit-breaker считает только ГЛОБАЛЬНЫЕ провалы (Login/Sabr/Network) —
/// пер-видео UNPLAYABLE в Other не должен глушить ступень 0 всем.
#[derive(Debug, PartialEq)]
enum InnertubeFail {
    LoginRequired(String),
    Sabr(String),
    Network(String),
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
        hls_segments: Vec::new(),
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
/// приоритет источников сервера не переворачиваем (Soundcloud первым — своя
/// ступень stage0_soundcloud_ref ниже; Bandcamp первым — сразу лестница).
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
        // сеть считается в fail_other: отдельный KPI не нужен, класс
        // существует ради circuit-breaker'а
        InnertubeFail::Network(_) | InnertubeFail::Other(_) => stats.fail_other += 1,
    }
}

// ── Журнал ступени 0 (2026-07-20) ─────────────────────────────────
// Предохранители ниже срабатывают за доли секунды и МОЛЧА — владелец видел
// только «через два часа всё стало медленно», а разобрать постфактум было
// нечем. Каждый значимый переход (провал с классом, открытие/закрытие
// кулдауна, пауза SC-ключа) оставляет след: кольцо в памяти + файл-зеркало.
// Наружу — engine_stage0_status (Настройки → Система → «Диагностика добычи»).

/// Событие журнала: unix-миллисекунды + текст простым языком (его видит
/// пользователь в настройках; сырые детали провала — после « — »).
#[derive(Clone, Serialize)]
pub struct Stage0Event {
    pub at_ms: u64,
    pub text: String,
}

/// Кэп кольца: часа событий хватает на разбор, память не растёт.
const STAGE0_EVENTS_CAP: usize = 300;
/// Кэп файла-зеркала: перерос — начинаем заново (журнал НЕДАВНИХ событий,
/// история не самоцель).
const STAGE0_LOG_MAX_BYTES: u64 = 512 * 1024;

/// Событие в кольцо + best-effort в файл: диагностика не имеет права
/// ломать или тормозить добычу (все ошибки файла глотаются).
fn stage0_log(state: &EngineState, now: SystemTime, text: impl Into<String>) {
    let text = text.into();
    let at_ms = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    {
        let mut ring = state.stage0_events.lock().unwrap();
        ring.push_back(Stage0Event { at_ms, text: text.clone() });
        while ring.len() > STAGE0_EVENTS_CAP {
            ring.pop_front();
        }
    }
    let path = state.stage0_log_path.lock().unwrap().clone();
    if let Some(path) = path {
        if fs::metadata(&path)
            .map(|m| m.len() > STAGE0_LOG_MAX_BYTES)
            .unwrap_or(false)
        {
            let _ = fs::remove_file(&path);
        }
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
            use std::io::Write;
            let _ = writeln!(f, "{at_ms} {text}");
        }
    }
}

/// Класс провала — человеком: показывается в журнале настроек.
fn innertube_fail_label(fail: &InnertubeFail) -> (&'static str, &str) {
    match fail {
        InnertubeFail::LoginRequired(d) => ("YouTube требует вход", d),
        InnertubeFail::Sabr(d) => ("YouTube сменил формат", d),
        InnertubeFail::Network(d) => ("сеть не ответила", d),
        InnertubeFail::Other(d) => ("трек недоступен", d),
    }
}

// ── Circuit-breaker ступени 0 ─────────────────────────────────────
// Бот-гейт YouTube бьёт по IP: продолжать долбить POST /player — усиливать
// блок, а каждый провал прогрева доваливается в yt-dlp simulate (CPU-лавина:
// 118 результатов поиска → 18 спавнов, 2026-07-19). Поэтому 3 глобальных
// провала подряд глушат ступень 0 во всех трёх командах на STAGE0_COOLDOWN;
// на время кулдауна visible-прогрев не фолбэчится в yt-dlp (см. engine_warm).
// Успех — полный сброс. Единственный ДРУГОЙ рубильник — горячий рецепт
// (enabled:false), но он требует деплоя сервера; breaker — автоматика.

/// Глобальных провалов подряд до кулдауна.
const STAGE0_BREAKER_THRESHOLD: u32 = 3;
/// Длина кулдауна: бот-гейт за минуты не рассасывается, а дольше держать
/// ступень 0 выключенной — терять скорость на здоровой сети зря.
const STAGE0_COOLDOWN: Duration = Duration::from_secs(300);

#[derive(Default)]
struct Stage0Breaker {
    consecutive_fails: u32,
    cooldown_until: Option<SystemTime>,
}

fn stage0_in_cooldown(state: &EngineState, now: SystemTime) -> bool {
    state
        .stage0_breaker
        .lock()
        .unwrap()
        .cooldown_until
        .map(|until| now < until)
        .unwrap_or(false)
}

/// Провал в счёт breaker'а. Other (UNPLAYABLE и прочее пер-видео) нейтрален:
/// не считается и не сбрасывает — он доказывает, что API вообще-то отвечает.
fn stage0_breaker_note_fail(state: &EngineState, fail: &InnertubeFail, now: SystemTime) {
    if matches!(fail, InnertubeFail::Other(_)) {
        return;
    }
    let (label, detail) = innertube_fail_label(fail);
    // detail режем: в журнале важен класс, сырой хвост — только зацепка
    let detail: String = detail.chars().take(120).collect();
    stage0_log(state, now, format!("сбой быстрого пути: {label} — {detail}"));
    let opened = {
        let mut b = state.stage0_breaker.lock().unwrap();
        b.consecutive_fails += 1;
        if b.consecutive_fails >= STAGE0_BREAKER_THRESHOLD {
            b.cooldown_until = Some(now + STAGE0_COOLDOWN);
            // после истечения кулдауна счёт начинается заново — один свежий
            // провал не захлопывает ступень 0 обратно
            b.consecutive_fails = 0;
            true
        } else {
            false
        }
    };
    if opened {
        stage0_log(
            state,
            now,
            format!(
                "быстрый путь выключен на {} мин ({} сбоя подряд, последний: {label}) — треки идут запасной дорогой",
                STAGE0_COOLDOWN.as_secs() / 60,
                STAGE0_BREAKER_THRESHOLD,
            ),
        );
    }
}

fn stage0_breaker_note_success(state: &EngineState) {
    let troubled = {
        let mut b = state.stage0_breaker.lock().unwrap();
        let troubled = b.consecutive_fails > 0 || b.cooldown_until.is_some();
        b.consecutive_fails = 0;
        b.cooldown_until = None;
        troubled
    };
    // Тихий успех — не событие: журнал не разбавляется рутиной
    if troubled {
        stage0_log(state, SystemTime::now(), "быстрый путь снова в строю");
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

/// Провал SC-ступени: след в журнале + негативный кэш (общая дисциплина трёх
/// команд warm/stream_start/resolve). ClientId не дублируется — кулдаун ключа
/// уже оставил своё событие в sc_cid_fail.
fn stage0_note_sc_fail(state: &EngineState, sc_key: &str, fail: &SoundcloudFail, now: SystemTime) {
    if let SoundcloudFail::Other(d) = fail {
        let detail: String = d.chars().take(120).collect();
        stage0_log(
            state,
            now,
            format!("SoundCloud не отдал трек — запасная дорога ({detail})"),
        );
    }
    stage0_note_fail(state, sc_key, now);
}

/// Тело POST /player. Значения client — из рецепта; остальные поля
/// (deviceMake и пр.) — обязательные константы ANDROID_VR из yt-dlp ff459e5
/// (без них клиент не признаётся «своим»).
fn build_innertube_body(
    cfg: &InnertubeConfig,
    video_id: &str,
    visitor: Option<&str>,
) -> serde_json::Value {
    // Контекст устройства зависит от клиента (ступень 0.5, 2026-07-22):
    // android_vr — прежний Oculus-профиль (проверен живьём 19.07), фолбэки
    // IOS/TVHTML5 несут свои поля — android-поля в чужом контексте YouTube
    // отвергает.
    let mut client = match cfg.client_name.as_str() {
        "IOS" => serde_json::json!({
            "clientName": cfg.client_name,
            "clientVersion": cfg.client_version,
            "deviceMake": "Apple",
            "deviceModel": "iPhone16,2",
            "osName": "iOS",
            "osVersion": "18.1.0.22B83",
            "hl": "en",
            "gl": "US",
        }),
        "TVHTML5" => serde_json::json!({
            "clientName": cfg.client_name,
            "clientVersion": cfg.client_version,
            "hl": "en",
            "gl": "US",
        }),
        _ => serde_json::json!({
            "clientName": cfg.client_name,
            "clientVersion": cfg.client_version,
            "deviceMake": "Oculus",
            "deviceModel": "Quest 3",
            "androidSdkVersion": 32,
            "osName": "Android",
            "osVersion": "12L",
            "hl": "en",
            "gl": "US",
        }),
    };
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
/// Разбор ответа параметризован (2026-07-21): аудио-путь даёт
/// parse_innertube_player, видео-путь «Сейчас играет» — parse_innertube_video;
/// сама оркестрация от содержимого не зависит.
async fn resolve_innertube_with_parse<T, F, Fut, P>(
    state: &EngineState,
    mut call: F,
    parse: P,
) -> Result<T, InnertubeFail>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<serde_json::Value, String>>,
    P: Fn(&serde_json::Value) -> Result<T, InnertubeFail>,
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
    let resp = call(visitor.clone()).await.map_err(InnertubeFail::Network)?;
    let fresh = innertube_visitor(&resp);
    if let Some(v) = &fresh {
        *state.youtube_visitor.lock().unwrap() = Some(VisitorData {
            value: v.clone(),
            obtained_at: SystemTime::now(),
        });
    }
    match parse(&resp) {
        Err(InnertubeFail::LoginRequired(msg)) => {
            // повторяем только если появился ДРУГОЙ visitor — слать тот же
            // значит получить тот же отказ
            let Some(retry_visitor) = fresh.filter(|v| Some(v.as_str()) != visitor.as_deref())
            else {
                return Err(InnertubeFail::LoginRequired(msg));
            };
            let resp2 = call(Some(retry_visitor))
                .await
                .map_err(InnertubeFail::Network)?;
            if let Some(v2) = innertube_visitor(&resp2) {
                *state.youtube_visitor.lock().unwrap() = Some(VisitorData {
                    value: v2,
                    obtained_at: SystemTime::now(),
                });
            }
            parse(&resp2)
        }
        other => other,
    }
}

/// Аудио-обёртка прежней сигнатуры: вся ступень 0 и её тесты живут как жили.
async fn resolve_via_innertube_with<F, Fut>(
    state: &EngineState,
    itag_priority: &[u64],
    call: F,
) -> Result<InnertubeFormat, InnertubeFail>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<serde_json::Value, String>>,
{
    resolve_innertube_with_parse(state, call, |raw| parse_innertube_player(raw, itag_priority)).await
}

/// User-Agent под клиента: android_vr — Oculus-профиль (проверен живьём),
/// фолбэки — свои (ступень 0.5).
fn innertube_ua(cfg: &InnertubeConfig) -> String {
    match cfg.client_name.as_str() {
        "IOS" => format!(
            "com.google.ios.youtube/{} (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
            cfg.client_version
        ),
        "TVHTML5" => "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version".to_string(),
        _ => format!(
            "com.google.android.apps.youtube.vr.oculus/{} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
            cfg.client_version
        ),
    }
}

/// Ступень 0.5 (отчёт G, 2026-07-22): SABR-only у android_vr раскатывается
/// региональными A/B-тестами — прежде чем сдаться лестнице yt-dlp (~4.5с),
/// пробуем ещё два клиента, которым по ресёрчу не нужен PoToken/n-sig.
/// Версии дрейфуют — провал любого МОЛЧА уступает дальше (лестница остаётся
/// страховкой), поэтому устаревание констант безопасно: ноль вреда, просто
/// перестанет выручать. Порядок: tv по ресёрчу стабильнее; ios — под
/// вопросом (местами требует PoToken), идёт вторым.
fn innertube_fallback_configs() -> [InnertubeConfig; 2] {
    [
        InnertubeConfig {
            client_name: "TVHTML5".into(),
            client_version: "7.20250312.16.00".into(),
            client_name_id: 7,
        },
        InnertubeConfig {
            client_name: "IOS".into(),
            client_version: "19.45.4".into(),
            client_name_id: 5,
        },
    ]
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
    let ua = innertube_ua(cfg);
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

/// Один клиент ступени 0: POST → разбор → WarmEntry той же формы, что у
/// прогрева.
async fn resolve_via_innertube_client(
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
    // DNS-preflight validate_warm_url — блокирующий getaddrinfo: с async-
    // рантайма его уводит spawn_blocking (лестница делает так же в
    // build_attempts) — медленный DNS не душит соседние async-задачи.
    tauri::async_runtime::spawn_blocking(move || innertube_warm_entry(&fmt, SystemTime::now()))
        .await
        .map_err(|e| InnertubeFail::Other(format!("spawn_blocking: {e}")))?
        .map_err(InnertubeFail::Other)
}

/// Боевая ступень 0 целиком: клиент рецепта, при SABR-only — фолбэк-клиенты
/// (ступень 0.5). Err любого класса = «молча уступи лестнице» у вызывающего.
async fn resolve_via_innertube(
    state: &EngineState,
    cfg: &InnertubeConfig,
    video_id: &str,
    itag_priority: &[u64],
) -> Result<WarmEntry, InnertubeFail> {
    match resolve_via_innertube_client(state, cfg, video_id, itag_priority).await {
        Err(InnertubeFail::Sabr(detail)) => {
            for fb in innertube_fallback_configs() {
                if let Ok(entry) =
                    resolve_via_innertube_client(state, &fb, video_id, itag_priority).await
                {
                    // KPI fail_sabr фиксируем и при спасении: это маркер
                    // деградации ОСНОВНОГО клиента (при полном провале его
                    // посчитает classify_innertube_failure у вызывающего —
                    // здесь не дублируем).
                    state.stats.lock().unwrap().fail_sabr += 1;
                    stage0_log(
                        state,
                        SystemTime::now(),
                        format!(
                            "YouTube перевёл основной путь на новый формат — выручил запасной клиент {}",
                            fb.client_name
                        ),
                    );
                    return Ok(entry);
                }
                // провал фолбэка — молча к следующему: лестница остаётся страховкой
            }
            Err(InnertubeFail::Sabr(detail))
        }
        other => other,
    }
}

// ── Видео трека для «Сейчас играет» (2026-07-21) ──────────────────
// Тот же InnerTube-путь, что ступень 0 аудио, но БЕЗ скачивания: наружу
// уходит удалённый googlevideo-URL видео-дорожки, его играет muted <video>
// (слейв к позиции аудио, App/useVideoSync). Аудио-инвариант «video/* — не
// кандидаты» (parse_ignores_video_formats) НЕ ослабляется: это параллельный
// разбор с зеркальным фильтром, аудио-путь не тронут.

/// Приоритет видео-itag (video-only с прямым url): H.264 (avc1) впереди —
/// WebView2 декодирует его аппаратно на любой машине; VP9 (webm) — фолбэк.
/// Панель узкая (~300–420 px): 480p (135) достаточно и бережёт трафик,
/// 720p/1080p — запас, 4K (313 и пр.) сознательно НЕ берём.
const INNERTUBE_VIDEO_ITAGS: &[u64] = &[135, 136, 134, 137, 244, 247, 243];

/// Разбор ответа /player для ВИДЕО-дорожки: зеркало parse_innertube_player
/// (тот же playability-гейт, та же SABR-диагностика), фильтр — "video/".
/// contentLength не требуем: поток не качается, размер не важен.
fn parse_innertube_video(
    raw: &serde_json::Value,
    itag_priority: &[u64],
) -> Result<(String, u64), InnertubeFail> {
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
            if !f["mimeType"].as_str().unwrap_or("").starts_with("video/") {
                continue;
            }
            // СТАТИЧНАЯ КАРТИНКА — НЕ ВИДЕО (наблюдение владельца 04.08:
            // «часть видео на деле статичная картинка, смотреть там не на
            // что, а система считает их видео»).
            //
            // Автоматические «арт-треки» YouTube (то, что заливает лейбл
            // вместе с аудио) — это обложка, растянутая на всю длину песни.
            // Отличить их от настоящего клипа по URL или itag нельзя, зато
            // InnerTube отдаёт у формата ЧАСТОТУ КАДРОВ, и она их выдаёт с
            // головой: у клипа 24/25/30/50/60, у картинки — единицы. Порог 10
            // лежит в пустоте между этими двумя мирами.
            //
            // Отброшенный формат = «видео нет», и панель показывает обложку —
            // ту же самую картинку, но своей, честной дорогой: без декодера,
            // без сетевого потока на несколько мегабайт и без ложного
            // обещания, что там что-то происходит.
            if f["fps"].as_u64().map(|fps| fps < 10).unwrap_or(false) {
                continue;
            }
            let Some(url) = f["url"].as_str().filter(|u| !u.is_empty()) else {
                continue;
            };
            return Ok((url.to_string(), *want));
        }
    }
    let any_url = formats
        .iter()
        .any(|f| f["url"].as_str().map(|u| !u.is_empty()).unwrap_or(false));
    if !formats.is_empty() && !any_url {
        return Err(InnertubeFail::Sabr(
            "adaptiveFormats без прямых url (SABR-сессия)".into(),
        ));
    }
    Err(InnertubeFail::Other(
        "нет подходящего видеоформата с прямым url".into(),
    ))
}

/// Ответ engine_resolve_video: удалённый URL для <video> + срок жизни ссылки
/// (googlevideo ~6ч, IP-bound) — клиент по нему решает, когда ре-резолвить.
#[derive(Serialize)]
pub struct VideoResolveOut {
    pub url: String,
    pub itag: u64,
    pub expires_at_ms: u64,
}

/// Видео трека для «Сейчас играет». Провал не критичен по определению —
/// панель показывает обложку; поэтому видео-путь кулдаун breaker'а УВАЖАЕТ
/// на чтение (не долбит бот-гейт ради картинки), но сам НЕ пишет ни провалы,
/// ни успехи — визуальный сахар не имеет права глушить добычу аудио.
#[tauri::command]
pub async fn engine_resolve_video(
    state: State<'_, EngineState>,
    video_id: String,
) -> Result<VideoResolveOut, String> {
    if !valid_youtube_id(&video_id) {
        return Err("некорректный id видео".into());
    }
    let Some(cfg) = innertube_from_recipe(&state.recipe.lock().unwrap()) else {
        return Err("видео недоступно: InnerTube выключен рецептом".into());
    };
    if stage0_in_cooldown(&state, SystemTime::now()) {
        return Err("видео недоступно: кулдаун InnerTube".into());
    }
    let cfg_owned = cfg.clone();
    let vid = video_id.clone();
    let (url, itag) = resolve_innertube_with_parse(
        &state,
        move |visitor| {
            let cfg = cfg_owned.clone();
            let vid = vid.clone();
            async move { innertube_player_call(&cfg, &vid, visitor.as_deref()).await }
        },
        |raw| parse_innertube_video(raw, INNERTUBE_VIDEO_ITAGS),
    )
    .await
    .map_err(|e| {
        let (InnertubeFail::LoginRequired(m)
        | InnertubeFail::Sabr(m)
        | InnertubeFail::Network(m)
        | InnertubeFail::Other(m)) = e;
        format!("видео не разрешилось: {m}")
    })?;
    // не качаем, но и мусор в <video> не отдаём: только https + googlevideo
    let parsed = Url::parse(&url).map_err(|e| format!("видео-URL не парсится: {e}"))?;
    let host_ok = parsed.scheme() == "https"
        && parsed
            .host_str()
            .map(|h| h == "googlevideo.com" || h.ends_with(".googlevideo.com"))
            .unwrap_or(false);
    if !host_ok {
        return Err("видео-URL с неожиданного хоста".into());
    }
    let expires_at_ms = warm_expires_at(&parsed, SystemTime::now())
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(VideoResolveOut {
        url,
        itag,
        expires_at_ms,
    })
}

// ── Ступень 0 SoundCloud: прямой api-v2-резолв (2026-07-19) ───────
// Появилась в тот же день, что и InnerTube-ступень, и по той же жалобе:
// владелец слушает в основном SoundCloud-треки, а всё ускорение (ступень 0 +
// стрим с первых 128 КиБ) работало только для YouTube-первых источников — SC
// шёл через yt-dlp с ожиданием ПОЛНОЙ закачки (~5–6 с на клик, 19.07). Схема
// из разведки (docs/notes/2026-07-19-прямой-innertube-резолв-замер.md,
// «Побочные победы»): GET /resolve (или /tracks/<id> для числовой формы) →
// media.transcodings → progressive (по format.protocol, НЕ по именам полей —
// SC уходит к AAC HLS) → GET transcoding.url → подписанный CDN-URL (~30 мин
// жизни) → Range-проба размера (transcodings contentLength не отдают).
// Выход — WarmEntry: вся нижняя половина (validate_warm_url, fetch_to_cache,
// warm-кэш, muza-stream) переиспользуется байт-в-байт. Провал ЛЮБОГО класса
// молча уступает лестнице yt-dlp — ступень 0 не имеет права сделать трек
// неиграбельным. Circuit-breaker InnerTube эту ступень не гейтит: он про
// бот-гейт YouTube, у SC своя автоматика — негативный кэш "sc:<source_id>"
// и минутный кулдаун добычи client_id.

/// Таймаут одного GET SC-ступени — та же философия, что INNERTUBE_TIMEOUT:
/// ступень 0 либо быстрая, либо сразу уступает лестнице.
const SOUNDCLOUD_TIMEOUT: Duration = Duration::from_secs(4);
/// TTL добытого client_id: зашит в JS-бандли soundcloud.com и живёт неделями;
/// протухание всё равно ловится 401/403 с передобычей — TTL лишь страховка,
/// чтобы не держать труп бесконечно.
const SOUNDCLOUD_CLIENT_ID_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
/// Кулдаун после провала добычи client_id: без него каждый клик по SC-треку
/// заново тянул бы главную + мегабайтные бандлы (see EngineState).
const SOUNDCLOUD_CID_FAIL_TTL: Duration = Duration::from_secs(60);
/// Срок жизни SC-WarmEntry: подписанный CDN-URL живёт ~30 минут, но его
/// query-параметры (Policy/Signature CloudFront) — чужой формат подписи,
/// парсить его ненадёжно. Консервативные 20 минут от now; это меньше 6 ч
/// googlevideo — warm-кэш сравнивает expires_at только с now, ему всё равно.
const SOUNDCLOUD_WARM_TTL: Duration = Duration::from_secs(20 * 60);
/// Сколько бандлов сканировать (с конца — client_id исторически в последних):
/// защита от патологической страницы с сотней скриптов.
const SOUNDCLOUD_CID_BUNDLE_SCAN_MAX: usize = 12;
/// UA всех GET SC-ступени: обычный браузерный — api-v2 обслуживает браузерный
/// фронт soundcloud.com, безликий reqwest-запрос выделялся бы сильнее.
const SOUNDCLOUD_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// Потолок сегментов AAC HLS для ступени 0 (≈33 минуты при нарезке SC по 10с).
/// Обычный трек — 20–30 кусков, это секунды последовательной закачки; длинные
/// миксы (живой прогон 27.07 поймал 733 сегмента) уходят на лестницу, где
/// yt-dlp качает фрагменты конкурентно.
const SC_HLS_MAX_SEGMENTS: usize = 200;

/// Провал SC-ступени. ClientId отделён от Other единственным поведенческим
/// отличием: он означает «добыча client_id провалилась», и кулдаун добычи уже
/// взведён — вызывающему остаётся молча уйти в лестницу (как и с Other).
#[derive(Debug, PartialEq)]
enum SoundcloudFail {
    ClientId(String),
    Other(String),
}

/// Успешный разбор SC-ступени — та же тройка, что InnertubeFormat/
/// SimulatedFormat: дальше единая конверсия в WarmEntry.
#[derive(Debug, PartialEq)]
struct SoundcloudFormat {
    url: String,
    size: u64,
    ext: String,
    /// Непусто = AAC HLS: `url` — манифест, аудио лежит этими кусками
    /// (init первым), а `size` — оценка (см. WarmEntry::hls_segments).
    segments: Vec<String>,
}

/// SC-ступень — только когда ВЕДУЩИЙ источник Soundcloud с канонично валидным
/// url (зеркало stage0_youtube_id: приоритет источников сервера не
/// переворачиваем). Грамматика url — та же byte_canonical_locator, что и у
/// лестницы: обе формы каталога (страничная и числовая api.soundcloud.com).
fn stage0_soundcloud_ref(sources: &[SourceRef]) -> Option<(String, Url)> {
    match sources.first()? {
        SourceRef::Soundcloud {
            source_id,
            canonical_url,
        } if valid_opaque_id(source_id) => {
            let url = byte_canonical_locator("soundcloud", canonical_url).ok()?;
            Some((source_id.clone(), url))
        }
        _ => None,
    }
}

/// mime_type транскодинга → расширение файла кэша. Ориентир — format-поля,
/// не имена пресетов: пресеты SC переименовывает, mime стабилен. Неизвестный
/// mime — кандидат пропускается (лучше лестница, чем кэш с неверным ext).
fn sc_ext_from_mime(mime: &str) -> Option<&'static str> {
    match mime.split(';').next().unwrap_or("").trim() {
        "audio/mpeg" | "audio/mp3" => Some("mp3"),
        "audio/mp4" | "audio/aac" => Some("m4a"),
        _ => None,
    }
}

/// Протокол выбранного транскодинга: определяет, что лежит по CDN-URL —
/// сам файл или манифест, аудио к которому надо собрать из сегментов.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum ScProtocol {
    /// Прямой файл — одним GET по CDN-URL (быстрый путь, пока SC его отдаёт).
    Progressive,
    /// AAC HLS: CDN-URL ведёт на m3u8, аудио лежит сегментами fMP4.
    HlsAac,
}

/// Выбранный транскодинг: url запроса за CDN-ссылкой + расширение файла кэша
/// + протокол (см. ScProtocol).
#[derive(Debug, PartialEq)]
struct ScTranscoding {
    url: String,
    ext: &'static str,
    protocol: ScProtocol,
    /// Битрейт пресета, кбит/с. Нужен ТОЛЬКО для оценки размера HLS до
    /// закачки (у манифеста нет Content-Length всего трека); у progressive
    /// размер даёт честная Range-проба, и это поле не используется.
    kbps: u32,
}

/// Порядок предпочтения среди AAC HLS: 160k лучше 96k, всё прочее AAC — в
/// хвост. Ранг влияет ТОЛЬКО на порядок выбора; корректность (что это вообще
/// AAC) определяется по mime, а не по имени пресета — пресеты SC
/// переименовывает, см. sc_ext_from_mime.
fn sc_aac_rank(preset: &str) -> u8 {
    let p = preset.to_ascii_lowercase();
    if p.contains("160") {
        0
    } else if p.contains("96") {
        1
    } else {
        2
    }
}

/// Битрейт пресета, кбит/с. Незнакомый пресет — 160 (верхняя из живых
/// ступеней SC): оценка размера должна ошибаться В БОЛЬШУЮ сторону, иначе
/// лимит содержимого срежет честный трек.
fn sc_aac_kbps(preset: &str) -> u32 {
    let p = preset.to_ascii_lowercase();
    if p.contains("96") {
        96
    } else {
        160
    }
}

/// Выбор транскодинга. Приоритет прежний: progressive (прямой файл) — первым,
/// он дешевле одной закачкой. Нет его — берём AAC HLS (отчёт H: SC удаляет
/// progressive из API, у части каталога прямого mp3 уже нет): по CDN-URL там
/// лежит m3u8, который разбирает sc_parse_m3u8, а не аудио.
///
/// HLS-mp3 сознательно НЕ берём, хотя SC его отдаёт: сегменты там — куски
/// mp3-фреймов, склейка играбельна, но выигрыша против AAC нет, а веток
/// становится вдвое больше. Нужен — добавляется рангом рядом с AAC.
fn sc_pick_transcoding(track: &serde_json::Value) -> Result<ScTranscoding, SoundcloudFail> {
    let transcodings = track["media"]["transcodings"]
        .as_array()
        .ok_or_else(|| SoundcloudFail::Other("нет media.transcodings".into()))?;
    let mut best_hls: Option<(u8, ScTranscoding)> = None;
    for t in transcodings {
        let Some(url) = t["url"].as_str().filter(|u| !u.is_empty()) else {
            continue;
        };
        let Some(ext) = sc_ext_from_mime(t["format"]["mime_type"].as_str().unwrap_or("")) else {
            continue;
        };
        match t["format"]["protocol"].as_str() {
            Some("progressive") => {
                return Ok(ScTranscoding {
                    url: url.to_string(),
                    ext,
                    protocol: ScProtocol::Progressive,
                    kbps: 0,
                })
            }
            // ext=="m4a" ⇔ mime audio/mp4|audio/aac — это и есть «AAC»;
            // HLS с audio/mpeg (mp3) сюда не попадает намеренно.
            Some("hls") if ext == "m4a" => {
                let preset = t["preset"].as_str().unwrap_or("");
                let rank = sc_aac_rank(preset);
                if best_hls.as_ref().is_none_or(|(best, _)| rank < *best) {
                    best_hls = Some((
                        rank,
                        ScTranscoding {
                            url: url.to_string(),
                            ext,
                            protocol: ScProtocol::HlsAac,
                            kbps: sc_aac_kbps(preset),
                        },
                    ));
                }
            }
            _ => {}
        }
    }
    if let Some((_, hls)) = best_hls {
        return Ok(hls);
    }
    Err(SoundcloudFail::Other(
        "у трека нет ни progressive, ни AAC HLS — качаем запасной дорогой".into(),
    ))
}

/// Разобранный медиаплейлист SC: init-сегмент (#EXT-X-MAP) и сегменты по
/// порядку, все — абсолютными URL.
#[derive(Debug, PartialEq)]
struct ScHlsPlaylist {
    /// У fMP4 init обязателен: без него склейка сегментов не играет (в ней
    /// нет ни ftyp, ни moov). Отсутствует — плейлист не наш случай.
    init: Option<String>,
    segments: Vec<String>,
}

/// Значение атрибута URI="…" из строки-тега (#EXT-X-MAP и родня).
fn sc_hls_attr_uri(line: &str) -> Option<&str> {
    let rest = line.split_once("URI=\"")?.1;
    rest.split_once('"').map(|(value, _)| value)
}

/// Разбор медиаплейлиста. Относительные ссылки резолвятся против URL самого
/// плейлиста (живой SC отдаёт абсолютные с подписью, но грамматика HLS
/// разрешает и относительные — на них ломался бы только прод).
///
/// `#EXT-X-KEY` ЛЮБОГО вида = сегменты зашифрованы: честный отказ ступени, а
/// не попытка склеить мусор. Ключи SC не раздаёт, и обходить их мы не будем.
fn sc_parse_m3u8(text: &str, base: &Url) -> Result<ScHlsPlaylist, SoundcloudFail> {
    let mut init = None;
    let mut segments = Vec::new();
    let resolve = |raw: &str| -> Result<String, SoundcloudFail> {
        base.join(raw)
            .map(|u| u.to_string())
            .map_err(|e| SoundcloudFail::Other(format!("ссылка сегмента не разбирается: {e}")))
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("#EXT-X-KEY") {
            return Err(SoundcloudFail::Other(
                "сегменты SC зашифрованы (#EXT-X-KEY) — ступень 0 их не берёт".into(),
            ));
        }
        if line.starts_with("#EXT-X-MAP") {
            if let Some(uri) = sc_hls_attr_uri(line) {
                init = Some(resolve(uri)?);
            }
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        segments.push(resolve(line)?);
    }
    if segments.is_empty() {
        return Err(SoundcloudFail::Other(
            "медиаплейлист SC без сегментов".into(),
        ));
    }
    Ok(ScHlsPlaylist { init, segments })
}

/// URL JS-бандлов из HTML главной: подстроки https://a-v2.sndcdn.com/assets/…
/// до конца имени ассета, только .js, дубли схлопнуты (preload + script).
/// Без regex-крейта намеренно: грамматика тривиальна, зависимость не окупается.
fn sc_bundle_urls(html: &str) -> Vec<String> {
    const PREFIX: &str = "https://a-v2.sndcdn.com/assets/";
    let mut out: Vec<String> = Vec::new();
    let mut rest = html;
    while let Some(pos) = rest.find(PREFIX) {
        let tail = &rest[pos..];
        let end = tail[PREFIX.len()..]
            .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/')))
            .map(|i| PREFIX.len() + i)
            .unwrap_or(tail.len());
        let url = &tail[..end];
        if url.ends_with(".js") && !out.iter().any(|u| u == url) {
            out.push(url.to_string());
        }
        rest = &rest[pos + PREFIX.len()..];
    }
    out
}

/// Грамматика значения client_id: ровно 32 ASCII-алфанумерных символа.
///
/// ⚠️ Это единственное, что делает законной СЫРУЮ интерполяцию значения в URL
/// (`sc_api_lookup_url`). Поэтому проверка обязана применяться к КАЖДОМУ
/// источнику значения — и к добыче из бандла, и к подъёму из файла в
/// пользовательской папке, который могли подменить или побить.
fn sc_client_id_is_valid(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Файл-персист ключа SC. Отдельный от recipe-cache.json нарочно: у рецепта
/// своя подпись и анти-даунгрейд, подмешивать туда чужое состояние нельзя.
#[derive(Serialize, Deserialize)]
struct StoredSoundcloudCid {
    client_id: String,
    /// Момент добычи, unix-мс.
    obtained_at_ms: u64,
}

/// Разбор файла-персиста. Значение поднимается, только если проходит ТУ ЖЕ
/// грамматику, что добыча, и не протухло по тому же TTL. Не сошлось — файл
/// игнорируется целиком (как init() молча игнорирует битый recipe-cache.json).
fn parse_stored_sc_cid(raw: &str, now: SystemTime) -> Option<(String, SystemTime)> {
    let stored: StoredSoundcloudCid = serde_json::from_str(raw).ok()?;
    if !sc_client_id_is_valid(&stored.client_id) {
        return None;
    }
    let at = SystemTime::UNIX_EPOCH.checked_add(Duration::from_millis(stored.obtained_at_ms))?;
    // Формула свежести — та же, что в sc_cached_client_id, включая
    // `unwrap_or(false)`: метка ИЗ БУДУЩЕГО (часы съехали назад, метка чужой
    // машины) даёт Err и читается как «протух», а не как «свежий».
    now.duration_since(at)
        .map(|age| age < SOUNDCLOUD_CLIENT_ID_TTL)
        .unwrap_or(false)
        .then_some((stored.client_id, at))
}

/// Сериализация для файла-персиста; None — значение непредставимо (метка до
/// эпохи или за пределами u64-мс), тогда просто ничего не пишем.
fn serialize_stored_sc_cid(id: &str, at: SystemTime) -> Option<String> {
    let ms = at.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_millis();
    serde_json::to_string(&StoredSoundcloudCid {
        client_id: id.to_string(),
        obtained_at_ms: u64::try_from(ms).ok()?,
    })
    .ok()
}

/// client_id из текста бандла: за словом client_id — `:` или `=`, кавычка,
/// ровно 32 алфанумерных символа, закрывающая кавычка. Жёсткая грамматика
/// отсеивает конкатенации вида `"?client_id="+e` и мусорные совпадения.
fn sc_client_id_from_js(js: &str) -> Option<String> {
    let mut search = js;
    while let Some(pos) = search.find("client_id") {
        let after = &search[pos + "client_id".len()..];
        let trimmed = after.trim_start();
        if let Some(rest) = trimmed
            .strip_prefix(':')
            .or_else(|| trimmed.strip_prefix('='))
        {
            let rest = rest.trim_start();
            for quote in ['"', '\''] {
                if let Some(body) = rest.strip_prefix(quote) {
                    if let Some(end) = body.find(quote) {
                        let candidate = &body[..end];
                        if sc_client_id_is_valid(candidate) {
                            return Some(candidate.to_string());
                        }
                    }
                }
            }
        }
        search = after;
    }
    None
}

/// client_id из состояния, если не протух. now — параметром (тестируемость).
fn sc_cached_client_id(state: &EngineState, now: SystemTime) -> Option<String> {
    let guard = state.soundcloud_client_id.lock().unwrap();
    match guard.as_ref() {
        Some((id, at))
            if now
                .duration_since(*at)
                .map(|age| age < SOUNDCLOUD_CLIENT_ID_TTL)
                .unwrap_or(false) =>
        {
            Some(id.clone())
        }
        _ => None,
    }
}

/// Свежедобытый client_id: в состояние; успех добычи стирает кулдаун.
/// Плюс best-effort персист, чтобы следующий запуск не платил главной и
/// бандлами заново. Запись идёт ВНЕ ЛОКОВ (fs::write под мьютексом состояния
/// подвесил бы соседние клики на время дискового ввода-вывода), ошибки
/// глотаются: не записалось — просто следующий запуск добудет ключ сам.
fn sc_note_client_id(state: &EngineState, id: &str, now: SystemTime) {
    *state.soundcloud_client_id.lock().unwrap() = Some((id.to_string(), now));
    *state.soundcloud_cid_fail.lock().unwrap() = None;
    let path = state.soundcloud_cid_path.lock().unwrap().clone();
    if let (Some(path), Some(raw)) = (path, serialize_stored_sc_cid(id, now)) {
        // каталог app_data мог ещё не появиться (чистая установка) — тот же
        // приём, что при сохранении recipe-cache.json
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(path, raw);
    }
}

/// Сброс client_id (401/403 на api-v2 — значение протухло). Файл-персист тоже
/// удаляем: иначе, если передобыча следом провалилась (SoundCloud лежит) и
/// сессия закончилась, следующий запуск поднял бы МЁРТВЫЙ ключ и снова оплатил
/// лишний round-trip до того же 401.
fn sc_drop_client_id(state: &EngineState) {
    *state.soundcloud_client_id.lock().unwrap() = None;
    let path = state.soundcloud_cid_path.lock().unwrap().clone();
    if let Some(path) = path {
        let _ = fs::remove_file(path);
    }
}

fn sc_cid_recently_failed(state: &EngineState, now: SystemTime) -> bool {
    (*state.soundcloud_cid_fail.lock().unwrap())
        .map(|at| {
            now.duration_since(at)
                .map(|age| age < SOUNDCLOUD_CID_FAIL_TTL)
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn sc_cid_note_fail(state: &EngineState, now: SystemTime) {
    *state.soundcloud_cid_fail.lock().unwrap() = Some(now);
}

/// Провал добычи client_id: взводит кулдаун и отдаёт класс ClientId.
fn sc_cid_fail(state: &EngineState, msg: String) -> SoundcloudFail {
    let now = SystemTime::now();
    sc_cid_note_fail(state, now);
    let detail: String = msg.chars().take(120).collect();
    stage0_log(
        state,
        now,
        format!("ключ SoundCloud не добылся — минуту треки SC идут запасной дорогой ({detail})"),
    );
    SoundcloudFail::ClientId(msg)
}

/// api-v2-URL для трека: страничная форма каталога — через /resolve,
/// числовая (api.soundcloud.com/tracks/<id>, 64% SoundCloud-каталога) — в
/// /tracks/<id> напрямую, /resolve ей не нужен. client_id уже провалидирован
/// грамматикой добычи (32 алфанумерных) — интерполяция безопасна.
fn sc_api_lookup_url(canonical: &Url, client_id: &str) -> String {
    if canonical.host_str() == Some("api.soundcloud.com") {
        let id = canonical
            .path_segments()
            .and_then(|mut s| s.nth(1))
            .unwrap_or("");
        format!("https://api-v2.soundcloud.com/tracks/{id}?client_id={client_id}")
    } else {
        let mut url = Url::parse("https://api-v2.soundcloud.com/resolve")
            .expect("статический api-v2-URL валиден");
        url.query_pairs_mut()
            .append_pair("url", canonical.as_str())
            .append_pair("client_id", client_id);
        url.into()
    }
}

/// transcoding.url + client_id. Перед этим — та же синтаксическая граница,
/// что у CDN-URL ниже: URL пришёл из ответа api-v2, GET на http/credentials/
/// IP-литерал не шлём (пустой lookup = DNS-часть пропущена, она best-effort).
fn sc_with_client_id(raw: &str, client_id: &str) -> Result<String, String> {
    let mut url = validate_warm_url_with_lookup(raw, &mut |_, _| Ok(Vec::new()))?;
    url.query_pairs_mut().append_pair("client_id", client_id);
    Ok(url.into())
}

/// Добыча client_id: главная soundcloud.com → JS-бандлы С КОНЦА → грамматика
/// client_id. ⚠️ На машине владельца DPI душит крупные загрузки у Node — но
/// Rust/reqwest не душится (проверено живьём 19.07 на googlevideo 3.4 МБ),
/// поэтому добыча живёт здесь, а не на сервере. Любой сбой (сеть, не-200,
/// не нашли) — кулдаун добычи + провал ступени: следующий клик в течение
/// минуты не тянет бандлы заново.
async fn sc_scrape_client_id<F, Fut>(
    state: &EngineState,
    call: &mut F,
) -> Result<String, SoundcloudFail>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<(u16, String), String>>,
{
    if sc_cid_recently_failed(state, SystemTime::now()) {
        return Err(SoundcloudFail::ClientId("кулдаун добычи client_id".into()));
    }
    let (status, html) = match call("https://soundcloud.com/".to_string()).await {
        Ok(pair) => pair,
        Err(e) => return Err(sc_cid_fail(state, format!("главная не загрузилась: {e}"))),
    };
    if status != 200 {
        return Err(sc_cid_fail(state, format!("главная: статус {status}")));
    }
    let bundles = sc_bundle_urls(&html);
    if bundles.is_empty() {
        return Err(sc_cid_fail(
            state,
            "на главной нет JS-бандлов a-v2.sndcdn.com".into(),
        ));
    }
    for bundle in bundles.iter().rev().take(SOUNDCLOUD_CID_BUNDLE_SCAN_MAX) {
        let (status, js) = match call(bundle.clone()).await {
            Ok(pair) => pair,
            // сеть легла посреди сканирования — тянуть остальные бандлы
            // значит удлинять и без того больной клик, сдаёмся
            Err(e) => return Err(sc_cid_fail(state, format!("бандл не загрузился: {e}"))),
        };
        if status != 200 {
            return Err(sc_cid_fail(state, format!("бандл: статус {status}")));
        }
        if let Some(id) = sc_client_id_from_js(&js) {
            sc_note_client_id(state, &id, SystemTime::now());
            return Ok(id);
        }
    }
    Err(sc_cid_fail(state, "client_id не найден в бандлах".into()))
}

/// Оркестрация SC-ступени с инъекцией транспорта (тестируется без сети):
/// call — GET url → (статус, тело), probe — GET c Range: bytes=0-0 → total
/// из Content-Range (~1 RTT; transcodings contentLength не отдают, а без
/// точного размера не построить явный Range в fetch_to_cache).
///  1) client_id: из состояния, иначе добыча из бандлов;
///  2) 401/403 на api-v2 = client_id протух: сброс + ОДНА передобыча +
///     повтор, и только если передобытый id ДРУГОЙ (образец — visitorData);
///  3) выбор progressive-транскодинга → GET transcoding.url → CDN-URL;
///  4) синтаксическая граница до пробы, затем проба размера.
///
/// timings — пофазовые отметки шагов ступени (sc_client_id, sc_api_v2,
/// sc_transcoding, sc_m3u8, sc_probe). Копятся И НА ПРОВАЛЬНОМ ПУТИ: провал
/// ступени 0 стоит времени ровно так же, как удача, и без его цены непонятно,
/// почему клик с уходом на лестницу дороже обычного.
async fn resolve_via_soundcloud_with<F, Fut, P, PFut>(
    state: &EngineState,
    canonical: &Url,
    timings: &mut Timings,
    mut call: F,
    // ⚠️ НЕ ИСПОЛЬЗУЕТСЯ с 13.08 — проба размера снята (см. комментарий у
    // возврата progressive-ветки ниже). Параметр и sc_http_probe оставлены
    // НАМЕРЕННО: правка помечена как опровергаемая (растёт first_chunk_wait →
    // CDN троттлит бесдиапазонный GET), и откат должен стоить одну строку, а
    // не восстановление обвязки с тестами.
    _probe: P,
) -> Result<SoundcloudFormat, SoundcloudFail>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<(u16, String), String>>,
    P: FnMut(String) -> PFut,
    PFut: std::future::Future<Output = Result<u64, String>>,
{
    let cached = sc_cached_client_id(state, SystemTime::now());
    let was_cached = cached.is_some();
    let mut client_id = match cached {
        // Метки sc_client_id НЕТ, когда ключ взят из состояния, — и это сам по
        // себе ответ на вопрос «сколько стоит client_id»: обычно нисколько
        // (TTL 7 суток + персист), а видно это по отсутствию строки.
        Some(id) => id,
        None => {
            timings
                .measure("sc_client_id", sc_scrape_client_id(state, &mut call))
                .await?
        }
    };

    let (status, body) = timings
        .measure("sc_api_v2", call(sc_api_lookup_url(canonical, &client_id)))
        .await
        .map_err(SoundcloudFail::Other)?;
    let track_body = match status {
        200 => body,
        // Протухший client_id — единственный лечимый отказ; свежедобытому
        // id 401 не лечится повтором (передобыча вернёт его же).
        401 | 403 if was_cached => {
            sc_drop_client_id(state);
            // Повтор метится ТЕМИ ЖЕ метками, а не «_retry»: обе строки
            // доезжают до журнала, и лечение протухшего ключа видно как
            // удвоение шага — то есть как цена, а не как отдельный случай.
            let fresh = timings
                .measure("sc_client_id", sc_scrape_client_id(state, &mut call))
                .await?;
            if fresh == client_id {
                return Err(SoundcloudFail::Other(format!(
                    "api-v2: статус {status}, передобытый client_id тот же — повтор бессмыслен"
                )));
            }
            client_id = fresh;
            let (status2, body2) = timings
                .measure("sc_api_v2", call(sc_api_lookup_url(canonical, &client_id)))
                .await
                .map_err(SoundcloudFail::Other)?;
            if status2 != 200 {
                return Err(SoundcloudFail::Other(format!(
                    "api-v2 после передобычи: статус {status2}"
                )));
            }
            body2
        }
        other => return Err(SoundcloudFail::Other(format!("api-v2: статус {other}"))),
    };
    let track: serde_json::Value = serde_json::from_str(&track_body)
        .map_err(|e| SoundcloudFail::Other(format!("ответ api-v2 не JSON: {e}")))?;
    let picked = sc_pick_transcoding(&track)?;
    let ext = picked.ext;

    let with_id = sc_with_client_id(&picked.url, &client_id).map_err(SoundcloudFail::Other)?;
    let (status, body) = timings
        .measure("sc_transcoding", call(with_id))
        .await
        .map_err(SoundcloudFail::Other)?;
    if status != 200 {
        return Err(SoundcloudFail::Other(format!("transcoding: статус {status}")));
    }
    let payload: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| SoundcloudFail::Other(format!("ответ transcoding не JSON: {e}")))?;
    let cdn_url = payload["url"]
        .as_str()
        .filter(|u| !u.is_empty())
        .ok_or_else(|| SoundcloudFail::Other("ответ transcoding без url".into()))?
        .to_string();

    // Синтаксическая граница ДО пробы (https/credentials/IP-литерал): DNS-часть
    // проверит soundcloud_warm_entry в боевой обёртке, здесь она пропущена.
    validate_warm_url_with_lookup(&cdn_url, &mut |_, _| Ok(Vec::new()))
        .map_err(SoundcloudFail::Other)?;

    // AAC HLS: по cdn_url лежит манифест, а не аудио — Range-проба размера
    // здесь бессмысленна, состав и объём собираются из сегментов (отчёт H).
    if picked.protocol == ScProtocol::HlsAac {
        // Метка на ВЕСЬ разбор плейлиста, а не на голый GET внутри него:
        // спрашивают «во что обошёлся HLS», а там одна сетевая ходка плюс
        // разбор текста — дробить не на что, зато замер не лезет внутрь.
        return timings
            .measure("sc_m3u8", sc_resolve_hls(&picked, &track, cdn_url, &mut call))
            .await;
    }

    // ⚠️ ПРОБА РАЗМЕРА СНЯТА (13.08). Прошлая сессия пометила её словами
    // «лишний RTT перед закачкой, сначала цифра, потом решение» — цифра
    // пришла с живого замера владельца: sc_probe = 745 мс из 3091 мс всего
    // пути «клик → звук», почти четверть, на холодном progressive-треке.
    //
    // Почему её можно снять без потери гарантий: НАСТОЯЩИЙ размер всё равно
    // берётся из заголовков ответа самой закачки (206 → Content-Range, 200 →
    // Content-Length, см. fetch_to_cache), там же проверяется лимит
    // содержимого, и там же total правится до первого записанного байта.
    // Проба узнавала ровно то, что через мгновение и так приезжает.
    //
    // ⚠️ Единственное, ради чего она была нужна, — явный `Range: bytes=0-N`.
    // Но требование явного Range — это замер GOOGLEVIDEO («обычный GET
    // троттлится до 32 КБ/с», 2026-07-15), и к CDN SoundCloud он никогда не
    // проверялся. Поэтому размер здесь честно объявляется НЕИЗВЕСТНЫМ (0 —
    // принятое в движке обозначение, ср. GrowingSource::byte_len), а
    // fetch_to_cache на неизвестном размере шлёт обычный GET.
    //
    // ⚠️ КАК ОПРОВЕРГНУТЬ, если я неправ: в телеметрии пропадает sc_probe, но
    // растёт first_chunk_wait — значит CDN SoundCloud троттлит бесдиапазонный
    // GET, и пробу надо вернуть. Размен виден в тех же замерах, гадать не
    // придётся.
    Ok(SoundcloudFormat {
        url: cdn_url,
        size: 0,
        ext: ext.to_string(),
        segments: Vec::new(),
    })
}

/// Оценка размера AAC HLS до закачки: длительность трека × битрейт пресета.
/// Нужна только лимиту содержимого и прогрессу — настоящий размер известен
/// после склейки. Нет duration в ответе api-v2 — считаем по числу сегментов
/// (SC режет по ~10с, см. EXT-X-TARGETDURATION живого плейлиста).
fn sc_hls_estimated_size(duration_ms: u64, kbps: u32, segments: usize) -> u64 {
    let seconds = if duration_ms > 0 {
        duration_ms / 1000
    } else {
        (segments as u64) * 10
    };
    seconds.saturating_mul(u64::from(kbps) * 1000 / 8)
}

/// Разбор AAC HLS в список кусков: GET манифеста → sc_parse_m3u8 → init
/// первым, дальше сегменты по порядку. Каждый кусок проходит ту же
/// синтаксическую границу, что и прямой CDN-URL: манифест приходит из сети и
/// доверять его ссылкам нельзя (SSRF — подписанный URL не значит безопасный).
async fn sc_resolve_hls<F, Fut>(
    picked: &ScTranscoding,
    track: &serde_json::Value,
    playlist_url: String,
    call: &mut F,
) -> Result<SoundcloudFormat, SoundcloudFail>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<(u16, String), String>>,
{
    let (status, text) = call(playlist_url.clone())
        .await
        .map_err(SoundcloudFail::Other)?;
    if status != 200 {
        return Err(SoundcloudFail::Other(format!(
            "медиаплейлист SC: статус {status}"
        )));
    }
    let base = Url::parse(&playlist_url)
        .map_err(|e| SoundcloudFail::Other(format!("url медиаплейлиста не разбирается: {e}")))?;
    let playlist = sc_parse_m3u8(&text, &base)?;
    // fMP4 без init не играет: в сегментах нет ни ftyp, ни moov. Живой SC
    // init отдаёт всегда — его отсутствие означает другой формат, и лучше
    // уступить лестнице, чем положить в кэш неиграбельный файл.
    let init = playlist.init.ok_or_else(|| {
        SoundcloudFail::Other("медиаплейлист SC без init-сегмента (#EXT-X-MAP)".into())
    })?;

    // Потолок длины (живой прогон 27.07): двухчасовой микс отдал 733 сегмента
    // по ~10с. Ступень 0 качает их ПОСЛЕДОВАТЕЛЬНО — на таком треке это
    // сотни рукопожатий подряд, то есть медленнее запасной дороги, где
    // yt-dlp тянет фрагменты конкурентно. Ступень 0 — быстрый путь, а не
    // универсальный: длинное честно уступаем лестнице.
    if playlist.segments.len() > SC_HLS_MAX_SEGMENTS {
        return Err(SoundcloudFail::Other(format!(
            "AAC HLS слишком длинный для последовательной сборки ({} сегментов) — запасная дорога",
            playlist.segments.len()
        )));
    }

    let mut segments = Vec::with_capacity(playlist.segments.len() + 1);
    segments.push(init);
    segments.extend(playlist.segments);
    for segment in &segments {
        validate_warm_url_with_lookup(segment, &mut |_, _| Ok(Vec::new()))
            .map_err(SoundcloudFail::Other)?;
    }

    let size = sc_hls_estimated_size(
        track["duration"].as_u64().unwrap_or(0),
        picked.kbps,
        segments.len().saturating_sub(1),
    );
    Ok(SoundcloudFormat {
        url: playlist_url,
        size,
        ext: picked.ext.to_string(),
        segments,
    })
}

/// Сетевой GET SC-ступени: текст/JSON отдаём строкой вместе со статусом —
/// 401/403 разбирает оркестрация (см. resolve_via_soundcloud_with).
async fn sc_http_get(url: String) -> Result<(u16, String), String> {
    let resp = warm_http_client()
        .get(&url)
        .header("User-Agent", SOUNDCLOUD_UA)
        .timeout(SOUNDCLOUD_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("GET не ушёл: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| format!("чтение тела: {e}"))?;
    Ok((status, body))
}

/// Проба размера: GET с Range: bytes=0-0, total — из Content-Range 206-ответа
/// (parse_content_range — тот же разборщик, что у fetch_to_cache).
async fn sc_http_probe(url: String) -> Result<u64, String> {
    let resp = warm_http_client()
        .get(&url)
        .header("User-Agent", SOUNDCLOUD_UA)
        .header("Range", "bytes=0-0")
        .timeout(SOUNDCLOUD_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("Range-проба не ушла: {e}"))?;
    let status = resp.status().as_u16();
    if status != 206 {
        return Err(format!("Range-проба: статус {status}"));
    }
    resp.headers()
        .get("Content-Range")
        .and_then(|v| v.to_str().ok())
        .and_then(parse_content_range)
        .map(|(_end, total)| total)
        .ok_or_else(|| "206 без разборчивого Content-Range".to_string())
}

/// SoundcloudFormat → WarmEntry: та же граница доверия, что у прогрева
/// (validate_warm_url, лимит 512 МиБ, грамматика ext). expires_at — константа
/// SOUNDCLOUD_WARM_TTL, а не разбор подписанных query-параметров sndcdn.
fn soundcloud_warm_entry_with_lookup(
    fmt: &SoundcloudFormat,
    now: SystemTime,
    lookup: &mut impl FnMut(&str, u16) -> LookupResult,
) -> Result<WarmEntry, String> {
    // ⚠️ РЕГРЕССИЯ 13.08, поймана живым замером владельца. Проверок лимита
    // ДВЕ — здесь и в fetch_to_cache, — а сняв пробу размера, я починил только
    // вторую. content_length_ok(0) = false, поэтому вся ступень 0 SoundCloud
    // падала на ровном месте, клиент уходил в лестницу yt-dlp, и «клик → звук»
    // вырос с 3.1 с до 6.9 с. Ноль здесь — «размер НЕИЗВЕСТЕН», а не «нулевой
    // файл»; реальный лимит проверяется по заголовкам ответа и по счётчику
    // записанных байт, оба ниже по пути.
    if fmt.size > 0 && !content_length_ok(fmt.size) {
        return Err(format!("sc-размер вне лимита: {}", fmt.size));
    }
    if !valid_warm_ext(&fmt.ext) {
        return Err(format!("подозрительное расширение: {:?}", fmt.ext));
    }
    let url = validate_warm_url_with_lookup(&fmt.url, lookup)?;
    // Сегменты HLS проходят ту же границу доверия, что и прямой URL, но
    // полный DNS-preflight делается на КАЖДЫЙ НОВЫЙ хост, а не на каждый
    // кусок: у живого плейлиста все десятки сегментов лежат на одном CDN, и
    // getaddrinfo per-segment встал бы прямо в путь «клик → звук».
    let mut hls_segments = Vec::with_capacity(fmt.segments.len());
    let mut checked_host: Option<String> = None;
    for raw in &fmt.segments {
        let host = Url::parse(raw)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .ok_or_else(|| format!("сегмент без разборчивого хоста: {raw}"))?;
        if checked_host.as_deref() != Some(host.as_str()) {
            validate_warm_url_with_lookup(raw, lookup)?;
            checked_host = Some(host);
        }
        hls_segments.push(raw.clone());
    }
    Ok(WarmEntry {
        url,
        size: fmt.size,
        ext: fmt.ext.clone(),
        provider: "soundcloud".into(),
        expires_at: now + SOUNDCLOUD_WARM_TTL,
        hls_segments,
    })
}

fn soundcloud_warm_entry(fmt: &SoundcloudFormat, now: SystemTime) -> Result<WarmEntry, String> {
    let mut lookup = |host: &str, port: u16| {
        debug_assert_eq!(port, 443);
        (host, 443)
            .to_socket_addrs()
            .map(|answers| answers.map(|answer| answer.ip()).collect())
            .map_err(|error| format!("DNS lookup failed: {error}"))
    };
    soundcloud_warm_entry_with_lookup(fmt, now, &mut lookup)
}

/// Боевая SC-ступень целиком: api-v2 → progressive → CDN-URL → проба →
/// WarmEntry той же формы, что у прогрева. Err любого класса = «молча уступи
/// лестнице» у вызывающего.
async fn resolve_via_soundcloud(
    state: &EngineState,
    canonical: &Url,
    timings: &mut Timings,
) -> Result<WarmEntry, SoundcloudFail> {
    let fmt =
        resolve_via_soundcloud_with(state, canonical, timings, sc_http_get, sc_http_probe).await?;
    // Видимость доли HLS в диагностике: раньше эта ветка была отказом ступени
    // («только AAC HLS — качаем запасной дорогой»), теперь — рабочий путь.
    if !fmt.segments.is_empty() {
        stage0_log(
            state,
            SystemTime::now(),
            format!(
                "SoundCloud отдал только AAC HLS — скачиваем сегментами ({} шт.)",
                fmt.segments.len()
            ),
        );
    }
    // DNS-preflight validate_warm_url — блокирующий getaddrinfo: с async-
    // рантайма его уводит spawn_blocking (как и у InnerTube-ступени).
    tauri::async_runtime::spawn_blocking(move || soundcloud_warm_entry(&fmt, SystemTime::now()))
        .await
        .map_err(|e| SoundcloudFail::Other(format!("spawn_blocking: {e}")))?
        .map_err(SoundcloudFail::Other)
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
    signal: Option<String>,
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

    // Ступень 0 SoundCloud (2026-07-19): прогрев ведущего SC-источника прямым
    // api-v2 — раньше SC грелся только процессом yt-dlp. Breaker и кулдаун
    // ниже — про InnerTube/бот-гейт YouTube, SC ими не гейтится; у SC свои
    // предохранители — негативный кэш "sc:" и кулдаун добычи client_id.
    // Провал молча уступает yt-dlp --simulate ниже.
    if let Some((source_id, canonical)) = stage0_soundcloud_ref(&sources) {
        let sc_key = format!("sc:{source_id}");
        if !stage0_recently_failed(&state, &sc_key, SystemTime::now()) {
            // Отметки прогрева уходят в никуда НАМЕРЕННО: журнал стартов мерит
            // «клик → звук», а прогрев случается до клика и в чужом окне
            // времени — приписать его фазы какому-то старту было бы враньём.
            match resolve_via_soundcloud(&state, &canonical, &mut Timings::default()).await {
                Ok(entry) => {
                    stage0_note_success(&state, &sc_key);
                    store_warm_entry(&state, &cache_ns, &track_id, entry);
                    return Ok(WarmOut {
                        warm: true,
                        cached: false,
                    });
                }
                Err(e) => stage0_note_sc_fail(&state, &sc_key, &e, SystemTime::now()),
            }
        }
    }

    // Ступень 0 (2026-07-19): прогрев тем же прямым InnerTube-резолвом —
    // ~171 мс вместо ~2–4 с процесса yt-dlp (дешёвый прогрев = можно греть
    // смелее). Провал молча уступает yt-dlp --simulate ниже; счётчики KPI
    // прогрев не трогает (см. док-коммент команды).
    let cooling = stage0_in_cooldown(&state, SystemTime::now());
    if cooling && signal.as_deref() == Some("visible") {
        // Кулдаун breaker'а = бот-гейт/сеть лежит. Массовый visible-прогрев
        // (каждая видимая строка списка) не имеет права доваливаться в
        // yt-dlp simulate: 2 параллельных процесса непрерывно, пока
        // скроллится список, — CPU-лавина, из-за которой «тормозит всё»
        // (2026-07-19). hover/queue — единичные сигналы намерения, им
        // simulate ниже разрешён.
        return Ok(WarmOut {
            warm: false,
            cached: false,
        });
    }
    let innertube_cfg = innertube_from_recipe(&state.recipe.lock().unwrap());
    if let Some(cfg) = innertube_cfg {
        if let Some(video_id) = stage0_youtube_id(&sources) {
            if cooling || stage0_recently_failed(&state, &video_id, SystemTime::now()) {
                // кулдаун или свежий провал — не дёргаем POST,
                // сразу simulate-ветка ниже
            } else {
                let itags = if quality.as_deref() == Some("econom") {
                    INNERTUBE_ITAGS_ECONOM
                } else {
                    INNERTUBE_ITAGS_DEFAULT
                };
                match resolve_via_innertube(&state, &cfg, &video_id, itags).await {
                    Ok(entry) => {
                        stage0_note_success(&state, &video_id);
                        stage0_breaker_note_success(&state);
                        store_warm_entry(&state, &cache_ns, &track_id, entry);
                        return Ok(WarmOut {
                            warm: true,
                            cached: false,
                        });
                    }
                    // счётчики KPI прогрев не трогает (см. док-коммент
                    // команды) — но негативный кэш и breaker общие: лавина
                    // идёт именно из прогрева
                    Err(fail) => {
                        stage0_note_fail(&state, &video_id, SystemTime::now());
                        stage0_breaker_note_fail(&state, &fail, SystemTime::now());
                    }
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
    // Бюджет всей лестницы прогрева: он держит single-flight-гейт трека, и
    // клик по той же строке стоит за ним в очереди (аудит 2026-08-02).
    let ladder_started = Instant::now();
    for attempt in attempts {
        let Some(left) = ladder_remaining(ladder_started, WARM_LADDER_BUDGET) else {
            last_error = format!(
                "бюджет прогрева ({}с) исчерпан; последняя ошибка: {last_error}",
                WARM_LADDER_BUDGET.as_secs()
            );
            break;
        };
        let attempt_timeout = left.min(SIMULATE_TIMEOUT);
        let fmt = format_str.clone();
        let ytdlp_clone = sidecars.ytdlp.clone();
        let deno_clone = sidecars.deno.clone();
        let attempt_provider = attempt.provider.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            run_ytdlp_simulate(&ytdlp_clone, &deno_clone, &attempt, &fmt, attempt_timeout)
        })
        .await
        .map_err(|e| format!("spawn_blocking: {e}"))?;

        match result {
            Ok(sim) => {
                if !content_length_ok(sim.size) {
                    last_error = format!("warm-размер вне лимита: {}", sim.size);
                    continue;
                }
                // DNS-preflight — блокирующий getaddrinfo, с async-рантайма
                // уводится в spawn_blocking (как build_attempts лестницы)
                let sim_url = sim.url.clone();
                let validated =
                    tauri::async_runtime::spawn_blocking(move || validate_warm_url(&sim_url))
                        .await
                        .map_err(|e| format!("spawn_blocking: {e}"));
                let url = match validated {
                    Ok(Ok(url)) => url,
                    Ok(Err(e)) | Err(e) => {
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
                    hls_segments: Vec::new(),
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
/// на фронте не медленнее. Было 15с (2026-07-19 → 8с): первые 128 КиБ дольше
/// 8с = CDN нездоров, лестница выгоднее, чем ожидание.
const STREAM_START_TIMEOUT: Duration = Duration::from_secs(8);
/// Сколько handler ждёт байты одного чанка (закачка обычно опережает
/// playback на порядок; ожидание дольше значит закачка умерла).
const STREAM_CHUNK_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Serialize)]
pub struct StreamStartOut {
    /// true — закачка идёт и первые килобайты уже на диске: фронт может
    /// отдавать <audio> stream-URL. false — стрим не нужен/недоступен
    /// (файл уже в кэше, warm-записи нет, закачка не завелась) — фронт
    /// молча идёт обычным путём. Ошибок наружу нет НАМЕРЕННО: стрим —
    /// best-effort, любой провал обязан выглядеть как «играй как раньше».
    pub stream: bool,
    /// Пофазовые отметки добычи (см. Timings). Отдаются И ПРИ stream:false —
    /// именно этот случай самый дорогой: ступень 0 отработала, стрим не
    /// завёлся, фронт пошёл лестницей. Без отметок эта работа невидима.
    pub timings: Vec<(String, u32)>,
}

/// Отказ от стрима «фронт идёт как раньше», но с уже собранными отметками:
/// выходов из engine_stream_start семь, и каждый обязан донести цену работы,
/// сделанной ДО отказа. Раньше здесь лежало одно готовое значение
/// `StreamStartOut { stream: false }` — с отметками так уже нельзя, они
/// накапливаются по пути.
fn stream_declined(timings: &mut Timings) -> Result<StreamStartOut, String> {
    Ok(StreamStartOut {
        stream: false,
        timings: timings.take(),
    })
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
    let mut timings = Timings::default();

    // уже стримится (повторный клик по треку) — подхватываем тот же канал
    let existing = state.streams.lock().unwrap().get(&key).cloned();
    // is_hls едет из ветки-создателя наружу: голову склейки надо проверить
    // ПОСЛЕ подтверждения первого чанка, а `entry` к тому моменту уже уехал в
    // задачу закачки. У подхваченного стрима флаг false — его голову проверили
    // при старте, второй раз незачем.
    let (handle, is_hls) = if let Some(handle) = existing {
        (handle, false)
    } else {
        if find_cached(&dir, &track_id).is_some() {
            return stream_declined(&mut timings); // кэш-хит быстрее обычным путём
        }
        // Прогрет — метаданные уже есть. Нет — добываем их ступенью 0 прямо
        // здесь: она быстрая (~0.75с) и не требует yt-dlp, а дальше звук идёт
        // с первых килобайт. Провал ступени 0 (SABR/бот-гейт/UNPLAYABLE/не
        // youtube) — молча no_stream: фронт уйдёт обычной лестницей, как
        // раньше. Единственная дисциплина стрима: он не имеет права сделать
        // трек неиграбельным.
        let warm_started = Instant::now();
        let warm = take_live_warm_entry(&state, &cache_ns, &track_id, SystemTime::now());
        let entry = match warm {
            Some(entry) => {
                // Метка по РЕЗУЛЬТАТУ, а не вокруг вызова (см. Timings::since):
                // у промаха измерять нечего — работа впереди, а не позади, и
                // она уже помечена своими метками ступени 0.
                timings.since("warm_hit", warm_started);
                entry
            }
            // Ступень 0 SoundCloud (2026-07-19): ведущий SC-источник резолвится
            // прямым api-v2 (~1–2 с до звука вместо 5–6 с ожидания полной
            // закачки yt-dlp — владелец слушает в основном SC, жалоба 19.07),
            // дальше тот же стрим с первых 128 КиБ. Breaker InnerTube SC не
            // гейтит; свой предохранитель — негативный кэш "sc:<source_id>".
            None if matches!(sources.first(), Some(SourceRef::Soundcloud { .. })) => {
                let Some((source_id, canonical)) = stage0_soundcloud_ref(&sources) else {
                    return stream_declined(&mut timings); // кривой canonical_url — лестница
                };
                let sc_key = format!("sc:{source_id}");
                if stage0_recently_failed(&state, &sc_key, SystemTime::now()) {
                    return stream_declined(&mut timings); // провал уже оплачен — лестница
                }
                // Своей метки у ступени нет НАРОЧНО: её шаги метит сама
                // resolve_via_soundcloud, а «итого» фронт сложит сам — общая
                // метка поверх слагаемых только сбивала бы с толку.
                // Результат — в переменную до match (см. ⚠️ в engine_resolve).
                let resolved = resolve_via_soundcloud(&state, &canonical, &mut timings).await;
                match resolved {
                    Ok(entry) => {
                        stage0_note_success(&state, &sc_key);
                        entry
                    }
                    Err(e) => {
                        stage0_note_sc_fail(&state, &sc_key, &e, SystemTime::now());
                        return stream_declined(&mut timings);
                    }
                }
            }
            None => {
                let cfg = innertube_from_recipe(&state.recipe.lock().unwrap());
                let (Some(cfg), Some(video_id)) = (cfg, stage0_youtube_id(&sources)) else {
                    return stream_declined(&mut timings);
                };
                let now = SystemTime::now();
                if stage0_recently_failed(&state, &video_id, now) || stage0_in_cooldown(&state, now)
                {
                    // провал уже оплачен / бот-гейт лежит — лестница
                    return stream_declined(&mut timings);
                }
                let itags = if quality.as_deref() == Some("econom") {
                    INNERTUBE_ITAGS_ECONOM
                } else {
                    INNERTUBE_ITAGS_DEFAULT
                };
                // Ступень 0 YouTube — один POST /player, дробить внутри нечего:
                // метка на весь вызов и есть его цена. Результат — в переменную
                // до match (см. ⚠️ в engine_resolve).
                let resolved = timings
                    .measure(
                        "yt_innertube",
                        resolve_via_innertube(&state, &cfg, &video_id, itags),
                    )
                    .await;
                match resolved {
                    Ok(entry) => {
                        stage0_note_success(&state, &video_id);
                        stage0_breaker_note_success(&state);
                        entry
                    }
                    Err(fail) => {
                        classify_innertube_failure(&mut state.stats.lock().unwrap(), &fail);
                        stage0_note_fail(&state, &video_id, SystemTime::now());
                        stage0_breaker_note_fail(&state, &fail, SystemTime::now());
                        return stream_declined(&mut timings);
                    }
                }
            }
        };
        // Склейка HLS — фрагментированный mp4, и её `moov` лежит В НАЧАЛЕ
        // (init-сегмент `#EXT-X-MAP` пишется первым). Это ровно тот случай,
        // на который ссылалась оговорка отказа ниже, — поэтому HLS через
        // гейт проходит, а сырой MP4 по-прежнему нет. Флаг снимаем ДО
        // spawn'а: `entry` уезжает в задачу закачки по значению.
        let is_hls = !entry.hls_segments.is_empty();
        // Сырой MP4/AAC (m4a) НЕ стримится с первых байт (отчёт J, И3
        // 2026-07-22): индекс-атом moov лежит В КОНЦЕ файла, Chromium не
        // начинает декод, пока не получит его целиком, — «стрим» такого файла
        // молчал бы до конца закачки, держа UI в состоянии «играет». Opus/webm
        // и mp3 декодируются с первых килобайт. Такой m4a честно уходит
        // no_stream — обычная дорога докачает файл и заиграет из кэша.
        //
        // ⚠️ HLS СЮДА НЕ ПОПАДАЕТ (2026-08-13). Раньше условие смотрело только
        // на расширение, а у SoundCloud AAC HLS ext ровно "m4a" — значит КАЖДЫЙ
        // холодный SC-трек уходил мимо стрима и ждал сборки ВСЕГО файла, хотя
        // играбельность его головы доказана (hls_head_looks_playable, отчёт H:
        // «ftyp iso5 → moov в начале, Chromium играет, ремукс не нужен»). Для
        // двухчасового микса это была разница между «звук через секунды» и
        // «звук через десятки секунд». Голова всё равно проверяется — ниже, по
        // первому чанку, до того как фронт получит добро.
        if entry.ext == "m4a" && !is_hls {
            // ⚠️ ЗАПИСЬ ОБЯЗАНА ВЕРНУТЬСЯ В РЕЕСТР (2026-08-05). take_live_warm_entry
            // читает РАЗРУШАЮЩЕ, а этот выход отказывается только от СТРИМА, не от
            // добытого адреса: ступень 0 отработала, url и размер на руках. Без
            // возврата engine_resolve ТОГО ЖЕ КЛИКА не находил ни warm-записи, ни
            // живого стрима и проходил ступень 0 ЗАНОВО — второй полный круг
            // client_id → api-v2 → transcoding.
            //
            // И это не редкий случай, а ОСНОВНОЙ: SoundCloud отдаёт AAC HLS, у
            // которого ext ровно "m4a" (sc_ext_from_mime → audio/mp4|audio/aac), а
            // progressive из выдачи api-v2 вычищен (см. sc_pick_transcoding). То
            // есть удвоение платил каждый холодный SC-трек, а владелец слушает в
            // основном SoundCloud. Негативный кэш stage0_recently_failed здесь не
            // помогал по построению: ступень 0 не провалилась, она УСПЕЛА.
            store_warm_entry(&state, &cache_ns, &track_id, entry);
            stage0_log(
                &state,
                SystemTime::now(),
                "аудио пришло в MP4 (m4a) — играем после полной закачки (стрим для него не работает)",
            );
            return stream_declined(&mut timings);
        }
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
            cancel: Arc::new(tokio::sync::Notify::new()),
        };
        state.streams.lock().unwrap().insert(key.clone(), handle.clone());

        let app_task = app.clone();
        let ns_task = cache_ns.clone();
        let id_task = track_id.clone();
        let key_task = key.clone();
        let cancel_task = handle.cancel.clone();
        tauri::async_runtime::spawn(async move {
            let result = match cache_dir(&app_task, &ns_task) {
                Ok(dir) => {
                    fetch_to_cache_with_progress(
                        &dir,
                        &id_task,
                        &entry,
                        Some(&tx),
                        Some(&cancel_task),
                    )
                    .await
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
        (handle, is_hls)
    };

    // добро фронту — только с первыми килобайтами на диске
    let confirmed = timings
        .measure(
            "first_chunk_wait",
            tokio::time::timeout(
                STREAM_START_TIMEOUT,
                stream_wait_first_chunk(handle.progress.clone()),
            ),
        )
        .await;
    // ⚠️ ПОСЛЕДНИЙ ГЕЙТ СКЛЕЙКИ (2026-08-13, вместе со снятием запрета на HLS).
    // У прямой закачки голову проверять незачем — там байты идут как есть. У
    // HLS файл СОБИРАЕТСЯ из кусков, и битая склейка (не тот init, обрезанный
    // первый сегмент) даёт файл, который Chromium молча не играет. До сих пор
    // эту проверку делал только fetch_hls_to_cache — но ПОСЛЕ полной сборки,
    // то есть слишком поздно для стрима. Здесь она приходит вовремя: первые
    // STREAM_FIRST_CHUNK уже на диске, а «добро» фронту ещё не отдано. Провал
    // ведёт себя как любой другой незаведшийся стрим — снос закачки и уход на
    // обычную дорогу, то есть НЕ ХУЖЕ, чем было до снятия запрета.
    let hls_head_bad =
        is_hls && matches!(confirmed, Ok(true)) && !stream_hls_head_ok(&handle.part);
    match confirmed {
        Ok(true) if !hls_head_bad => Ok(StreamStartOut {
            stream: true,
            timings: timings.take(),
        }),
        _ => {
            // Первый чанк не подтвердился (таймаут или провал): сносим
            // НЕподтверждённую закачку, иначе она жила бы до RESOLVE_TIMEOUT
            // (180с), а engine_resolve ЭТОГО ЖЕ клика ждал бы её хвост вместо
            // ухода в лестницу — «клик висит минуты» (2026-07-19). Из реестра
            // удаляем ДО notify: resolve не должен подцепить умирающий handle.
            // Играющие стримы в эту ветку не попадают: stream:true сюда не
            // доходит, а повторный клик по живому стриму подтверждается
            // мгновенно (первый чанк уже на диске).
            state.streams.lock().unwrap().remove(&key);
            handle.cancel.notify_one();
            // Видимость тихого хвоста (живая поимка 22.07: 19-мин трек висел
            // «играющим» на 0:00 минуты без единой строки в журнале): фронт
            // сейчас уйдёт обычной дорогой и будет КАЧАТЬ ФАЙЛ ЦЕЛИКОМ — для
            // длинного трека это заметное ожидание, пользователь должен мочь
            // увидеть его причину в диагностике.
            stage0_log(
                &state,
                SystemTime::now(),
                if hls_head_bad {
                    // Отдельная причина: стрим успел завестись по байтам, но
                    // склейка непригодна — путать это с таймаутом нельзя,
                    // лечится оно совсем другим.
                    "склейка HLS не похожа на fMP4 — стрим отменён, трек играем обычной дорогой"
                        .to_string()
                } else {
                    format!(
                        "стрим не завёлся за {}с — трек докачивается целиком, запасной дорогой (это дольше)",
                        STREAM_START_TIMEOUT.as_secs()
                    )
                },
            );
            stream_declined(&mut timings)
        }
    }
}

/// Играбельна ли голова УЖЕ НАЧАТОЙ склейки HLS. Тот же критерий, что у
/// финальной проверки в `fetch_hls_to_cache` (`hls_head_looks_playable`), но
/// применённый к недописанному `.part`: к моменту вызова на диске лежат
/// init-сегмент и первые медиа-куски, а `ftyp`/`moov` живут именно в init —
/// значит вердикт уже окончательный и ждать конца сборки незачем.
///
/// Ошибка чтения трактуется как «непригодна»: файл обязан существовать (первый
/// чанк подтверждён), и если его не прочесть — это отказ, а не повод рискнуть
/// молчащим плеером.
fn stream_hls_head_ok(part: &Path) -> bool {
    matches!(hls_part_head(part), Ok(head) if hls_head_looks_playable(&head))
}

/// Ожидание подтверждения стрима: первые STREAM_FIRST_CHUNK (или весь файл,
/// если он меньше) на диске → true; провал закачки → false. Потолок времени —
/// у вызывающего (tokio::time::timeout), поэтому хелпер честно ждёт вечно.
async fn stream_wait_first_chunk(
    mut rx: tokio::sync::watch::Receiver<StreamProgress>,
) -> bool {
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
    // Только dev: релиз собирается с windows_subsystem = "windows" (main.rs:1) —
    // консоли нет, показать эту строку физически негде, а печатается она на
    // КАЖДЫЙ Range-запрос играющего трека (аллокация имени файла + мьютекс
    // stderr всё время воспроизведения). В `pnpm desktop` трасса окон стрима
    // остаётся байт-в-байт прежней — это единственный след Range-запросов.
    #[cfg(debug_assertions)]
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
    let mut timings = Timings::default();

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
            // добывать не пришлось — мерить нечего, и пустой список это и значит
            timings: timings.take(),
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
                // байты добыл стрим, и его фазы уже уехали ответом
                // engine_stream_start того же клика — не дублируем
                timings: timings.take(),
            });
        }
    }

    // Быстрый путь прогрева (Фаза 1): метаданные уже разрешены engine_warm —
    // вместо процесса yt-dlp остаётся один GET (~4.5с → ~1.2с). Любая ошибка
    // (URL протух, CDN отказал, размер не сошёлся) — запись уже выброшена
    // самим take, молча падаем на обычную лестницу ниже: прогрев не имеет
    // права сделать трек неиграбельным.
    let warm_started = Instant::now();
    if let Some(entry) = take_live_warm_entry(&state, &cache_ns, &track_id, SystemTime::now()) {
        // Метка по РЕЗУЛЬТАТУ (см. Timings::since): у промаха измерять нечего.
        timings.since("warm_hit", warm_started);
        // ⚠️ САМАЯ ДОРОГАЯ ФАЗА — ИМЕННО ЭТА. `warm_hit` меряет взятие записи из
        // HashMap (~0 мс), а секунды, из-за которых «заметная пауза до звука»,
        // лежат в GET файла целиком: ~1.2 с по замерам, а у SC AAC HLS это ещё и
        // последовательная сборка сегментов. Без метки сумма фаз объясняла ~0 %
        // от urlMs, и строка `warm_hit=0` рядом с `urlMs=1200` читалась как «шаг
        // бесплатен». let-перед-if — тот же заём timings, что и ниже в match.
        let fetched = timings.measure("fetch", fetch_to_cache(&dir, &track_id, &entry)).await;
        if let Ok(path) = fetched {
            let limit = *state.cache_limit_bytes.lock().unwrap();
            ensure_pins_loaded(&app, &state, &cache_ns);
            let pins = state.pins.lock().unwrap().clone();
            evict_lru(&dir, limit, &path, &pins);
            state.stats.lock().unwrap().resolve_ok += 1;
            return Ok(ResolveOut {
                path: path.to_string_lossy().into_owned(),
                from_cache: false,
                provider: Some(entry.provider),
                timings: timings.take(),
            });
        }
    }

    // Ступень 0 SoundCloud (2026-07-19): ведущий SC-источник — прямой
    // api-v2-резолв + тот же GET fetch_to_cache, что у warm-пути (~1–2 с
    // вместо 5–6 с процесса yt-dlp с полной закачкой; владелец слушает в
    // основном SC, жалоба 19.07). Дисциплина та же: любой провал МОЛЧА
    // уступает лестнице. Breaker InnerTube SC не гейтит — предохранители
    // SC свои (негативный кэш "sc:", кулдаун добычи client_id).
    if let Some((source_id, canonical)) = stage0_soundcloud_ref(&sources) {
        let sc_key = format!("sc:{source_id}");
        if !stage0_recently_failed(&state, &sc_key, SystemTime::now()) {
            // см. ⚠️ ниже про let-перед-match: заём timings обязан кончиться
            // до веток, иначе в них не собрать отметки в ответ
            let resolved = resolve_via_soundcloud(&state, &canonical, &mut timings).await;
            match resolved {
                Ok(entry) => {
                    stage0_note_success(&state, &sc_key);
                    // см. warm-путь выше: `fetch` — доминирующая фаза, и заём
                    // timings обязан кончиться до веток match
                    let fetched = timings.measure("fetch", fetch_to_cache(&dir, &track_id, &entry)).await;
                    match fetched {
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
                                timings: timings.take(),
                            });
                        }
                        // байты не доехали (URL протух/CDN отказал) — лестница;
                        // маркеры ошибки понимает существующий классификатор
                        Err(e) => classify_failure(&mut state.stats.lock().unwrap(), &e),
                    }
                }
                Err(e) => stage0_note_sc_fail(&state, &sc_key, &e, SystemTime::now()),
            }
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
            // секунду назад) или кулдаун breaker'а — не платим за тот же
            // POST/таймаут второй раз, сразу лестница ниже.
            let now = SystemTime::now();
            if stage0_recently_failed(&state, &video_id, now) || stage0_in_cooldown(&state, now) {
                // ничего: проваливаемся в лестницу
            } else {
                let itags = if quality.as_deref() == Some("econom") {
                    INNERTUBE_ITAGS_ECONOM
                } else {
                    INNERTUBE_ITAGS_DEFAULT
                };
                // ⚠️ Результат СНАЧАЛА в переменную, и только потом в match:
                // future из measure держит `&mut timings`, а временное значение
                // в СКРУТИНИИ живёт до конца всего match — внутри веток
                // timings.take() тогда не собрать. В let-выражении заём
                // кончается на точке с запятой.
                let resolved = timings
                    .measure(
                        "yt_innertube",
                        resolve_via_innertube(&state, &cfg, &video_id, itags),
                    )
                    .await;
                match resolved {
                    Ok(entry) => {
                        stage0_note_success(&state, &video_id);
                        stage0_breaker_note_success(&state);
                        // см. warm-путь выше: `fetch` — доминирующая фаза
                        let fetched =
                            timings.measure("fetch", fetch_to_cache(&dir, &track_id, &entry)).await;
                        match fetched {
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
                                    timings: timings.take(),
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
                        stage0_breaker_note_fail(&state, &fail, SystemTime::now());
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
    // Общий дедлайн лестницы (аудит 2026-08-02): потолок был только у одной
    // попытки, поэтому четыре ступени складывались в минуты молчания.
    //
    // Он же и ЗАМЕР метки ladder: заводить второй Instant рядом с этим значило
    // бы держать два таймера об одном и том же — а меряют они буквально одно,
    // «сколько шла лестница целиком». Метка ставится только на удаче: на
    // провале ответ уходит через Err, где отметкам места нет.
    let ladder_started = Instant::now();
    for attempt in attempts {
        let Some(left) = ladder_remaining(ladder_started, RESOLVE_LADDER_BUDGET) else {
            last_error = format!(
                "бюджет добычи ({}с) исчерпан; последняя ошибка: {last_error}",
                RESOLVE_LADDER_BUDGET.as_secs()
            );
            break;
        };
        let attempt_timeout = left.min(RESOLVE_TIMEOUT);
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
                attempt_timeout,
            )
        })
        .await
        .map_err(|e| format!("spawn_blocking: {e}"))?;

        match result {
            Ok(path) => {
                timings.since("ladder", ladder_started);
                let limit = *state.cache_limit_bytes.lock().unwrap();
                ensure_pins_loaded(&app, &state, &cache_ns);
                let pins = state.pins.lock().unwrap().clone();
                evict_lru(&dir, limit, &path, &pins);
                state.stats.lock().unwrap().resolve_ok += 1;
                return Ok(ResolveOut {
                    path: path.to_string_lossy().into_owned(),
                    from_cache: false,
                    provider: Some(attempt_provider),
                    timings: timings.take(),
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
            if entry_is_file(&entry) {
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
            // свежий .part — возможно, живой стрим Фазы 2 (не рвать на ходу).
            // Список закреплённых обязан пережить чистку вместе с самими
            // файлами — иначе они останутся на диске без защиты.
            if entry_is_file(&entry)
                && !is_cache_bookkeeping(&path)
                && !is_pinned(&path, &pins)
                && !is_live_stream_part(&path)
            {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(())
}

// ── Диагностика ступени 0 (2026-07-20) ────────────────────────────

/// Снимок для Настройки → Система → «Диагностика добычи».
#[derive(Serialize)]
pub struct Stage0Status {
    /// Конец кулдауна предохранителя (unix-мс), если он активен СЕЙЧАС.
    pub cooldown_until_ms: Option<u64>,
    /// Провалы подряд в счётчике breaker'а (0..THRESHOLD-1).
    pub consecutive_fails: u32,
    /// Ключ SoundCloud добыт и не протух (без него SC-треки — запасной дорогой).
    pub sc_key_ready: bool,
    /// Последние события журнала, НОВЫЕ ПЕРВЫМИ (кольцо — до 300, наружу — 50).
    pub events: Vec<Stage0Event>,
}

/// Чистая часть команды: now — параметром (тестируемость).
fn stage0_status_snapshot(state: &EngineState, now: SystemTime) -> Stage0Status {
    let (cooldown_until_ms, consecutive_fails) = {
        let b = state.stage0_breaker.lock().unwrap();
        let until = b.cooldown_until.filter(|until| now < *until).map(|until| {
            until
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0)
        });
        (until, b.consecutive_fails)
    };
    let sc_key_ready = state
        .soundcloud_client_id
        .lock()
        .unwrap()
        .as_ref()
        .map(|(_, at)| {
            now.duration_since(*at)
                .map(|age| age < SOUNDCLOUD_CLIENT_ID_TTL)
                .unwrap_or(false)
        })
        .unwrap_or(false);
    let events = state
        .stage0_events
        .lock()
        .unwrap()
        .iter()
        .rev()
        .take(50)
        .cloned()
        .collect();
    Stage0Status {
        cooldown_until_ms,
        consecutive_fails,
        sc_key_ready,
        events,
    }
}

#[tauri::command]
pub fn engine_stage0_status(state: State<'_, EngineState>) -> Stage0Status {
    stage0_status_snapshot(&state, SystemTime::now())
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
        // тот же порядок, что у боевых прогонов: канал вычитывается
        // параллельно ожиданию, иначе полный буфер вешает процесс
        let (status, out, _) = wait_capturing(&mut child, Duration::from_secs(20)).ok()?;
        if !status.success() {
            return None;
        }
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
                RESOLVE_TIMEOUT,
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

    /// `entry_is_file` обязан отвечать ровно то же, что прежний
    /// `path.is_file()`, — иначе обходы кэша начнут пропускать реальные файлы
    /// (промах кэша, повторная закачка) или чистить каталоги.
    #[test]
    fn entry_is_file_matches_path_is_file() {
        let base = ns_test_base("entrytype");
        fs::write(base.join("song.webm"), b"x").unwrap();
        fs::create_dir_all(base.join("subdir")).unwrap();
        let mut seen = 0;
        for entry in fs::read_dir(&base).unwrap().flatten() {
            let path = entry.path();
            assert_eq!(
                entry_is_file(&entry),
                path.is_file(),
                "разошлись на {}",
                path.display()
            );
            seen += 1;
        }
        assert_eq!(seen, 2, "должны быть перечислены и файл, и каталог");
    }

    /// Зачистка корня — один раз НА КАТАЛОГ за сессию (а не на каждый вызов,
    /// как было до 03.08). Второй заход по тому же base уже не подметает.
    #[test]
    fn legacy_root_swept_once_per_base() {
        let base = ns_test_base("sweep-once");
        fs::write(base.join("7.webm"), b"x").unwrap();
        namespaced_cache_dir(&base, "deadbeef").unwrap();
        assert!(!base.join("7.webm").exists(), "первый проход подметает");
        // легаси в корне может оставить только СТАРАЯ версия приложения, то
        // есть до старта процесса: файл, появившийся позже, — синтетика теста
        fs::write(base.join("8.webm"), b"x").unwrap();
        namespaced_cache_dir(&base, "deadbeef").unwrap();
        assert!(
            base.join("8.webm").exists(),
            "второй заход по тому же корню не должен читать каталог заново"
        );
        // ...а другой корень подметается независимо: ключ — путь, не процесс
        let other = ns_test_base("sweep-once-other");
        fs::write(other.join("9.webm"), b"x").unwrap();
        namespaced_cache_dir(&other, "deadbeef").unwrap();
        assert!(!other.join("9.webm").exists());
    }

    /// Быстрая проба прямых имён обязана давать РОВНО тот же путь, что полный
    /// обход, включая случай дублей stem с разными расширениями (иначе выбор
    /// начал бы зависеть от порядка CACHE_PROBE_EXTS вместо порядка read_dir).
    #[test]
    fn cache_probe_matches_full_scan() {
        let base = ns_test_base("probe");
        // дубли одного stem + незнакомое расширение + файл без расширения
        for name in ["42.webm", "42.m4a", "42.opus", "77.flac", "88"] {
            fs::write(base.join(name), b"x").unwrap();
        }
        for id in ["42", "77", "88", "zzz"] {
            assert_eq!(
                find_cached(&base, id),
                find_cached_full_scan(&base, id),
                "проба и полный обход разошлись на id={id}"
            );
        }
        // порядок проб зафиксирован: первым идёт webm (а НЕ 42.m4a, который
        // на NTFS идёт раньше по алфавиту — раньше выбирал именно read_dir)
        assert_eq!(find_cached(&base, "42"), Some(base.join("42.webm")));
        // фолбэк живой: незнакомое расширение и файл без расширения находятся
        assert_eq!(find_cached(&base, "77"), Some(base.join("77.flac")));
        assert_eq!(find_cached(&base, "88"), Some(base.join("88")));
        // знакомый контейнер выигрывает у незнакомого при том же stem
        fs::write(base.join("77.mp3"), b"x").unwrap();
        assert_eq!(find_cached(&base, "77"), Some(base.join("77.mp3")));
        assert_eq!(find_cached(&base, "77"), find_cached_full_scan(&base, "77"));
    }

    /// Полный обход в чистом виде — эталон для `cache_probe_matches_full_scan`.
    /// Тот же отбор кандидатов, что в `find_cached`, но БЕЗ быстрой пробы:
    /// именно он должен совпадать с результатом пробы.
    fn find_cached_full_scan(dir: &Path, track_id: &str) -> Option<PathBuf> {
        let mut best: Option<(usize, PathBuf)> = None;
        for entry in fs::read_dir(dir).ok()?.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.ends_with(".part") || name.ends_with(".ytdl") {
                continue;
            }
            if path
                .file_stem()
                .map(|s| s.to_string_lossy() == track_id)
                .unwrap_or(false)
            {
                let rank = cache_ext_rank(&path);
                if best.as_ref().map(|(r, _)| rank < *r).unwrap_or(true) {
                    best = Some((rank, path));
                }
            }
        }
        best.map(|(_, path)| path)
    }

    /// Проба прямым именем не имеет права строить путь из невалидированного
    /// id: `engine_pins` кормит find_cached строками из offline-pins.json,
    /// то есть с диска. Такие id идут только полным обходом.
    #[test]
    fn cache_probe_skipped_for_unvalidated_id() {
        let base = ns_test_base("probe-escape");
        let outside = base.join("наружу.webm");
        fs::write(&outside, b"x").unwrap();
        let inner = namespaced_cache_dir(&base, "deadbeef").unwrap();
        assert_eq!(
            find_cached(&inner, "../наружу"),
            None,
            "id с выходом за каталог не имеет права стать кэш-хитом"
        );
        assert!(outside.exists());
    }

    /// Живой прогон ожидания: короткий процесс ловится быстро и с правильным
    /// кодом выхода (статус по-прежнему берётся у `child.try_wait()`, а не у
    /// GetExitCodeProcess — иначе разъехался бы учёт внутри std).
    #[cfg(windows)]
    #[test]
    fn wait_with_timeout_catches_quick_child() {
        let mut child = command(Path::new("cmd"))
            .args(["/c", "exit", "7"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("cmd есть на любой Windows");
        let started = Instant::now();
        let status = wait_with_timeout(&mut child, Duration::from_secs(10)).unwrap();
        assert_eq!(status.code(), Some(7));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "завершение процесса должно ловиться сразу, а не по таймауту"
        );
    }

    /// Главный риск правки: дедлайн обязан жить. Долгий процесс с коротким
    /// бюджетом убивается ПО БЮДЖЕТУ, а не висит на хендле — иначе поток
    /// блокирующего пула держал бы single-flight-гейт трека навсегда (человек
    /// кликнул бы и не получил ни звука, ни ошибки до перезапуска).
    #[cfg(windows)]
    #[test]
    fn wait_with_timeout_kills_child_over_budget() {
        let mut child = command(Path::new("ping"))
            .args(["-n", "30", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("ping есть на любой Windows");
        let started = Instant::now();
        let err = wait_with_timeout(&mut child, Duration::from_millis(300)).unwrap_err();
        let elapsed = started.elapsed();
        assert!(err.contains("таймаут"), "ошибка бюджета: {err}");
        assert!(
            elapsed >= Duration::from_millis(250) && elapsed < Duration::from_secs(5),
            "убить обязаны около бюджета, а не через 30 с: {elapsed:?}"
        );
    }

    /// Парковка обязана РЕАЛЬНО ждать на хендле. Без этой проверки правка
    /// могла бы молча выродиться обратно в опрос со сном: WAIT_FAILED на
    /// каждом заходе тоже даёт зелёные тесты выше, только пробуждения
    /// возвращаются, а вместе с ними и «греется в фоне».
    #[cfg(windows)]
    #[test]
    fn park_on_child_actually_waits_on_handle() {
        let mut child = command(Path::new("ping"))
            .args(["-n", "5", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("ping есть на любой Windows");
        let mut broken = false;
        let started = Instant::now();
        let parked = park_on_child(&child, Duration::from_millis(200), &mut broken);
        let elapsed = started.elapsed();
        let _ = child.kill();
        let _ = child.wait();
        assert!(parked && !broken, "ожидание на хендле не сработало");
        assert!(
            elapsed >= Duration::from_millis(150),
            "заход обязан ждать ~200 мс, а не возвращаться сразу: {elapsed:?}"
        );
        assert!(elapsed < Duration::from_secs(2), "и не дольше куска: {elapsed:?}");
    }

    /// Кусок ожидания хендла процесса: НИКОГДА не 0 и никогда не INFINITE.
    #[test]
    fn wait_chunk_is_clamped() {
        assert_eq!(wait_chunk_ms(Duration::ZERO), 1);
        assert_eq!(wait_chunk_ms(Duration::from_millis(5)), 5);
        assert_eq!(wait_chunk_ms(Duration::from_millis(1000)), 1000);
        assert_eq!(wait_chunk_ms(Duration::from_secs(180)), 1000);
        // переполнение u32 (в мс это ~49 суток) — насыщаем, а не усекаем:
        // усечение могло бы дать 0xFFFFFFFF, то есть вечное ожидание
        assert_eq!(wait_chunk_ms(Duration::from_secs(60 * 60 * 24 * 365)), 1000);
        assert_eq!(wait_chunk_ms(Duration::MAX), 1000);
    }
}

#[cfg(test)]
mod warm_tests {
    use super::*;

    // ── Ожидание первого чанка стрима (К4, 2026-07-19) ─────────────
    // Раньше таймаут первого чанка просто возвращал no_stream, а закачка
    // ЖИЛА в реестре до 180с — и engine_resolve этого же клика ждал её
    // вместо ухода в лестницу («клик висит минуты»). Теперь ожидание —
    // отдельный хелпер, а ветка таймаута сносит закачку (реестр → cancel).

    fn progress_channel(
        total: u64,
    ) -> (
        tokio::sync::watch::Sender<StreamProgress>,
        tokio::sync::watch::Receiver<StreamProgress>,
    ) {
        tokio::sync::watch::channel(StreamProgress {
            written: 0,
            total,
            finalized: false,
            failed: false,
        })
    }

    /// Первые STREAM_FIRST_CHUNK на диске — подтверждение.
    #[test]
    fn stream_wait_confirms_on_first_chunk() {
        let (tx, rx) = progress_channel(10 * STREAM_FIRST_CHUNK);
        tx.send_replace(StreamProgress {
            written: STREAM_FIRST_CHUNK,
            total: 10 * STREAM_FIRST_CHUNK,
            finalized: false,
            failed: false,
        });
        assert!(tauri::async_runtime::block_on(stream_wait_first_chunk(rx)));
    }

    /// Файл меньше первого чанка — подтверждение по written >= total.
    #[test]
    fn stream_wait_confirms_small_file() {
        let (tx, rx) = progress_channel(1000);
        tx.send_replace(StreamProgress {
            written: 1000,
            total: 1000,
            finalized: false,
            failed: false,
        });
        assert!(tauri::async_runtime::block_on(stream_wait_first_chunk(rx)));
    }

    /// Провал закачки — false (фронт уходит лестницей).
    #[test]
    fn stream_wait_false_on_failure() {
        let (tx, rx) = progress_channel(10 * STREAM_FIRST_CHUNK);
        tx.send_replace(StreamProgress {
            written: 0,
            total: 10 * STREAM_FIRST_CHUNK,
            finalized: false,
            failed: true,
        });
        assert!(!tauri::async_runtime::block_on(stream_wait_first_chunk(rx)));
    }

    /// Молчащий CDN — таймаут у вызывающего срабатывает, хелпер не зависает
    /// сам по себе (ожидание отменяемо снаружи).
    #[test]
    fn stream_wait_times_out_when_sender_silent() {
        let (_tx, rx) = progress_channel(10 * STREAM_FIRST_CHUNK);
        let out = tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_millis(50), stream_wait_first_chunk(rx)).await
        });
        assert!(out.is_err(), "молчание — таймаут, не подтверждение");
    }

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
            hls_segments: Vec::new(),
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

    /// ОТКАЗ ОТ СТРИМА — НЕ ОТКАЗ ОТ АДРЕСА (регрессия 2026-08-05).
    ///
    /// engine_stream_start читает запись РАЗРУШАЮЩЕ, а на m4a отказывается
    /// только стримить: ступень 0 к этому моменту уже отработала, url и размер
    /// добыты. Пока запись не возвращалась, engine_resolve того же клика не
    /// находил ничего и проходил ступень 0 ЗАНОВО — второй полный круг
    /// client_id → api-v2 → transcoding на КАЖДОМ холодном треке SoundCloud
    /// (там AAC HLS, то есть ext ровно "m4a", а progressive из api-v2 вычищен).
    ///
    /// Проверяем сам инвариант реестра, на который опирается починка: вернули —
    /// значит следующий читатель находит. Полный путь команды тестом не
    /// покрыть — ей нужны AppHandle и сеть.
    #[test]
    fn returned_warm_entry_is_found_again() {
        let state = EngineState::default();
        let now = SystemTime::now();
        let live = now + Duration::from_secs(3600);
        store_warm_entry(&state, "ns1", "42", entry_with_expiry(live));

        let taken = take_live_warm_entry(&state, "ns1", "42", now).expect("запись была живой");
        assert!(
            !has_live_warm_entry(&state, "ns1", "42", now),
            "изъятие обязано опустошать реестр — иначе чинить было бы нечего"
        );

        // Ровно то, что делает ветка m4a: раздумали стримить — верните адрес.
        store_warm_entry(&state, "ns1", "42", taken);
        assert!(
            has_live_warm_entry(&state, "ns1", "42", now),
            "engine_resolve того же клика обязан найти адрес, а не добывать его снова"
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
                    run_ytdlp_once(
                        &sidecars.ytdlp,
                        &sidecars.deno,
                        &dir,
                        tag,
                        &attempt,
                        fmt,
                        RESOLVE_TIMEOUT,
                    )
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
                let Ok(sim) = run_ytdlp_simulate(
                    &sidecars.ytdlp,
                    &sidecars.deno,
                    &attempt,
                    fmt,
                    SIMULATE_TIMEOUT,
                )
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
                    hls_segments: Vec::new(),
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

    /// Защита «только что скачанный файл не удалять» обязана работать на
    /// РЕАЛЬНОМ пути, а не только на выдуманном. `keep` приходит с
    /// канонизацией (на Windows это префикс `\\?\`), пути обхода каталога — без
    /// неё; пока сравнивали строки, защита не срабатывала никогда, и уборка
    /// сносила свежий файл до того, как его отдадут плееру.
    #[test]
    fn evict_keeps_just_downloaded_file_even_in_canonical_form() {
        let dir = std::env::temp_dir().join(format!("muza-warm-keep-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let just_downloaded = dir.join("777.opus");
        let other = dir.join("888.opus");
        fs::write(&just_downloaded, vec![0u8; 1000]).unwrap();
        fs::write(&other, vec![0u8; 1000]).unwrap();
        // ровно то, что отдаёт validate_ytdlp_output
        let keep = fs::canonicalize(&just_downloaded).unwrap();
        evict_lru(&dir, 0, &keep, &HashSet::new());
        assert!(
            just_downloaded.exists(),
            "только что скачанный файл обязан пережить уборку"
        );
        assert!(!other.exists(), "остальное при нулевом лимите уходит");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Список закреплённых оффлайн лежит в одной папке с музыкой. Обе уборки
    /// щадят сами закреплённые файлы — но снеся список, они оставляли их без
    /// защиты, и при следующей уборке оффлайн-музыка исчезала.
    #[test]
    fn cleanups_never_delete_the_offline_pins_list() {
        let dir = std::env::temp_dir().join(format!("muza-warm-pins-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let pins_list = dir.join("offline-pins.json");
        fs::write(&pins_list, br#"["42"]"#).unwrap();
        fs::write(dir.join("42.opus"), vec![0u8; 1000]).unwrap();
        fs::write(dir.join("43.opus"), vec![0u8; 1000]).unwrap();
        let pins: HashSet<String> = ["42".to_string()].into_iter().collect();
        evict_lru(&dir, 0, &dir.join("нет-такого"), &pins);
        assert!(pins_list.exists(), "список закреплённых пережил уборку по лимиту");
        assert!(dir.join("42.opus").exists(), "закреплённый трек на месте");
        assert!(!dir.join("43.opus").exists(), "незакреплённый ушёл");
        assert!(
            is_cache_bookkeeping(&pins_list) && !is_cache_bookkeeping(&dir.join("42.opus")),
            "служебным считается только сам список"
        );
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

    // ── Видео-разбор («Сейчас играет», 2026-07-21) ────────────────

    /// Фикстура с видео нужного itag: у живой в adaptiveFormats только 313
    /// (4K VP9, сознательно вне приоритета) — патчим его в 136 (720p H.264).
    fn video_fixture(itag: u64, mime: &str) -> serde_json::Value {
        let mut raw = ok_fixture();
        let f = &mut raw["streamingData"]["adaptiveFormats"][0];
        assert!(f["mimeType"].as_str().unwrap().starts_with("video/"));
        f["itag"] = serde_json::json!(itag);
        f["mimeType"] = serde_json::json!(mime);
        raw
    }

    /// Видео-парсер берёт видео-дорожку по приоритету и отдаёт url+itag.
    #[test]
    fn video_parse_picks_h264_from_priority() {
        let raw = video_fixture(136, "video/mp4; codecs=\"avc1.4d401f\"");
        let (url, itag) = parse_innertube_video(&raw, INNERTUBE_VIDEO_ITAGS).unwrap();
        assert_eq!(itag, 136);
        assert!(!url.is_empty());
    }

    /// Зеркальный инвариант parse_ignores_video_formats: аудио-форматы — не
    /// кандидаты видео-разбора, даже когда видео в ответе нет вовсе.
    #[test]
    fn video_parse_ignores_audio_formats() {
        let mut raw = ok_fixture();
        raw["streamingData"]["adaptiveFormats"]
            .as_array_mut()
            .unwrap()
            .retain(|f| {
                f["mimeType"]
                    .as_str()
                    .unwrap_or("")
                    .starts_with("audio/")
            });
        assert!(parse_innertube_video(&raw, INNERTUBE_VIDEO_ITAGS).is_err());
    }

    /// 4K (313) живой фикстуры вне приоритета: тянуть его в узкую панель —
    /// зря жечь трафик; честный провал (обложка), не «какое-нибудь видео».
    #[test]
    fn video_parse_skips_itags_outside_priority() {
        assert!(parse_innertube_video(&ok_fixture(), INNERTUBE_VIDEO_ITAGS).is_err());
    }

    /// Видео без прямого url (SABR) — провал с SABR-диагностикой.
    #[test]
    fn video_parse_without_urls_is_sabr() {
        let mut raw = video_fixture(136, "video/mp4");
        for f in raw["streamingData"]["adaptiveFormats"].as_array_mut().unwrap() {
            f.as_object_mut().unwrap().remove("url");
        }
        match parse_innertube_video(&raw, INNERTUBE_VIDEO_ITAGS).unwrap_err() {
            InnertubeFail::Sabr(_) => {}
            other => panic!("ожидали Sabr, получили {other:?}"),
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
    /// Network считается в fail_other — отдельный KPI сети не нужен, класс
    /// существует ради breaker'а (глобальный провал ≠ пер-видео UNPLAYABLE).
    #[test]
    fn classify_innertube_counters() {
        let mut stats = EngineStats::default();
        classify_innertube_failure(&mut stats, &InnertubeFail::Sabr("нет url".into()));
        classify_innertube_failure(&mut stats, &InnertubeFail::LoginRequired("бот-гейт".into()));
        classify_innertube_failure(&mut stats, &InnertubeFail::Other("UNPLAYABLE".into()));
        classify_innertube_failure(&mut stats, &InnertubeFail::Network("сеть упала".into()));
        assert_eq!(stats.fail_sabr, 1);
        assert_eq!(stats.fail_login, 1);
        assert_eq!(stats.fail_other, 2);
    }

    // ── Circuit-breaker ступени 0 ──────────────────────────────────
    // Бот-гейт YouTube бьёт по IP: продолжать долбить POST /player — усиливать
    // блок и кормить CPU-лавину yt-dlp-фолбэков прогрева (2026-07-19: 118
    // результатов поиска → 18 спавнов yt-dlp). 3 глобальных провала подряд →
    // кулдаун, успех — полный сброс. UNPLAYABLE (Other) — пер-видео провал,
    // breaker не трогает: плейлист заблокированных треков не имеет права
    // глушить ступень 0 всем остальным.

    /// 3 глобальных провала (любой микс Login/Network/Sabr) открывают кулдаун;
    /// кулдаун истекает по STAGE0_COOLDOWN.
    #[test]
    fn breaker_opens_after_three_global_fails() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        assert!(!stage0_in_cooldown(&state, t0));
        stage0_breaker_note_fail(&state, &InnertubeFail::LoginRequired("бот".into()), t0);
        stage0_breaker_note_fail(&state, &InnertubeFail::Network("сеть".into()), t0);
        assert!(!stage0_in_cooldown(&state, t0), "двух провалов мало");
        stage0_breaker_note_fail(&state, &InnertubeFail::Sabr("sabr".into()), t0);
        assert!(stage0_in_cooldown(&state, t0));
        assert!(stage0_in_cooldown(
            &state,
            t0 + STAGE0_COOLDOWN - Duration::from_secs(1)
        ));
        assert!(!stage0_in_cooldown(&state, t0 + STAGE0_COOLDOWN), "кулдаун истёк");
    }

    /// UNPLAYABLE и прочие пер-видео Other не считаются и не сбивают счёт
    /// глобальных провалов (нейтральны).
    #[test]
    fn breaker_ignores_per_video_other() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        for _ in 0..5 {
            stage0_breaker_note_fail(&state, &InnertubeFail::Other("UNPLAYABLE".into()), t0);
        }
        assert!(!stage0_in_cooldown(&state, t0), "Other не открывает кулдаун");
        stage0_breaker_note_fail(&state, &InnertubeFail::LoginRequired("б".into()), t0);
        stage0_breaker_note_fail(&state, &InnertubeFail::Other("UNPLAYABLE".into()), t0);
        stage0_breaker_note_fail(&state, &InnertubeFail::LoginRequired("б".into()), t0);
        assert!(!stage0_in_cooldown(&state, t0), "Other нейтрален для счёта");
        stage0_breaker_note_fail(&state, &InnertubeFail::LoginRequired("б".into()), t0);
        assert!(stage0_in_cooldown(&state, t0), "3-й глобальный — кулдаун");
    }

    /// Успех сбрасывает счёт: «подряд» значит подряд.
    #[test]
    fn breaker_resets_on_success() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        stage0_breaker_note_fail(&state, &InnertubeFail::LoginRequired("б".into()), t0);
        stage0_breaker_note_fail(&state, &InnertubeFail::LoginRequired("б".into()), t0);
        stage0_breaker_note_success(&state);
        stage0_breaker_note_fail(&state, &InnertubeFail::LoginRequired("б".into()), t0);
        stage0_breaker_note_fail(&state, &InnertubeFail::LoginRequired("б".into()), t0);
        assert!(!stage0_in_cooldown(&state, t0), "после успеха счёт с нуля");
    }

    /// После истечения кулдауна счёт начинается заново — один свежий провал
    /// не захлопывает ступень 0 обратно.
    #[test]
    fn breaker_counts_fresh_after_cooldown() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        for _ in 0..3 {
            stage0_breaker_note_fail(&state, &InnertubeFail::Network("сеть".into()), t0);
        }
        let after = t0 + STAGE0_COOLDOWN + Duration::from_secs(1);
        assert!(!stage0_in_cooldown(&state, after));
        stage0_breaker_note_fail(&state, &InnertubeFail::Network("сеть".into()), after);
        assert!(!stage0_in_cooldown(&state, after), "один провал — ещё не кулдаун");
    }

    // ── Журнал ступени 0 (2026-07-20) ──────────────────────────────
    // Предохранители срабатывали МОЛЧА — жалоба «через два часа всё стало
    // медленно» была неразбираема постфактум. Теперь каждый значимый переход
    // оставляет след, и Настройки → Система показывают его человеку.

    /// Открытие кулдауна — событие с классом причины; сами провалы тоже видны.
    #[test]
    fn breaker_opening_leaves_journal_trail() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        for _ in 0..3 {
            stage0_breaker_note_fail(&state, &InnertubeFail::Network("таймаут 4с".into()), t0);
        }
        let ring = state.stage0_events.lock().unwrap();
        assert!(
            ring.iter().any(|e| e.text.contains("выключен")),
            "открытие кулдауна — событие"
        );
        assert!(
            ring.iter().any(|e| e.text.contains("сеть не ответила")),
            "класс провала назван человеком"
        );
    }

    /// Восстановление — событие ТОЛЬКО после неприятностей: рутинные успехи
    /// журнал не разбавляют.
    #[test]
    fn breaker_recovery_logged_only_after_trouble() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        stage0_breaker_note_success(&state);
        assert!(
            state.stage0_events.lock().unwrap().is_empty(),
            "тихий успех — не событие"
        );
        stage0_breaker_note_fail(&state, &InnertubeFail::LoginRequired("бот".into()), t0);
        stage0_breaker_note_success(&state);
        assert!(
            state
                .stage0_events
                .lock()
                .unwrap()
                .iter()
                .any(|e| e.text.contains("снова в строю")),
            "восстановление после сбоев — событие"
        );
    }

    /// Кольцо каппится: старые события уходят, память не растёт.
    #[test]
    fn journal_ring_is_capped() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        for i in 0..(STAGE0_EVENTS_CAP + 50) {
            stage0_log(&state, t0, format!("событие {i}"));
        }
        let ring = state.stage0_events.lock().unwrap();
        assert_eq!(ring.len(), STAGE0_EVENTS_CAP);
        assert_eq!(ring.front().unwrap().text, "событие 50", "старые вытеснены");
    }

    /// Файл-зеркало: строки дописываются; перерос кэп — журнал начинается
    /// заново (лог НЕДАВНИХ событий, не вечный архив).
    #[test]
    fn journal_mirrors_to_file_and_caps_size() {
        let state = EngineState::default();
        let dir = std::env::temp_dir().join("muza-stage0-log-test");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("engine-events.log");
        let _ = fs::remove_file(&path);
        *state.stage0_log_path.lock().unwrap() = Some(path.clone());
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);

        stage0_log(&state, t0, "первая запись");
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("первая запись"));
        assert!(content.contains("1000000000"), "unix-мс в строке");

        fs::write(&path, "x".repeat((STAGE0_LOG_MAX_BYTES + 1) as usize)).unwrap();
        stage0_log(&state, t0, "после кэпа");
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("после кэпа"));
        assert!(!content.starts_with("xxx"), "переросший файл начат заново");
    }

    /// Снимок статуса: активный кулдаун виден с моментом конца, истёкший —
    /// нет; события отдаются новыми первыми.
    #[test]
    fn stage0_status_snapshot_reports_cooldown_and_events() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        for _ in 0..3 {
            stage0_breaker_note_fail(&state, &InnertubeFail::Network("сеть".into()), t0);
        }
        let st = stage0_status_snapshot(&state, t0 + Duration::from_secs(1));
        assert!(st.cooldown_until_ms.is_some(), "активный кулдаун виден");
        assert!(!st.events.is_empty());
        let newest = st.events.first().unwrap();
        let oldest = st.events.last().unwrap();
        assert!(newest.at_ms >= oldest.at_ms, "новые первыми");

        let st2 = stage0_status_snapshot(&state, t0 + STAGE0_COOLDOWN + Duration::from_secs(1));
        assert!(st2.cooldown_until_ms.is_none(), "истёкший кулдаун не пугает");
        assert!(!st2.sc_key_ready, "ключ SC не добывался");
    }

    /// Кулдаун SC-ключа оставляет событие (sc_cid_fail — единственная точка).
    #[test]
    fn sc_key_cooldown_leaves_journal_trail() {
        let state = EngineState::default();
        let _ = sc_cid_fail(&state, "бандл не скачался".into());
        assert!(
            state
                .stage0_events
                .lock()
                .unwrap()
                .iter()
                .any(|e| e.text.contains("ключ SoundCloud")),
            "пауза SC-ключа — событие"
        );
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

    /// Сеть/таймаут — Network без повтора: ступень 0 либо быстрая, либо
    /// сразу уступает лестнице. Класс отдельный от Other: только глобальные
    /// провалы (сеть/бот-гейт/SABR) взводят circuit-breaker.
    #[test]
    fn orchestration_network_error_is_network() {
        let state = EngineState::default();
        let (result, calls) = run_orchestration(&state, vec![Err("сеть упала".into())]);
        assert!(matches!(result, Err(InnertubeFail::Network(_))));
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

#[cfg(test)]
mod soundcloud_tests {
    use super::*;
    use std::collections::VecDeque;
    use std::net::{IpAddr, Ipv4Addr};

    /// Санитизированные ответы api-v2 (форма живого ответа 2026-07-19:
    /// transcodings с format.protocol/mime_type, id/подписи — синтетика).
    fn sc_track_fixture() -> String {
        include_str!("../testdata/sc_resolve_ok.json").to_string()
    }

    fn sc_no_progressive_fixture() -> String {
        include_str!("../testdata/sc_resolve_no_progressive.json").to_string()
    }

    fn sc_transcoding_fixture() -> String {
        include_str!("../testdata/sc_transcoding_url.json").to_string()
    }

    /// Живой медиаплейлист SC (форма ответа 22.07.2026: version 7, EXT-X-MAP с
    /// init.mp4, сегменты .m4s — то есть fMP4; подписи заменены синтетикой).
    fn sc_hls_playlist_fixture() -> &'static str {
        include_str!("../testdata/sc_hls_playlist.m3u8")
    }

    fn sc_playlist_base() -> Url {
        Url::parse(
            "https://playback.media-streaming.soundcloud.cloud/SYNTH0000/aac_160k/00000000-1111-2222-3333-444444444444/playlist.m3u8",
        )
        .unwrap()
    }

    #[test]
    fn pick_prefers_progressive_even_when_hls_stands_first() {
        let track: serde_json::Value = serde_json::from_str(&sc_track_fixture()).unwrap();
        let picked = sc_pick_transcoding(&track).unwrap();
        assert_eq!(picked.protocol, ScProtocol::Progressive);
    }

    /// Голова fMP4: `ftyp` со смещения 4 (первые четыре байта — размер бокса)
    /// и `moov` где-то в начале. Кусок init-сегмента SoundCloud выглядит так.
    fn fmp4_head() -> Vec<u8> {
        let mut head = Vec::new();
        head.extend_from_slice(&[0, 0, 0, 0x18]);
        head.extend_from_slice(b"ftypiso5");
        head.extend_from_slice(&[0u8; 16]);
        head.extend_from_slice(&[0, 0, 0, 0x10]);
        head.extend_from_slice(b"moov");
        head.extend_from_slice(&[0u8; 64]);
        head
    }

    fn write_part(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("muza-hls-head-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    /// Гейт снятия запрета на стрим HLS (2026-08-13): недописанный `.part`,
    /// у которого init-сегмент уже на диске, обязан признаваться играбельным —
    /// иначе SoundCloud так и остался бы без стрима.
    #[test]
    fn stream_hls_head_ok_accepts_partial_fmp4() {
        let mut bytes = fmp4_head();
        bytes.extend_from_slice(&[0xAB; 4096]); // «первый медиа-сегмент», файл ещё растёт
        let part = write_part("partial-ok.m4a.part", &bytes);
        assert!(stream_hls_head_ok(&part));
    }

    /// Битая склейка (не тот init / обрезано) обязана отдавать false — тогда
    /// engine_stream_start снесёт закачку и уйдёт обычной дорогой. Это и есть
    /// страховка «не хуже, чем было до снятия запрета».
    #[test]
    fn stream_hls_head_ok_rejects_garbage_and_missing_moov() {
        let garbage = write_part("garbage.m4a.part", &[0x00; 512]);
        assert!(!stream_hls_head_ok(&garbage), "мусор — не fMP4");

        let mut no_moov = Vec::new();
        no_moov.extend_from_slice(&[0, 0, 0, 0x18]);
        no_moov.extend_from_slice(b"ftypiso5");
        no_moov.extend_from_slice(&[0u8; 256]); // ftyp есть, moov не приехал
        let path = write_part("no-moov.m4a.part", &no_moov);
        assert!(!stream_hls_head_ok(&path), "без moov Chromium не заиграет");
    }

    /// Отсутствующий файл — отказ, а не паника: голова не прочлась, значит
    /// рисковать молчащим плеером нельзя.
    #[test]
    fn stream_hls_head_ok_rejects_unreadable() {
        let missing = std::env::temp_dir().join("muza-hls-head-none/never-created.part");
        assert!(!stream_hls_head_ok(&missing));
    }

    /// Отчёт H: у части каталога progressive уже нет — берём AAC HLS.
    #[test]
    fn pick_falls_back_to_aac_hls_and_ignores_hls_mp3() {
        let track: serde_json::Value = serde_json::from_str(&sc_no_progressive_fixture()).unwrap();
        let picked = sc_pick_transcoding(&track).unwrap();
        assert_eq!(picked.protocol, ScProtocol::HlsAac);
        assert_eq!(picked.ext, "m4a", "AAC HLS кэшируется как m4a");
        assert!(
            picked.url.contains("11112222"),
            "выбран должен быть aac_160k-транскодинг, а не hls-mp3: {}",
            picked.url
        );
    }

    #[test]
    fn pick_prefers_aac_160_over_96() {
        let track: serde_json::Value = serde_json::json!({
            "media": { "transcodings": [
                { "url": "https://api-v2.soundcloud.com/x/96/stream/hls", "preset": "aac_96k",
                  "format": { "protocol": "hls", "mime_type": "audio/mp4" } },
                { "url": "https://api-v2.soundcloud.com/x/160/stream/hls", "preset": "aac_160k",
                  "format": { "protocol": "hls", "mime_type": "audio/mp4" } },
            ]}
        });
        assert!(sc_pick_transcoding(&track).unwrap().url.contains("/160/"));
    }

    #[test]
    fn pick_without_any_supported_transcoding_fails() {
        let track: serde_json::Value = serde_json::json!({
            "media": { "transcodings": [
                { "url": "https://api-v2.soundcloud.com/x/opus/stream/hls", "preset": "opus_0_0",
                  "format": { "protocol": "hls", "mime_type": "audio/ogg" } },
            ]}
        });
        assert!(matches!(
            sc_pick_transcoding(&track),
            Err(SoundcloudFail::Other(_))
        ));
    }

    #[test]
    fn parse_m3u8_reads_init_and_segments_in_order() {
        let parsed = sc_parse_m3u8(sc_hls_playlist_fixture(), &sc_playlist_base()).unwrap();
        assert!(
            parsed.init.as_deref().unwrap().contains("init.mp4"),
            "fMP4 без init-сегмента не играет"
        );
        assert_eq!(parsed.segments.len(), 3);
        assert!(parsed.segments[0].contains("data000.m4s"));
        assert!(parsed.segments[2].contains("data002.m4s"));
    }

    /// Живой SC отдаёт абсолютные подписанные ссылки, но грамматика HLS
    /// разрешает относительные — на них ломался бы только прод.
    #[test]
    fn parse_m3u8_resolves_relative_uris_against_playlist() {
        let text = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:10,\ndata000.m4s\n#EXT-X-ENDLIST";
        let parsed = sc_parse_m3u8(text, &sc_playlist_base()).unwrap();
        assert_eq!(
            parsed.init.as_deref(),
            Some("https://playback.media-streaming.soundcloud.cloud/SYNTH0000/aac_160k/00000000-1111-2222-3333-444444444444/init.mp4")
        );
        assert!(parsed.segments[0].ends_with("/data000.m4s"));
    }

    #[test]
    fn parse_m3u8_refuses_encrypted_segments() {
        let text = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:10,\nd0.m4s";
        let err = sc_parse_m3u8(text, &sc_playlist_base()).unwrap_err();
        match err {
            SoundcloudFail::Other(msg) => assert!(msg.contains("зашифрованы"), "{msg}"),
            other => panic!("ожидался честный отказ по шифрованию, получено {other:?}"),
        }
    }

    #[test]
    fn parse_m3u8_without_segments_fails() {
        let text = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-ENDLIST";
        assert!(sc_parse_m3u8(text, &sc_playlist_base()).is_err());
    }

    /// 32 строчно-алфанумерных символа — грамматика живого client_id.
    const SYNTH_CLIENT_ID: &str = "AAAABBBBCCCCDDDDEEEEFFFF00112233";
    const SYNTH_CLIENT_ID_2: &str = "ZZZZYYYYXXXXWWWWVVVVUUUU99887766";

    /// Главная soundcloud.com: два JS-бандла a-v2.sndcdn.com (client_id
    /// исторически в ПОСЛЕДНИХ — сканирование обязано идти с конца).
    const SC_HOME_HTML: &str = concat!(
        r#"<html><head><link rel="preload" href="https://a-v2.sndcdn.com/assets/0-first11.js">"#,
        r#"<script crossorigin src="https://a-v2.sndcdn.com/assets/0-first11.js"></script>"#,
        r#"<script crossorigin src="https://a-v2.sndcdn.com/assets/50-last222.js"></script>"#,
        r#"</head><body></body></html>"#
    );

    /// Кусок JS-бандла: первое упоминание client_id — не присваивание
    /// (сканер обязан пройти дальше), второе — настоящая грамматика.
    fn sc_bundle_with_id(id: &str) -> String {
        format!(r#"var e=t.client_id;n.query="?client_id="+e;o.client_id="{id}";"#)
    }

    fn public_lookup(_host: &str, _port: u16) -> LookupResult {
        Ok(vec![IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))])
    }

    fn sc_canonical(raw: &str) -> Url {
        byte_canonical_locator("soundcloud", raw).unwrap()
    }

    /// Прогон оркестрации с инъекцией транспорта (очередь ответов по порядку,
    /// как run_orchestration у InnerTube) и инъекцией Range-пробы размера.
    fn run_sc(
        state: &EngineState,
        canonical: &str,
        responses: Vec<Result<(u16, String), String>>,
        probe_response: Result<u64, String>,
    ) -> (
        Result<SoundcloudFormat, SoundcloudFail>,
        Vec<String>,
        Vec<String>,
    ) {
        let (result, calls, probes, _timings) =
            run_sc_timed(state, canonical, responses, probe_response);
        (result, calls, probes)
    }

    /// То же, но с отметками фаз: их смотрят только замерные тесты, остальным
    /// они шум — поэтому run_sc их отбрасывает.
    fn run_sc_timed(
        state: &EngineState,
        canonical: &str,
        responses: Vec<Result<(u16, String), String>>,
        probe_response: Result<u64, String>,
    ) -> (
        Result<SoundcloudFormat, SoundcloudFail>,
        Vec<String>,
        Vec<String>,
        Vec<(String, u32)>,
    ) {
        let canonical = sc_canonical(canonical);
        let calls: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let probes: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let queue: Mutex<VecDeque<Result<(u16, String), String>>> =
            Mutex::new(VecDeque::from(responses));
        let mut timings = Timings::default();
        let result = tauri::async_runtime::block_on(resolve_via_soundcloud_with(
            state,
            &canonical,
            &mut timings,
            |url| {
                calls.lock().unwrap().push(url);
                let resp = queue
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("лишний вызов транспорта");
                async move { resp }
            },
            |url| {
                probes.lock().unwrap().push(url);
                let resp = probe_response.clone();
                async move { resp }
            },
        ));
        (
            result,
            calls.into_inner().unwrap(),
            probes.into_inner().unwrap(),
            timings.take(),
        )
    }

    // ── Разбор ответа api-v2 ───────────────────────────────────────

    /// Выбор по format.protocol == "progressive" (не по порядку и не по
    /// именам полей — SC уходит к AAC HLS, protocol надёжнее).
    #[test]
    fn sc_picks_progressive_over_hls() {
        let track: serde_json::Value = serde_json::from_str(&sc_track_fixture()).unwrap();
        let picked = sc_pick_transcoding(&track).unwrap();
        assert!(picked.url.ends_with("/stream/progressive"), "{}", picked.url);
        assert_eq!(picked.ext, "mp3");
        assert_eq!(picked.protocol, ScProtocol::Progressive);
    }

    /// Только HLS — выбор теперь его находит (часть B), но закачка сегментами
    /// ещё не подключена, поэтому ступень по-прежнему уступает лестнице.
    #[test]
    fn sc_no_progressive_picks_hls_but_stage_still_yields() {
        let track: serde_json::Value =
            serde_json::from_str(&sc_no_progressive_fixture()).unwrap();
        assert_eq!(
            sc_pick_transcoding(&track).unwrap().protocol,
            ScProtocol::HlsAac
        );
    }

    /// mime_type → расширение файла кэша (find_cached понимает mp3/m4a).
    #[test]
    fn sc_ext_mapping_covers_known_mimes() {
        assert_eq!(sc_ext_from_mime("audio/mpeg"), Some("mp3"));
        assert_eq!(sc_ext_from_mime("audio/mp4; codecs=\"mp4a.40.2\""), Some("m4a"));
        assert_eq!(sc_ext_from_mime("audio/aac"), Some("m4a"));
        assert_eq!(sc_ext_from_mime("audio/ogg; codecs=\"opus\""), None);
        assert_eq!(sc_ext_from_mime(""), None);
    }

    // ── Выбор источника ────────────────────────────────────────────

    /// SC-ступень — только когда ПЕРВЫЙ источник Soundcloud с канонично
    /// валидным url (та же грамматика byte_canonical_locator, что у лестницы);
    /// приоритет источников сервера не переворачиваем.
    #[test]
    fn stage0_sc_ref_only_for_leading_valid_source() {
        let sc = || SourceRef::Soundcloud {
            source_id: "12345".into(),
            canonical_url: "https://soundcloud.com/artist-a/track-b".into(),
        };
        let yt = SourceRef::Youtube {
            source_id: "dQw4w9WgXcQ".into(),
        };
        let (sid, url) = stage0_soundcloud_ref(&[sc()]).unwrap();
        assert_eq!(sid, "12345");
        assert_eq!(url.as_str(), "https://soundcloud.com/artist-a/track-b");
        assert!(
            stage0_soundcloud_ref(&[yt, sc()]).is_none(),
            "YouTube первый — его ступень, не SC"
        );
        assert!(stage0_soundcloud_ref(&[]).is_none());
        let bad = SourceRef::Soundcloud {
            source_id: "12345".into(),
            canonical_url: "https://evil.example.com/a/b".into(),
        };
        assert!(stage0_soundcloud_ref(&[bad]).is_none(), "чужой хост — лестница");
        let api_form = SourceRef::Soundcloud {
            source_id: "987654321".into(),
            canonical_url: "https://api.soundcloud.com/tracks/987654321".into(),
        };
        assert!(
            stage0_soundcloud_ref(&[api_form]).is_some(),
            "числовая форма каталога (64% SoundCloud) — годна"
        );
    }

    /// Страничная форма идёт через /resolve, числовая — в /tracks/<id>
    /// напрямую (resolve ей не нужен).
    #[test]
    fn sc_api_lookup_url_forms() {
        let page = sc_canonical("https://soundcloud.com/artist-a/track-b");
        let url = sc_api_lookup_url(&page, SYNTH_CLIENT_ID);
        assert!(
            url.starts_with("https://api-v2.soundcloud.com/resolve?"),
            "{url}"
        );
        assert!(
            url.contains("url=https%3A%2F%2Fsoundcloud.com%2Fartist-a%2Ftrack-b"),
            "{url}"
        );
        assert!(url.contains(&format!("client_id={SYNTH_CLIENT_ID}")), "{url}");
        let numeric = sc_canonical("https://api.soundcloud.com/tracks/987654321");
        assert_eq!(
            sc_api_lookup_url(&numeric, SYNTH_CLIENT_ID),
            format!("https://api-v2.soundcloud.com/tracks/987654321?client_id={SYNTH_CLIENT_ID}")
        );
    }

    // ── Добыча client_id из бандлов ────────────────────────────────

    #[test]
    fn sc_bundle_urls_from_home_html() {
        let urls = sc_bundle_urls(SC_HOME_HTML);
        assert_eq!(
            urls,
            vec![
                "https://a-v2.sndcdn.com/assets/0-first11.js".to_string(),
                "https://a-v2.sndcdn.com/assets/50-last222.js".to_string(),
            ],
            "порядок документа, дубли схлопнуты"
        );
    }

    /// Грамматика client_id: за словом — : или =, кавычка, ровно 32
    /// алфанумерных символа. Всё прочее (конкатенации URL, короткие
    /// значения) — мимо.
    #[test]
    fn sc_client_id_extraction_grammar() {
        assert_eq!(
            sc_client_id_from_js(&sc_bundle_with_id(SYNTH_CLIENT_ID)).as_deref(),
            Some(SYNTH_CLIENT_ID)
        );
        assert_eq!(sc_client_id_from_js("client_id=\"short\""), None);
        assert_eq!(
            sc_client_id_from_js("client_id:\"AAAABBBBCCCCDDDDEEEEFFFF0011223!\""),
            None,
            "не-алфанум не проходит"
        );
        assert_eq!(sc_client_id_from_js("тут ничего нет"), None);
        assert_eq!(
            sc_client_id_from_js(&format!("a.client_id = \"{SYNTH_CLIENT_ID}\"")).as_deref(),
            Some(SYNTH_CLIENT_ID),
            "форма с = и пробелами тоже валидна"
        );
    }

    // ── Кэш client_id и кулдаун добычи ─────────────────────────────

    #[test]
    fn sc_client_id_cache_respects_ttl() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        assert_eq!(sc_cached_client_id(&state, t0), None);
        sc_note_client_id(&state, SYNTH_CLIENT_ID, t0);
        assert_eq!(
            sc_cached_client_id(&state, t0 + SOUNDCLOUD_CLIENT_ID_TTL - Duration::from_secs(1))
                .as_deref(),
            Some(SYNTH_CLIENT_ID)
        );
        assert_eq!(
            sc_cached_client_id(&state, t0 + SOUNDCLOUD_CLIENT_ID_TTL),
            None,
            "протухший не переиспользуем"
        );
    }

    // ── Персист client_id между запусками (2026-08-03) ─────────────
    //
    // Без него первый SC-трек КАЖДОГО запуска заново тянул главную
    // soundcloud.com и до 12 JS-бандлов. Файл лежит в пользовательской папке,
    // поэтому поднятое значение проходит ТУ ЖЕ грамматику, что добыча.

    fn stored_json(id: &str, at: SystemTime) -> String {
        let ms = at
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        format!("{{\"client_id\":\"{id}\",\"obtained_at_ms\":{ms}}}")
    }

    #[test]
    fn stored_sc_cid_roundtrips() {
        let at = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let now = at + Duration::from_secs(3600);
        let raw = serialize_stored_sc_cid(SYNTH_CLIENT_ID, at).expect("сериализуется");
        assert_eq!(
            parse_stored_sc_cid(&raw, now),
            Some((SYNTH_CLIENT_ID.to_string(), at))
        );
    }

    /// Главный инвариант правки: значение из файла подставляется в URL СЫРЫМ,
    /// поэтому всё, что не проходит грамматику добычи, обязано вести себя как
    /// отсутствие файла — иначе файл в пользовательской папке становится
    /// точкой подстановки в запрос к api-v2.
    #[test]
    fn stored_sc_cid_rejects_substitution_and_bad_length() {
        let at = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let now = at + Duration::from_secs(3600);
        let bad_values: Vec<String> = vec![
            "abc&client_id=x".to_string(),               // подстановка в query
            "a".repeat(33),                              // длиннее 32
            "a".repeat(31),                              // короче 32
            "0123456789012345678901234567890 ".to_string(), // пробел вместо алфанум
            "0123456789012345678901234567890/".to_string(), // разделитель пути
            String::new(),
        ];
        for bad in &bad_values {
            assert_eq!(
                parse_stored_sc_cid(&stored_json(bad, at), now),
                None,
                "значение {bad:?} обязано игнорироваться целиком"
            );
        }
        // битый/чужой файл — тоже как отсутствие файла
        assert_eq!(parse_stored_sc_cid("не json", now), None);
        assert_eq!(parse_stored_sc_cid("{}", now), None);
    }

    #[test]
    fn stored_sc_cid_respects_ttl_and_clock_skew() {
        let at = SystemTime::UNIX_EPOCH + Duration::from_secs(30 * 24 * 3600);
        assert!(
            parse_stored_sc_cid(&stored_json(SYNTH_CLIENT_ID, at), at + SOUNDCLOUD_CLIENT_ID_TTL)
                .is_none(),
            "протухший ключ поднимать нельзя"
        );
        assert!(parse_stored_sc_cid(
            &stored_json(SYNTH_CLIENT_ID, at),
            at + SOUNDCLOUD_CLIENT_ID_TTL - Duration::from_secs(1)
        )
        .is_some());
        // метка из БУДУЩЕГО (часы съехали назад, файл с чужой машины) читается
        // как «протух», а не как «вечно свежий»
        assert!(
            parse_stored_sc_cid(
                &stored_json(SYNTH_CLIENT_ID, at + Duration::from_secs(60)),
                at
            )
            .is_none(),
            "метка из будущего не даёт свежести"
        );
    }

    /// Персист пишется при успехе добычи и СНОСИТСЯ при сбросе по 401/403:
    /// иначе следующий запуск поднял бы мёртвый ключ и снова оплатил 401.
    #[test]
    fn sc_client_id_persist_written_and_dropped() {
        let dir = std::env::temp_dir().join(format!(
            "muza-sccid-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("soundcloud-cid.json");
        let state = EngineState::default();
        *state.soundcloud_cid_path.lock().unwrap() = Some(file.clone());

        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        sc_note_client_id(&state, SYNTH_CLIENT_ID, t0);
        let raw = fs::read_to_string(&file).expect("файл записан");
        assert_eq!(
            parse_stored_sc_cid(&raw, t0 + Duration::from_secs(60)),
            Some((SYNTH_CLIENT_ID.to_string(), t0))
        );

        sc_drop_client_id(&state);
        assert!(!file.exists(), "сброс по 401/403 сносит и файл");
        assert_eq!(sc_cached_client_id(&state, t0), None);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Без пути персиста (тесты, ранний старт) поведение прежнее: только память.
    #[test]
    fn sc_client_id_persist_is_optional() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        sc_note_client_id(&state, SYNTH_CLIENT_ID, t0);
        assert_eq!(sc_cached_client_id(&state, t0).as_deref(), Some(SYNTH_CLIENT_ID));
        sc_drop_client_id(&state);
        assert_eq!(sc_cached_client_id(&state, t0), None);
    }

    #[test]
    fn sc_cid_cooldown_respects_ttl() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        assert!(!sc_cid_recently_failed(&state, t0));
        sc_cid_note_fail(&state, t0);
        assert!(sc_cid_recently_failed(
            &state,
            t0 + SOUNDCLOUD_CID_FAIL_TTL - Duration::from_secs(1)
        ));
        assert!(!sc_cid_recently_failed(&state, t0 + SOUNDCLOUD_CID_FAIL_TTL));
    }

    // ── Оркестрация (инъекция транспорта) ──────────────────────────

    // ── Пофазовые отметки ступени 0 ────────────────────────────────

    /// Обычный SC-путь размечен пофазово, и метки идут В ПОРЯДКЕ шагов.
    /// Это и есть смысл замера: одна цифра urlMs не отвечала на вопрос,
    /// который из четырёх сетевых шагов длинный.
    ///
    /// sc_client_id тут НЕТ намеренно: ключ взят из состояния — шага не было.
    #[test]
    fn sc_timings_label_each_network_step() {
        let state = EngineState::default();
        sc_note_client_id(&state, SYNTH_CLIENT_ID, SystemTime::now());
        let (result, _calls, _probes, timings) = run_sc_timed(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((200, sc_track_fixture())),
                Ok((200, sc_transcoding_fixture())),
            ],
            Ok(4_567_890),
        );
        assert!(result.is_ok(), "{result:?}");
        let labels: Vec<&str> = timings.iter().map(|(l, _)| l.as_str()).collect();
        // 13.08: проба размера снята — сетевых шагов на тёплом ключе ровно два
        assert_eq!(labels, vec!["sc_api_v2", "sc_transcoding"]);
    }

    /// Холодный старт: ключа в состоянии нет — появляется sc_client_id, и
    /// именно он объясняет, почему первый SC-трек после запуска дороже.
    #[test]
    fn sc_timings_add_client_id_when_scraped() {
        let state = EngineState::default();
        let (result, _calls, _probes, timings) = run_sc_timed(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((200, SC_HOME_HTML.to_string())),
                Ok((200, sc_bundle_with_id(SYNTH_CLIENT_ID))),
                Ok((200, sc_track_fixture())),
                Ok((200, sc_transcoding_fixture())),
            ],
            Ok(4_567_890),
        );
        assert!(result.is_ok(), "{result:?}");
        let labels: Vec<&str> = timings.iter().map(|(l, _)| l.as_str()).collect();
        assert_eq!(
            labels,
            vec!["sc_client_id", "sc_api_v2", "sc_transcoding"] // 13.08: без пробы
        );
    }

    /// AAC HLS — своя метка вместо пробы: по cdn_url лежит манифест, а не
    /// аудио, и Range-проба туда не ходит (см. sc_resolve_hls).
    #[test]
    fn sc_timings_mark_m3u8_instead_of_probe_on_hls() {
        let state = EngineState::default();
        sc_note_client_id(&state, SYNTH_CLIENT_ID, SystemTime::now());
        let (result, _calls, _probes, timings) = run_sc_timed(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((200, sc_no_progressive_fixture())),
                Ok((200, sc_transcoding_fixture())),
                Ok((200, sc_hls_playlist_fixture().to_string())),
            ],
            Ok(0),
        );
        assert!(result.is_ok(), "{result:?}");
        let labels: Vec<&str> = timings.iter().map(|(l, _)| l.as_str()).collect();
        assert_eq!(labels, vec!["sc_api_v2", "sc_transcoding", "sc_m3u8"]);
    }

    /// Провал ступени НЕ стирает уже собранные отметки: клик, ушедший на
    /// лестницу, дороже обычного ровно на эту работу — и её обязано быть видно.
    #[test]
    fn sc_timings_survive_failed_stage() {
        let state = EngineState::default();
        sc_note_client_id(&state, SYNTH_CLIENT_ID, SystemTime::now());
        let (result, _calls, _probes, timings) = run_sc_timed(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![Ok((200, sc_track_fixture())), Ok((500, String::new()))],
            Ok(4_567_890),
        );
        assert!(result.is_err(), "transcoding 500 — провал ступени");
        let labels: Vec<&str> = timings.iter().map(|(l, _)| l.as_str()).collect();
        assert_eq!(labels, vec!["sc_api_v2", "sc_transcoding"]);
    }

    /// Обычный путь: client_id уже в состоянии — resolve → transcoding, и всё.
    /// ⚠️ Размер приходит НУЛЁМ = «неизвестен» (13.08, проба снята): реальный
    /// берётся из заголовков ответа самой закачки, см. fetch_to_cache.
    #[test]
    fn sc_orchestration_uses_cached_client_id() {
        let state = EngineState::default();
        sc_note_client_id(&state, SYNTH_CLIENT_ID, SystemTime::now());
        let (result, calls, probes) = run_sc(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((200, sc_track_fixture())),
                Ok((200, sc_transcoding_fixture())),
            ],
            Ok(4_567_890),
        );
        let fmt = result.expect("успех");
        assert_eq!(fmt.ext, "mp3");
        assert_eq!(fmt.size, 0, "размер обязан приходить неизвестным — пробы больше нет");
        assert!(probes.is_empty(), "проба размера снята: сети на неё уходить не должно");
        assert!(
            fmt.url.starts_with("https://cf-media.sndcdn.com/"),
            "{}",
            fmt.url
        );
        assert_eq!(calls.len(), 2, "{calls:?}");
        assert!(
            calls[0].starts_with("https://api-v2.soundcloud.com/resolve?"),
            "{}",
            calls[0]
        );
        assert!(
            calls[1].contains(&format!("client_id={SYNTH_CLIENT_ID}")),
            "{}",
            calls[1]
        );
        // 13.08: раньше здесь проверялось, что проба идёт по CDN-URL. Пробы
        // больше нет — сторож перевёрнут выше (probes обязан быть пуст).
    }

    /// Бутстрап: состояния нет — главная → бандлы С КОНЦА → client_id
    /// оседает в состоянии (следующие клики без добычи).
    #[test]
    fn sc_orchestration_bootstraps_client_id_from_bundles() {
        let state = EngineState::default();
        let (result, calls, _probes) = run_sc(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((200, SC_HOME_HTML.to_string())),
                Ok((200, sc_bundle_with_id(SYNTH_CLIENT_ID))),
                Ok((200, sc_track_fixture())),
                Ok((200, sc_transcoding_fixture())),
            ],
            Ok(4_567_890),
        );
        assert!(result.is_ok(), "{result:?}");
        assert_eq!(calls[0], "https://soundcloud.com/");
        assert_eq!(
            calls[1], "https://a-v2.sndcdn.com/assets/50-last222.js",
            "бандлы сканируются С КОНЦА"
        );
        let cached = state.soundcloud_client_id.lock().unwrap();
        assert_eq!(
            cached.as_ref().map(|(id, _)| id.as_str()),
            Some(SYNTH_CLIENT_ID),
            "client_id осел в состоянии"
        );
    }

    /// 401 на api-v2 = протухший client_id: сброс + ОДНА передобыча +
    /// повтор со свежим id (образец — оркестрация visitorData).
    #[test]
    fn sc_orchestration_401_rescrapes_and_retries_once() {
        let state = EngineState::default();
        sc_note_client_id(&state, SYNTH_CLIENT_ID, SystemTime::now());
        let (result, calls, _probes) = run_sc(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((401, String::new())),
                Ok((200, SC_HOME_HTML.to_string())),
                Ok((200, sc_bundle_with_id(SYNTH_CLIENT_ID_2))),
                Ok((200, sc_track_fixture())),
                Ok((200, sc_transcoding_fixture())),
            ],
            Ok(4_567_890),
        );
        assert!(result.is_ok(), "{result:?}");
        assert!(calls[0].contains(SYNTH_CLIENT_ID), "{}", calls[0]);
        assert!(
            calls[3].contains(SYNTH_CLIENT_ID_2),
            "повтор — со свежим id: {}",
            calls[3]
        );
        assert!(calls[4].contains(SYNTH_CLIENT_ID_2), "{}", calls[4]);
        let cached = state.soundcloud_client_id.lock().unwrap();
        assert_eq!(
            cached.as_ref().map(|(id, _)| id.as_str()),
            Some(SYNTH_CLIENT_ID_2)
        );
    }

    /// Передобыча вернула ТОТ ЖЕ id — повтор бессмыслен, сдаёмся
    /// (та же дисциплина, что у visitorData: не больше одного повтора).
    #[test]
    fn sc_orchestration_gives_up_when_rescrape_returns_same_id() {
        let state = EngineState::default();
        sc_note_client_id(&state, SYNTH_CLIENT_ID, SystemTime::now());
        let (result, calls, _probes) = run_sc(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((401, String::new())),
                Ok((200, SC_HOME_HTML.to_string())),
                Ok((200, sc_bundle_with_id(SYNTH_CLIENT_ID))),
            ],
            Ok(1),
        );
        assert!(result.is_err());
        assert_eq!(calls.len(), 3, "повтор тем же id не шлём: {calls:?}");
    }

    /// Нет progressive — ступень больше НЕ уступает лестнице (часть B, отчёт
    /// H): берёт AAC HLS, читает манифест и отдаёт куски для склейки.
    #[test]
    fn sc_orchestration_no_progressive_takes_aac_hls() {
        let state = EngineState::default();
        sc_note_client_id(&state, SYNTH_CLIENT_ID, SystemTime::now());
        let playlist_url = sc_playlist_base().to_string();
        let (result, calls, probes) = run_sc(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((200, sc_no_progressive_fixture())),
                Ok((200, format!(r#"{{"url":"{playlist_url}"}}"#))),
                Ok((200, sc_hls_playlist_fixture().to_string())),
            ],
            Ok(1),
        );
        let fmt = result.expect("AAC HLS обязан резолвиться");
        assert_eq!(fmt.ext, "m4a");
        assert_eq!(fmt.segments.len(), 4, "init + три сегмента: {:?}", fmt.segments);
        assert!(fmt.segments[0].contains("init.mp4"), "init обязан идти первым");
        // 213с × 160 кбит/с — оценка для лимита и прогресса, не факт
        assert_eq!(fmt.size, 213 * 20_000);
        assert_eq!(calls.len(), 3, "api-v2 → transcoding → манифест: {calls:?}");
        assert!(
            probes.is_empty(),
            "у манифеста нет Content-Length — Range-проба бессмысленна"
        );
    }

    /// Живой прогон против настоящего SoundCloud: резолв реального трека и,
    /// если ступень выбрала AAC HLS, скачивание init+первого сегмента с
    /// проверкой, что склейка начинается сигнатурой mp4 (`ftyp`) — то есть
    /// Chromium её сыграет. Сеть и подписанные ссылки, поэтому ignored.
    /// `cargo test --lib live_soundcloud_hls -- --ignored --nocapture`
    #[test]
    #[ignore = "живой SoundCloud: сеть, client_id и подписанные ссылки"]
    fn live_soundcloud_hls_smoke() {
        let state = EngineState::default();
        let canonical = sc_canonical("https://soundcloud.com/not-rozshow/yara-yara-fonk-aura-farming");
        let mut timings = Timings::default();
        let fmt = tauri::async_runtime::block_on(resolve_via_soundcloud_with(
            &state,
            &canonical,
            &mut timings,
            sc_http_get,
            sc_http_probe,
        ))
        .expect("живой SC обязан резолвиться");
        println!("фазы: {:?}", timings.take());
        println!(
            "путь: {}, ext={}, оценка размера={} Б, кусков={}",
            if fmt.segments.is_empty() { "progressive" } else { "AAC HLS" },
            fmt.ext,
            fmt.size,
            fmt.segments.len()
        );
        if fmt.segments.is_empty() {
            println!("у трека ещё жив progressive — HLS-ветка не проверялась");
            return;
        }
        assert!(fmt.segments[0].contains("init"), "init обязан идти первым");
        let head = tauri::async_runtime::block_on(async {
            let mut buf: Vec<u8> = Vec::new();
            for segment in fmt.segments.iter().take(2) {
                let resp = warm_http_client()
                    .get(segment)
                    .header("User-Agent", SOUNDCLOUD_UA)
                    .send()
                    .await
                    .expect("сегмент должен скачаться");
                assert_eq!(resp.status().as_u16(), 200);
                buf.extend_from_slice(&resp.bytes().await.expect("тело сегмента"));
            }
            buf
        });
        println!("склеено {} Б из двух кусков", head.len());
        assert_eq!(
            &head[4..8],
            b"ftyp",
            "склейка обязана начинаться боксом ftyp — иначе Chromium не сыграет"
        );
        assert!(
            head.windows(4).any(|w| w == b"moov"),
            "init-сегмент обязан нести moov"
        );
    }

    /// Предохранитель склейки: в кэш попадает только то, что похоже на mp4.
    /// Дефект, который это ловит, самый неприятный из возможных — испорченный
    /// файл в кэше считается готовым, лестница не включается, трек молчит.
    #[test]
    fn hls_head_check_accepts_only_fmp4() {
        let mut good = vec![0u8, 0, 0, 0x18];
        good.extend_from_slice(b"ftypiso5");
        good.extend_from_slice(&[0u8; 8]);
        good.extend_from_slice(b"\0\0\0\x08moov");
        assert!(hls_head_looks_playable(&good), "нормальный init отвергнут");

        // HTML-страница ошибки CDN вместо сегмента — самый вероятный мусор.
        assert!(!hls_head_looks_playable(b"<!DOCTYPE html><html><body>403"));
        // ftyp есть, moov нет: хвостовой moov Chromium не сыграет потоком.
        let mut no_moov = vec![0u8, 0, 0, 0x18];
        no_moov.extend_from_slice(b"ftypiso5");
        no_moov.extend_from_slice(&[0u8; 64]);
        assert!(!hls_head_looks_playable(&no_moov));
        // Обрезанный ответ короче сигнатуры не должен паниковать на срезе.
        assert!(!hls_head_looks_playable(b"\0\0\0"));
        assert!(!hls_head_looks_playable(b""));
    }

    /// Длинный микс (живой прогон 27.07 поймал 733 сегмента) уступает
    /// лестнице: последовательная сборка сотен кусков медленнее yt-dlp с
    /// конкурентными фрагментами.
    #[test]
    fn sc_orchestration_overlong_hls_yields_to_ladder() {
        let state = EngineState::default();
        sc_note_client_id(&state, SYNTH_CLIENT_ID, SystemTime::now());
        let mut playlist = String::from("#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n");
        for i in 0..=SC_HLS_MAX_SEGMENTS {
            playlist.push_str(&format!("#EXTINF:10,\ndata{i}.m4s\n"));
        }
        let (result, _calls, _probes) = run_sc(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((200, sc_no_progressive_fixture())),
                Ok((200, format!(r#"{{"url":"{}"}}"#, sc_playlist_base()))),
                Ok((200, playlist)),
            ],
            Ok(1),
        );
        match result {
            Err(SoundcloudFail::Other(msg)) => {
                assert!(msg.contains("слишком длинный"), "{msg}")
            }
            other => panic!("длинный HLS обязан уступать лестнице, получено {other:?}"),
        }
    }

    /// Зашифрованный плейлист — честный отказ ступени, а не склейка мусора.
    #[test]
    fn sc_orchestration_encrypted_hls_yields_to_ladder() {
        let state = EngineState::default();
        sc_note_client_id(&state, SYNTH_CLIENT_ID, SystemTime::now());
        let playlist_url = sc_playlist_base().to_string();
        let (result, _calls, _probes) = run_sc(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((200, sc_no_progressive_fixture())),
                Ok((200, format!(r#"{{"url":"{playlist_url}"}}"#))),
                Ok((
                    200,
                    "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n#EXTINF:10,\nd0.m4s".to_string(),
                )),
            ],
            Ok(1),
        );
        assert!(matches!(result, Err(SoundcloudFail::Other(_))), "{result:?}");
    }

    /// ⚠️ ПЕРЕВЁРНУТЫЙ СТОРОЖ (13.08). Раньше падение пробы роняло всю ступень.
    /// Теперь пробы нет вовсе, и её мнимый отказ не должен значить НИЧЕГО:
    /// резолв обязан пройти, а размер прийти неизвестным. Тест оставлен именно
    /// в перевёрнутом виде — он ловит случайное возвращение пробы в путь.
    #[test]
    fn sc_orchestration_ignores_probe_entirely() {
        let state = EngineState::default();
        sc_note_client_id(&state, SYNTH_CLIENT_ID, SystemTime::now());
        let (result, _calls, probes) = run_sc(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![
                Ok((200, sc_track_fixture())),
                Ok((200, sc_transcoding_fixture())),
            ],
            Err("сеть упала".into()), // проба «сломана» — и это больше не важно
        );
        let fmt = result.expect("резолв обязан пройти без пробы");
        assert_eq!(fmt.size, 0);
        assert!(probes.is_empty(), "в путь вернулась проба размера");
    }

    /// Провал добычи client_id взводит кулдаун: следующий клик в течение
    /// минуты НЕ тянет главную и бандлы заново (0 запросов).
    #[test]
    fn sc_client_id_scrape_failure_sets_cooldown() {
        let state = EngineState::default();
        let (result, calls, _probes) = run_sc(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![Ok((200, "<html>без бандлов</html>".to_string()))],
            Ok(1),
        );
        assert!(matches!(result, Err(SoundcloudFail::ClientId(_))), "{result:?}");
        assert_eq!(calls.len(), 1);
        let (result2, calls2, _probes) = run_sc(
            &state,
            "https://soundcloud.com/artist-a/track-b",
            vec![],
            Ok(1),
        );
        assert!(matches!(result2, Err(SoundcloudFail::ClientId(_))), "{result2:?}");
        assert!(calls2.is_empty(), "кулдаун — сеть не трогаем");
    }

    // ── WarmEntry из ответа ────────────────────────────────────────

    /// Форма наружу — WarmEntry: provider soundcloud; подписанные
    /// query-параметры sndcdn не парсим — консервативные 20 минут от now.
    #[test]
    fn sc_warm_entry_conversion() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let fmt = SoundcloudFormat {
            url: "https://cf-media.sndcdn.com/synthAAAA1111.128.mp3?Policy=P&Signature=S&Key-Pair-Id=K"
                .into(),
            size: 4_567_890,
            ext: "mp3".into(),
            segments: Vec::new(),
        };
        let entry = soundcloud_warm_entry_with_lookup(&fmt, now, &mut public_lookup).unwrap();
        assert_eq!(entry.provider, "soundcloud");
        assert_eq!(entry.size, 4_567_890);
        assert_eq!(entry.ext, "mp3");
        assert_eq!(entry.expires_at, now + SOUNDCLOUD_WARM_TTL);
    }

    /// ⚠️ СТОРОЖ ШВА (регрессия 13.08). Проверок лимита содержимого ДВЕ — эта
    /// и в fetch_to_cache. Сняв пробу размера, я починил только вторую, и
    /// content_length_ok(0)=false уронил всю ступень 0 SoundCloud: клиент
    /// уходил в лестницу yt-dlp, «клик → звук» вырос с 3.1 с до 6.9 с. Дыра
    /// пришлась ровно между двумя протестированными единицами — ни один
    /// существующий тест её не видел. Ноль = «размер неизвестен», не «пустой
    /// файл»; настоящий лимит проверяется по заголовкам ответа и счётчику байт.
    #[test]
    fn sc_warm_entry_accepts_unknown_size() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let fmt = SoundcloudFormat {
            url: "https://cf-media.sndcdn.com/synthAAAA1111.128.mp3?Policy=P&Signature=S&Key-Pair-Id=K"
                .into(),
            size: 0, // ровно то, что отдаёт progressive-ветка с 13.08
            ext: "mp3".into(),
            segments: Vec::new(),
        };
        let entry = soundcloud_warm_entry_with_lookup(&fmt, now, &mut public_lookup)
            .expect("неизвестный размер обязан проходить — иначе ступень 0 падает в лестницу");
        assert_eq!(entry.size, 0);
    }

    /// А запредельный размер по-прежнему отвергается: снятие пробы не должно
    /// было превратиться в снятие лимита.
    #[test]
    fn sc_warm_entry_still_rejects_oversized() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let fmt = SoundcloudFormat {
            url: "https://cf-media.sndcdn.com/synthAAAA1111.128.mp3?Policy=P&Signature=S&Key-Pair-Id=K"
                .into(),
            size: MAX_YTDLP_OUTPUT_BYTES + 1,
            ext: "mp3".into(),
            segments: Vec::new(),
        };
        assert!(soundcloud_warm_entry_with_lookup(&fmt, now, &mut public_lookup).is_err());
    }

    /// Граница доверия warm-пути наследуется без ослаблений (https, без
    /// credentials, лимит 512 МиБ, грамматика ext).
    #[test]
    fn sc_warm_entry_inherits_trust_boundary() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        for (url, size, ext) in [
            ("http://cf-media.sndcdn.com/a.mp3", 100u64, "mp3"),
            ("https://user:pass@cf-media.sndcdn.com/a.mp3", 100, "mp3"),
            // ⚠️ size=0 отсюда УБРАН 13.08: с отменой пробы ноль означает
            // «размер неизвестен», а не «битый формат», и отвергать его —
            // ровно та регрессия, что уронила ступень 0 в лестницу. Отдельные
            // сторожа на ноль и на превышение лимита стоят выше.
            ("https://cf-media.sndcdn.com/a.mp3", MAX_YTDLP_OUTPUT_BYTES + 1, "mp3"),
            ("https://cf-media.sndcdn.com/a.mp3", 100, "MP3."),
        ] {
            let fmt = SoundcloudFormat {
                url: url.into(),
                size,
                ext: ext.into(),
                segments: Vec::new(),
            };
            assert!(
                soundcloud_warm_entry_with_lookup(&fmt, now, &mut public_lookup).is_err(),
                "{url} size={size} ext={ext} обязан отвергаться"
            );
        }
    }

    // ── Негативный кэш sc:-ключей ──────────────────────────────────

    /// SC-провалы живут в той же карте, что и YouTube, но под префиксом
    /// "sc:" — источники не задевают друг друга.
    #[test]
    fn stage0_fail_memory_sc_keys_are_namespaced() {
        let state = EngineState::default();
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        stage0_note_fail(&state, "sc:12345", t0);
        assert!(stage0_recently_failed(&state, "sc:12345", t0));
        assert!(
            !stage0_recently_failed(&state, "12345", t0),
            "yt-ключ не задет sc-провалом"
        );
        stage0_note_success(&state, "sc:12345");
        assert!(!stage0_recently_failed(&state, "sc:12345", t0));
    }

    /// Живой сквозной прогон SC-ступени: добыча client_id → api-v2 →
    /// transcoding → Range-проба → fetch_to_cache.
    /// `cargo test soundcloud_real -- --ignored --nocapture`
    #[test]
    #[ignore = "сеть: живые GET soundcloud.com, api-v2 и CDN"]
    fn soundcloud_real_resolve_and_fetch() {
        let dir = std::env::temp_dir().join("muza-soundcloud-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let state = EngineState::default();
        let canonical = sc_canonical("https://soundcloud.com/forss/flickermood");

        let started = std::time::Instant::now();
        let mut timings = Timings::default();
        let entry =
            tauri::async_runtime::block_on(resolve_via_soundcloud(&state, &canonical, &mut timings))
                .expect("прямой SC-резолв обязан пройти");
        println!(
            "резолв: {} мс, ext {}, size {}, фазы {:?}",
            started.elapsed().as_millis(),
            entry.ext,
            entry.size,
            timings.take()
        );

        let started = std::time::Instant::now();
        let path = tauri::async_runtime::block_on(fetch_to_cache(&dir, "smoke1", &entry))
            .expect("байты по CDN-URL обязаны доехать");
        let size = fs::metadata(&path).unwrap().len();
        println!(
            "байты: {} мс, {} байт, {}",
            started.elapsed().as_millis(),
            size,
            path.display()
        );
        assert_eq!(size, entry.size, "скачали ровно столько, сколько заявлено");
        assert!(size > 500_000, "полноразмерное аудио");
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod timings_tests {
    use super::*;

    /// ФОРМА СЕРИАЛИЗАЦИИ — договор с фронтом. Кортеж (String, u32) serde
    /// отдаёт МАССИВОМ из двух элементов, и это ровно то, что разбирает
    /// normalizeTimings (src/lib/startLog.ts): [["метка", мс], …].
    /// Тест держит именно форму: смени тип поля на структуру — и приёмник
    /// молча начнёт отбрасывать все отметки, потому что телеметрии запрещено
    /// ронять плеер, а значит и жаловаться она не станет.
    #[test]
    fn timings_serialize_as_pairs_of_label_and_ms() {
        let out = ResolveOut {
            path: "C:/cache/42.webm".into(),
            from_cache: false,
            provider: Some("soundcloud".into()),
            timings: vec![("sc_api_v2".into(), 340), ("sc_probe".into(), 21)],
        };
        let json: serde_json::Value = serde_json::to_value(&out).unwrap();
        assert_eq!(
            json["timings"],
            serde_json::json!([["sc_api_v2", 340], ["sc_probe", 21]])
        );
    }

    /// Пустой список — законный ответ (кэш-хит: добывать не пришлось), и он
    /// обязан ехать как [], а не как null/отсутствующее поле: normalizeTimings
    /// вернёт undefined, запись останется без фаз, разбор не сломается.
    #[test]
    fn empty_timings_serialize_as_empty_array() {
        let resolve = ResolveOut {
            path: "C:/cache/42.webm".into(),
            from_cache: true,
            provider: None,
            timings: Vec::new(),
        };
        let stream = StreamStartOut {
            stream: false,
            timings: Vec::new(),
        };
        assert_eq!(
            serde_json::to_value(&resolve).unwrap()["timings"],
            serde_json::json!([])
        );
        assert_eq!(
            serde_json::to_value(&stream).unwrap(),
            serde_json::json!({ "stream": false, "timings": [] })
        );
    }

    /// measure метит ИЗМЕРЕННЫЙ БЛОК и сохраняет порядок шагов; значение —
    /// длительность блока, а не момент времени (задержка видна в метке).
    #[test]
    fn measure_records_blocks_in_order_with_their_own_duration() {
        let mut t = Timings::default();
        let out = tauri::async_runtime::block_on(async {
            t.measure("first", async {
                std::thread::sleep(Duration::from_millis(12));
                7u32
            })
            .await;
            t.measure("second", async { "готово" }).await
        });
        assert_eq!(out, "готово");
        let marks = t.take();
        assert_eq!(
            marks.iter().map(|(l, _)| l.as_str()).collect::<Vec<_>>(),
            vec!["first", "second"]
        );
        assert!(marks[0].1 >= 10, "длительность блока, а не ноль: {marks:?}");
        assert!(
            marks[1].1 < marks[0].1,
            "второй блок мерится ОТДЕЛЬНО, а не от начала: {marks:?}"
        );
        assert!(t.take().is_empty(), "take опустошает: отметка не уедет дважды");
    }

    /// Потолок отметок: цикл с ошибкой на стороне добычи не имеет права
    /// раздуть журнал стартов (тот же предел, что у приёмника).
    #[test]
    fn timings_are_capped() {
        let mut t = Timings::default();
        for _ in 0..(TIMINGS_MAX + 10) {
            t.since("sc_api_v2", Instant::now());
        }
        assert_eq!(t.take().len(), TIMINGS_MAX);
    }
}
