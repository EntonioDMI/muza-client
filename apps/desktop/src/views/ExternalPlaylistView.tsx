import { useEffect, useState } from "react";
import { Button, EmptyState, Icon, TrackRow } from "@muza/ui";
import type { MuzaApi, SoundcloudPlaylist, Track } from "@muza/api-client";
import { fmtTime, primarySourceLabel } from "../lib/format";
import { trackRowL10n } from "../lib/dsLabels";
import { useT } from "../i18n";

/** Read-only страница плейлиста SoundCloud (2026-07-20). Тонкий вью ОТДЕЛЬНО
 *  от PlaylistView: тому нужны реордер, роли, drop-зоны и правки состава —
 *  внешнему плейлисту из этого не нужно ничего. Треки уже в каталоге (сервер
 *  upsert-ит их при открытии) — играют обычным движком, лайкаются, уходят в
 *  плейлисты через обычное меню трека.
 *  «Сохранить к себе» делает КОПИЮ (решение владельца 20.07: страница
 *  read-only, в библиотеку сама по себе ничего не пишет). */
export function ExternalPlaylistView({
  api,
  playlistId,
  currentId,
  playing,
  likes,
  rowShow,
  onPlayCatalog,
  onQueueCatalog,
  onLike,
  onNotify,
  onTrackMenu,
  canSave,
  onSaveCopy,
}: {
  api: MuzaApi;
  /** id из выдачи (с префиксом sc:). */
  playlistId: string;
  currentId: string | null;
  playing: boolean;
  likes: string[];
  rowShow?: { cover: boolean; duration: boolean; album: boolean; source: boolean };
  onPlayCatalog: (tracks: Track[], id: string) => void;
  /** Дабл-клик = «в очередь» (настройка); нет — dblclick играет. */
  onQueueCatalog?: (t: Track) => void;
  onLike: (id: string) => void;
  onNotify: (text: string, icon?: string) => void;
  /** «⋯»/ПКМ на треке — обычное меню каталожного трека. */
  onTrackMenu: (t: Track, e: React.MouseEvent) => void;
  /** Серверная сессия: «Сохранить к себе» доступно. */
  canSave: boolean;
  /** Создать у себя копию плейлиста (App: createPlaylist + треки по одному). */
  onSaveCopy: (name: string, tracks: Track[]) => Promise<void>;
}) {
  const { t, lang } = useT();
  const [pl, setPl] = useState<SoundcloudPlaylist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPl(null);
    setError(null);
    api
      .getSoundcloudPlaylist(playlistId)
      .then(setPl)
      .catch((e) => setError(e instanceof Error ? e.message : t("views.scPlaylist.loadFailed")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  if (error !== null) {
    return (
      <div style={{ padding: "var(--sp-6)" }}>
        <EmptyState icon="cloud-off" title={t("views.scPlaylist.loadFailed")} hint={error} />
      </div>
    );
  }

  const meta = pl
    ? [
        t("views.search.publicPlaylist.by", { owner: pl.ownerUsername }),
        t("views.search.publicPlaylist.trackCount", { count: pl.trackCount }),
        // часть состава могла выпасть (DRM/длительность) — говорим честно
        ...(pl.tracks.length < pl.trackCount
          ? [t("views.scPlaylist.playableCount", { count: pl.tracks.length })]
          : []),
      ].join(" · ")
    : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
        {pl?.artworkUrl ? (
          <img
            src={pl.artworkUrl}
            alt=""
            style={{ width: 96, height: 96, borderRadius: "var(--r-md)", objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "var(--r-md)",
              background: "var(--surface-3)",
              display: "grid",
              placeItems: "center",
              color: "var(--text-3)",
              flexShrink: 0,
            }}
          >
            <Icon name="list-music" size={42} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-caption)",
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {t("views.scPlaylist.kind")}
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--fs-h1)",
              fontWeight: 700,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {pl?.name ?? t("views.playlist.loadingLabel")}
          </h1>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>{meta}</div>
        </div>
        {pl && pl.tracks.length > 0 ? (
          <div style={{ display: "flex", gap: "var(--sp-2)", flexShrink: 0 }}>
            <Button variant="primary" icon="play" onClick={() => onPlayCatalog(pl.tracks, pl.tracks[0].id)}>
              {t("views.search.publicPlaylist.listen")}
            </Button>
            {canSave ? (
              <Button
                variant="secondary"
                icon="plus"
                disabled={saving}
                onClick={() => {
                  setSaving(true);
                  void onSaveCopy(pl.name, pl.tracks).finally(() => setSaving(false));
                }}
              >
                {saving ? t("views.scPlaylist.saving") : t("views.scPlaylist.saveCopy")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Счётчики разошлись → объясняем словами, а не оставляем загадку
          (жалоба владельца 20.07: «N треков, а слушать нечего») */}
      {pl && pl.tracks.length < pl.trackCount ? (
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5, marginTop: "calc(-1 * var(--sp-3))" }}>
          {t("views.scPlaylist.drmNotice")}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column" }}>
        {(pl?.tracks ?? []).map((tr, i) => (
          <TrackRow
            key={tr.id}
            {...trackRowL10n(t)}
            index={i + 1}
            cover={tr.coverUrl}
            showCover={rowShow?.cover !== false}
            title={tr.title}
            artist={tr.artist}
            album={rowShow?.album ? (tr.album ?? undefined) : undefined}
            duration={fmtTime(tr.durationSec)}
            showDuration={rowShow?.duration !== false}
            source={rowShow?.source ? primarySourceLabel(tr.sources, lang) : undefined}
            active={currentId === tr.id}
            playing={currentId === tr.id && playing}
            liked={likes.includes(tr.id)}
            onPlay={() => onPlayCatalog(pl?.tracks ?? [], tr.id)}
            onRowDoubleClick={onQueueCatalog ? () => onQueueCatalog(tr) : undefined}
            onLike={() => onLike(tr.id)}
            onMore={(e: React.MouseEvent) => onTrackMenu(tr, e)}
          />
        ))}
        {pl === null && error === null ? (
          <div style={{ padding: "var(--sp-4)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
            {t("views.playlist.loadingLabel")}…
          </div>
        ) : null}
      </div>
    </div>
  );
}
