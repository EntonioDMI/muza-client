// Рантайм плагинов уровня 1 (эпик W8, T44): custom-протокол `muza-plugin`
// (песочница — bootstrap-документ со своим CSP, независимым от глобального),
// установка из .muzaplugin (zip, распаковка с защитой от zip-slip/бомбы —
// глубокая валидация манифеста/AST-скан entry делаются на TS-стороне,
// см. packages/core/src/plugin/{manifest,scan}.ts — Rust тут JS не исполняет),
// installed.json, KV-storage с квотой, net-fetch с allowlist.
//
// См. docs/notes/2026-07-13-плагины-архитектура.md §2, §4, §6.1.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read as _;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

/// Вшитый guest-рантайм (window.Muza SDK) — плейн JS, не через npm/бандлер
/// (исполняется в песочнице без доступа к ним). См. plugin_guest_runtime.js.
const GUEST_RUNTIME_JS: &str = include_str!("plugin_guest_runtime.js");

const MAX_UNPACKED_BYTES: u64 = 2 * 1024 * 1024; // 2 МБ — лимит распакованного пакета
const MAX_ENTRY_COUNT: usize = 64;
const STORAGE_QUOTA_BYTES: usize = 1024 * 1024; // 1 МБ KV на плагин
const NET_BODY_LIMIT: usize = 5 * 1024 * 1024; // 5 МБ тело ответа net.fetch

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPlugin {
    pub id: String,
    pub version: String,
    pub enabled: bool,
    pub manifest: serde_json::Value,
    pub granted: Vec<String>,
    #[serde(default)]
    pub granted_at: String,
    /// Денормализованное содержимое contributes.css (если объявлен) — хранится
    /// прямо в installed.json, чтобы host.ts (apps/desktop/src/plugins/host.ts)
    /// мог применить CSS плагина при каждом старте без лишнего round-trip
    /// в Rust за чтением файла с диска.
    #[serde(default)]
    pub css: Option<String>,
}

#[derive(Default)]
pub struct PluginsState {
    /// Сериализует конкурентные read-modify-write installed.json (команды
    /// зовутся из фронта по одной, но список должен остаться консистентным
    /// и при двух почти одновременных кликах в Settings).
    lock: Mutex<()>,
}

static NONCE_COUNTER: AtomicU64 = AtomicU64::new(0);

// ── Пути и общие утилиты ─────────────────────────────────────────

fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("internal: {e}"))?
        .join("plugins");
    fs::create_dir_all(&dir).map_err(|e| format!("internal: {e}"))?;
    Ok(dir)
}

fn installed_json_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(plugins_dir(app)?.join("installed.json"))
}

fn read_installed(app: &AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    let path = installed_json_path(app)?;
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(Vec::new());
    };
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&raw).map_err(|e| format!("internal: installed.json битый: {e}"))
}

fn write_installed(app: &AppHandle, list: &[InstalledPlugin]) -> Result<(), String> {
    let path = installed_json_path(app)?;
    let raw = serde_json::to_string_pretty(list).map_err(|e| format!("internal: {e}"))?;
    fs::write(path, raw).map_err(|e| format!("internal: {e}"))
}

/// id плагина используется как компонент файлового пути — валидируем
/// строго на Rust-стороне тоже (фронту на слово не верим), та же форма,
/// что в Zod-схеме packages/core/src/plugin/manifest.ts.
fn sanitize_id(id: &str) -> Result<String, String> {
    let bytes = id.as_bytes();
    let len = bytes.len();
    if !(3..=40).contains(&len) {
        return Err("bad_args: id: длина 3-40 символов".into());
    }
    let is_alnum = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if !is_alnum(bytes[0]) || !is_alnum(bytes[len - 1]) {
        return Err("bad_args: id: начало/конец — латиница/цифра".into());
    }
    for &b in bytes {
        if !(is_alnum(b) || b == b'-') {
            return Err("bad_args: id: только a-z0-9-".into());
        }
    }
    Ok(id.to_string())
}

fn random_nonce() -> String {
    let n = NONCE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut hasher = Sha256::new();
    hasher.update(t.to_le_bytes());
    hasher.update(n.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    let digest = hasher.finalize();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&digest[..16])
}

// ── Установленные плагины: список/вкл-выкл/удаление ──────────────

#[tauri::command]
pub fn list_installed(app: AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    read_installed(&app)
}

