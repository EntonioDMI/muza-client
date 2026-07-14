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
use std::collections::HashMap;
use std::fs;
use std::io::Read as _;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
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

/// CSPRNG (T44-fix: security review — раньше был SHA256(время+счётчик+pid),
/// предсказуемый источник, не годится ни для CSP-nonce, ни для стейджинг-токена).
fn random_nonce() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("internal: CSPRNG недоступен");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Канонизирует `path` и убеждается, что он лежит СТРОГО внутри канонизированного
/// `base` (T44-fix: security review — манифесту не доверяем: `entry`/`css`/`strings`
/// приходят из JSON, и `PathBuf::join` с абсолютным путём или Windows drive-letter
/// (`C:\...`) заменяет базу целиком, а не подмешивает её — Zod-валидация на TS-стороне
/// такие пути уже отклоняет, но Rust не полагается на фронт). Требует, чтобы файл
/// физически существовал (canonicalize) — отсутствующий путь тоже отклоняется.
fn ensure_within(base: &Path, path: &Path) -> Result<PathBuf, String> {
    let base_canon = fs::canonicalize(base).map_err(|e| format!("internal: {e}"))?;
    let path_canon = fs::canonicalize(path)
        .map_err(|_| "bad_args: недопустимый путь внутри пакета плагина".to_string())?;
    if !path_canon.starts_with(&base_canon) {
        return Err("bad_args: путь выходит за пределы папки плагина".into());
    }
    Ok(path_canon)
}

/// Читает содержимое zip-entry, НЕ доверяя `entry.size()` из заголовка (T44-fix:
/// security review, Important #3 — заголовочный размер ничем не гарантирован,
/// классическая zip-бомба: маленький архив, огромный реальный поток после
/// decode). Лимитирует сам декомпрессированный поток через `Read::take` на
/// факт прочитанных байт, а не на заявленный размер: если поток не кончился
/// в пределах `remaining`, отказ — не читаем дальше, не ждём, пока decoder
/// сам исчерпает бомбу.
fn read_entry_capped<R: std::io::Read>(entry: &mut R, remaining: u64) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    entry
        .take(remaining + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("internal: {e}"))?;
    if buf.len() as u64 > remaining {
        return Err("bad_args: пакет распаковывается больше 2 МБ — отклонено".into());
    }
    Ok(buf)
}

/// Плагин установлен и ему выдано право `perm` — Rust-сторона перепроверяет
/// это для каждой команды, доступной guest-фрейму через host.ts (не доверяем
/// тому, что фронт уже отфильтровал по `granted` перед вызовом invoke).
fn require_granted(app: &AppHandle, id: &str, perm: &str) -> Result<InstalledPlugin, String> {
    let list = read_installed(app)?;
    let plugin = list
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "denied: плагин не найден".to_string())?;
    if !plugin.granted.iter().any(|g| g == perm) {
        return Err(format!("denied: нет права {perm}"));
    }
    Ok(plugin)
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
pub fn uninstall_plugin(
    app: AppHandle,
    state: State<'_, PluginsState>,
    id: String,
) -> Result<(), String> {
    let id = sanitize_id(&id)?;
    let _g = state.lock.lock().unwrap();
    let mut list = read_installed(&app)?;
    list.retain(|p| p.id != id);
    write_installed(&app, &list)?;
    let _ = fs::remove_dir_all(plugins_dir(&app)?.join(&id));
    let _ = fs::remove_file(
        plugins_dir(&app)?
            .join(".storage")
            .join(format!("{id}.json")),
    );
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
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| format!("bad_args: не похоже на .muzaplugin (zip): {e}"))?;
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
        let mut entry = zip
            .by_index(i)
            .map_err(|e| format!("bad_args: битый пакет: {e}"))?;
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
        let remaining = MAX_UNPACKED_BYTES.saturating_sub(total);
        let buf = read_entry_capped(&mut entry, remaining).map_err(|e| {
            let _ = fs::remove_dir_all(&staged_dir);
            e
        })?;
        total += buf.len() as u64;
        fs::write(&dest, &buf).map_err(|e| format!("internal: {e}"))?;
    }

    let manifest_json = fs::read_to_string(staged_dir.join("manifest.json"))
        .map_err(|_| "bad_args: в пакете нет manifest.json".to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("bad_args: manifest.json битый: {e}"))?;
    let entry_rel = manifest
        .get("entry")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "bad_args: manifest.entry отсутствует".to_string())?;
    // T44-fix: security review — манифесту не доверяем: entry_rel мог бы быть
    // Windows-абсолютом (C:\...) или UNC-путём, тогда staged_dir.join() заменил
    // бы базу целиком (см. ensure_within). Zod уже отклоняет такие entry на
    // TS-стороне, но эта команда вызывается ДО TS-валидации (сама распаковка).
    let entry_path = ensure_within(&staged_dir, &staged_dir.join(entry_rel))?;
    let entry_code = fs::read_to_string(&entry_path)
        .map_err(|e| format!("bad_args: не читается entry «{entry_rel}»: {e}"))?;

    let css_code = manifest
        .get("contributes")
        .and_then(|c| c.get("css"))
        .and_then(|v| v.as_str())
        .and_then(|rel| ensure_within(&staged_dir, &staged_dir.join(rel)).ok())
        .and_then(|p| fs::read_to_string(p).ok());
    let strings_json = manifest
        .get("contributes")
        .and_then(|c| c.get("strings"))
        .and_then(|v| v.as_str())
        .and_then(|rel| ensure_within(&staged_dir, &staged_dir.join(rel)).ok())
        .and_then(|p| fs::read_to_string(p).ok());

    Ok(StagedPlugin {
        staged_dir: staged_dir.to_string_lossy().to_string(),
        manifest_json,
        entry_code,
        css_code,
        strings_json,
    })
}

