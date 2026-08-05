import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../core/Icon.jsx";

/** Synced lyrics — the product's signature. Full, uncensored, and NEVER blurred.
 *
 *  Активная строка центрируется В СЕРЕДИНЕ трека; у краёв (первые/последние
 *  строки) садится к верху/низу, а не в центр. Раньше центрировались и края —
 *  ценой ОТБИВКИ 50% высоты сверху и снизу, и это читалось как «стена пустоты»
 *  над первой строкой и под последней/ноткой (жалоба владельца 19.07: пустота
 *  «из ниоткуда», не на всех треках — только на synced, plain её не имел).
 *  Теперь краевая отбивка скромная (edgePad ниже), а центрирование середины
 *  доигрывает centerActive: scrollTo у краёв клампится сам. Ручной скролл
 *  приостанавливает следование, через 2.5с бездействия оно возвращается.
 *
 *  Сколько строк видно — у режимов РАЗНО (спека владельца, 2026-07-15):
 *  - karaoke: окно вокруг активной, видно 5 строк (radius 2), масштаб по
 *    удалению 100/90/80, дальние скрыты. Полный экран, разрежённость — замысел.
 *  - panel:   виден ВЕСЬ текст, как в Spotify. Окно здесь было (radius 1 = 3
 *    строки) и давало ровно тот эффект, на который пожаловался владелец:
 *    скрытая строка получает opacity:0, но ОСТАЁТСЯ В ПОТОКЕ и держит своё
 *    место пустым — панель читалась как три строки посреди пустоты. */