#[tauri::command]
pub fn set_plugin_enabled(
    app: AppHandle,
    state: State<'_, PluginsState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let id = sanitize_id(&id)?;
    let _g = state.lock.lock().unwrap();
    let mut list = read_installed(&app)?;
    let Some(p) = list.iter_mut().find(|p| p.id == id) else {
        return Err("bad_args: плагин не найден".into());
    };
    p.enabled = enabled;
    write_installed(&app, &list)
}

#[tauri::command]
pub fn uninstall_plugin(app: AppHandle, state: State<'_, PluginsState>, id: String) -> Result<(), String> {
    let id = sanitize_id(&id)?;
    let _g = state.lock.lock().unwrap();
    let mut list = read_installed(&app)?;
    list.retain(|p| p.id != id);
    write_installed(&app, &list)?;
    let _ = fs::remove_dir_all(plugins_dir(&app)?.join(&id));
    let _ = fs::remove_file(plugins_dir(&app)?.join(".storage").join(format!("{id}.json")));
    Ok(())
}

// ── Установка из файла: стейджинг (Rust) → валидация/скан (TS) → финализация ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedPlugin {
    pub staged_dir: String,
    pub manifest_json: String,
    pub entry_code: String,
    pub css_code: Option<String>,
    pub strings_json: Option<String>,
}

/// Распаковать .muzaplugin во временную папку `$APPDATA/plugins/.staging/<токен>/`
/// с защитой от zip-slip (только `enclosed_name()`) и zip-бомбы (лимит
/// суммарного распакованного размера и числа записей). Глубокая валидация
/// манифеста (Zod) и AST/CSS-скан — на TS-стороне (plugin_stage_from_file
/// НЕ является достаточной защитой сама по себе, это только безопасная
/// распаковка); финализация — отдельной командой после согласия пользователя.
#[tauri::command]
pub fn plugin_stage_from_file(app: AppHandle, path: String) -> Result<StagedPlugin, String> {
    let file = fs::File::open(&path).map_err(|e| format!("bad_args: не открылся файл: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("bad_args: не похоже на .muzaplugin (zip): {e}"))?;
    if zip.len() > MAX_ENTRY_COUNT {
        return Err("bad_args: слишком много файлов в пакете".into());
    }

    let staging_root = plugins_dir(&app)?.join(".staging");
    fs::create_dir_all(&staging_root).map_err(|e| format!("internal: {e}"))?;
    let token = random_nonce();
    let staged_dir = staging_root.join(&token);
    fs::create_dir_all(&staged_dir).map_err(|e| format!("internal: {e}"))?;

    let mut total: u64 = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("bad_args: битый пакет: {e}"))?;
        total += entry.size();
        if total > MAX_UNPACKED_BYTES {
            let _ = fs::remove_dir_all(&staged_dir);
            return Err("bad_args: пакет распаковывается больше 2 МБ — отклонено".into());
        }
        let Some(rel) = entry.enclosed_name() else {
            let _ = fs::remove_dir_all(&staged_dir);
            return Err("bad_args: недопустимый путь внутри пакета (zip-slip)".into());
        };
        let dest = staged_dir.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| format!("internal: {e}"))?;
            continue;
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("internal: {e}"))?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| format!("internal: {e}"))?;
        fs::write(&dest, &buf).map_err(|e| format!("internal: {e}"))?;
    }

    let manifest_json = fs::read_to_string(staged_dir.join("manifest.json"))
        .map_err(|_| "bad_args: в пакете нет manifest.json".to_string())?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_json).map_err(|e| format!("bad_args: manifest.json битый: {e}"))?;
    let entry_rel = manifest
        .get("entry")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "bad_args: manifest.entry отсутствует".to_string())?;
    let entry_code = fs::read_to_string(staged_dir.join(entry_rel))
        .map_err(|e| format!("bad_args: не читается entry «{entry_rel}»: {e}"))?;

    let css_code = manifest
        .get("contributes")
        .and_then(|c| c.get("css"))
        .and_then(|v| v.as_str())
        .and_then(|rel| fs::read_to_string(staged_dir.join(rel)).ok());
    let strings_json = manifest
        .get("contributes")
        .and_then(|c| c.get("strings"))
        .and_then(|v| v.as_str())
        .and_then(|rel| fs::read_to_string(staged_dir.join(rel)).ok());

    Ok(StagedPlugin {
        staged_dir: staged_dir.to_string_lossy().to_string(),
        manifest_json,
        entry_code,
        css_code,
        strings_json,
    })
}