/// Стейджинг плагина ИЗ ДАННЫХ (не из .muzaplugin-файла) — установка из
/// маркетплейса (T45b, §6.2 дока): payload = { manifest, code, css?, strings? }
/// приходит с сервера уже распакованным, zip-шаг не нужен, но на выходе тот
/// же конверт `StagedPlugin`, что и `plugin_stage_from_file` — TS-сторона
/// (install.ts::stagePluginFromData) переиспользует ВЕСЬ пайплайн валидации
/// манифеста (Zod) / AST-скана entry / CSS-скана / согласия на права /
/// `plugin_finalize_install` без изменений, установка из маркета неотличима
/// от установки из файла с точки зрения консента и финализации.
///
/// `entry`/`contributes.css`/`contributes.strings` — пути ИЗ МАНИФЕСТА
/// С СЕРВЕРА, т.е. недоверенный источник (сервер сканирует payload при
/// publish, но клиент ему на слово не верит) — `safe_rel_path` проверяется
/// ДО записи файла на диск.
#[tauri::command]
pub fn plugin_stage_from_data(
    app: AppHandle,
    manifest_json: String,
    entry_code: String,
    css_code: Option<String>,
    strings_json: Option<String>,
) -> Result<StagedPlugin, String> {
    let total = manifest_json.len()
        + entry_code.len()
        + css_code.as_deref().map(str::len).unwrap_or(0)
        + strings_json.as_deref().map(str::len).unwrap_or(0);
    if total as u64 > MAX_UNPACKED_BYTES {
        return Err("bad_args: плагин слишком большой (лимит 2 МБ суммарно)".into());
    }

    let manifest: serde_json::Value = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("bad_args: manifest.json битый: {e}"))?;
    let entry_rel = manifest
        .get("entry")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "bad_args: manifest.entry отсутствует".to_string())?;
    if !safe_rel_path(entry_rel) {
        return Err("bad_args: entry: недопустимый путь".into());
    }
    let css_rel = manifest
        .get("contributes")
        .and_then(|c| c.get("css"))
        .and_then(|v| v.as_str());
    if let Some(rel) = css_rel {
        if !safe_rel_path(rel) {
            return Err("bad_args: contributes.css: недопустимый путь".into());
        }
    }
    let strings_rel = manifest
        .get("contributes")
        .and_then(|c| c.get("strings"))
        .and_then(|v| v.as_str());
    if let Some(rel) = strings_rel {
        if !safe_rel_path(rel) {
            return Err("bad_args: contributes.strings: недопустимый путь".into());
        }
    }

    let staging_root = plugins_dir(&app)?.join(".staging");
    fs::create_dir_all(&staging_root).map_err(|e| format!("internal: {e}"))?;
    let token = random_nonce();
    let staged_dir = staging_root.join(&token);
    fs::create_dir_all(&staged_dir).map_err(|e| format!("internal: {e}"))?;

    fs::write(staged_dir.join("manifest.json"), &manifest_json)
        .map_err(|e| format!("internal: {e}"))?;

    let entry_dest = staged_dir.join(entry_rel);
    if let Some(parent) = entry_dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("internal: {e}"))?;
    }
    fs::write(&entry_dest, &entry_code).map_err(|e| format!("internal: {e}"))?;
    // Пост-проверка тем же canonicalize-инструментом, что и file-based
    // стейджинг (defense in depth — предварительный safe_rel_path уже сделал
    // запись безопасной, это подтверждение по тому же рубежу).
    ensure_within(&staged_dir, &entry_dest)?;

    if let (Some(css), Some(rel)) = (css_code.as_ref(), css_rel) {
        let dest = staged_dir.join(rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("internal: {e}"))?;
        }
        fs::write(&dest, css).map_err(|e| format!("internal: {e}"))?;
        ensure_within(&staged_dir, &dest)?;
    }
    if let (Some(s), Some(rel)) = (strings_json.as_ref(), strings_rel) {
        let dest = staged_dir.join(rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("internal: {e}"))?;
        }
        fs::write(&dest, s).map_err(|e| format!("internal: {e}"))?;
        ensure_within(&staged_dir, &dest)?;
    }

    Ok(StagedPlugin {
        staged_dir: staged_dir.to_string_lossy().to_string(),
        manifest_json,
        entry_code,
        css_code,
        strings_json,
    })
}

