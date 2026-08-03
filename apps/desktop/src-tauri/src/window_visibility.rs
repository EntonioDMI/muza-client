//! Видно ли окно на самом деле — вопрос к СИСТЕМЕ, а не к странице.
//!
//! ⚠️ ПОЧЕМУ ЭТОТ ФАЙЛ ВООБЩЕ СУЩЕСТВУЕТ. В WebView2 страница не узнаёт, что
//! окно свёрнуто: `document.visibilityState` остаётся `"visible"`, событие
//! `visibilitychange` не приходит НИ РАЗУ, а цикл кадров без окна перестаёт
//! ждать развёртку экрана и разгоняется выше 60 к/с. Замер 03.08 (чистый,
//! отладчик отключён — он сам снимает торможение): свёрнутое на 20 секунд окно
//! насчитало 3425 кадров, то есть 171 в секунду; расход при играющей музыке —
//! 177% одного ядра против 170% у открытого, то есть свёрнутое ДОРОЖЕ.
//! Подробности и таблица — `docs/subsystems/производительность-интерфейса.md`.
//!
//! Следствие: любой гейт вида `if (document.hidden)` в этом приложении мёртв.
//! Флаг `--enable-features=CalculateNativeWinOcclusion` пробован, не помог.
//!
//! ЧТО СЧИТАЕМ «НЕ ВИДНО» (решение владельца 03.08): свёрнуто ИЛИ полностью
//! перекрыто другим окном. Состояние «видно, но не в фокусе» к этому НЕ
//! относится — окно на экране, и гасить видимую анимацию нельзя: правило
//! владельца запрещает оптимизации, которые человек может заметить.
//!
//! ⚠️ ГРАНИЦА ЧЕСТНОСТИ У ПЕРЕКРЫТИЯ. Мы считаем перекрытием случай, когда ОДНО
//! окно поверх нас накрывает наш прямоугольник целиком — это игра во весь экран
//! или развёрнутый браузер, ровно сценарий владельца. Мозаику из нескольких
//! окон, вместе закрывающих нас, мы НЕ ловим: честная проверка требует
//! вычитания областей, как это делает Chromium, и ошибиться там — значит
//! погасить анимацию у видимого окна. Ошибаемся в безопасную сторону.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// Как часто спрашиваем систему. 800 мс — незаметно для человека (гасим не
/// мгновенно, а через доли секунды) и бесплатно по расходу: пара вызовов Win32.
const POLL: Duration = Duration::from_millis(800);

/// Событие для фронта. Полезная нагрузка — `true`, когда окно видно.
///
/// ⚠️ БЕЗ `://` В ИМЕНИ. Первая версия называлась `muza://window-visible`, и
/// событие не доходило до фронта ВООБЩЕ: Tauri проверяет имя события, отвергает
/// его молча, а `emit` возвращает ошибку, которую легко проглотить. Отладка
/// стоила лишнего круга сборки — имя держим простым.
pub const EVENT: &str = "muza-window-visible";

/// Прямоугольник в экранных координатах.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    fn is_empty(&self) -> bool {
        self.right <= self.left || self.bottom <= self.top
    }
}

/// Накрывает ли `other` прямоугольник `ours` целиком.
///
/// Вырожденные случаи важнее обычных: у свёрнутого окна система отдаёт пустой
/// или отрицательный прямоугольник, и наивное сравнение краёв объявило бы его
/// накрывающим ВСЁ. Поэтому пустые прямоугольники не накрывают ничего, а пустое
/// «наше» окно не считается накрытым (его состояние определяет `IsIconic`).
pub fn fully_covers(other: Rect, ours: Rect) -> bool {
    if other.is_empty() || ours.is_empty() {
        return false;
    }
    other.left <= ours.left && other.top <= ours.top && other.right >= ours.right && other.bottom >= ours.bottom
}

#[cfg(windows)]
mod win {
    use super::Rect;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, IsIconic, IsWindowVisible, GetWindowLongW, GWL_EXSTYLE, WS_EX_TRANSPARENT,
    };

    fn rect_of(h: HWND) -> Option<Rect> {
        let mut r = RECT::default();
        unsafe { GetWindowRect(h, &mut r) }.ok()?;
        Some(Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }

    struct Scan {
        ours: HWND,
        our_rect: Rect,
        covered: bool,
        /// Окна перечисляются СВЕРХУ ВНИЗ по z-порядку: как только дошли до
        /// своего, всё, что ниже, нас закрыть уже не может.
        reached_ours: bool,
    }

    unsafe extern "system" fn cb(h: HWND, lp: LPARAM) -> windows::core::BOOL {
        let s = &mut *(lp.0 as *mut Scan);
        if h == s.ours {
            s.reached_ours = true;
            return false.into(); // дальше только те, кто под нами
        }
        if unsafe { IsWindowVisible(h) }.as_bool() && !unsafe { IsIconic(h) }.as_bool() {
            // Прозрачные для мыши слои (оверлеи, всплывающие подсказки) визуально
            // ничего не закрывают — иначе любой такой слой «погасил» бы Музу.
            let ex = unsafe { GetWindowLongW(h, GWL_EXSTYLE) } as u32;
            if ex & WS_EX_TRANSPARENT.0 == 0 {
                if let Some(r) = rect_of(h) {
                    if super::fully_covers(r, s.our_rect) {
                        s.covered = true;
                        return false.into();
                    }
                }
            }
        }
        true.into()
    }

    /// `true`, если окно видно: не свёрнуто и не накрыто целиком.
    pub fn is_visible(hwnd: isize) -> bool {
        let h = HWND(hwnd as *mut _);
        if unsafe { IsIconic(h) }.as_bool() {
            return false;
        }
        let Some(our_rect) = rect_of(h) else { return true };
        let mut scan = Scan { ours: h, our_rect, covered: false, reached_ours: false };
        let _ = unsafe { EnumWindows(Some(cb), LPARAM(&mut scan as *mut _ as isize)) };
        // Своё окно в перечислении не встретилось — доверять выводу нельзя
        // (мог смениться рабочий стол), считаем видимым.
        if !scan.reached_ours && !scan.covered {
            return true;
        }
        !scan.covered
    }
}

