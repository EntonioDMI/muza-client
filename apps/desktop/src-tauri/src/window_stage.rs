//! Две «сцены» главного окна: компактная под карточку входа и обычная.
//!
//! На экранах входа, регистрации и восстановления окно ужимается под серую
//! плашку с формой и не тянется за углы, а после входа (или «продолжить
//! анонимно») плавно разворачивается во все стороны до прежнего размера — как
//! в десктопном Claude. Заказ владельца 03.08.
//!
//! ПОЧЕМУ РАЗМЕР ЗАШИТ, А НЕ МЕРИТСЯ ПО КАРТОЧКЕ. Высота плашки разная у трёх
//! вкладок: у входа два поля, у регистрации три плюс строка согласия, у
//! восстановления одно. Окно, которое следует за карточкой, дёргалось бы на
//! каждом переключении вкладки — а это первое, что человек делает на этом
//! экране. Поэтому размер один на все три сцены и взят с запасом, чтобы
//! хватило самой высокой (регистрация) даже когда появится строка ошибки,
//! перевод окажется длиннее русского или человек увеличит масштаб интерфейса.
//! Решение владельца, тот же приём в Claude.
//!
//! Откуда числа: карточка — 380 логических пикселей содержимого плюс padding
//! `--sp-7` (32) с каждой стороны, то есть ровно 444 в ширину (замерено живьём
//! 03.08). По высоте самая высокая вкладка около 580. Ширина 500 и высота 670
//! оставляют примерно по 28 вокруг плашки и ещё запас снизу.
//!
//! ⚠️ ГОЧА МИНИМАЛЬНОГО РАЗМЕРА. У главного окна в tauri.conf.json стоит
//! minWidth 1024 / minHeight 700. Пока ограничение висит, окно НЕ сожмётся до
//! плашки — set_size молча упрётся в минимум. Поэтому на время компактной
//! сцены ограничение снимается и возвращается при разворачивании. Возвращать
//! обязательно ДО роста: вернуть его после — значит на последнем кадре
//! дёрнуть окно до минимума, если цель оказалась меньше.
//!
//! ⚠️ ГОЧА РАЗВЁРНУТОГО ОКНА. Развёрнутое (maximized) окно не уменьшается
//! вовсе — сначала unmaximize, иначе выход из аккаунта оставит окно во весь
//! экран с крошечной карточкой посередине.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager};

/// Компактная сцена: плашка 444×~580 плюс воздух вокруг.
const AUTH_W: f64 = 500.0;
const AUTH_H: f64 = 670.0;

/// Минимальные размеры обычной сцены — держим синхронно с tauri.conf.json
/// (сторож — тест `min_size_matches_config`).
const FULL_MIN_W: f64 = 1024.0;
const FULL_MIN_H: f64 = 700.0;

/// Запасной размер обычной сцены, если приложение стартовало сразу на входе и
/// прежнего размера мы не видели. Совпадает с width/height из tauri.conf.json.
const FULL_FALLBACK_W: f64 = 1440.0;
const FULL_FALLBACK_H: f64 = 900.0;

/// Длительность разворота = токен `--dur-slow` дизайн-системы (400 мс), тот же,
/// что у входа-выхода полноэкранного режима. Кадр — 16 мс.
const EXPAND_MS: u64 = 400;
const FRAME_MS: u64 = 16;

/// Размер обычной сцены, снятый перед первым сжатием.
#[derive(Default)]
pub struct StageState {
    full: Mutex<Option<(f64, f64)>>,
}