/// Путь внутри манифеста (entry/contributes.css/contributes.strings) обязан
/// быть относительным и не выходить за пределы staged-папки — зеркало
/// `isSafeRelPath` из packages/core/src/plugin/manifest.ts (та же форма
/// атаки: `..`, ведущий `/`/`\` (в т.ч. UNC), Windows drive-letter `C:\...`).
/// Zod уже отклоняет такие пути на TS-стороне ДО вызова
/// `plugin_stage_from_data` (см. install.ts::stagePluginFromData), но Rust
/// не полагается на фронт: это ПРЕДварительная проверка перед записью файла
/// на диск — в отличие от `ensure_within` (canonicalize существующего файла),
/// её обязательно делать ДО `fs::write`, иначе запись за пределы staged_dir
/// уже произойдёт до того, как её можно будет обнаружить постфактум.
fn safe_rel_path(p: &str) -> bool {
    let is_drive_absolute =
        p.len() >= 2 && p.as_bytes()[0].is_ascii_alphabetic() && p.as_bytes()[1] == b':';
    !p.is_empty()
        && !p.contains("..")
        && !p.starts_with('/')
        && !p.starts_with('\\')
        && !is_drive_absolute
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
    // T44b: уровень 2 (app:full-access) больше не блокируется здесь — T44
    // отказывал в установке, потому что рантайм не умел исполнять такой
    // плагин вообще. Теперь умеет (run_full_access_plugin ниже), а громкое
    // согласие (чекбокс + задержка кнопки) — забота фронта (SettingsView),
    // эта команда лишь фиксирует то, на что согласился пользователь, в
    // installed.json. Реальный гейт — не установка, а ИСПОЛНЕНИЕ: каждый
    // вызов run_full_access_plugin перепроверяет `granted` В RUST заново
    // (см. require_granted там же) — фронту не доверяем и на этом шаге тоже.
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
            .header(
                tauri::http::header::CONTENT_TYPE,
                "text/plain; charset=utf-8",
            )
            .body(e.into_bytes())
            .unwrap(),
    }
}

fn build_bootstrap_response(
    app: &AppHandle,
    path: &str,
) -> Result<tauri::http::Response<Vec<u8>>, String> {
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
    // T44-fix: security review — установленный манифест уже прошёл Zod на
    // TS-стороне при установке, но Rust это не проверяет сам и файл читается
    // при КАЖДОМ открытии плагина — не полагаемся на прошлую валидацию.
    let plugin_dir = plugins_dir(app)?.join(&id);
    let entry_path = ensure_within(&plugin_dir, &plugin_dir.join(entry_rel))?;
    let entry_code =
        fs::read_to_string(&entry_path).map_err(|e| format!("internal: не читается entry: {e}"))?;

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
        .header(
            tauri::http::header::CONTENT_TYPE,
            "text/html; charset=utf-8",
        )
        .header(tauri::http::header::CONTENT_SECURITY_POLICY, csp)
        .body(html.into_bytes())
        .unwrap())
}

