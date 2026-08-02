// Системный прокси Windows для добычи (отчёт O, 22.07.2026): yt-dlp и
// reqwest по умолчанию не видят прокси/DPI-обходчик, настроенный в системе —
// POST на /player у обходчика не уходит, хотя браузер (который читает те же
// системные настройки через WinINET) работает штатно. Живая поимка 22.07 у
// владельца: «добыча падает, хотя браузер видит интернет».
//
// WinHTTP — тот же API, которым живут системные настройки прокси Windows
// (Параметры → Сеть → Прокси используют именно эту конфигурацию), НЕ WinINET
// браузера напрямую, но тот же первоисточник данных (реестр
// HKCU\...\Internet Settings), поэтому расхождений с браузером не бывает.
//
// Инварианты (не переоткрывать):
// - **`<local>` Windows НЕ покрывает `*.localhost`** — bypass наших
//   кастомных протоколов (`muza-stream.localhost`, `asset.localhost`)
//   зашит здесь ЖЁСТКО и НЕ зависит от пользовательской настройки: эти
//   хосты обязаны идти напрямую, иначе собственный трафик клиента ловит
//   его же DPI-обходчик/прокси (гоча отчёта O).
// - Кэш IE-конфига ~60с: `WinHttpGetIEProxyConfigForCurrentUser` читает
//   реестр при каждом вызове — недёшево на путь резолва per-track.
// - Кэш PAC-результата per-host ~5 мин: PAC/автообнаружение исполняется
//   `WinHttpGetProxyForUrl` ПО КОНКРЕТНОМУ URL (не по хосту формально, но
//   PAC-скрипты почти всегда решают по хосту — see отчёт O/MSDN), кэшируем
//   по хосту заявленного URL, чтобы не гонять WPAD/PAC на каждый трек.
// - Не-Windows сборка: `proxy_for` всегда `None` (компилируемость,
//   без заглушки "TODO" — на других ОС системного прокси Windows нет).
// - Логирование «нашли прокси» — ОДИН раз за сессию (см. engine::init),
//   НЕ здесь: этот модуль не знает про EngineState/stage0_log нарочно
//   (чистая переиспользуемая логика, тестируется без Tauri).

use url::Url;

/// Bypass, который обязаны соблюдать МЫ САМИ, а не пользовательская
/// настройка Windows: `<local>` (авто-bypass для хостов без точки) НЕ
/// покрывает `*.localhost`, и в конфиге прокси обычно никто не прописывает
/// наши кастомные протоколы вручную.
const HARD_BYPASS: &[&str] = &["localhost", "127.0.0.1", "::1", "*.localhost"];

/// Прокси-таргеты, разобранные из ОДНОЙ строки WinHTTP — форма строки
/// определяется тем, ОТКУДА она приехала (см. `parse_proxy_string`).
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct ParsedTargets {
    /// Общий таргет: голая строка `host:port` (форма 1) или первый `PROXY`
    /// из PAC-результата (форма 3) — годится для любого протокола.
    default: Option<String>,
    http: Option<String>,
    https: Option<String>,
    socks: Option<String>,
}

