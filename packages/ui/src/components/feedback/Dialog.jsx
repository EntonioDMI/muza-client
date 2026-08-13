import React, { useEffect, useRef } from "react";
import { Icon } from "../core/Icon.jsx";
import { IconButton } from "../core/IconButton.jsx";
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
 *  ним атрибут и берёт свою позу модификатором.
 *
 *  ── ЛИЦО ДИАЛОГА 2026-08-13 (жалоба владельца: «все модалки скучные») ──────
 *  Скука была не в оформлении, а в ОТСУТСТВИИ СТРОЕНИЯ: панель отдавала три
 *  висящих в пустоте блока (жирный заголовок, серый абзац, кнопки справа) с
 *  одинаковым зазором sp-5 между ними, и «Удалить плейлист?» выглядело ровно
 *  как «Импорт плейлиста» — ни веса, ни предупреждения, ни даже намёка, о чём
 *  окно, пока не прочтёшь заголовок целиком.
 *
 *  Добавлены ЧЕТЫРЕ необязательных вещи, все со старым поведением по умолчанию
 *  (ни один существующий вызыватель не правится):
 *    icon        — глиф в круглой плашке слева от заголовка. Диалог получает
 *                  опознаваемое лицо ДО чтения: замок, ключ, корзина.
 *    tone        — "danger" перекрашивает плашку (и только её) в тревожный тон.
 *                  Кнопку не трогаем: вес действия — забота вызывателя.
 *    description — тихая вторая строка под заголовком: последствие действия.
 *                  Ровно то место, куда UX-руководства (Carbon, Setproduct)
 *                  кладут «что произойдёт», чтобы это не смешалось с телом.
 *    onClose     — крестик в шапке. Раньше выхода было три (Escape, клик мимо,
 *                  кнопка в actions), и все три НЕВИДИМЫЕ; половина диалогов
 *                  тратила на это кнопку «Закрыть» в подвале.
 *
 *  И главное — ПОДВАЛ СТАЛ ПОДВАЛОМ: над кнопками волосяная линия во всю
 *  ширину панели (отрицательные поля гасят padding). Тот же приём в шапке,
 *  когда есть и заголовок, и тело. Три блока перестали висеть — у окна
 *  появились шапка, тело и подвал. Волосяная линия — ЕДИНСТВЕННОЕ, чем ДС
 *  разрешает разделять (tokens/glass.css): ни рамок, ни теней тут быть не
 *  может, и не надо.
 *
 *  ⚠️ maxHeight + прокрутка ТЕЛА, а не панели: уехавшие за кромку кнопки —
 *  худшее, что может случиться с модальным окном, а до 13.08 длинный диалог
 *  просто выпирал за экран целиком. */
export function Dialog({
  open,
  title,
  description,
  icon,
  tone = "neutral",
  headerAction,
  children,
  actions,
  onClose,
  /** false — крестика в шапке нет (подтверждения: выход должен быть осознанным).
   *  ⚠️ ПО УМОЛЧАНИЮ — «есть, ЕСЛИ шапка ещё не занята». Оба живых потребителя
   *  headerAction (MeaningDialog, LyricsPanel) кладут туда именно свой крестик,
   *  собранный руками до того, как он появился здесь. Безусловный крестик дал
   *  бы им ДВА одинаковых крестика подряд. Правило шире частного случая: если
   *  вызыватель сам что-то поставил в шапку, он ей и распоряжается. */
  showClose = !headerAction,
  /** Подпись крестика для читалок. Пакет без i18n — перевод даёт вызыватель. */
  closeLabel = "Close",
  width = 440,
}) {
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
          /* Панель не выше экрана; прокручивается ТЕЛО (см. ниже), шапка и
             подвал остаются на месте — кнопки недостижимыми не станут. */
          maxHeight: "calc(100dvh - 64px)",
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
          <div style={{ display: "flex", alignItems: icon || description ? "flex-start" : "center", gap: "var(--sp-3)" }}>
            {/* Плашка-лицо. Круг, а не квадрат: заголовок рядом — прямоугольный
                блок текста, и круглая метка не спорит с ним за форму.
                color-mix, а не готовый токен: --accent-soft в системе есть, а
                парного «мягкого тревожного» нет, и заводить его в чужом
                tokens/colors.css ради одной плашки — хуже, чем посчитать на
                месте от того же --danger. */}
            {icon ? (
              <span
                aria-hidden="true"
                style={{
                  flex: "none",
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background:
                    tone === "danger"
                      ? "color-mix(in srgb, var(--danger) 16%, transparent)"
                      : "var(--accent-soft)",
                }}
              >
                <Icon name={icon} size={18} color={tone === "danger" ? "var(--danger)" : "var(--accent-text)"} />
              </span>
            ) : null}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-title)", fontWeight: "var(--fw-bold)", color: "var(--text-1)", letterSpacing: "-0.01em" }}>{title}</div>
              {description ? (
                <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.45 }}>{description}</div>
              ) : null}
            </div>
            {headerAction}
            {showClose && onClose ? (
              <IconButton icon="x" size="sm" label={closeLabel} onClick={onClose} style={{ flex: "none", marginTop: -2, marginRight: -6 }} />
            ) : null}
          </div>
        ) : null}
        {/* ТЕЛО. minHeight:0 обязателен — без него flex-ребёнок не даёт себя
            сжать, и overflow:auto не включается вовсе (панель растёт наружу). */}
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", overflowY: "auto", overflowX: "hidden", minHeight: 0 }}>
          {children}
        </div>
        {actions ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: "var(--sp-3)",
              /* Линия во всю ширину панели: поля гасятся отрицательными
                 margin'ами и возвращаются padding'ом — иначе разделитель
                 повисает «поплавком» посреди подвала и делает ровно обратное
                 тому, зачем нужен. */
              margin: "0 calc(-1 * var(--sp-6)) calc(-1 * var(--sp-6))",
              padding: "var(--sp-4) var(--sp-6) var(--sp-5)",
              borderTop: "1px solid var(--hairline)",
            }}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
  return portal(layer);
}
