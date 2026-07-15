import React from "react";
import { Icon } from "../core/Icon.jsx";

/** 4:3-варианты тумбов ytimg: 16:9-кадр, доложенный полосами сверху и снизу.
 *  16:9-варианты (mqdefault/maxresdefault/hq720) сюда НЕ входят намеренно —
 *  см. `pillarboxThumb`. */
const YT_43_THUMB = /\/(default|hqdefault|sddefault)\.(jpg|webp)$/;

/** 480×360: поля по 45px + контент 480×270 → нужно 360/270 = 4/3 = 1.333.
 *  1.34 — волосок сверху (+0.5%), чтобы съесть JPEG-звон на границе поля:
 *  на живых тумбах граница «плывёт» на 44–45px, и недозум оставил бы полоску. */
const PILLARBOX_SCALE = 1.34;

/** Нужно ли доворачивать геометрию источника.
 *
 *  Тумб YouTube — это КАДР ВИДЕО, а не обложка: квадратный арт вписан в 16:9
 *  полями по бокам, а 4:3-варианты — тот же 16:9-кадр с полосами сверху/снизу.
 *  В квадратной рамке object-fit: cover показывает центральный квадрат
 *  ИСХОДНИКА — для 4:3 в него попадают полосы. Лечится чистой геометрией: зум
 *  на 4/3 оставляет в кадре ровно 16:9-контент (для арт-треков — ровно арт).
 *  Канва для этого не нужна — потому списки (30–60 строк) чинятся бесплатно.
 *
 *  16:9-варианты зумить НЕЛЬЗЯ: полос у них нет, object-fit: cover и так даёт
 *  ровно квадрат арта, а зум срезал бы картинку. Поэтому смотрим не только на
 *  хост, но и на ИМЯ варианта.
 *
 *  dataURL от useCoverArt (уже кропнутый квадрат) сюда не попадает сам собой:
 *  у data: нет хоста → режим остаётся "cover", повторного зума не будет.
 *
 *  Почему про ytimg знает ДС. Альтернатива — проп, которым рулит приложение;
 *  но Cover зовут из ~20 мест, и знание «ytimg врёт про геометрию» тогда не
 *  исчезает, а размножается по всем зовущим, а забытый проп = тихая
 *  регрессия в новой точке. Cover — единственная точка рендера обложек ИМЕННО
 *  затем, чтобы квирки источников жили в одном месте. Проп `fit` оставлен
 *  ручным оверрайдом, дефолт "auto" трогать не нужно. */
function pillarboxThumb(src) {
  let url;
  try {
    url = new URL(src);
  } catch {
    return false; // относительный путь/мусор — точно не тумб
  }
  return /(^|\.)ytimg\.com$/.test(url.hostname) && YT_43_THUMB.test(url.pathname);
}

/** Square cover art — the ONE place artwork is rendered in the system.
 *
 *  Существует потому, что обложки в приложении разъезжались каждая по-своему:
 *  часть мест рисовала <img> вообще без object-fit (дефолтный fill = честное
 *  растяжение), часть — без плейсхолдера (нет обложки → битая картинка или
 *  дыра в раскладке, из которой уезжает соседний текст). Прокси-картинки
 *  источников (ytimg отдаёт кадр видео 4:3/16:9 вокруг квадратного арта) это
 *  добивало.
 *
 *  Контракт: контейнер — всегда квадрат (aspectRatio: 1) с overflow: hidden,
 *  картинка — всегда object-fit: cover. Значит любая непрямоугольная обложка
 *  обрезается по центру, а не сплющивается. Нет src — плейсхолдер, а не
 *  подставная чужая картинка.
 *
 *  size: число (px) или CSS-длина, в т.ч. var(--size-cover-bar). Не задан —
 *  ширина по родителю (плитки). */
export function Cover({ src, size, radius = "var(--r-xs)", alt = "", className, style, fit = "auto" }) {
  const box = {
    width: size ?? "100%",
    ...(size === undefined ? null : { height: size }),
    aspectRatio: "1",
    borderRadius: radius,
    overflow: "hidden",
    flex: "none",
    // Фон виден только пока картинка грузится — не даёт «мигнуть дырой»
    background: "var(--surface-3)",
    ...style,
  };

  if (!src) {
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        {/* size в процентах: плейсхолдер обязан жить и в 42px строки, и в 400px
            панели, и при size = var(--…), где числа взять неоткуда. lucide кладёт
            size прямо в width/height svg, а проценты там законны. */}
        <Icon name="music-2" size="45%" color="var(--text-3)" />
      </span>
    );
  }

  const pillarbox = fit === "auto" ? pillarboxThumb(src) : fit === "pillarbox";

  return (
    <span className={className} style={{ ...box, display: "block" }}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          ...(pillarbox ? { transform: `scale(${PILLARBOX_SCALE})` } : null),
        }}
      />
    </span>
  );
}
