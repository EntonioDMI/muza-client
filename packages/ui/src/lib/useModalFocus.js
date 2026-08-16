import { useEffect } from "react";
import { NO_SCROLL } from "./focusNoScroll.js";

/** Что считаем фокусируемым — тот же список, что у Dialog. */
export const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Фокус-модель модального слоя: вход, ловушка Tab, возврат по закрытию.
 *
 *  ЗАЧЕМ ХУК. Ровно это уже делает `Dialog` — и делает правильно (см. его шапку
 *  и разбор аудита 02.08, когда фокус не входил НИ В ОДНО модальное окно из-за
 *  гонки монтирования). Но три оверлея построены МИМО `Dialog`, каждый со своей
 *  разметкой, и ни один не делал ничего: ящик и полноэкранный «Сейчас играет» в
 *  вебе, «Итоги года» на десктопе. Скопировать туда по три эффекта — завести три
 *  места, которые разъедутся; поэтому модель вынесена сюда.
 *
 *  ⚠️ `mounted` в зависимостях ОБЯЗАТЕЛЕН, и это не перестраховка. Оверлеи
 *  держат в дереве постоянно, а прячут пропом: на коммите смены `open` узла ещё
 *  нет (ref пуст), эффект с deps `[open]` уходит впустую и больше не
 *  повторяется — ровно та гонка, которую нашёл аудит 02.08.
 *
 *  Фокус ставится только через `NO_SCROLL`: обычный `focus()` подкручивает
 *  прокручиваемого предка, и на жалобу «весь экран улетает вверх» это уже
 *  ловили 03.08 (разбор — в focusNoScroll.js).
 *
 *      const panelRef = useRef(null);
 *      const onKeyDown = useModalFocus(open, panelRef);
 *      <div ref={panelRef} role="dialog" aria-modal="true" onKeyDown={onKeyDown}>
 *
 *  @param {boolean} open  слой показан
 *  @param {{current: HTMLElement|null}} panelRef  корень слоя
 *  @param {boolean} [mounted]  узел уже в дереве; по умолчанию — сам `open`
 *  @returns {(e: KeyboardEvent) => void} обработчик для onKeyDown корня
 */
export function useModalFocus(open, panelRef, mounted = open) {
  // Возврат фокуса тому, кто открыл. ОТДЕЛЬНЫМ эффектом от входа: общая уборка
  // дёргала бы фокус назад на каждую смену mounted.
  useEffect(() => {
    if (!open) return;
    const restore = document.activeElement;
    return () => {
      if (restore && typeof restore.focus === "function" && document.contains(restore)) {
        restore.focus(NO_SCROLL);
      }
    };
  }, [open]);

  // Вход внутрь: первое поле, иначе первый фокусируемый узел.
  useEffect(() => {
    if (!open || !mounted) return;
    const panel = panelRef.current;
    if (!panel) return;
    const field = panel.querySelector("input, textarea, select");
    const target = field ?? panel.querySelector(FOCUSABLE);
    if (target) target.focus(NO_SCROLL);
  }, [open, mounted, panelRef]);

  return (e) => {
    if (e.key !== "Tab") return;
    const nodes = [...(panelRef.current?.querySelectorAll(FOCUSABLE) ?? [])].filter((n) => !n.disabled);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus(NO_SCROLL);
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus(NO_SCROLL);
    }
  };
}