/// Разбор строки прокси WinHTTP — три грамматики живут в одной функции,
/// потому что ИМЕННО эти три формы реально приходят из разных вызовов:
/// 1) `"host:port"` — `WINHTTP_CURRENT_USER_IE_PROXY_CONFIG.lpszProxy`,
///    когда в настройках указан один прокси на все протоколы;
/// 2) `"http=h:p;https=h2:p2;socks=h3:p3"` — тот же `lpszProxy`, но когда
///    в настройках расписаны разные прокси по протоколам (`=`-пары через
///    `;`, ключ регистронезависим);
/// 3) `"PROXY h:p; DIRECT"` / `"PROXY h:p; SOCKS h2:p2; DIRECT"` —
///    результат `WinHttpGetProxyForUrl` (ручной PAC-скрипт или
///    автообнаружение): список альтернатив через `;`, ключевые слова
///    `PROXY`/`SOCKS`/`DIRECT` (регистр не гарантирован PAC-движком).
/// Пустая/нераспознанная строка → всё `None` (`proxy_for` отдаст `None` —
/// прямое соединение, как было до этой задачи).
fn parse_proxy_string(raw: &str) -> ParsedTargets {
    let raw = raw.trim();
    if raw.is_empty() {
        return ParsedTargets::default();
    }
    let looks_like_pac_result = raw
        .split(&[';', ' '][..])
        .any(|tok| ["PROXY", "SOCKS", "SOCKS5", "SOCKS4", "DIRECT"].contains(&tok.to_ascii_uppercase().as_str()));
    if looks_like_pac_result {
        let mut out = ParsedTargets::default();
        for entry in raw.split(';') {
            let entry = entry.trim();
            if entry.is_empty() {
                continue;
            }
            let mut parts = entry.splitn(2, char::is_whitespace);
            let kind = parts.next().unwrap_or("").to_ascii_uppercase();
            let target = parts.next().unwrap_or("").trim();
            match kind.as_str() {
                "SOCKS" | "SOCKS5" | "SOCKS4" if !target.is_empty() && out.socks.is_none() => {
                    out.socks = Some(target.to_string());
                }
                "PROXY" | "HTTP" if !target.is_empty() && out.default.is_none() => {
                    out.default = Some(target.to_string());
                }
                _ => {}
            }
        }
        return out;
    }
    if raw.contains('=') {
        let mut out = ParsedTargets::default();
        for entry in raw.split(';') {
            let entry = entry.trim();
            let Some((k, v)) = entry.split_once('=') else {
                continue;
            };
            let v = v.trim();
            if v.is_empty() {
                continue;
            }
            match k.trim().to_ascii_lowercase().as_str() {
                "http" => out.http = Some(v.to_string()),
                "https" => out.https = Some(v.to_string()),
                "socks" => out.socks = Some(v.to_string()),
                _ => {}
            }
        }
        return out;
    }
    ParsedTargets {
        default: Some(raw.to_string()),
        ..Default::default()
    }
}

/// Таргет для конкретной схемы запроса: явная пара (http=/https=) важнее
/// общего дефолта; SOCKS в `ParsedTargets` не участвует здесь — его
/// осознанно выбирает вызывающий (`pick_and_normalize`), потому что SOCKS
/// меняет СХЕМУ возвращаемой строки (`socks5://`), а не адрес для https.
fn target_for_scheme<'a>(parsed: &'a ParsedTargets, scheme: &str) -> Option<&'a str> {
    match scheme {
        "https" => parsed.https.as_deref().or(parsed.default.as_deref()),
        "http" => parsed.http.as_deref().or(parsed.default.as_deref()),
        _ => parsed.default.as_deref(),
    }
}

/// `host:port` → `scheme://host:port`; строка, уже несущая свою схему
/// (`socks5://...`), не трогается — WinHTTP такое не отдаёт, но грамматика
/// защищена от неожиданностей на будущее.
fn normalize_target(raw: &str, scheme: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.contains("://") {
        return Some(raw.to_string());
    }
    Some(format!("{scheme}://{raw}"))
}

/// Выбор итоговой строки для reqwest/yt-dlp: HTTP(S)-таргет приоритетнее
/// (если настроен per-protocol) — SOCKS остаётся запасным, когда для
/// схемы запроса явного HTTP-таргета нет вообще (частый случай PAC-only
/// SOCKS-конфигов у DPI-обходчиков).
fn pick_and_normalize(parsed: &ParsedTargets, scheme: &str) -> Option<String> {
    if let Some(t) = target_for_scheme(parsed, scheme) {
        return normalize_target(t, "http");
    }
    if let Some(t) = &parsed.socks {
        return normalize_target(t, "socks5");
    }
    None
}

/// Простая wildcard-грамматика bypass-листов WinHTTP: `*.domain.tld` (суффикс)
/// и `domain.tld*` (префикс, редко, но валиден), иначе точное совпадение
/// хоста (регистронезависимо — DNS-имена нечувствительны к регистру).
fn host_matches_bypass_entry(host: &str, entry: &str) -> bool {
    let host = host.to_ascii_lowercase();
    let entry = entry.trim().to_ascii_lowercase();
    if entry.is_empty() {
        return false;
    }
    if let Some(suffix) = entry.strip_prefix('*') {
        return host.ends_with(suffix);
    }
    if let Some(prefix) = entry.strip_suffix('*') {
        return host.starts_with(prefix);
    }
    host == entry
}

