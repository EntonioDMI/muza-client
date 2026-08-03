/** ФОН-КАРТИНА: одна рисовалка на оба фона Muza — за интерфейсом и в караоке.
 *
 *  ПОЧЕМУ ФОН КАРАОКЕ ОТДЕЛЁН ОТ ОСНОВНОГО (заявка владельца, 2026-08-03).
 *  Он поставил гифку основным фоном и ждал её же в режиме прослушивания — а там
 *  намертво сидела размытая обложка трека, без единой настройки. Его слова:
 *  «основной фон и фон в караоке — разные вещи, эти настройки должны
 *  разделяться». Разделили: у караоке своя группа полей karaokeBg* (зеркало
 *  основной) и своё значение «как основной фон» — ровно то, чего он ждал, но не
 *  по умолчанию.
 *
 *  ПОЧЕМУ ПО УМОЛЧАНИЮ «ОБЛОЖКА ТРЕКА». Караоке выглядит одинаково у всех со
 *  Stage 3. Молча поменять людям вид нельзя — это не улучшение, а сюрприз.
 *  Поэтому karaokeBgType="cover" + zone="scene" рисуют РОВНО прежнюю разметку:
 *  inset −10 %, 120 %×120 %, blur(--blur-scenery), transform: scale(1.1), без
 *  приглушения. Ни одного изменённого пикселя у того, кто настройку не трогал.
 *
 *  ЧЕМ ОТЛИЧАЮТСЯ ЗОНЫ. Разница ровно одна и живёт в ветке "cover":
 *   • "app" — подложка ПОД интерфейсом: снимок приглушён до 22 % и меняется с
 *     треком через muza-fade (key={cover} ремонтирует картинку, чтобы анимация
 *     появления проигралась заново);
 *   • "scene" — караоке: снимок в полную силу (сверху ложится своя затемняющая
 *     плёнка --glass-deep) и чуть приближен, зато БЕЗ fade — сегодня смена
 *     трека там просто подменяет src, и добавлять движение значило бы менять
 *     вид тем, кто ни о чём не просил.
 *  Остальные виды фона в обеих зонах идентичны.
 *
 *  ПОЧЕМУ КОМПОНЕНТ НЕ ЗНАЕТ ПРО Prefs. Ему приходит плоский BackdropView
 *  (prefs/backdrop.ts) — там же живёт развилка «какие поля читать» и вся
 *  нормализация чужих значений. Здесь остаётся только разметка.
 *
 *  ⚠️ Пока фон ПРИЛОЖЕНИЯ рисует apps/desktop/src/App.tsx своей копией этой
 *  разметки, живут две рисовалки. Это временно и намеренно (перевод App.tsx —
 *  отдельная правка); чтобы они не путались, классы вращения здесь свои
 *  (.muza-backdrop-orb--*, см. animatedBackdrop.css). */

import type { CSSProperties } from "react";
import { SPIN_PAIRS, type BackdropView } from "../prefs/backdrop";
import "./animatedBackdrop.css";

const FILL: CSSProperties = { position: "absolute", inset: 0 };

