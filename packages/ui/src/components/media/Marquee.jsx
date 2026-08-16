import { useEffect, useRef, useState } from "react";

/** БЕГУЩАЯ СТРОКА ДЛЯ ТОГО, ЧТО НЕ ПОМЕСТИЛОСЬ.
 *
 *  Приём из наборов вроде Magic UI / React Bits, но взятый ради ЗАДАЧИ, а не
 *  ради эффекта: у длинных названий треков хвост срезался многоточием, и
 *  «Kai Angel & 9mice — …» невозможно было дочитать вообще никак. Наведение
 *  мышью — единственный момент, когда человек этого хвоста ХОЧЕТ.
 *
 *  ⚠️ ТРИ ПРАВИЛА, БЕЗ КОТОРЫХ ЭТО СТАНОВИТСЯ РАЗДРАЖИТЕЛЕМ:
 *
 *  1. ЕДЕТ ТОЛЬКО ПЕРЕПОЛНЕННОЕ. Помещается — обычный текст, ноль анимации,
 *     ноль подписок. В списке на сотню строк «едут все» превратило бы экран в
 *     табло аэропорта, а процессор — в печку.
 *  2. ЕДЕТ ТОЛЬКО ПОД КУРСОРОМ (или при фокусе с клавиатуры). Постоянное
 *     движение в списке, который человек просто читает, — самый быстрый способ
 *     сделать интерфейс утомительным. Тот же довод записан в animations.css
 *     про короткие переходы: чем чаще человек это видит, тем дороже ему
 *     анимация.
 *  3. СКОРОСТЬ ПОСТОЯННА, А НЕ ДЛИТЕЛЬНОСТЬ. Иначе длинное название едет
 *     торопливо, короткое — ползёт, и одинаковыми они не выглядят никогда.
 *
 *  При `prefers-reduced-motion` не едет вовсе: остаётся обычное многоточие.
 *  Это не «деградация», а осознанный отказ — человек попросил не двигать.
 */

/** Пикселей в секунду. Медленнее — не дочитать за разумное время наведения,
 *  быстрее — глаз не успевает за текстом. */
const SPEED_PX_PER_SEC = 40;
/** ⚠️ ДОЛЯ ПРОЕЗДА В ЦИКЛЕ — ЖЁСТКО СВЯЗАНА С @keyframes muzaMarquee.
 *  Проценты в кадрах переменной не задать, поэтому согласование лежит здесь:
 *  там два проезда по 30% и две полки по 20%. Делим время проезда на 0.3 и
 *  получаем полный цикл. Менять — только вместе с animations.css. */
const TRAVEL_SHARE = 0.3;

export function Marquee({ text, className, style, ...rest }) {
  const boxRef = useRef(null);
  const textRef = useRef(null);
  const [overflow, setOverflow] = useState(0);
  const [running, setRunning] = useState(false);

  // Переполнение меряем на КАЖДУЮ смену текста и размера: строка трека
  // переиспользуется виртуальным списком, и без пересчёта новая песня
  // унаследовала бы чужой замер.
  useEffect(() => {
    const box = boxRef.current;
    const span = textRef.current;
    if (!box || !span) return;
    const measure = () => {
      const extra = span.scrollWidth - box.clientWidth;
      setOverflow(extra > 1 ? extra : 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [text]);

  const active = running && overflow > 0;
  const travelMs = (overflow / SPEED_PX_PER_SEC) * 1000;
  const cycleMs = Math.round(travelMs / TRAVEL_SHARE);

  return (
    <span
      ref={boxRef}
      className={className}
      style={{ display: "block", overflow: "hidden", whiteSpace: "nowrap", ...style }}
      onPointerEnter={() => setRunning(true)}
      onPointerLeave={() => setRunning(false)}
      onFocus={() => setRunning(true)}
      onBlur={() => setRunning(false)}
      {...rest}
    >
      <span
        ref={textRef}
        className={active ? "muza-marquee-run" : undefined}
        style={{
          display: "inline-block",
          maxWidth: "100%",
          // Многоточие живёт ТОЛЬКО в покое: у едущего текста оно съело бы
          // тот самый хвост, ради которого он и поехал.
          overflow: active ? "visible" : "hidden",
          textOverflow: active ? "clip" : "ellipsis",
          whiteSpace: "nowrap",
          verticalAlign: "top",
          ...(active
            ? {
                "--muza-marquee-shift": `-${overflow}px`,
                "--muza-marquee-dur": `${cycleMs}ms`,
              }
            : null),
        }}
      >
        {text}
      </span>
    </span>
  );
}