export function Lyrics({ lines, activeIndex = 0, mode = "panel", onSeek, onExplain, onLineContextMenu, autoScroll = true, endNote = false, windowLines = 5, panelLines = 0, style }) {
  const wrapRef = useRef(null);
  const activeRef = useRef(null);
  // Пользователь листает сам: показываем весь текст и не дёргаем автоскролл
  const [manual, setManual] = useState(false);
  const manualTimer = useRef(null);

  const karaoke = mode === "karaoke";
  const synced = activeIndex >= 0; // plain-текст без таймкодов — обычный список
  // Караоке-окно: активная ±radius. Окно всегда симметрично, поэтому число
  // видимых строк нечётное: 3, 5, 7… Настройка «Строк текста в караоке» даёт
  // именно это число, заводское 5 = прежний radius 2. В панели окна нет.
  const radius = Math.max(1, Math.floor((windowLines - 1) / 2));
  // autoScroll=false — постоянный «ручной» режим: свободный скролл, активная
  // строка подсвечивается, но окно за ней не едет
  const freeScroll = manual || !autoScroll;
  // «Видно всё» и «следуем за активной» — РАЗНЫЕ вещи, но до 15.07 их связывал
  // один freeScroll: показать весь текст в панели можно было, только перестав
  // следить за активной строкой. Развязано — окно осталось только у караоке.
  const windowed = karaoke && !freeScroll;
  // Краевая отбивка synced-текста. Была 50% высоты (первая/последняя строка
  // вставали ровно в центр) — но при статичном взгляде это «стена пустоты»
  // сверху и снизу (жалоба 19.07). Теперь скромная: первая строка у верха,
  // последняя у низа (как Spotify/Apple Music), центр трека доигрывает
  // centerActive (scrollTo клампится у краёв сам). Караоке — процент: полный
  // экран, активная всплывает в верхнюю треть, а не жмётся к самому краю.
  const edgePad = karaoke ? "22%" : "var(--sp-8)";

  // «Строк текста в панели»: 0 — «Авто» (размер строки диктует общий «Размер
  // текста», как было всегда), N — подобрать размер так, чтобы в видимую
  // высоту влезло ровно N строк. Наблюдаем ПРОКРУЧИВАЕМУЮ ОБЁРТКУ, а не список
  // строк: её высоту задаёт flex-родитель, поэтому обратной связи «шрифт вырос
  // → контейнер вырос → шрифт вырос» не возникает. В караоке не применяется —
  // там число строк задаётся окном, а не размером.
  const [fittedFs, setFittedFs] = useState(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    // panelLines === 1 ТОЖЕ подгоняется: «Сейчас играет» на низкой панели
    // показывает ровно одну строку во всю её высоту (адаптивная лестница в
    // shell/NowPlayingPanel.tsx). Раньше единица отсекалась вместе с нулём, и
    // самая тесная ступень лестницы молча вырождалась в обычный список.
    if (karaoke || !panelLines || panelLines < 1 || !wrap || typeof ResizeObserver === "undefined") {
      setFittedFs(null);
      return;
    }
    const recompute = () => {
      const cs = getComputedStyle(wrap);
      const lh = parseFloat(cs.getPropertyValue("--lh-lyrics")) || 1.3;
      const gap = parseFloat(cs.rowGap) || 0;
      const h = wrap.clientHeight;
      if (!h) return;
      const raw = (h - (panelLines - 1) * gap) / (panelLines * lh);
      // кламп: ниже 12px текст нечитаем, выше 34px панель превращается в караоке
      setFittedFs(Math.max(12, Math.min(34, raw)));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [karaoke, panelLines]);

  const centerActive = (behavior) => {
    const wrap = wrapRef.current;
    const el = activeRef.current;
    if (!wrap || !el) return;
    const target = el.offsetTop - wrap.clientHeight / 2 + el.clientHeight / 2;
    wrap.scrollTo({ top: target, behavior: behavior || "smooth" });
  };

  useEffect(() => {
    if (synced && autoScroll && !manual) centerActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, manual, synced, autoScroll]);

  const wake = () => {
    if (!synced || !autoScroll) return;
    setManual(true);
    if (manualTimer.current) clearTimeout(manualTimer.current);
    manualTimer.current = setTimeout(() => setManual(false), 2500);
  };

  // Одно действие строки на все способы её нажать. До 02.08 клик перематывал, а
  // Enter на той же строке открывал «смысл» — одна и та же строка делала РАЗНОЕ
  // от того, мышью её нажали или с клавиатуры.
  const activateLine = (i, hasNote) => {
    if (onSeek) {
      onSeek(i);
      // нажатие = «нашёл нужную строчку»: сразу возвращаем автоследование
      if (manualTimer.current) clearTimeout(manualTimer.current);
      setManual(false);
    } else if (hasNote) {
      onExplain(i);
    }
  };

  // Ходьба по строкам стрелками. Без неё roving-tabindex (одна остановка Tab на
  // весь текст) не имел бы смысла: перемотать можно было бы только на ТЕКУЩУЮ
  // строку. Упор в края, а не цикл: список длинный, прыжок с конца в начало
  // читается как потеря места.
  const moveLine = (delta, edge) => {
    const nodes = [...(wrapRef.current?.querySelectorAll("[data-lyric-line]") ?? [])];
    if (nodes.length === 0) return;
    if (edge === "first") return nodes[0].focus();
    if (edge === "last") return nodes[nodes.length - 1].focus();
    const i = nodes.indexOf(document.activeElement);
    if (i < 0) return nodes[0].focus();
    nodes[Math.min(Math.max(i + delta, 0), nodes.length - 1)].focus();
  };

  // Roving tabindex: в обходе Tab ровно ОДНА строка — текущая (в plain-тексте
  // первая). Иначе панель на восемьдесят строк даёт восемьдесят остановок Tab
  // по дороге к плееру.
  const tabStopIdx = synced ? Math.min(Math.max(activeIndex, 0), Math.max(lines.length - 1, 0)) : 0;
  useEffect(() => () => {
    if (manualTimer.current) clearTimeout(manualTimer.current);
  }, []);

  return (
    <div
      ref={wrapRef}
      onWheel={wake}
      onTouchMove={wake}
      // ПКМ мимо строк (края/промежутки): меню текста без строки (index=null).
      // ПКМ по строке сюда не всплывает — обработчик строки гасит всплытие сам.
      onContextMenu={onLineContextMenu ? (e) => onLineContextMenu(e, null) : undefined}
      style={{
        overflowY: "auto",
        scrollbarWidth: "none",
        display: "flex",
        flexDirection: "column",
        gap: karaoke ? "var(--sp-5)" : "var(--sp-4)",
        ...(synced ? {} : { padding: karaoke ? "40vh 0" : "var(--sp-6) 0" }),
        ...style,
      }}
    >
      {/* краевая отбивка: у краёв центрирование клампится, стены пустоты нет */}
      {synced ? <div aria-hidden data-testid="lyrics-edge-pad" style={{ flex: "none", height: edgePad }} /> : null}
      {lines.map((line, i) => {
        const d = synced ? Math.abs(i - activeIndex) : 1;
        const isActive = synced && i === activeIndex;
        const isPast = synced && i < activeIndex;
        // строка с объяснением («режим смысла»): акцентный цвет, клик открывает смысл вместо seek
        const hasNote = !!line.note && !!onExplain;
        // Масштаб. Караоке — «линза»: 100/90/80 читаются как глубина ровно
        // потому, что видно только 5 строк. В панели видно весь текст, и та же
        // лесенка выродилась бы (одна строка 90%, все прочие 80%), поэтому один
        // шаг: активная 100%, остальные 90%. Ниже не опускаем — transform не
        // занимает места в потоке, значит любой scale<1 ДОБАВЛЯЕТ пустоты (ту
        // самую, из-за которой правка) и молча ужимает prefs.fontScale.
        const scale = isActive ? 1 : karaoke ? (d === 1 ? 0.9 : 0.8) : 0.9;
        const hidden = synced && windowed && d > radius;
        // строка что-то делает по нажатию — и она на экране
        const actionable = (!!onSeek || hasNote) && !hidden;
        // Нативного title на аннотированной строке больше нет: стоковая плашка
        // WebView2 выбивалась из языка ДС (жалоба 2026-07-16); о «смысле по
        // двойному клику» говорит звёздочка-метка ниже, aria-label — скринридеру.
        // Прозрачность. В панели иерархию несёт ТОЛЬКО color: --accent-text →
        // --text-2 (0.62α) → --text-3 (0.38α). Множитель opacity здесь дал бы
        // двойное затемнение: --text-3 ×0.5 = 0.19α — это 1.8:1 к фону панели,
        // призрак вместо строки. При opacity:1 те же --text-3 дают 3.2:1 — AA
        // для крупного текста (24px bold) и нижняя планка читаемости; запаса на
        // «рамп к краям» под ней нет, рампом и служит сама лесенка color.
        const karaokeDim = freeScroll ? 0.6 : hidden ? 0 : d === 1 ? 0.7 : 0.5;
        const opacity = !synced ? 0.8 : isActive ? 1 : karaoke ? karaokeDim : 1;
        return (
          <div
            key={i}
            ref={isActive ? activeRef : null}
            // Строка нажимается → значит нажимается и с клавиатуры. Раньше
            // role/tabIndex были только у строки С ЗАМЕТКОЙ, и перемотать по
            // тексту с клавиатуры было нельзя вообще (аудит 02.08). Скрытые
            // строки караоке-окна из обхода выпадают — фокус на невидимом.
            {...(actionable
              ? {
                  "data-lyric-line": "",
                  role: "button",
                  tabIndex: i === tabStopIdx ? 0 : -1,
                }
              : {})}
            // Подпись описывает ДЕЙСТВИЕ строки, а оно разное: с перемоткой
            // Enter перематывает, и про «смысл» надо сказать отдельно; без
            // перемотки (plain-текст) Enter открывает смысл — подпись прежняя.
            aria-label={
              !actionable || !hasNote
                ? undefined
                : onSeek
                  ? `${line.text}. Смысл строки — Shift+Enter`
                  : `Смысл строки: ${line.text}`
            }
            aria-keyshortcuts={actionable && hasNote && onSeek ? "Shift+Enter" : undefined}
            onClick={() => {
              // Одиночный клик — ВСЕГДА перемотка (жалоба 2026-07-16: строка с
              // аннотацией перехватывала клик, и на неё нельзя было перемотать).
              // Аннотация — двойным кликом; без onSeek (plain-текст) прежнее
              // поведение: клик открывает объяснение.
              activateLine(i, hasNote);
            }}
            onDoubleClick={hasNote && onSeek ? () => onExplain(i) : undefined}
            onContextMenu={onLineContextMenu ? (e) => {
              // не всплывать до обёртки — иначе меню открылось бы дважды (index → null)
              e.stopPropagation();
              onLineContextMenu(e, i);
            } : undefined}
            onKeyDown={!actionable ? undefined : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                // Shift+Enter — клавиатурная пара двойному клику: у мыши
                // «смысл» на двойном нажатии, у клавиатуры отдельного двойного
                // нажатия нет. Сочетание объявлено в aria-keyshortcuts.
                if (e.shiftKey && hasNote && onSeek) onExplain(i);
                else activateLine(i, hasNote);
              } else if (e.key === "ArrowDown") { e.preventDefault(); moveLine(1); }
              else if (e.key === "ArrowUp") { e.preventDefault(); moveLine(-1); }
              else if (e.key === "Home") { e.preventDefault(); moveLine(0, "first"); }
              else if (e.key === "End") { e.preventDefault(); moveLine(0, "last"); }
            }}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: karaoke ? "var(--fs-karaoke)" : fittedFs ? `${fittedFs}px` : "var(--fs-lyric)",
              fontWeight: "var(--fw-bold)",
              lineHeight: "var(--lh-lyrics)",
              // Karaoke runs 56px+ and the side panel 24px: the same tracking
              // can't serve both — letters drift apart as they grow, so the
              // big one tightens further. Both scale with the user's size.
              letterSpacing: karaoke ? "var(--ls-karaoke)" : "var(--ls-title)",
              color: hasNote
                ? "var(--accent-text)"
                : isActive
                  ? karaoke ? "var(--text-1)" : "var(--accent-text)"
                  : isPast || d > 1 ? "var(--text-3)" : "var(--text-2)",
              opacity,
              transform: `scale(${scale})`,
              transformOrigin: "left center",
              cursor: hasNote || onSeek ? "pointer" : "default",
              pointerEvents: hidden ? "none" : "auto",
              transition: "color var(--dur-lyric) var(--ease-out), opacity var(--dur-lyric) var(--ease-out), transform var(--dur-lyric) var(--ease-out)",
              textWrap: "balance",
            }}
          >
            {line.text || "•••"}
            {/* Метка аннотации: строка кликается как все (перемотка), поэтому
                о «смысле по двойному клику» говорит звёздочка, а не цвет-ловушка */}
            {hasNote ? (
              <span aria-hidden style={{ marginLeft: 6, fontSize: "0.55em", verticalAlign: "super", opacity: 0.85 }}>
                ✦
              </span>
            ) : null}
          </div>
        );
      })}
      {/* Конфигурируемая нотка-финал (prefs.lyricsEndNote): декоративный знак в
          самом низу текста, с отступом — «песня кончилась». После последней
          строки активная переезжает на неё (activeIndex === lines.length,
          считает App.activeLine): нотка загорается акцентом, как текущая строка,
          и центрируется — «текст кончился, доигрывает музыка». */}
      {endNote && lines.length > 0 ? (
        (() => {
          const noteActive = synced && activeIndex >= lines.length;
          return (
            <div
              ref={noteActive ? activeRef : null}
              aria-hidden="true"
              style={{
                flex: "none",
                display: "flex",
                justifyContent: "center",
                paddingTop: karaoke ? "var(--sp-8, 48px)" : "var(--sp-7)",
                paddingBottom: karaoke ? "var(--sp-6)" : "var(--sp-4)",
                opacity: noteActive ? 1 : 0.55,
                transform: `scale(${noteActive ? 1.15 : 1})`,
                transition:
                  "opacity var(--dur-lyric) var(--ease-out), transform var(--dur-lyric) var(--ease-out)",
              }}
            >
              <Icon
                name="music"
                size={karaoke ? 52 : 40}
                color={noteActive ? "var(--accent-text)" : "var(--text-3)"}
                strokeWidth={noteActive ? 2 : 1.5}
              />
            </div>
          );
        })()
      ) : null}
      {synced ? <div aria-hidden data-testid="lyrics-edge-pad" style={{ flex: "none", height: edgePad }} /> : null}
    </div>
  );
}
