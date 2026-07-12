"use client";

import { Icon } from "@muza/ui";

/** Крупная квадратная обложка. Тумбы ytimg (hqdefault 480×360) несут чёрные
 *  letterbox-полосы ВНУТРИ картинки — лёгкая версия десктопного coverArt:
 *  канвас-детект не тащим, ytimg зумим на 360/270 (полосы по 45px), чужие
 *  обложки не трогаем. Владелец чинил то же самое на десктопе. */
export function Cover({
  url,
  radius = "var(--r-md)",
  className,
  style,
}: {
  url: string | null;
  radius?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (!url) {
    return (
      <div
        aria-hidden="true"
        className={className}
        style={{
          aspectRatio: "1",
          borderRadius: radius,
          background: "var(--accent-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...style,
        }}
      >
        <Icon name="music-2" size={48} color="var(--accent-text)" />
      </div>
    );
  }
  const isYt = /(^|\.)ytimg\.com$/.test((() => { try { return new URL(url).hostname; } catch { return ""; } })());
  return (
    <div className={className} style={{ aspectRatio: "1", borderRadius: radius, overflow: "hidden", ...style }}>
      <img
        key={url}
        src={url}
        alt=""
        className="muza-fade"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          ...(isYt ? { transform: "scale(1.34)" } : {}),
        }}
      />
    </div>
  );
}
