import { useEffect, useState } from "react";
import { Button, EmptyState, Icon, TrackRow } from "@muza/ui";
import type { ExternalPlaylist, MuzaApi, Track } from "@muza/api-client";
import { fmtTime, primarySourceLabel, providerLabel } from "../lib/format";
import { trackRowL10n } from "../lib/dsLabels";
import { useLayout } from "../shell/LayoutContext";
import { useT } from "../i18n";
import { humanError } from "@muza/api-client";

/** Read-only страница плейлиста внешней площадки (2026-07-20 SoundCloud,
 *  2026-08-14 YouTube и Deezer). Тонкий вью ОТДЕЛЬНО от PlaylistView: тому
 *  нужны реордер, роли, drop-зоны и правки состава — внешнему плейлисту из
 *  этого не нужно ничего. Треки уже в каталоге (сервер разрешает их при
 *  открытии) — играют обычным движком, лайкаются, уходят в плейлисты через
 *  обычное меню трека.
 *
 *  ⚠️ ПОЧЕМУ СТРАНИЦА ОДНА НА ТРИ ПЛОЩАДКИ, А ОБЪЯСНЕНИЕ РАЗНОЕ. Состав почти
 *  всегда короче, чем счётчик площадки, но причины у этого РАЗНЫЕ: у
 *  SoundCloud часть песен под DRM, у YouTube не разобрался ролик, у Deezer
 *  звука нет в принципе — он каталог названий, и играть можно только то, что
 *  уже есть в Музе. Одна общая фраза «часть песен недоступна» не отвечает ни
 *  на один из трёх случаев: человек не понимает, сломалось у него, у нас или
 *  у площадки. Поэтому текст выбирается по source (см. notice ниже).
 *  «Сохранить к себе» делает КОПИЮ (решение владельца 20.07: страница
 *  read-only, в библиотеку сама по себе ничего не пишет).
 *
 *  ⚠️ ПЕРЕЕХАЛО из apps/desktop/src/views/ExternalPlaylistView.tsx (волна
 *  экранов веб-паритета, 2026-08-02). Касаний площадки внутри не было вовсе —
 *  ни файлов с диска, ни переноса на рабочий стол, ни оффлайн-копии, — так что
 *  переезд дословный: изменились только пути импортов (lib/ и i18n общего
 *  пакета). На старом месте пенёк-ре-экспорт для App.tsx. */
export function ExternalPlaylistView({
  api,
  playlistId,
  currentId,
  playing,
  likes,
  rowShow,
  onPlayCatalog,
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
  const { phone } = useLayout();
  const [pl, setPl] = useState<ExternalPlaylist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Флаг живости: экран переоткрывают на другом плейлисте, и ответ по прежнему
   *  успевал нарисоваться под новым заголовком. */
  useEffect(() => {
    let alive = true;
    setPl(null);
    setError(null);
    api
      .getExternalPlaylist(playlistId)
      .then((data) => {
        if (alive) setPl(data);
      })
      .catch((e) => {
        if (alive) setError(humanError(e, t("views.scPlaylist.loadFailed")));
      });
    return () => {
      alive = false;
    };
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
        // у плейлиста YouTube автора может не быть — пустое «от » выглядит поломкой
        ...(pl.ownerUsername ? [t("views.search.publicPlaylist.by", { owner: pl.ownerUsername })] : []),
        t("views.search.publicPlaylist.trackCount", { count: pl.trackCount }),
        // часть состава могла выпасть (DRM/длительность/нет у нас) — говорим честно
        ...(pl.tracks.length < pl.trackCount
          ? [t("views.scPlaylist.playableCount", { count: pl.tracks.length })]
          : []),
      ].join(" · ")
    : "";

  /** Объяснение расхождения счётчиков — своё на каждую площадку (см. шапку).
   *  У Deezer два разных случая: «нашли часть» и «не нашли ничего» — второй
   *  требует другого текста, иначе экран показывает пустоту и молчит о ней. */
  const notice = (() => {
    if (!pl || pl.tracks.length >= pl.trackCount) return null;
    if (pl.source === "deezer") {
      return pl.tracks.length === 0 ? t("views.scPlaylist.deezerEmpty") : t("views.scPlaylist.deezerNotice");
    }
    return pl.source === "youtube" ? t("views.scPlaylist.ytNotice") : t("views.scPlaylist.drmNotice");
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: phone ? "var(--sp-4)" : "var(--sp-5)", padding: phone ? "var(--sp-4) var(--sp-4) 0" : "var(--sp-6) var(--sp-6) 0" }}>
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
            {t("views.scPlaylist.kindExternal", { source: providerLabel(pl?.source ?? "soundcloud", lang) })}
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--fs-h1)",
              fontWeight: 600,
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
      {notice ? (
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5, marginTop: "calc(-1 * var(--sp-3))" }}>
          {notice}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column" }}>
        {(pl?.tracks ?? []).map((tr, i) => (
          <TrackRow
            key={tr.id}
            {...trackRowL10n(t)}
            compact={phone}
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
