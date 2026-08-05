/** ПРЕРЫВАЕМЫЙ ПЛАВАЮЩИЙ СЛОЙ — один механизм на меню, диалог, выпадашку,
 *  палитру и подсказку. Пара к утилите .muza-layer в animations.css: хук держит
 *  ЖИЗНЕННЫЙ ЦИКЛ узла, класс — его позу и длительности.
 *
 *  ПОЧЕМУ НЕ @keyframes. До 2026-08-05 Dialog и Menu переключали свойство
 *  animation с «…Out» обратно на «…In» НА ОДНОМ И ТОМ ЖЕ УЗЛЕ. Браузер стартует
 *  новую анимацию от её собственного from-кадра, то есть от ЗАКРЫТОЙ позы:
 *  полуоткрытая панель телепортировалась в закрытую и ехала оттуда заново. У
 *  перехода (transition) стартом всегда берётся ТЕКУЩЕЕ ВЫЧИСЛЕННОЕ значение —
 *  прерываемость получается по построению, без единой строки кода про «отменить
 *  начатое». Отсюда и весь этот файл: он ничего не анимирует сам, он лишь
 *  вовремя переставляет data-layer-state и вовремя снимает узел.
 *
 *  ПОЧЕМУ ХУК, А НЕ ТРЕТЬЯ КОПИЯ. delayed-unmount был написан дважды (Dialog и
 *  Menu), и обе копии носили магический фолбэк-таймер — 500 и 400 мс. Оба врали:
 *  при замедленных анимациях (ползунок скорости до 170 %) уход длиннее таймера,
 *  и слой снимался на середине собственного затухания.
 *
 *  ЧТО ДЕЛАЕТ ВЫЗЫВАЮЩИЙ: рендерит слой, пока mounted, и раскладывает layerProps
 *  на ТОТ САМЫЙ узел, которому дал класс .muza-layer. Нужен свой ref на тот же
 *  узел (замер, фокус, querySelector) — передай его вторым аргументом
 *  ({ ref }), хук возьмёт его вместо своего, и двух ref'ов на узле не будет. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readDurationMs } from "./motion.js";

/** Сколько ждать, когда живой длительности НЕ ВИДНО: стили пакета не подключены
 *  потребителем, узел скрыт display:none, jsdom. Число заведомо больше самого
 *  долгого ухода шкалы (--dur-scene-out 280 мс на скорости 1.0), но не настолько,
 *  чтобы забытый слой заметно висел в дереве. */
const BLIND_FALLBACK_MS = 400;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * @param {boolean} open — должен ли слой быть виден
 * @param {{ ref?: import("react").RefObject<Element> }} [options]
 * @returns {{ mounted: boolean, layerProps: object }}
 */
export function useLayerState(open, options = {}) {
  const ownRef = useRef(null);
  // options.ref обязан быть стабильным (обычный useRef вызывающего) — он им и
  // является; условного хука здесь нет, свой ref заводится всегда.
  const nodeRef = options.ref ?? ownRef;
  const timerRef = useRef(null);
  const [mounted, setMounted] = useState(open);
  // Стартуем ВСЕГДА закрытыми, даже если open=true на первом рендере: иначе у
  // слоя, который монтируется сразу открытым (Select, палитра, подсказка —
  // их узел рождается вместе с открытием), не было бы кадра «до», и вход не
  // сыграл бы вовсе.
  const [state, setState] = useState("closed");

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const finish = useCallback(() => {
    clearTimer();
    setState("closed");
    setMounted(false);
  }, [clearTimer]);

  // ВХОД. Эффект намеренно БЕЗ СПИСКА ЗАВИСИМОСТЕЙ: узел слоя появляется не
  // обязательно на том коммите, где сменился open (Select ждёт замера позиции и
  // рисует панель только вторым коммитом), а зависимостями «появление узла» не
  // выражается. Прогон на каждом коммите стоит одного сравнения: как только
  // состояние стало open, эффект выходит первой же строкой.
  useLayoutEffect(() => {
    if (!open) return;
    clearTimer(); // передумали закрывать — снимаем страховку ухода
    if (!mounted) {
      setMounted(true); // узел появится следующим коммитом, тогда и продолжим
      return;
    }
    if (state === "open") return;
    const node = nodeRef.current;
    if (!node) return;
    // ПРИНУДИТЕЛЬНЫЙ РЕФЛОУ, А НЕ requestAnimationFrame. Браузеру нужно
    // ВЫЧИСЛИТЬ закрытую позу, иначе он схлопнет обе смены стиля в одну и
    // перехода не будет вовсе. rAF это тоже даёт, но угадыванием кадра: под
    // нагрузкой кадр приходит позже отрисовки, и слой успевает мигнуть закрытой
    // позой. Чтение offsetHeight детерминировано — layout считается здесь и
    // сейчас, до возврата из эффекта.
    if (!prefersReducedMotion()) void node.offsetHeight;
    setState("open");
  });

  // УХОД. Узел остаётся в дереве, меняется только поза; снимет его transitionend
  // или страховка ниже. При «меньше движения» ждать нечего — снимаем сразу, как
  // это делали Dialog и Menu до появления хука.
  useEffect(() => {
    if (open || !mounted) return;
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    setState("closed");
  }, [open, mounted, finish]);

  // СТРАХОВКА. transitionend может не прийти: вкладка уснула, узел скрыли
  // display:none, свойство не изменилось вовсе. Длительность читаем с ЖИВОГО
  // узла и уже ПОСЛЕ того, как на нём оказалось data-layer-state="closed", —
  // иначе getComputedStyle отдал бы длительность ВХОДА (она объявлена на
  // [data-layer-state="open"]) и страховка сработала бы не по тому времени.
  // Полтора запаса плюс 100 мс: конец перехода и без того нормальный путь,
  // таймер — только для случаев, когда события не будет.
  useEffect(() => {
    if (open || !mounted || state !== "closed") return;
    const live = readDurationMs(nodeRef.current);
    const ms = live > 0 ? live * 1.5 + 100 : BLIND_FALLBACK_MS;
    timerRef.current = setTimeout(finish, ms);
    // Эта же уборка — единственная, что нужна при размонтировании: таймер
    // ставится только здесь, а слушатель ухода живёт пропом на узле и исчезает
    // вместе с ним.
    return clearTimer;
  }, [open, mounted, state, nodeRef, finish, clearTimer]);

  const onTransitionEnd = useCallback(
    (e) => {
      if (open) return; // это доиграл ВХОД
      // e.target, а не currentTarget: событие всплывает, и без проверки слой
      // снимался бы по первому же доехавшему transform любого потомка.
      if (e.target !== nodeRef.current) return;
      // Прозрачность — единственное свойство, которое меняется у ЛЮБОГО слоя
      // (поза бывает none: затемнение диалога, подсказка). Ждём именно её.
      if (e.propertyName !== "opacity") return;
      finish();
    },
    [open, nodeRef, finish],
  );

  return {
    mounted,
    layerProps: {
      ref: nodeRef,
      "data-layer-state": state,
      onTransitionEnd,
      // inert только на УХОДЕ: на первом кадре входа поза тоже закрытая, и
      // безусловный inert по state отнимал бы фокус у только что открытой
      // панели ровно в тот момент, когда она его туда уводит.
      inert: !open && mounted ? true : undefined,
    },
  };
}