/// Путь обязан лежать внутри `.staging/` — защита от того, чтобы фронт
/// (по ошибке или иначе) не подсунул произвольный путь на удаление/перенос.
fn require_staging_path(p: &PathBuf) -> Result<(), String> {
    if p.components().any(|c| c.as_os_str() == ".staging") {
        Ok(())
    } else {
        Err("bad_args: недопустимый путь стейджинга".into())
    }
}

#[tauri::command]
pub fn plugin_discard_staged(staged_dir: String) -> Result<(), String> {
    let p = PathBuf::from(&staged_dir);
    require_staging_path(&p)?;
    let _ = fs::remove_dir_all(p);
    Ok(())
}

/// Финализация после согласия пользователя на права (модалка в SettingsView):
/// переносим стейджинг в постоянную папку плагина и дописываем installed.json.
/// `granted` — права, на которые согласился пользователь (может быть
/// подмножеством `manifest.permissions`, если модалка это допускает; T44
/// согласие — всё-или-ничего, но список принимаем явно на будущее T44b).
#[tauri::command]
pub fn plugin_finalize_install(
    app: AppHandle,
    state: State<'_, PluginsState>,
    staged_dir: String,
    id: String,
    version: String,
    manifest_json: String,
    granted: Vec<String>,
    css: Option<String>,
) -> Result<(), String> {
    let id = sanitize_id(&id)?;
    let src = PathBuf::from(&staged_dir);
    require_staging_path(&src)?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_json).map_err(|e| format!("bad_args: {e}"))?;

    let _g = state.lock.lock().unwrap();
    let dest = plugins_dir(&app)?.join(&id);
    let _ = fs::remove_dir_all(&dest); // переустановка/обновление — старое стирается
    fs::rename(&src, &dest).map_err(|e| format!("internal: не удалось установить: {e}"))?;

    let granted_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    let mut list = read_installed(&app)?;
    list.retain(|p| p.id != id);
    list.push(InstalledPlugin {
        id,
        version,
        enabled: true,
        manifest,
        granted,
        granted_at,
        css,
    });
    write_installed(&app, &list)
}

// ── Custom-протокол muza-plugin: bootstrap-документ песочницы ────

/// Windows/WebView2: origin `http://muza-plugin.localhost`; mac/Linux:
/// `muza-plugin://localhost` — оба перечислены в tauri.conf.json frame-src.
pub fn handle_plugin_request(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    match build_bootstrap_response(ctx.app_handle(), request.uri().path()) {
        Ok(resp) => resp,
        Err(e) => tauri::http::Response::builder()
            .status(tauri::http::StatusCode::BAD_REQUEST)
            .header(tauri::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(e.into_bytes())
            .unwrap(),
    }
}

fn build_bootstrap_response(app: &AppHandle, path: &str) -> Result<tauri::http::Response<Vec<u8>>, String> {
    let raw_id = path.trim_matches('/').split('/').next().unwrap_or("");
    let id = sanitize_id(raw_id)?;
    let list = read_installed(app)?;
    let plugin = list
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "bad_args: плагин не найден или не установлен".to_string())?;
    if !plugin.enabled {
        return Err("bad_args: плагин выключен".into());
    }
    let entry_rel = plugin
        .manifest
        .get("entry")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "internal: битый манифест установленного плагина".to_string())?;
    let entry_path = plugins_dir(app)?.join(&id).join(entry_rel);
    let entry_code = fs::read_to_string(&entry_path).map_err(|e| format!("internal: не читается entry: {e}"))?;

    let nonce = random_nonce();
    // Guest-рантайм + entry плагина в ОДНОМ <script> с общим nonce — плагин
    // никогда не попадает в хост-DOM, это отдельный документ на opaque origin.
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>\n\
         <script nonce=\"{nonce}\">\n{GUEST_RUNTIME_JS}\n;(function(){{\n{entry_code}\n}})();\n</script>\n\
         </body></html>"
    );
    let csp = format!(
        "default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'"
    );
    Ok(tauri::http::Response::builder()
        .header(tauri::http::header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(tauri::http::header::CONTENT_SECURITY_POLICY, csp)
        .body(html.into_bytes())
        .unwrap())
}