fn host_matches_any_bypass(host: &str, entries: &[&str]) -> bool {
    entries.iter().any(|e| host_matches_bypass_entry(host, e))
}

/// Bypass-лист WinHTTP — строка `lpszProxyBypass`, элементы через `;`
/// (иногда через пробел) плюс служебный токен `<local>` (хосты без точки в
/// имени — НЕ обрабатываем отдельно: короткие имена — не наш случай,
/// `*.localhost` уже покрыт HARD_BYPASS).
fn split_bypass_list(raw: &str) -> Vec<String> {
    raw.split(|c: char| c == ';' || c.is_whitespace())
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "<local>")
        .map(str::to_ascii_lowercase)
        .collect()
}

/// Итог разбора `WINHTTP_CURRENT_USER_IE_PROXY_CONFIG` — снимок системной
/// конфигурации прокси на момент чтения (см. `ie_config` за кэшем ~60с).
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct IeProxyConfig {
    pub manual_proxy: Option<String>,
    pub manual_bypass: Option<String>,
    pub auto_detect: bool,
    pub auto_config_url: Option<String>,
}

/// Ядро `proxy_for`, независимое от источника конфигурации — тестируется
/// без единого вызова WinHTTP. `pac_lookup` вызывается ТОЛЬКО когда ручного
/// прокси для нужной схемы нет и включены autodetect/PAC (дорогой путь).
fn resolve_proxy(
    url: &str,
    cfg: &IeProxyConfig,
    pac_lookup: impl FnOnce(&str, bool, Option<&str>) -> Option<String>,
) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    if host_matches_any_bypass(host, HARD_BYPASS) {
        return None;
    }
    if let Some(bypass) = &cfg.manual_bypass {
        let list = split_bypass_list(bypass);
        let refs: Vec<&str> = list.iter().map(String::as_str).collect();
        if host_matches_any_bypass(host, &refs) {
            return None;
        }
    }
    if let Some(manual) = &cfg.manual_proxy {
        let targets = parse_proxy_string(manual);
        if let Some(picked) = pick_and_normalize(&targets, parsed.scheme()) {
            return Some(picked);
        }
    }
    if cfg.auto_detect || cfg.auto_config_url.is_some() {
        return pac_lookup(url, cfg.auto_detect, cfg.auto_config_url.as_deref());
    }
    None
}

#[cfg(target_os = "windows")]
mod win {
    use super::{parse_proxy_string, pick_and_normalize, resolve_proxy, IeProxyConfig};
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
    use windows::Win32::Networking::WinHttp::{
        WinHttpGetIEProxyConfigForCurrentUser, WinHttpGetProxyForUrl, WinHttpOpen,
        WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_AUTOPROXY_AUTO_DETECT, WINHTTP_AUTOPROXY_CONFIG_URL,
        WINHTTP_AUTOPROXY_OPTIONS, WINHTTP_AUTO_DETECT_TYPE_DHCP, WINHTTP_AUTO_DETECT_TYPE_DNS_A,
        WINHTTP_CURRENT_USER_IE_PROXY_CONFIG, WINHTTP_PROXY_INFO,
    };

    const IE_CONFIG_TTL: Duration = Duration::from_secs(60);
    const PAC_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

    struct IeConfigCache {
        at: Instant,
        cfg: IeProxyConfig,
    }

    /// Хендл WinHTTP-сессии (`*mut c_void`, эта версия API возвращает сырой
    /// указатель, не типизированный HINTERNET) — MSDN разрешает делить
    /// hSession между потоками для автопрокси-вызовов, windows-rs просто не
    /// выводит Send/Sync для сырого указателя автоматически.
    struct SessionHandle(*mut c_void);
    unsafe impl Send for SessionHandle {}
    unsafe impl Sync for SessionHandle {}