// ── Уровень 2: «Полный доступ» (T44b) — исполнение в хост-контексте ──

/// Собирает скрипт для `main_window.eval` (T44b, дизайн-док §5.2) — вынесено
/// в чистую функцию отдельно от `run_full_access_plugin`, чтобы не требовать
/// мок-`AppHandle` для юнит-теста (остальные тесты файла держат этот же
/// принцип: тестируем чистую сборку/валидацию, не Tauri-команды целиком).
///
/// Идемпотентность — `window.__MUZA__[<id>]` как маркер «уже исполнялось в
/// этом окне»: realm нельзя выгрузить без рестарта (§5.3 дока), поэтому
/// повторный вызов `run_full_access_plugin` в той же сессии окна (например,
/// включили → выключили → включили обратно без рестарта) НЕ должен запускать
/// `entry_code` ещё раз — предыдущий запуск уже что-то сделал с DOM/стейтом
/// и не может быть откачен. `id_js`/`name_js`/`version_js` — через
/// `serde_json::to_string`: даёт корректно экранированный JS string-литерал
/// (JSON — синтаксический подмножество ES2019+, WebView2 — Chromium,
/// экранирования выше ES2019 не касаются нас). `entry_code` льётся как есть
/// (это исходный JS, не строковый литерал) — та же техника, что и в
/// `build_bootstrap_response` для guest-рантайма уровня 1.
fn build_full_access_script(
    id: &str,
    name: &str,
    version: &str,
    entry_code: &str,
) -> Result<String, String> {
    let id_js = serde_json::to_string(id).map_err(|e| format!("internal: {e}"))?;
    let name_js = serde_json::to_string(name).map_err(|e| format!("internal: {e}"))?;
    let version_js = serde_json::to_string(version).map_err(|e| format!("internal: {e}"))?;
    Ok(format!(
        r#"(function () {{
  window.__MUZA__ = window.__MUZA__ || {{}};
  if (window.__MUZA__[{id_js}]) return;
  var __muzaPlugin = {{ id: {id_js}, name: {name_js}, version: {version_js} }};
  __muzaPlugin.reportError = function (message) {{
    try {{
      if (window.__MUZA_FULL_ACCESS__ && typeof window.__MUZA_FULL_ACCESS__.reportError === "function") {{
        window.__MUZA_FULL_ACCESS__.reportError({id_js}, String(message));
      }}
    }} catch (_e) {{}}
  }};
  window.__MUZA__[{id_js}] = __muzaPlugin;
  try {{
    (function () {{
{entry_code}
    }})();
  }} catch (e) {{
    __muzaPlugin.reportError((e && e.message) ? e.message : String(e));
  }}
}})();"#
    ))
}

/// Запуск app:full-access-плагина В ХОСТ-КОНТЕКСТЕ (дизайн-док §5.2). Поток:
/// `granted` плагина перепроверяется В RUST (`require_granted` — фронту не
/// верим: SettingsView прячет кнопку/дизейблит её без права, но `invoke()`
/// доступен напрямую) → `entry` читается с диска той же `ensure_within`
/// защитой от path traversal, что и бутстрап уровня 1, → скрипт из
/// `build_full_access_script` льётся в главное окно через
/// `WebviewWindow::eval` (WebView2 `ExecuteScript`) — привилегия хоста,
/// глобальный CSP страницы (`script-src 'self'`, без `unsafe-eval`) на неё
/// не действует (см. tauri v2 docs, develop/calling-frontend; §5.2 дока).
/// Глобальный CSP этой командой НЕ меняется вообще.
///
/// Вызывается фронтом (не отсюда, не из `lib.rs::setup`) при старте
/// приложения — для уже включённых full-access-плагинов, как только
/// React примонтировался и `window.__MUZA_FULL_ACCESS__` зарегистрирован
/// (см. `apps/desktop/src/plugins/fullAccessHost.ts`) — и при включении
/// плагина. Запуск из `setup()` был бы раньше готовности фронта (окно ещё
/// не догрузило бандл) — `window.__MUZA_FULL_ACCESS__.reportError` тогда
/// был бы не определён, и репорт ошибок из try/catch терялся бы молча.
#[tauri::command]
pub fn run_full_access_plugin(app: AppHandle, id: String) -> Result<(), String> {
    let id = sanitize_id(&id)?;
    let plugin = require_granted(&app, &id, "app:full-access")?;
    if !plugin.enabled {
        return Err("bad_args: плагин выключен".into());
    }
    let entry_rel = plugin
        .manifest
        .get("entry")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "internal: битый манифест установленного плагина".to_string())?;
    let plugin_dir = plugins_dir(&app)?.join(&id);
    let entry_path = ensure_within(&plugin_dir, &plugin_dir.join(entry_rel))?;
    let entry_code =
        fs::read_to_string(&entry_path).map_err(|e| format!("internal: не читается entry: {e}"))?;
    let name = plugin
        .manifest
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let wrapped = build_full_access_script(&id, name, &plugin.version, &entry_code)?;

    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "internal: главное окно не найдено".to_string())?;
    main_window
        .eval(&wrapped)
        .map_err(|e| format!("internal: eval не удался: {e}"))?;
    Ok(())
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

