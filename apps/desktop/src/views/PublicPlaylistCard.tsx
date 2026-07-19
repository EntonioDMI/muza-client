import { useState } from "react";
import { Button, Icon } from "@muza/ui";
import type { PublicPlaylist } from "@muza/api-client";
import { playlistIconSrc } from "@muza/core";
import { useT } from "../i18n";

/** Карточка публичного плейлиста в поиске (2026-07-17).
 *
 *  Два вида: hero — высокая плашка (режим кода PL_… и «Лучший результат»
 *  НАД треками; сознательно ВЫШЕ трековой строки — решение владельца 17.07);
 *  tile — компактная карточка витрины «Плейлисты от слушателей» под выдачей.
 *  Кнопки подписки нет у своих плейлистов (onFollow не передан). */
export function PublicPlaylistCard({
  playlist,
  variant,
  onOpen,
  onFollow,
  following = false,
}: {
  playlist: PublicPlaylist;
  variant: "hero" | "tile";
  onOpen: () => void;
  /** Подписаться; undefined — кнопка не рисуется (свой плейлист). */
  onFollow?: () => void;
  following?: boolean;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const cover = playlist.iconCoverUrl ?? playlistIconSrc(playlist.icon);
  const meta = [
    // @Адрес (2026-07-17) — первым: им хвастаются
    ...(playlist.handle ? [`@${playlist.handle}`] : []),
    t("views.search.publicPlaylist.by", { owner: playlist.ownerUsername }),
    t("views.search.publicPlaylist.trackCount", { count: playlist.trackCount }),
    ...(playlist.followersCount > 0
      ? [t("views.search.publicPlaylist.followerCount", { count: playlist.followersCount })]
      : []),
  ].join(" · ");

  const coverBox = (size: number, radius: string) =>
    cover ? (
      <img
        src={cover}
        alt=""
        style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", flexShrink: 0 }}
      />
    ) : (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: "var(--surface-3)",
          display: "grid",
          placeItems: "center",
          color: "var(--text-3)",
          flexShrink: 0,
        }}
      >
        <Icon name="list-music" size={Math.round(size * 0.45)} />
      </div>
    );

  if (variant === "tile") {
    return (
      <div
        role="button"
        tabIndex={0}
        data-testid="public-playlist-tile"
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen();
        }}
        style={{ width: 132, cursor: "pointer", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}
      >
        {coverBox(132, "var(--r-md)")}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-body)",
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {playlist.name}
          </div>
          <div
            style={{
              fontSize: "var(--fs-caption)",
              color: "var(--text-3)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {playlist.handle
              ? `@${playlist.handle}`
              : t("views.search.publicPlaylist.by", { owner: playlist.ownerUsername })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="public-playlist-hero"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-4)",
        padding: "var(--sp-4) var(--sp-5)",
        // плоская панель-зона по ДС: без обводок (замечание владельца 17.07)
        background: "var(--surface-2)",
        borderRadius: "var(--r-lg)",
      }}
    >
      {coverBox(72, "var(--r-md)")}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--fs-caption)",
            color: "var(--text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {t("views.search.publicPlaylist.kind")}
        </div>
        <div
          style={{
            fontSize: "var(--fs-title)",
            fontWeight: 700,
            color: "var(--text-1)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {playlist.name}
        </div>
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>{meta}</div>
      </div>
      <div style={{ display: "flex", gap: "var(--sp-2)", flexShrink: 0 }}>
        <Button variant="secondary" onClick={onOpen}>
          {t("views.search.publicPlaylist.open")}
        </Button>
        {onFollow ? (
          <Button
            variant="secondary"
            icon={following ? "check" : "plus"}
            disabled={busy || following}
            onClick={() => {
              // подписка идемпотентна; busy только гасит дабл-клик
              setBusy(true);
              Promise.resolve(onFollow()).finally(() => setBusy(false));
            }}
          >
            {following
              ? t("views.search.publicPlaylist.inLibrary")
              : t("views.search.publicPlaylist.addToLibrary")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
