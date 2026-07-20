import { useState } from "react";
import { Button, Icon } from "@muza/ui";
import type { PublicPlaylist } from "@muza/api-client";
import { playlistIconSrc } from "@muza/core";
import { fmtTime } from "../lib/format";
import { useT } from "../i18n";

/** Карточка плейлиста в выдаче (2026-07-20) — по мотивам SoundCloud: обложка
 *  слева, автор/название, первые ~5 треков списком, «Показать все N», ряд
 *  действий. Материал Muza: плоская панель-зона --surface-2, без обводок,
 *  теней и градиентов (правила ДС). Волны-полосы нет сознательно (решение
 *  владельца 20.07): у наших плейлистов таких данных нет вовсе, а два разных
 *  вида карточки в одном списке хуже одинакового скромного.
 *
 *  Заменила hero-вариант PublicPlaylistCard; tile для витрины живёт там же.
 *  Строки превью НЕ кликабельны: превью не возит каталожных id — играть
 *  отсюда нечем; честная кнопка «Слушать» играет плейлист целиком. */
export function PlaylistResultCard({
  playlist,
  onOpen,
  onPlay,
  onFollow,
  following = false,
}: {
  playlist: PublicPlaylist;
  onOpen: () => void;
  /** «Слушать» — играть плейлист целиком; не задан — кнопки нет. */
  onPlay?: () => void;
  /** Подписаться (только наши); не задан — кнопки нет. */
  onFollow?: () => void;
  following?: boolean;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const isSc = playlist.source === "soundcloud";
  const cover = playlist.iconCoverUrl ?? playlistIconSrc(playlist.icon);
  const meta = [
    // @Адрес (2026-07-17) — первым: им хвастаются
    ...(playlist.handle ? [`@${playlist.handle}`] : []),
    t("views.search.publicPlaylist.by", { owner: playlist.ownerUsername }),
    ...(playlist.followersCount > 0
      ? [
          isSc
            ? t("views.search.publicPlaylist.likeCount", { count: playlist.followersCount })
            : t("views.search.publicPlaylist.followerCount", { count: playlist.followersCount }),
        ]
      : []),
  ].join(" · ");

  return (
    <div
      data-testid="playlist-result-card"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--sp-5)",
        padding: "var(--sp-5)",
        background: "var(--surface-2)",
        borderRadius: "var(--r-lg)",
      }}
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          style={{ width: 120, height: 120, borderRadius: "var(--r-md)", objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: "var(--r-md)",
            background: "var(--surface-3)",
            display: "grid",
            placeItems: "center",
            color: "var(--text-3)",
            flexShrink: 0,
          }}
        >
          <Icon name="list-music" size={54} />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontSize: "var(--fs-caption)",
            color: "var(--text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {isSc ? t("views.search.publicPlaylist.kindSc") : t("views.search.publicPlaylist.kind")}
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
        <div
          style={{
            fontSize: "var(--fs-caption)",
            color: "var(--text-2)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {meta}
        </div>

        {playlist.previewTracks.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: "var(--sp-2)" }}>
            {playlist.previewTracks.map((tr, i) => (
              <div
                key={`${tr.title}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-3)",
                  height: 26,
                  fontSize: "var(--fs-caption)",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: 14,
                    flex: "none",
                    textAlign: "right",
                    color: "var(--text-3)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tr.artist ? <span style={{ color: "var(--text-2)" }}>{tr.artist} · </span> : null}
                  <span style={{ color: "var(--text-1)" }}>{tr.title}</span>
                </span>
                <span
                  style={{ flex: "none", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtTime(tr.durationSec)}
                </span>
              </div>
            ))}
            {playlist.trackCount > playlist.previewTracks.length ? (
              <button
                type="button"
                onClick={onOpen}
                style={{
                  alignSelf: "flex-start",
                  border: "none",
                  background: "none",
                  padding: "var(--sp-1) 0 0",
                  color: "var(--accent-text)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-caption)",
                  fontWeight: "var(--fw-medium)",
                  cursor: "pointer",
                }}
              >
                {t("views.search.publicPlaylist.showAll", { count: playlist.trackCount })}
              </button>
            ) : null}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-3)", flexWrap: "wrap" }}>
          {onPlay ? (
            <Button variant="primary" icon="play" onClick={onPlay}>
              {t("views.search.publicPlaylist.listen")}
            </Button>
          ) : null}
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
    </div>
  );
}