fn write_storage_map(
    app: &AppHandle,
    id: &str,
    map: &HashMap<String, String>,
) -> Result<(), String> {
    let path = storage_path(app, id)?;
    let raw = serde_json::to_string(map).map_err(|e| format!("internal: {e}"))?;
    fs::write(path, raw).map_err(|e| format!("internal: {e}"))
}

// T44-fix: security review — как и net_fetch, перепроверяем `granted` на
// Rust-стороне (не только в host.ts): storage.* доступна через invoke()
// напрямую, host.ts — не единственный путь к этим командам.

#[tauri::command]
pub fn plugin_storage_get(
    app: AppHandle,
    id: String,
    key: String,
) -> Result<Option<String>, String> {
    let id = sanitize_id(&id)?;
    require_granted(&app, &id, "storage")?;
    Ok(read_storage_map(&app, &id)?.get(&key).cloned())
}

#[tauri::command]
pub fn plugin_storage_set(
    app: AppHandle,
    id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let id = sanitize_id(&id)?;
    require_granted(&app, &id, "storage")?;
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
    require_granted(&app, &id, "storage")?;
    let mut map = read_storage_map(&app, &id)?;
    map.remove(&key);
    write_storage_map(&app, &id, &map)
}

#[tauri::command]
pub fn plugin_storage_keys(app: AppHandle, id: String) -> Result<Vec<String>, String> {
    let id = sanitize_id(&id)?;
    require_granted(&app, &id, "storage")?;
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

/// SSRF-фильтр (T44-fix: security review) — loopback/приватные/link-local/
/// CGNAT диапазоны запрещены для net.fetch, даже если хост прошёл net_allow
/// (плагин мог бы объявить `net_allow: ["attacker.example"]`, где домен
/// резолвится на 127.0.0.1/10.x/192.168.x — атака на локальную сеть жертвы).
/// ⚠️ Резолвим и проверяем ЗДЕСЬ, но сам connect делает reqwest со своим,
/// отдельным резолвом — окно для DNS rebinding (адрес меняется между этой
/// проверкой и реальным подключением) теоретически остаётся; полное закрытие
/// требует кастомного resolver/connector в reqwest — вне объёма этого фикса.
fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_documentation()
                // CGNAT 100.64.0.0/10 — тоже периметр провайдера/облака, не публичный интернет
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0b1100_0000) == 0b0100_0000)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.to_ipv4_mapped().is_some_and(|v4| is_blocked_ip(&IpAddr::V4(v4)))
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
        }
    }
}