    static IE_CONFIG: Mutex<Option<IeConfigCache>> = Mutex::new(None);
    static PAC_CACHE: Mutex<Option<HashMap<String, (Instant, Option<String>)>>> = Mutex::new(None);
    /// Сессия WinHTTP только для автообнаружения/PAC — открывается один раз
    /// (WinHttpOpen — не бесплатный, а WinHttpGetProxyForUrl можно дёргать
    /// на уже открытой сессии сколько угодно раз). `WINHTTP_ACCESS_TYPE_NO_PROXY`,
    /// потому что эта сессия НЕ шлёт запросы сама — только вычисляет прокси.
    static AUTOPROXY_SESSION: OnceLock<Option<SessionHandle>> = OnceLock::new();

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// PWSTR из WinHTTP → String + GlobalFree, единой функцией, чтобы не
    /// забыть освободить память (три поля IE-конфига одинаковые по форме;
    /// MSDN требует GlobalFree ровно для lpszProxy/lpszProxyBypass/
    /// lpszAutoConfigUrl этой структуры и для lpszProxy WINHTTP_PROXY_INFO).
    unsafe fn take_pwstr(p: PWSTR) -> Option<String> {
        if p.is_null() {
            return None;
        }
        let out = p.to_string().ok();
        let _ = GlobalFree(Some(HGLOBAL(p.0.cast())));
        out
    }

    /// Живое чтение `WinHttpGetIEProxyConfigForCurrentUser` — реестровый
    /// вызов, дорого дёргать на каждый трек (см. IE_CONFIG_TTL выше).
    fn fetch_ie_config() -> IeProxyConfig {
        unsafe {
            let mut raw = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
            if WinHttpGetIEProxyConfigForCurrentUser(&mut raw).is_err() {
                return IeProxyConfig::default();
            }
            IeProxyConfig {
                auto_detect: raw.fAutoDetect.as_bool(),
                auto_config_url: take_pwstr(raw.lpszAutoConfigUrl),
                manual_proxy: take_pwstr(raw.lpszProxy),
                manual_bypass: take_pwstr(raw.lpszProxyBypass),
            }
        }
    }

    fn ie_config(now: Instant) -> IeProxyConfig {
        let mut guard = IE_CONFIG.lock().unwrap();
        if let Some(cached) = guard.as_ref() {
            if now.duration_since(cached.at) < IE_CONFIG_TTL {
                return cached.cfg.clone();
            }
        }
        let cfg = fetch_ie_config();
        *guard = Some(IeConfigCache {
            at: now,
            cfg: cfg.clone(),
        });
        cfg
    }

    fn autoproxy_session() -> Option<*mut c_void> {
        AUTOPROXY_SESSION
            .get_or_init(|| unsafe {
                let agent = to_wide("Muza");
                let handle = WinHttpOpen(
                    PCWSTR::from_raw(agent.as_ptr()),
                    WINHTTP_ACCESS_TYPE_NO_PROXY,
                    PCWSTR::null(),
                    PCWSTR::null(),
                    0,
                );
                if handle.is_null() {
                    None
                } else {
                    Some(SessionHandle(handle))
                }
            })
            .as_ref()
            .map(|s| s.0)
    }

    /// PAC/автообнаружение для ОДНОГО url — дорогой путь (WinHttpGetProxyForUrl
    /// может уйти в сеть за WPAD/скачать PAC-скрипт), поэтому кэшируется
    /// per-host на PAC_CACHE_TTL выше вызывающим (`pac_lookup_cached`).
    fn pac_lookup_live(url: &str, auto_detect: bool, config_url: Option<&str>) -> Option<String> {
        let session = autoproxy_session()?;
        let wide_url = to_wide(url);
        let wide_config = config_url.map(to_wide);
        unsafe {
            let mut flags: u32 = 0;
            if auto_detect {
                flags |= WINHTTP_AUTOPROXY_AUTO_DETECT;
            }
            if wide_config.is_some() {
                flags |= WINHTTP_AUTOPROXY_CONFIG_URL;
            }
            let mut options = WINHTTP_AUTOPROXY_OPTIONS {
                dwFlags: flags,
                dwAutoDetectFlags: if auto_detect {
                    WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A
                } else {
                    0
                },
                lpszAutoConfigUrl: wide_config
                    .as_ref()
                    .map(|w| PCWSTR::from_raw(w.as_ptr()))
                    .unwrap_or(PCWSTR::null()),
                fAutoLogonIfChallenged: true.into(),
                ..Default::default()
            };
            let mut info = WINHTTP_PROXY_INFO::default();
            let ok = WinHttpGetProxyForUrl(
                session,
                PCWSTR::from_raw(wide_url.as_ptr()),
                &mut options,
                &mut info,
            )
            .is_ok();
            if !ok {
                return None;
            }
            let proxy = take_pwstr(info.lpszProxy);
            let _ = take_pwstr(info.lpszProxyBypass);
            proxy
        }
    }