/// Плавность разворота: ease-out cubic. Быстро в начале, мягко в конце —
/// та же кривая, что у переходов дизайн-системы.
fn ease_out_cubic(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

/// Кадры разворота: от (w0,h0) к (w1,h1) вокруг НЕПОДВИЖНОГО центра.
///
/// Центр держим сами, потому что set_size растит окно вправо и вниз от левого
/// верхнего угла — границы разошлись бы в две стороны из четырёх, а нужно во
/// все. Поэтому каждый кадр — пара «размер + позиция», где позиция пересчитана
/// от центра.
///
/// Возвращает (x, y, w, h) в логических пикселях; последний кадр — ровно
/// целевой размер, без накопленной ошибки округления.
fn expand_frames(from: (f64, f64), to: (f64, f64), center: (f64, f64), steps: usize) -> Vec<(f64, f64, f64, f64)> {
    let steps = steps.max(1);
    (1..=steps)
        .map(|i| {
            let p = ease_out_cubic(i as f64 / steps as f64);
            let w = from.0 + (to.0 - from.0) * p;
            let h = from.1 + (to.1 - from.1) * p;
            (center.0 - w / 2.0, center.1 - h / 2.0, w, h)
        })
        .collect()
}

/// Загнать окно в границы монитора: развернувшись из центра, оно может вылезти
/// за край, если компактное окно стояло вплотную к углу.
fn clamp_to_area(x: f64, y: f64, w: f64, h: f64, area: (f64, f64, f64, f64)) -> (f64, f64) {
    let (ax, ay, aw, ah) = area;
    // Если окно шире области — прижимаем к левому/верхнему краю, а не центрируем:
    // уехавший за экран заголовок хуже торчащего правого края.
    let x = if w >= aw { ax } else { x.clamp(ax, ax + aw - w) };
    let y = if h >= ah { ay } else { y.clamp(ay, ay + ah - h) };
    (x, y)
}

/// Сжать главное окно под карточку входа и центрировать.
#[tauri::command]
pub async fn window_auth_compact(app: AppHandle) -> Result<(), String> {
    let win = app.get_webview_window("main").ok_or("окно main не найдено")?;

    if win.is_maximized().unwrap_or(false) {
        win.unmaximize().map_err(|e| e.to_string())?;
    }
    // Запоминаем обычный размер ОДИН раз: повторный вызов (перемонтирование
    // экрана входа) снял бы уже компактный размер и выдал его за обычный.
    {
        let state = app.state::<StageState>();
        let mut full = state.full.lock().map_err(|_| "состояние сцены отравлено")?;
        if full.is_none() {
            let scale = win.scale_factor().map_err(|e| e.to_string())?;
            let logical = win.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
            *full = Some((logical.width, logical.height));
        }
    }

    win.set_resizable(false).map_err(|e| e.to_string())?;
    win.set_min_size(None::<LogicalSize<f64>>).map_err(|e| e.to_string())?;
    win.set_size(LogicalSize::new(AUTH_W, AUTH_H)).map_err(|e| e.to_string())?;
    win.center().map_err(|e| e.to_string())?;
    Ok(())
}

/// Развернуть окно обратно. `animate = false` — мгновенно (выключённые анимации
/// в настройках или уменьшенное движение в системе).
#[tauri::command]
pub async fn window_auth_expand(app: AppHandle, animate: bool) -> Result<(), String> {
    let win = app.get_webview_window("main").ok_or("окно main не найдено")?;
    let (tw, th) = {
        let state = app.state::<StageState>();
        let mut full = state.full.lock().map_err(|_| "состояние сцены отравлено")?;
        // take, а не clone: следующий выход из аккаунта снимет размер заново —
        // человек мог растянуть окно, и возвращать его к прошлому неправильно.
        full.take().unwrap_or((FULL_FALLBACK_W, FULL_FALLBACK_H))
    };

    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let cur = win.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
    let pos = win.outer_position().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
    let center = (pos.x + cur.width / 2.0, pos.y + cur.height / 2.0);

    // Ограничение возвращаем ДО роста — см. гочу в шапке.
    win.set_min_size(Some(LogicalSize::new(FULL_MIN_W, FULL_MIN_H)))
        .map_err(|e| e.to_string())?;
    win.set_resizable(true).map_err(|e| e.to_string())?;

    let area = win
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let p = m.position().to_logical::<f64>(scale);
            let s = m.size().to_logical::<f64>(scale);
            (p.x, p.y, s.width, s.height)
        })
        .unwrap_or((0.0, 0.0, f64::MAX, f64::MAX));

    let steps = if animate { (EXPAND_MS / FRAME_MS) as usize } else { 1 };
    for (x, y, w, h) in expand_frames((cur.width, cur.height), (tw, th), center, steps) {
        let (x, y) = clamp_to_area(x, y, w, h, area);
        win.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
        win.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        if animate {
            tokio::time::sleep(Duration::from_millis(FRAME_MS)).await;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ease_out_cubic_держит_концы_и_не_вылезает() {
        assert_eq!(ease_out_cubic(0.0), 0.0);
        assert_eq!(ease_out_cubic(1.0), 1.0);
        // Дрожь таймера не должна давать размер больше цели.
        assert_eq!(ease_out_cubic(1.7), 1.0);
        assert_eq!(ease_out_cubic(-0.3), 0.0);
        // Ease-out: к середине пути пройдено БОЛЬШЕ половины.
        assert!(ease_out_cubic(0.5) > 0.5);
    }

    #[test]
    fn последний_кадр_ровно_целевой_без_накопленной_ошибки() {
        let f = expand_frames((AUTH_W, AUTH_H), (1440.0, 900.0), (960.0, 540.0), 25);
        let (_, _, w, h) = *f.last().unwrap();
        assert_eq!((w, h), (1440.0, 900.0));
    }

    #[test]
    fn границы_расходятся_во_все_стороны_а_не_вправо_вниз() {
        let center = (960.0, 540.0);
        let f = expand_frames((AUTH_W, AUTH_H), (1440.0, 900.0), center, 10);
        let (x0, y0, w0, h0) = f[0];
        let (x1, y1, w1, h1) = *f.last().unwrap();
        assert!(x1 < x0, "левый край обязан уехать влево");
        assert!(y1 < y0, "верхний край обязан уехать вверх");
        assert!(x1 + w1 > x0 + w0, "правый край обязан уехать вправо");
        assert!(y1 + h1 > y0 + h0, "нижний край обязан уехать вниз");
        for (x, y, w, h) in f {
            assert!((x + w / 2.0 - center.0).abs() < 1e-9, "центр по X уехал");
            assert!((y + h / 2.0 - center.1).abs() < 1e-9, "центр по Y уехал");
        }
    }

    #[test]
    fn мгновенный_разворот_это_один_кадр_сразу_в_цель() {
        let f = expand_frames((AUTH_W, AUTH_H), (1440.0, 900.0), (960.0, 540.0), 1);
        assert_eq!(f.len(), 1);
        assert_eq!((f[0].2, f[0].3), (1440.0, 900.0));
    }

    #[test]
    fn окно_не_выпадает_за_край_монитора() {
        let area = (0.0, 0.0, 1920.0, 1080.0);
        let (x, y) = clamp_to_area(1600.0, 900.0, 1440.0, 900.0, area);
        assert_eq!((x, y), (480.0, 180.0));
        // Второй монитор слева от основного — отрицательные координаты это норма.
        let left = (-1920.0, 0.0, 1920.0, 1080.0);
        let (x2, y2) = clamp_to_area(-2400.0, -50.0, 1440.0, 900.0, left);
        assert_eq!((x2, y2), (-1920.0, 0.0));
    }

    #[test]
    fn окно_шире_монитора_прижимается_к_левому_верхнему_углу() {
        // Иначе центрирование увело бы заголовок и кнопки закрытия за экран.
        let area = (0.0, 0.0, 1024.0, 600.0);
        let (x, y) = clamp_to_area(-200.0, -150.0, 1440.0, 900.0, area);
        assert_eq!((x, y), (0.0, 0.0));
    }

    /// Компактная сцена обязана быть МЕНЬШЕ минимума обычной — иначе весь
    /// приём бессмыслен: окно и так столько занимает.
    #[test]
    fn компактная_сцена_меньше_минимума_обычной() {
        assert!(AUTH_W < FULL_MIN_W && AUTH_H < FULL_MIN_H);
        // И больше самой карточки (444) с запасом, иначе плашка упрётся в края.
        assert!(AUTH_W > 444.0 + 32.0);
    }

    /// Минимальные размеры продублированы в Rust и в tauri.conf.json. Дубль
    /// осознан (см. шапку), но обязан сходиться: разъедутся — окно после входа
    /// получит НЕ тот минимум, и заметит это только человек, потянув за угол.
    #[test]
    fn min_size_matches_config() {
        let raw = include_str!("../tauri.conf.json");
        let cfg: serde_json::Value = serde_json::from_str(raw).expect("tauri.conf.json — валидный JSON");
        let main = cfg["app"]["windows"]
            .as_array()
            .expect("windows — массив")
            .iter()
            .find(|w| w["label"] == "main")
            .expect("окно main объявлено");
        assert_eq!(main["minWidth"].as_f64(), Some(FULL_MIN_W));
        assert_eq!(main["minHeight"].as_f64(), Some(FULL_MIN_H));
        assert_eq!(main["width"].as_f64(), Some(FULL_FALLBACK_W));
        assert_eq!(main["height"].as_f64(), Some(FULL_FALLBACK_H));
    }
}