#[cfg(not(windows))]
mod win {
    pub fn is_visible(_hwnd: isize) -> bool {
        true
    }
}

/// Запустить наблюдение за состоянием окна. Событие уходит ТОЛЬКО на смену
/// состояния — фронт не должен получать поток одинаковых сообщений.
pub fn spawn(app: &AppHandle) {
    let app = app.clone();
    let last = Arc::new(AtomicBool::new(true));
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL);
        let Some(win) = app.get_webview_window("main") else { continue };
        #[cfg(windows)]
        let visible = match win.hwnd() {
            Ok(h) => win::is_visible(h.0 as isize),
            Err(_) => true,
        };
        #[cfg(not(windows))]
        let visible = {
            let _ = &win;
            true
        };
        if last.swap(visible, Ordering::Relaxed) != visible {
            // Ошибку не глотаем: молчащее событие — ровно та беда, на которую
            // ушёл лишний круг сборки (см. комментарий у EVENT).
            if let Err(e) = app.emit(EVENT, visible) {
                eprintln!("[видимость] событие не ушло: {e}");
            }
        }
    });
}

/// Диагностика: что нативный слой думает про окно прямо сейчас. Нужна потому,
/// что проверить это со стороны страницы нельзя — она про свёрнутость не знает.
#[tauri::command]
pub fn window_visible_now(app: AppHandle) -> Result<bool, String> {
    let win = app.get_webview_window("main").ok_or("окно main не найдено")?;
    #[cfg(windows)]
    {
        let h = win.hwnd().map_err(|e| e.to_string())?;
        Ok(win::is_visible(h.0 as isize))
    }
    #[cfg(not(windows))]
    {
        let _ = &win;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OURS: Rect = Rect { left: 100, top: 100, right: 900, bottom: 700 };

    #[test]
    fn накрывающее_окно_считается_перекрытием() {
        // Игра во весь экран поверх Музы.
        assert!(fully_covers(Rect { left: 0, top: 0, right: 1920, bottom: 1080 }, OURS));
        // Ровно по краям — тоже накрывает.
        assert!(fully_covers(OURS, OURS));
    }

    #[test]
    fn частичное_перекрытие_не_считается() {
        // Окно рядом, задевает край — Музу видно.
        assert!(!fully_covers(Rect { left: 500, top: 100, right: 1920, bottom: 700 }, OURS));
        // Накрывает по ширине, но не по высоте.
        assert!(!fully_covers(Rect { left: 0, top: 200, right: 1920, bottom: 1080 }, OURS));
        // Вообще в стороне.
        assert!(!fully_covers(Rect { left: 1000, top: 0, right: 1920, bottom: 1080 }, OURS));
    }

    #[test]
    fn пустой_прямоугольник_не_накрывает_ничего() {
        // Свёрнутое окно система отдаёт вырожденным; наивное сравнение краёв
        // объявило бы его накрывающим ВСЁ и погасило бы Музу на ровном месте.
        assert!(!fully_covers(Rect { left: 0, top: 0, right: 0, bottom: 0 }, OURS));
        assert!(!fully_covers(Rect { left: -32000, top: -32000, right: -31900, bottom: -31900 }, OURS));
        // И наоборот: если вырожденным оказались МЫ, накрытыми себя не считаем.
        assert!(!fully_covers(Rect { left: 0, top: 0, right: 1920, bottom: 1080 }, Rect { left: 0, top: 0, right: 0, bottom: 0 }));
    }

    #[test]
    fn отрицательные_координаты_второго_монитора_работают() {
        let ours = Rect { left: -1800, top: 100, right: -1000, bottom: 700 };
        assert!(fully_covers(Rect { left: -1920, top: 0, right: 0, bottom: 1080 }, ours));
        assert!(!fully_covers(Rect { left: -1500, top: 0, right: 0, bottom: 1080 }, ours));
    }
}
