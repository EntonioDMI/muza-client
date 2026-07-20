/** Подавление нативного контекстного меню WebView2 (2026-07-20).
 *
 *  Правило: нативное меню давится ВЕЗДЕ, кроме текстовых полей — там нужны
 *  «Копировать/Вставить/Отменить» и подсказки орфографии, своим меню их не
 *  воспроизвести (вставка в WebView требует Clipboard API с разрешениями).
 *  Своё меню показывается только там, где есть честное действие: пустое
 *  меню хуже, чем ничего.
 *
 *  Слушатель НА document, БЕЗ capture и БЕЗ stopPropagation: React-обработчики
 *  onContextMenu (TrackRow/Tile/вью) сидят на контейнере корня и отрабатывают
 *  ДО всплытия сюда — им ничего не мешает, а preventDefault хоть здесь, хоть
 *  там гасит нативное меню.
 *
 *  Граница «где текст» — та же, что у user-select в app.css: правило одно,
 *  разъезд был бы неприятным (см. комментарий там). */

/** Текстовые поля, где нативное меню ОСТАЁТСЯ. Кнопочно-переключательные
 *  input-типы исключены: им нечего копировать. */
export const NATIVE_MENU_SELECTOR =
  'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, [contenteditable="true"]';

export function isTextField(el: EventTarget | null): boolean {
  return el instanceof Element && el.closest(NATIVE_MENU_SELECTOR) !== null;
}

/** Вешает подавитель; возвращает снятие (для useEffect). */
export function installNativeMenuSuppressor(doc: Document = document): () => void {
  const onContextMenu = (e: MouseEvent) => {
    if (isTextField(e.target)) return;
    e.preventDefault();
  };
  doc.addEventListener("contextmenu", onContextMenu);
  return () => doc.removeEventListener("contextmenu", onContextMenu);
}