export function AnimatedBackdrop({
  view,
  cover,
  spinning = true,
  paused = false,
}: {
  view: BackdropView;
  /** Обложка играющего трека. null — нечего показывать: виды "cover" и
   *  "animated" в этом случае не рисуются вовсе (та же идиома, что у "image"
   *  без ссылки), остаётся фон зоны. */
  cover: string | null;
  /** Вращение вообще разрешено: общий переключатель анимаций И системное
   *  «уменьшить анимацию». Выключено — круги стоят на месте, а не пропадают. */
  spinning?: boolean;
  /** Заморозить вращение на текущем угле (фон не видно: караоке закрыто, окно
   *  свёрнуто или накрыто). Не то же самое, что spinning=false: угол
   *  сохраняется, возврат идёт без прыжка. */
  paused?: boolean;
}) {
  // Размытие ставится, только когда оно есть: blur(0px) ничего не размывает, но
  // заводит полноэкранный слой композитора — плата ни за что.
  const blur = view.sceneryBlurPx > 0 ? "blur(var(--blur-scenery))" : undefined;

  if (view.type === "color") {
    return <div aria-hidden="true" style={{ ...FILL, background: view.color }} />;
  }

  if (view.type === "gradient") {
    return (
      <div
        aria-hidden="true"
        style={{ ...FILL, background: `linear-gradient(160deg, ${view.color} 0%, ${view.color2} 100%)` }}
      />
    );
  }

  if (view.type === "image") {
    if (!view.imageUrl) return null;
    return (
      <img
        src={view.imageUrl}
        alt=""
        style={{
          position: "absolute",
          inset: "-5%",
          width: "110%",
          height: "110%",
          objectFit: "cover",
          filter: blur,
        }}
      />
    );
  }

  if (view.type === "cover") {
    if (!cover) return null;
    const scene = view.zone === "scene";
    return (
      <img
        // Ремонт на смене трека нужен только приложению — он перезапускает
        // muza-fade. У сцены караоке fade нет, и key там навредил бы: картинка
        // моргала бы там, где раньше просто менялся src.
        key={scene ? undefined : cover}
        src={cover}
        alt=""
        className={scene ? undefined : "muza-fade"}
        style={{
          position: "absolute",
          inset: "-10%",
          width: "120%",
          height: "120%",
          objectFit: "cover",
          filter: blur,
          ...(scene ? { transform: "scale(1.1)" } : { opacity: 0.22 }),
        }}
      />
    );
  }

  if (view.type === "animated") {
    if (!cover) return null;
    const [left, right] = SPIN_PAIRS[view.animSpin];
    const solo = view.animDiscs === "one";
    return (
      // ПЕРФ: размытие и прозрачность — ОДИН раз на общем контейнере, а не по
      // слою на каждую картинку.
      <div aria-hidden="true" style={{ ...FILL, overflow: "hidden", filter: blur, opacity: view.animOpacity / 100 }}>
        {/* Одна обложка встаёт по центру и берёт направление ЛЕВОГО круга:
            «навстречу» в одиночку не бывает, честный ответ на него — «по
            часовой» (таблица SPIN_PAIRS). Заход за край для неё не имеет
            смысла — прятать нечего, круг и так в середине окна. */}
        <Orb
          cover={cover}
          view={view}
          side={solo ? "solo" : "left"}
          direction={left}
          spinning={spinning}
          paused={paused}
        />
        {solo ? null : (
          <Orb cover={cover} view={view} side="right" direction={right} spinning={spinning} paused={paused} />
        )}
      </div>
    );
  }

  return null;
}

/** Один круг-обложка.
 *
 *  Диаметр = max(scale vw, scale vh), а не «scale % от высоты контейнера»:
 *  на ультрашироком окне (3440×1440) круг, посчитанный от высоты, не дотягивался
 *  до центра при заходе за край −20 % ширины (фикс по ревью T15). max(vw, vh)
 *  даёт нужный запас при ЛЮБОМ соотношении сторон.
 *
 *  Вращение висит на ОБЁРТКЕ без key, а key={cover} — только на картинке внутри:
 *  смена трека ремонтирует img (и фейдит его), а идущая CSS-анимация обёртки не
 *  прерывается и угол не сбрасывается. */
function Orb({
  cover,
  view,
  side,
  direction,
  spinning,
  paused,
}: {
  cover: string;
  view: BackdropView;
  side: "left" | "right" | "solo";
  direction: "cw" | "ccw";
  spinning: boolean;
  paused: boolean;
}) {
  const size = `max(${view.animScale}vw, ${view.animScale}vh)`;
  const place: CSSProperties =
    side === "solo"
      ? { left: "50%", transform: "translate(-50%, -50%)" }
      : side === "left"
        ? { left: `-${view.animEdge}%`, transform: "translateY(-50%)" }
        : { right: `-${view.animEdge}%`, transform: "translateY(-50%)" };
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        height: size,
        aspectRatio: "1",
        borderRadius: "50%",
        overflow: "hidden",
        ...place,
      }}
    >
      <div
        className={spinning ? `muza-backdrop-orb--${direction}` : undefined}
        data-orb-paused={paused ? "" : undefined}
        style={{ width: "100%", height: "100%", animationDuration: `${view.animSpeedSec}s` }}
      >
        <img
          key={cover}
          src={cover}
          alt=""
          className="muza-fade"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
    </div>
  );
}