// ── Storage: KV на диске, неймспейс <id>, квота 1 МБ ──────────────

fn storage_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = plugins_dir(app)?.join(".storage");
    fs::create_dir_all(&dir).map_err(|e| format!("internal: {e}"))?;
    Ok(dir.join(format!("{id}.json")))
}

fn read_storage_map(app: &AppHandle, id: &str) -> Result<HashMap<String, String>, String> {
    let path = storage_path(app, id)?;
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(HashMap::new());
    };
    if raw.trim().is_empty() {
        return Ok(HashMap::new());
    }
    serde_json::from_str(&raw).map_err(|e| format!("internal: storage битый: {e}"))
}

fn write_storage_map(app: &AppHandle, id: &str, map: &HashMap<String, String>) -> Result<(), String> {
    let path = storage_path(app, id)?;
    let raw = serde_json::to_string(map).map_err(|e| format!("internal: {e}"))?;
    fs::write(path, raw).map_err(|e| format!("internal: {e}"))
}

#[tauri::command]
pub fn plugin_storage_get(app: AppHandle, id: String, key: String) -> Result<Option<String>, String> {
    let id = sanitize_id(&id)?;
    Ok(read_storage_map(&app, &id)?.get(&key).cloned())
}

#[tauri::command]
pub fn plugin_storage_set(app: AppHandle, id: String, key: String, value: String) -> Result<(), String> {
    let id = sanitize_id(&id)?;
    let mut map = read_storage_map(&app, &id)?;
    map.insert(key, value);
    let total: usize = map.iter().map(|(k, v)| k.len() + v.len()).sum();
    if total > STORAGE_QUOTA_BYTES {
        return Err("quota: хранилище плагина ограничено 1 МБ".into());
    }
    write_storage_map(&app, &id, &map)
}

#[tauri::command]
pub fn plugin_storage_remove(app: AppHandle, id: String, key: String) -> Result<(), String> {
    let id = sanitize_id(&id)?;
    let mut map = read_storage_map(&app, &id)?;
    map.remove(&key);
    write_storage_map(&app, &id, &map)
}

#[tauri::command]
pub fn plugin_storage_keys(app: AppHandle, id: String) -> Result<Vec<String>, String> {
    let id = sanitize_id(&id)?;
    Ok(read_storage_map(&app, &id)?.into_keys().collect())
}

// ── Net: fetch с allowlist из manifest.net_allow, https-only ──────

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetFetchInit {
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetFetchResult {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn plugin_net_fetch(
    app: AppHandle,
    id: String,
    url: String,
    init: Option<NetFetchInit>,
) -> Result<NetFetchResult, String> {
    let id = sanitize_id(&id)?;
    let list = read_installed(&app)?;
    let plugin = list
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "denied: плагин не найден".to_string())?;
    if !plugin.granted.iter().any(|g| g == "net") {
        return Err("denied: нет права net".into());
    }

    let parsed = url::Url::parse(&url).map_err(|_| "bad_args: битый URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("bad_args: net.fetch — только https".into());
    }
    let host = parsed.host_str().unwrap_or("").to_string();
    let allow: Vec<String> = plugin
        .manifest
        .get("net_allow")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();
    if !allow.iter().any(|h| h == &host) {
        return Err(format!("denied: хост «{host}» не в net_allow манифеста"));
    }

    let init = init.unwrap_or_default();
    let method = init.method.as_deref().unwrap_or("GET").to_uppercase();
    let client = reqwest::Client::new();
    let mut builder = match method.as_str() {
        "GET" => client.get(parsed),
        "POST" => client.post(parsed),
        "PUT" => client.put(parsed),
        "DELETE" => client.delete(parsed),
        _ => return Err("bad_args: net.fetch — неподдержанный метод".into()),
    };
    if let Some(headers) = &init.headers {
        for (k, v) in headers {
            builder = builder.header(k, v);
        }
    }
    if let Some(body) = init.body {
        builder = builder.body(body);
    }

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("internal: сеть недоступна: {e}"))?;
    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(v) = v.to_str() {
            headers.insert(k.to_string(), v.to_string());
        }
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("internal: тело ответа: {e}"))?;
    if bytes.len() > NET_BODY_LIMIT {
        return Err("quota: ответ больше 5 МБ".into());
    }
    let body = String::from_utf8_lossy(&bytes).to_string();
    Ok(NetFetchResult { status, headers, body })
}