    fn host_cache_key(url: &str) -> String {
        url::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_default()
    }

    fn pac_lookup_cached(url: &str, auto_detect: bool, config_url: Option<&str>) -> Option<String> {
        let host = host_cache_key(url);
        let now = Instant::now();
        {
            let mut guard = PAC_CACHE.lock().unwrap();
            let map = guard.get_or_insert_with(HashMap::new);
            if let Some((at, cached)) = map.get(&host) {
                if now.duration_since(*at) < PAC_CACHE_TTL {
                    return cached.clone();
                }
            }
        }
        let result = pac_lookup_live(url, auto_detect, config_url).and_then(|raw| {
            let targets = parse_proxy_string(&raw);
            let scheme = url::Url::parse(url).ok()?.scheme().to_string();
            pick_and_normalize(&targets, &scheme)
        });
        let mut guard = PAC_CACHE.lock().unwrap();
        guard
            .get_or_insert_with(HashMap::new)
            .insert(host, (now, result.clone()));
        result
    }

    pub(crate) fn proxy_for(url: &str) -> Option<String> {
        let cfg = ie_config(Instant::now());
        resolve_proxy(url, &cfg, pac_lookup_cached)
    }
}

/// Разбор значения аварийного выключателя. Вынесен отдельной чистой функцией
/// нарочно: само значение кэшируется на весь запуск, поэтому тест, дёргающий
/// переменную окружения, был бы зависим от порядка тестов.
#[cfg(target_os = "windows")]
fn disabled_by_value(value: Option<&str>) -> bool {
    matches!(
        value.map(|v| v.trim().to_ascii_lowercase()).as_deref(),
        Some("1") | Some("true") | Some("yes")
    )
}

/// Аварийный выход: `MUZA_NO_SYSTEM_PROXY=1` полностью выключает системный
/// прокси — добыча ходит напрямую, ровно как в v0.1.5.
///
/// Зачем: прокси берётся всегда, когда он настроен в Windows, и это правильно
/// для тех, кто его ставил ради обхода. Но есть узкая группа, которой стало
/// хуже: прокси есть, браузер через него ходит, а музыкальные площадки он не
/// тянет — трек просто не заводится, и связать это с настройками сети человек
/// сам не может. Список исключений Windows приложение соблюдает, но требовать
/// от пользователя редактировать его — не выход на время до появления тумблера
/// в интерфейсе (запланирован, см. docs/subsystems/добыча.md).
///
/// Читается ОДИН раз за запуск: менять на лету незачем, а чтение ДО любого
/// обращения к WinHTTP заодно снимает синхронный запрос к системе на старте —
/// на машине с залипшим PAC-адресом именно он подвешивал окно.
#[cfg(target_os = "windows")]
fn system_proxy_disabled() -> bool {
    static DISABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *DISABLED.get_or_init(|| {
        disabled_by_value(std::env::var("MUZA_NO_SYSTEM_PROXY").ok().as_deref())
    })
}

#[cfg(target_os = "windows")]
pub fn proxy_for(url: &str) -> Option<String> {
    if system_proxy_disabled() {
        return None;
    }
    win::proxy_for(url)
}

