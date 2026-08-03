/** КНОПКИ ОКНА — десктопная вилка для общей полосы заголовка
 *  (@muza/app/shell/TitleBar, заявка владельца 03.08.2026 «своя рамка вместо
 *  системной»). Компонент полосы живёт в общем пакете и про Tauri не знает —
 *  туда нельзя импортировать `@tauri-apps/*`, иначе веб не соберётся. Значит
 *  настоящие вызовы окна живут ЗДЕСЬ.
 *
 *  Импорт API окна ДИНАМИЧЕСКИЙ (как у webview в App.tsx): статический
 *  выполняется при загрузке модуля и тянет метаданные текущего окна из
 *  `__TAURI_INTERNALS__`, которых в jsdom нет — все тесты App упали бы на
 *  импорте. `isTauri()` перед вызовом делает функции пустышками в тестах и в
 *  вебе, ничего не бросая.
 *
 *  `close()` — именно закрытие окна, а не выход: оно поднимает CloseRequested,
 *  который в Rust перехватывает трей (src-tauri/src/tray.rs::handle_close_
 *  requested) и по настройке прячет окно в значок у часов. Ровно как у
 *  системного крестика раньше. */

import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/** Ошибку глотаем молча: единственный реальный сценарий отказа — вызов вне
 *  Tauri, а там кнопок и нет. Показывать человеку «не удалось свернуть» не о
 *  чем — он это и так увидит. */
function act(run: (w: Awaited<ReturnType<typeof currentWindow>>) => Promise<unknown>): void {
  if (!isTauri()) return;
  void currentWindow()
    .then(run)
    .catch(() => {});
}

export function minimizeWindow(): void {
  act((w) => w.minimize());
}

export function toggleMaximizeWindow(): void {
  act((w) => w.toggleMaximize());
}

export function closeWindow(): void {
  act((w) => w.close());
}

/** Развёрнуто ли окно — нужно ровно для глифа кнопки («развернуть» ↔
 *  «восстановить»).
 *
 *  Слушаем DOM-событие resize, а не `onResized` Tauri: развернуть/восстановить
 *  ВСЕГДА меняет размер вебвью, то есть событие приходит в обоих случаях, зато
 *  подписка не идёт через IPC и не требует ни прав, ни снятия по IPC. Двойной
 *  клик по полосе (его обрабатывает сам Tauri, минуя наш onClick) тоже сюда
 *  доезжает — состояние кнопки не расходится с окном. */
export function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    const read = () => {
      void currentWindow()
        .then((w) => w.isMaximized())
        .then((v) => {
          if (alive) setMaximized(v);
        })
        .catch(() => {});
    };
    read();
    window.addEventListener("resize", read);
    return () => {
      alive = false;
      window.removeEventListener("resize", read);
    };
  }, []);
  return maximized;
}
