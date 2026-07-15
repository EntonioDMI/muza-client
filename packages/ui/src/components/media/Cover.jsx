import React from "react";
import { Icon } from "../core/Icon.jsx";

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
export function Cover({ src, size, radius = "var(--r-xs)", alt = "", className, style }) {
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

  return (
    <span className={className} style={{ ...box, display: "block" }}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </span>
  );
}
