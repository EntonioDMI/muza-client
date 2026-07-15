import { useEffect, useState } from "react";
import { EmptyState, Icon, TrackRow } from "@muza/ui";
import type { MuzaApi, Track } from "@muza/api-client";
import { withSnapshot } from "../lib/offlineSnapshot";
import { fmtTime } from "../lib/format";
import { useDrag } from "../shell/DragLayer";
import { exportCachedTrack, maybeAltFileDrag } from "../lib/dragOut";
import { useT } from "../i18n";

/** «Любимое» — настоящее избранное с сервера (слайс 4, переживает
 *  переустановку). Лайки живут в аккаунте, поэтому у анонима их нет.
 *  Раньше ниже была секция «Из демо-каталога», а App стартовал с
 *  захардкоженным лайком демо-трека — из-за чего честное пустое состояние
 *  не показывалось никогда. */
export function FavoritesView({
  api,
  canSearch,
  likes,
  currentId,
  playing,
  onPlayCatalog,
  onQueueCatalog,
  rowShow,
  onLike,
  onCatalogMenu,
  onNotify,
}: {
  api: MuzaApi;
  canSearch: boolean;
  likes: string[];
  /** id играющего трека; null — ничего не играет (ни одна строка не активна). */
  currentId: string | null;
  playing: boolean;
  /** Играть серверный трек в контексте избранного (Stage 3, движок). */
  onPlayCatalog: (tracks: Track[], id: string) => void;
  /** Дабл-клик = «в очередь» (настройка); нет — dblclick играет. */
  onQueueCatalog?: (t: Track) => void;
  /** Строка трека (настройка «Строка трека»): что показывать. */
  rowShow?: { cover: boolean; duration: boolean };
  onLike: (id: string) => void;
  /** «⋯» на серверном треке: меню Stage 4 (плейлист, версии/источники). */
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
  /** Тост (T18: «Трека нет в кэше…» при Alt+drag файла). */
  onNotify: (text: string, icon?: string) => void;
}) {
  const { t } = useT();
  const { dragSource } = useDrag();
  const [server, setServer] = useState<Track[] | null>(null);

  useEffect(() => {
    if (!canSearch) return;
    // Stage 4: сервер лёг — показываем последний снапшот (оффлайн-режим)
    withSnapshot("favorites", () => api.getFavorites())
      .then(({ data }) => setServer(data))
      .catch(() => setServer([]));
    // likes меняются лайками в интерфейсе — перечитываем список
  }, [api, canSearch, likes]);

  const total = server?.length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <Icon name="heart" size={26} color="var(--accent-text)" filled />
        <h1 style={{ margin: 0, fontSize: "var(--fs-h1)", fontWeight: 700, color: "var(--text-1)" }}>{t("views.favorites.title")}</h1>
        <span style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", alignSelf: "flex-end", paddingBottom: 4 }}>
          {total > 0 ? t("views.favorites.trackCount", { count: total }) : ""}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", paddingBottom: "var(--sp-6)" }}>
        {(server ?? []).map((tr, i) => (
          // draggable: любимое можно унести в плейлист сайдбара; Alt+drag — файл (T18)
          <div
            key={tr.id}
            draggable
            onDragStart={(e) => {
              // Только Alt: для остального dragSource гасит draggable (native
              // drag убил бы pointer-перенос через pointercancel).
              if (maybeAltFileDrag(e, () => exportCachedTrack(tr.id, tr.artist, tr.title), (m) => onNotify(m, "x")))
                return;
              e.preventDefault();
            }}
            {...dragSource({ id: tr.id, title: tr.title, artist: tr.artist, cover: tr.coverUrl, kind: "track" })}
          >
            <TrackRow
              index={i + 1}
              cover={tr.coverUrl}
              showCover={rowShow?.cover !== false}
              title={tr.title}
              artist={tr.artist}
              duration={fmtTime(tr.durationSec)}
              showDuration={rowShow?.duration !== false}
              active={currentId === tr.id}
              playing={currentId === tr.id && playing}
              liked
              onPlay={() => onPlayCatalog(server ?? [], tr.id)}
              onRowDoubleClick={onQueueCatalog ? () => onQueueCatalog(tr) : undefined}
              onLike={() => onLike(tr.id)}
              onMore={(e: React.MouseEvent) => onCatalogMenu(tr, e)}
            />
          </div>
        ))}

        {/* Аноним: лайки живут в аккаунте, сервера у него нет — говорим прямо.
            Залогиненный с пустым избранным — честное «пока пусто». */}
        {!canSearch ? (
          <EmptyState icon="user" title={t("views.favorites.anon.title")} hint={t("views.favorites.anon.hint")} />
        ) : total === 0 && server !== null ? (
          <EmptyState icon="heart" title={t("views.favorites.emptyTitle")} hint={t("views.favorites.empty")} />
        ) : null}
      </div>
    </div>
  );
}