/// Не-Windows сборка: системного прокси Windows здесь нет по определению —
/// не заглушка "TODO", а честный факт платформы (см. шапку файла).
#[cfg(not(target_os = "windows"))]
pub fn proxy_for(_url: &str) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Живой прогон реального `WinHttpGetIEProxyConfigForCurrentUser` +
    /// (если PAC/автообнаружение включены) `WinHttpGetProxyForUrl` на ЭТОЙ
    /// машине — единственное, что unit-тесты `resolve_proxy` не покрывают
    /// (там транспорт инъецирован). Печатает найденное, но не требует
    /// конкретного значения: результат зависит от системных настроек
    /// прокси машины, где запущен тест.
    /// `cargo test sysproxy::tests::live_winhttp_smoke -- --ignored --nocapture`
    #[test]
    #[ignore = "живой вызов WinHTTP — читает реальную системную конфигурацию прокси"]
    fn live_winhttp_smoke() {
        let youtube = proxy_for("https://www.youtube.com/");
        println!("proxy_for(youtube) = {youtube:?}");
        assert_eq!(
            proxy_for("http://muza-stream.localhost/ns/track"),
            None,
            "жёсткий bypass обязан работать даже если куда-то настроен прокси на всё"
        );
        assert_eq!(proxy_for("http://asset.localhost/x"), None);
        assert_eq!(proxy_for("http://127.0.0.1:4321/x"), None);
        // Второй вызов подряд — должен попасть в 60с-кэш IE-конфига (не падает,
        // не виснет; сама скорость проверяется глазами по --nocapture).
        let again = proxy_for("https://www.youtube.com/");
        assert_eq!(youtube, again, "кэш IE-конфига отдаёт то же значение");
    }

    #[test]
    fn parse_bare_host_port() {
        let p = parse_proxy_string("proxy.local:8080");
        assert_eq!(p.default.as_deref(), Some("proxy.local:8080"));
        assert!(p.http.is_none() && p.https.is_none() && p.socks.is_none());
    }

    #[test]
    fn parse_per_protocol_pairs() {
        let p = parse_proxy_string("http=a:1;https=b:2;socks=c:3");
        assert_eq!(p.http.as_deref(), Some("a:1"));
        assert_eq!(p.https.as_deref(), Some("b:2"));
        assert_eq!(p.socks.as_deref(), Some("c:3"));
    }

    #[test]
    fn parse_per_protocol_pairs_case_and_spaces() {
        let p = parse_proxy_string(" HTTP = a:1 ; HTTPS=b:2 ");
        assert_eq!(p.http.as_deref(), Some("a:1"));
        assert_eq!(p.https.as_deref(), Some("b:2"));
    }

    #[test]
    fn parse_pac_result_single_proxy_with_direct() {
        let p = parse_proxy_string("PROXY a:8080; DIRECT");
        assert_eq!(p.default.as_deref(), Some("a:8080"));
        assert!(p.socks.is_none());
    }

    #[test]
    fn parse_pac_result_socks_fallback() {
        let p = parse_proxy_string("SOCKS s:1080; DIRECT");
        assert_eq!(p.socks.as_deref(), Some("s:1080"));
        assert!(p.default.is_none());
    }

    #[test]
    fn parse_pac_result_proxy_then_socks() {
        let p = parse_proxy_string("PROXY a:8080; SOCKS s:1080; DIRECT");
        assert_eq!(p.default.as_deref(), Some("a:8080"));
        assert_eq!(p.socks.as_deref(), Some("s:1080"));
    }

    #[test]
    fn parse_empty_and_direct_only() {
        assert_eq!(parse_proxy_string(""), ParsedTargets::default());
        assert_eq!(parse_proxy_string("DIRECT"), ParsedTargets::default());
    }

    #[test]
    fn normalize_adds_http_scheme() {
        assert_eq!(
            normalize_target("a:8080", "http"),
            Some("http://a:8080".to_string())
        );
        assert_eq!(
            normalize_target("socks5://a:1080", "http"),
            Some("socks5://a:1080".to_string())
        );
        assert_eq!(normalize_target("", "http"), None);
    }

    #[test]
    fn pick_prefers_explicit_scheme_target_over_default() {
        let p = ParsedTargets {
            default: Some("d:1".into()),
            https: Some("h:2".into()),
            ..Default::default()
        };
        assert_eq!(
            pick_and_normalize(&p, "https"),
            Some("http://h:2".to_string())
        );
        assert_eq!(
            pick_and_normalize(&p, "http"),
            Some("http://d:1".to_string())
        );
    }

    #[test]
    fn pick_falls_back_to_socks_when_no_http_target() {
        let p = ParsedTargets {
            socks: Some("s:1080".into()),
            ..Default::default()
        };
        assert_eq!(
            pick_and_normalize(&p, "https"),
            Some("socks5://s:1080".to_string())
        );
    }

    #[test]
    fn pick_none_when_nothing_configured() {
        assert_eq!(pick_and_normalize(&ParsedTargets::default(), "https"), None);
    }

    #[test]
    fn bypass_matches_exact_suffix_and_prefix_wildcards() {
        assert!(host_matches_bypass_entry("intra.corp.local", "*.corp.local"));
        assert!(host_matches_bypass_entry("corp.local", "corp.local*"));
        assert!(host_matches_bypass_entry("Corp.Local", "corp.local"));
        assert!(!host_matches_bypass_entry("evil-corp.local", "*.corp.local"));
        assert!(!host_matches_bypass_entry("example.com", "*.corp.local"));
    }

    #[test]
    fn split_bypass_ignores_local_token() {
        let list = split_bypass_list("*.corp.local; <local> ;10.0.0.1");
        assert_eq!(list, vec!["*.corp.local".to_string(), "10.0.0.1".to_string()]);
    }

    /// Гоча отчёта O: `.localhost` НИКОГДА не проксируется, даже если
    /// пользователь как-то умудрился прописать в конфиге прокси на ВСЁ —
    /// muza-stream.localhost/asset.localhost обязаны идти напрямую.
    #[test]
    fn hard_bypass_wins_over_manual_proxy_for_everything() {
        let cfg = IeProxyConfig {
            manual_proxy: Some("proxy.local:8080".into()),
            ..Default::default()
        };
        assert_eq!(
            resolve_proxy("http://muza-stream.localhost/track", &cfg, |_, _, _| panic!(
                "PAC не должен звонить — hard bypass раньше"
            )),
            None
        );
        assert_eq!(
            resolve_proxy("http://asset.localhost/x", &cfg, |_, _, _| panic!(
                "PAC не должен звонить"
            )),
            None
        );
        assert_eq!(
            resolve_proxy("http://127.0.0.1:1234/x", &cfg, |_, _, _| panic!(
                "PAC не должен звонить"
            )),
            None
        );
    }

    #[test]
    fn manual_proxy_used_for_ordinary_host() {
        let cfg = IeProxyConfig {
            manual_proxy: Some("http=a:1;https=b:2".into()),
            ..Default::default()
        };
        assert_eq!(
            resolve_proxy("https://www.youtube.com/watch", &cfg, |_, _, _| panic!(
                "ручной прокси есть — PAC не нужен"
            )),
            Some("http://b:2".to_string())
        );
    }

    #[test]
    fn user_bypass_list_is_respected() {
        let cfg = IeProxyConfig {
            manual_proxy: Some("proxy.local:8080".into()),
            manual_bypass: Some("*.internal.example".into()),
            ..Default::default()
        };
        assert_eq!(
            resolve_proxy("https://api.internal.example/x", &cfg, |_, _, _| panic!(
                "PAC не должен звонить"
            )),
            None
        );
    }

    #[test]
    fn no_config_at_all_is_direct_silently() {
        assert_eq!(resolve_proxy("https://example.com/", &IeProxyConfig::default(), |_, _, _| {
            panic!("autodetect выключен — PAC не звоним")
        }), None);
    }

    #[test]
    fn pac_path_used_when_autodetect_and_no_manual_proxy() {
        let cfg = IeProxyConfig {
            auto_detect: true,
            ..Default::default()
        };
        let mut called_with = None;
        let result = resolve_proxy("https://example.com/", &cfg, |u, auto, pac| {
            called_with = Some((u.to_string(), auto, pac.map(str::to_string)));
            Some("http://pac-result:3128".to_string())
        });
        assert_eq!(result, Some("http://pac-result:3128".to_string()));
        assert_eq!(
            called_with,
            Some(("https://example.com/".to_string(), true, None))
        );
    }

    #[test]
    fn invalid_url_is_none() {
        assert_eq!(
            resolve_proxy("not a url", &IeProxyConfig::default(), |_, _, _| None),
            None
        );
    }

    /// Аварийный выключатель: включается только явным значением. Пустая строка
    /// и «0» — это НЕ «выключить прокси»: переменная, случайно объявленная
    /// пустой в чужом окружении, не должна молча возвращать поведение 0.1.5.
    #[cfg(target_os = "windows")]
    #[test]
    fn no_system_proxy_switch_reads_only_explicit_values() {
        for on in ["1", "true", "yes", "TRUE", " 1 "] {
            assert!(disabled_by_value(Some(on)), "{on:?} обязан выключать прокси");
        }
        for off in ["", "0", "false", "no", "off", "да"] {
            assert!(
                !disabled_by_value(Some(off)),
                "{off:?} НЕ должен выключать прокси"
            );
        }
        assert!(!disabled_by_value(None));
    }
}
