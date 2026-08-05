import React, { useEffect, useRef } from "react";
import { NO_SCROLL } from "../../lib/focusNoScroll.js";
import { portal } from "../../lib/layerRoot.js";
import { useLayerState } from "../../lib/useLayerState.js";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Modal dialog — frosted glass panel over a deep scrim. Use sparingly.
 *  Focus: jumps inside on open (first field or button), Tab loops within,
 *  Escape closes, focus returns to the opener on close.
 *  Закрытие — delayed-unmount: узел остаётся в DOM, пока доигрывает уход. Весь
 *  механизм (позы, страховка, prefers-reduced-motion, повторное открытие прямо
 *  посреди закрытия) живёт в lib/useLayerState.js + классе .muza-layer; здесь
 *  остаются только фокус, Escape и клик мимо. Затемнение и панель — ОДИН слой
 *  на два узла: состояние диктует затемнение (на нём хук), панель повторяет за
 *  ним атрибут и берёт свою позу модификатором. */
export function Dialog({ open, title, headerAction, children, actions, onClose, width = 440 }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const pressTargetRef = useRef(null);
  const { mounted, layerProps } = useLayerState(open);
  const closing = mounted && !open;

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" && onClose) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    // Capture: модалка перехватывает Escape раньше оверлеев под ней.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // Куда вернуть фокус — запоминаем В МОМЕНТ ОТКРЫТИЯ, на том же коммите, где
  // open стал true: фокус внутрь панели уводит эффект НИЖЕ по файлу, то есть
  // строго позже этого, значит document.activeElement здесь ещё снаружи — это и
  // есть открывший элемент. Порядок объявления эффектов тут несущая
  // конструкция, а не стиль: поменяешь местами — вернём фокус сами в себя.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    return () => {
      const el = restoreRef.current;
      restoreRef.current = null;
      if (el && typeof el.focus === "function" && document.contains(el)) el.focus();
    };
  }, [open]);

  // Фокус внутрь панели (первое поле, иначе первая кнопка). mounted В DEPS
  // ОБЯЗАТЕЛЕН: приложение держит <Dialog open={…}> всегда смонтированным, и на
  // коммите смены open панель ещё null — эффект с deps [open] уходил впустую и
  // больше не повторялся, поэтому фокус не входил НИ В ОДНО модальное окно
  // (аудит 02.08). Отдельным эффектом, а не общим с возвратом фокуса: иначе
  // уборка общего эффекта дёргала бы фокус назад на каждую смену mounted.
  useEffect(() => {
    if (!open || !mounted) return;
    const panel = panelRef.current;
    const field = panel?.querySelector("input, textarea, select");
    const target = field ?? panel?.querySelector(FOCUSABLE);
    if (target) target.focus(NO_SCROLL);
  }, [open, mounted]);

  // Tab не убегает под модалку: зацикливаем внутри панели
  const onTrapKeyDown = (e) => {
    if (e.key !== "Tab") return;
    const nodes = [...(panelRef.current?.querySelectorAll(FOCUSABLE) ?? [])].filter((n) => !n.disabled);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(NO_SCROLL); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(NO_SCROLL); }
  };

  // Закрытие кликом мимо — по цели НАЖАТИЯ, а не отпускания: выделяя текст в
  // панели, мышь часто отпускают за её краем, и click тогда приходит на общего
  // предка (затемнение) — диалог закрывался прямо под руками (аудит 02.08).
  const onScrimMouseDown = (e) => { pressTargetRef.current = e.target; };
  const onScrimClick = (e) => {
    const pressed = pressTargetRef.current;
    pressTargetRef.current = null;
    if (closing || !onClose) return;
    // pressed === null — клик без нажатия (программный): считаем честным.
    if (pressed && pressed !== e.currentTarget) return; // нажали внутри панели
    onClose();
  };

  if (!mounted) return null;

  // ПОРТАЛ (03.08). Слой — position: fixed, а стеклянный предок (backdrop-filter)
  // делается для него содержащим блоком и уводит его от края окна. Цель портала
  // — theme-div приложения, а НЕ document.body: на нём живут все токены темы и
  // zoom масштаба интерфейса. Разбор с замером — packages/ui/src/lib/layerRoot.js.
  const layer = (
    <div
      {...layerProps}
      /* Затемнение приходит дольше, чем уходит: ему нужно время, чтобы
         прочитаться затемнением, а не миганием (--scrim в animations.css). */
      className="muza-layer muza-layer--scrim"
      onMouseDown={onScrimMouseDown}
      onClick={onScrimClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        background: "var(--glass-deep)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="muza-layer muza-layer--modal"
        /* Панель повторяет состояние затемнения, а не заводит своё: разъехаться
           им нельзя, а снимает узел хук по прозрачности ЗАТЕМНЕНИЯ. */
        data-layer-state={layerProps["data-layer-state"]}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onTrapKeyDown}
        style={{
          width,
          maxWidth: "calc(100% - 48px)",
          padding: "var(--sp-6)",
          borderRadius: "var(--r-xl)",
          /* Диалог — САМЫЙ ПЛОТНЫЙ материал лестницы (packages/ui/src/tokens/
             glass.css): он лежит поверх всего, и сквозь него не должно читаться
             содержимое под ним. До 03.08 был глухим --bg-1 и на ползунок
             «Плотность стекла» не отзывался вовсе — единственная панель вне
             системы. Фолбэк оставлен глухим для потребителей без движка тем. */
          background: "var(--glass-dialog, var(--bg-1))",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-5)",
        }}
      >
        {title || headerAction ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <div style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--fs-title)", fontWeight: "var(--fw-bold)", color: "var(--text-1)", letterSpacing: "-0.01em" }}>{title}</div>
            {headerAction}
          </div>
        ) : null}
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)" }}>{children}</div>
        {actions ? (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--sp-3)" }}>{actions}</div>
        ) : null}
      </div>
    </div>
  );
  return portal(layer);
}
