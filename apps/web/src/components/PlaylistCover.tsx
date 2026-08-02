"use client";

import { Cover, Icon } from "@muza/ui";
import { playlistIconSrc } from "@muza/core";

/** Обложка плейлиста (T47): картинка выбранной иконки из манифеста
 *  @muza/core, фолбэк — прежний значок по типу плейлиста (совместный/свой),
 *  как было до иконок. Один компонент для сайдбара/списка/шапки плейлиста —
 *  чтобы правило фолбэка не разъезжалось по местам использования.
 *
 *  Саму картинку рисует Cover ДС, а не свой <img>: иконкой плейлиста бывает
 *  обложка трека (`coverUrl`), а это ссылка источника со вшитыми полями —
 *  ровно тот случай, ради которого Cover и знает про геометрию источников.
 *  Своя ветка остаётся только у ПУСТОГО состояния: здесь осмысленный значок
 *  (совместный плейлист / обычный), а не общая нота из ДС. */
interface PlaylistCoverProps {
  /** id иконки из PlaylistMeta/PlaylistDetail.icon; невалидный/чужой id → фолбэк. */
  icon?: string | null;
  /** PlaylistMeta/PlaylistDetail.iconCoverUrl — обложка трека, выбранного
   *  иконкой (icon="track:<id>"). Важнее манифестной картинки, как в приложении. */
  coverUrl?: string | null;
  /** true — совместный плейлист (иконка-фолбэк "users"), иначе "list-music". */
  shared: boolean;
  size: number;
  radius?: string;
  iconSize?: number;
  /** Плиточный режим (библиотека): тянется на ширину колонки, квадрат.
   *  `size` тогда — только масштаб иконки-фолбэка. */
  fluid?: boolean;
}

export function PlaylistCover({
  icon,
  coverUrl,
  shared,
  size,
  radius = "var(--r-xs)",
  iconSize,
  fluid = false,
}: PlaylistCoverProps) {
  const src = coverUrl ?? playlistIconSrc(icon);
  if (src) {
    // size не задан → Cover тянется на ширину родителя (плиточный режим)
    return <Cover src={src} size={fluid ? undefined : size} radius={radius} style={{ background: "var(--accent-soft)" }} />;
  }
  return (
    <span
      aria-hidden="true"
      style={{
        ...(fluid ? { width: "100%", aspectRatio: "1" } : { width: size, height: size }),
        borderRadius: radius,
        flex: "none",
        background: "var(--accent-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Icon name={shared ? "users" : "list-music"} size={iconSize ?? Math.round(size * 0.42)} color="var(--accent-text)" />
    </span>
  );
}
