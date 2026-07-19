/** Эффективный накопленный CSS zoom элемента (1 — зума нет/не поддерживается).
 *  Экранные координаты (getBoundingClientRect, clientX/Y) перед применением к
 *  left/top/transform ВНУТРИ зумленного поддерева делить на это значение. */
export function cssZoom(el: Element | null | undefined): number;