#[tauri::command]
pub async fn plugin_net_fetch(
    app: AppHandle,
    id: String,
    url: String,
    init: Option<NetFetchInit>,
) -> Result<NetFetchResult, String> {
    let id = sanitize_id(&id)?;
    let plugin = require_granted(&app, &id, "net")?;

    let parsed = url::Url::parse(&url).map_err(|_| "bad_args: битый URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("bad_args: net.fetch — только https".into());
    }
    let host = parsed.host_str().unwrap_or("").to_string();
    let allow: Vec<String> = plugin
        .manifest
        .get("net_allow")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if !allow.iter().any(|h| h == &host) {
        return Err(format!("denied: хост «{host}» не в net_allow манифеста"));
    }

    let port = parsed.port_or_known_default().unwrap_or(443);
    let addrs: Vec<_> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| format!("bad_args: хост «{host}» не резолвится"))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("bad_args: хост «{host}» не резолвится"));
    }
    if addrs.iter().any(|a| is_blocked_ip(&a.ip())) {
        return Err(format!(
            "denied: хост «{host}» резолвится в приватный/локальный адрес"
        ));
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
    Ok(NetFetchResult {
        status,
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// T44-fix (security review, Important #2) — на Windows `PathBuf::join`
    /// с абсолютным drive-letter путём заменяет базу целиком, а не подмешивает
    /// её; ensure_within обязана это ловить, даже если бы Zod-валидация манифеста
    /// на TS-стороне почему-то пропустила такой `entry`.
    #[test]
    #[cfg(windows)]
    fn ensure_within_rejects_windows_drive_absolute_join() {
        let dir = std::env::temp_dir().join("muza-plugins-test-drive-abs");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let joined = dir.join(r"C:\Windows");
        assert_ne!(
            joined,
            dir.join("Windows"),
            "join() обязан был заменить базу целиком — иначе тест не о том"
        );
        assert!(
            ensure_within(&dir, &joined).is_err(),
            "абсолютный Windows-путь обязан быть отклонён"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_within_accepts_legit_relative_path() {
        let dir = std::env::temp_dir().join("muza-plugins-test-legit");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let entry = dir.join("index.js");
        fs::write(&entry, "// ok").unwrap();

        assert!(ensure_within(&dir, &entry).is_ok());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_within_rejects_traversal_outside_base() {
        let base = std::env::temp_dir().join("muza-plugins-test-base");
        let outside = std::env::temp_dir().join("muza-plugins-test-outside");
        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&base).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();

        // "../<outside>/secret.txt" — классический traversal через дозволенные
        // символы (без drive-letter), проверяем что ensure_within тоже его ловит.
        let escaped = base
            .join("..")
            .join(outside.file_name().unwrap())
            .join("secret.txt");
        assert!(ensure_within(&base, &escaped).is_err());

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&outside);
    }

    /// SSRF-фильтр (Important-минор) — loopback/приватные/link-local/CGNAT.
    #[test]
    fn is_blocked_ip_rejects_private_ranges() {
        for ip in [
            "127.0.0.1",
            "10.0.0.5",
            "192.168.1.1",
            "172.16.0.1",
            "169.254.1.1",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
        ] {
            let addr: IpAddr = ip.parse().unwrap();
            assert!(is_blocked_ip(&addr), "{ip} обязан быть заблокирован");
        }
    }

    #[test]
    fn is_blocked_ip_allows_public_addresses() {
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            let addr: IpAddr = ip.parse().unwrap();
            assert!(
                !is_blocked_ip(&addr),
                "{ip} — публичный адрес, блокироваться не должен"
            );
        }
    }

    #[test]
    fn is_blocked_ip_rejects_ipv4_mapped_loopback() {
        // ::ffff:127.0.0.1 — IPv4-mapped IPv6, распаковывается и перепроверяется
        let addr: IpAddr = "::ffff:127.0.0.1".parse().unwrap();
        assert!(is_blocked_ip(&addr));
    }

    /// Nonce/staging-токен больше не детерминирован по времени/счётчику/pid.
    #[test]
    fn random_nonce_is_not_predictable_and_unique() {
        let a = random_nonce();
        let b = random_nonce();
        assert_ne!(a, b);
        assert!(!a.is_empty());
    }

    /// Настоящий crafted-zip: 3 МБ нулей deflate сжимает в считанные КБ —
    /// классический профиль zip-бомбы (T44-fix, Important #3). До фикса
    /// `entry.size()` из заголовка использовался для контроля лимита, а
    /// реальная распаковка через read_to_end() ничем не ограничивалась.
    #[test]
    fn read_entry_capped_rejects_real_zip_bomb_entry() {
        use std::io::{Cursor, Write as _};
        let mut zip_bytes = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut zip_bytes));
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            writer.start_file("index.js", options).unwrap();
            writer.write_all(&vec![0u8; 3 * 1024 * 1024]).unwrap(); // 3 МБ > лимита 2 МБ
            writer.finish().unwrap();
        }
        assert!(
            zip_bytes.len() < 100 * 1024,
            "сжатый архив обязан быть маленьким — иначе тест не о том"
        );

        let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes)).unwrap();
        let mut entry = archive.by_index(0).unwrap();
        let res = read_entry_capped(&mut entry, MAX_UNPACKED_BYTES);
        assert!(
            res.is_err(),
            "3 МБ реального декомпрессированного потока обязаны отклоняться при лимите 2 МБ"
        );
    }

    /// T44b — идемпотентность: повторный `run_full_access_plugin` в той же
    /// сессии окна не должен исполнять entry дважды (realm не выгружаем,
    /// §5.3 дока) — маркер и ранний `return` обязаны быть в собранном скрипте.
    #[test]
    fn build_full_access_script_has_idempotency_guard() {
        let script =
            build_full_access_script("demo-plugin", "Demo", "1.0.0", "console.log(1)").unwrap();
        assert!(script.contains("window.__MUZA__[\"demo-plugin\"]"));
        assert!(script.contains("return;"));
    }

    /// Имя плагина — произвольная Zod-строка (до 60 символов, без ограничений
    /// на символы), кавычки/бэкслэши обязаны экранироваться корректно —
    /// иначе сломанный JS-литерал = вся команда рушится на плагине с таким
    /// именем (а не просто «плагин отказался запускаться»).
    #[test]
    fn build_full_access_script_escapes_quotes_and_backslashes_in_name() {
        let script =
            build_full_access_script("demo-plugin", "He said \"hi\\bye\"", "1.0.0", "1").unwrap();
        let expected_name_literal = serde_json::to_string("He said \"hi\\bye\"").unwrap();
        assert!(script.contains(&expected_name_literal));
    }

    /// entry_code — сырой JS (не строковый литерал) — обязан попасть в
    /// вывод дословно, без обёртки/экранирования (иначе плагин не исполнится
    /// вовсе, синтаксическая ошибка на первой же строке).
    #[test]
    fn build_full_access_script_embeds_entry_code_verbatim() {
        let script =
            build_full_access_script("demo-plugin", "Demo", "1.0.0", "window.__marker = 42;")
                .unwrap();
        assert!(script.contains("window.__marker = 42;"));
    }

    /// Ошибки исполнения entry обязаны репортиться через
    /// window.__MUZA_FULL_ACCESS__.reportError, а не молча глотаться —
    /// хост-реестр ошибок (SettingsView) иначе никогда их не увидит.
    #[test]
    fn build_full_access_script_reports_errors_via_catch() {
        let script =
            build_full_access_script("demo-plugin", "Demo", "1.0.0", "throw new Error('boom')")
                .unwrap();
        assert!(script.contains("catch (e)"));
        assert!(script.contains("__MUZA_FULL_ACCESS__"));
        assert!(script.contains("reportError"));
    }

    /// T45b — зеркало TS `isSafeRelPath` (packages/core/src/plugin/manifest.ts):
    /// `entry`/`contributes.css`/`contributes.strings` из МАРКЕТ-манифеста
    /// (сервер) обязаны проверяться той же формой ДО записи на диск.
    #[test]
    fn safe_rel_path_rejects_traversal_and_absolute() {
        for bad in [
            "../../etc/passwd",
            "..\\..\\evil.js",
            "/etc/passwd",
            "\\\\server\\share\\x",
            "C:\\Windows\\x",
            "c:/x",
            "",
        ] {
            assert!(!safe_rel_path(bad), "{bad} обязан быть отклонён");
        }
    }

    #[test]
    fn safe_rel_path_accepts_legit_relative() {
        for good in ["index.js", "dist/index.js", "theme.css", "a/b/c.json"] {
            assert!(safe_rel_path(good), "{good} обязан быть принят");
        }
    }

    #[test]
    fn read_entry_capped_accepts_stream_within_limit() {
        use std::io::{Cursor, Write as _};
        let mut zip_bytes = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut zip_bytes));
            writer
                .start_file("index.js", zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"console.log(1)").unwrap();
            writer.finish().unwrap();
        }
        let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes)).unwrap();
        let mut entry = archive.by_index(0).unwrap();
        let res = read_entry_capped(&mut entry, MAX_UNPACKED_BYTES).unwrap();
        assert_eq!(res, b"console.log(1)");
    }
}
