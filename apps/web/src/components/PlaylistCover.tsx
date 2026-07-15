"use client";

import { Icon } from "@muza/ui";
import { playlistIconSrc } from "@muza/core";

/** Обложка плейлиста (T47): картинка выбранной иконки из манифеста
 *  @muza/core, фолбэк — прежний значок по типу плейлиста (совместный/свой),
 *  как было до иконок. Один компонент для сайдбара/списка/шапки плейлиста —
 *  чтобы правило фолбэка не разъезжалось по местам использования. */
interface PlaylistCoverProps {
  /** id иконки из PlaylistMeta/PlaylistDetail.icon; невалидный/чужой id → фолбэк. */
  icon?: string | null;
  /** true — совместный плейлист (иконка-фолбэк "users"), иначе "list-music". */
  shared: boolean;
  size: number;
  radius?: string;
  iconSize?: number;
}

export function PlaylistCover({ icon, shared, size, radius = "var(--r-xs)", iconSize }: PlaylistCoverProps) {
  const src = playlistIconSrc(icon);
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flex: "none",
        background: "var(--accent-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {src ? (
        <img src={src} alt="" width={size} height={size} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <Icon name={shared ? "users" : "list-music"} size={iconSize ?? Math.round(size * 0.42)} color="var(--accent-text)" />
      )}
    </span>
  );
}
