"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PlaylistDetail, Track } from "@muza/api-client";
import { useT } from "@muza/app";
import { ContextMenuProvider } from "@muza/app/shell/ContextMenu";
import { PlaylistIconPicker } from "@muza/app/shell/PlaylistIconPicker";
import { ShareDialog } from "@muza/app/shell/ShareDialog";
import { ReplaceVersionDialog, type ReplaceCtx } from "@muza/app/shell/ReplaceVersionDialog";
import type { ShareData } from "@muza/app/lib/shareCard";
import { PlaylistView } from "@muza/app/views/PlaylistView";
import { getApi } from "../../../src/api";
import { useLikes } from "../../../src/likes";
import { usePlayer } from "../../../src/player";
import { usePlaylists } from "../../../src/playlists";
import { useSession } from "../../../src/session";
import { useToast } from "../../../src/toast";
import { useWebTrackMenu } from "../../../src/components/trackMenu";

/** Страница плейлиста — ТОТ ЖЕ экран, что в приложении
 *  (@muza/app/views/PlaylistView, волна «экраны» веб-паритета, 2026-08-02).
 *  id — query-параметр (`/playlist?id=…`): статический экспорт Next не умеет
 *  динамические сегменты без generateStaticParams.
 *
 *  Своей реализации здесь больше нет — страница только подаёт экрану данные
 *  площадки (сессия, плеер, лайки, плейлисты, тосты) и умения меню. Что веб
 *  получил вместе с переездом и чего у него не было вовсе:
 *  - перестановку треков перетаскиванием и приём трека, брошенного на список;
 *  - «Совместный доступ» (участники, кик, выход) и лесенку видимости
 *    private → по коду → для всех вместе с @адресом;
 *  - подписку на чужой открытый плейлист и роль «только смотрю»;
 *  - «Поделиться» карточкой-картинкой, «Заменить версию», иконку плейлиста
 *    из обложки трека, «в начало/в конец» и множественный выбор.
 *
 *  Чего у браузера нет — того нет и на странице, не серым: «Сохранить
 *  оффлайн» (музыка на устройстве) экрану не передаётся вовсе, вставок в
 *  очередь нет в умениях меню, «Сохранить PNG» прячет сам диалог «Поделиться»
 *  (порт saveImage розетки). */
function PlaylistBody() {
  const params = useSearchParams();
  const id = params.get("id");
  const router = useRouter();
  const notify = useToast();
  const { t } = useT();
  const { session } = useSession();
  const { current, playing, playContext } = usePlayer();
  const { likedIds, toggle } = useLikes();
  const { refresh: refreshPlaylists } = usePlaylists();

  /** Показанные экраном треки: меню веба принимает Track целиком (лайк
   *  оптимистично правит список «Любимого»), а экран отдаёт наружу плоский
   *  список строк — по нему и собирается меню. */
  const [rows, setRows] = useState<Track[]>([]);
  const menu = useWebTrackMenu(rows);

  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [replaceCtx, setReplaceCtx] = useState<ReplaceCtx | null>(null);
  const [iconPicker, setIconPicker] = useState<{ coverTile: { value: string; src: string } | null } | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  /** Перечитать страницу после смены иконки: экран собирается заново при
   *  смене ключа — тот же приём, что plBump в приложении. */
  const [bump, setBump] = useState(0);

  /** Стабильные ссылки: экран держит колбэк загрузки в зависимостях, а
   *  onTracksChange — в зависимостях эффекта (новая функция каждый рендер
   *  отправила бы страницу в вечную перезагрузку). */
  const reloadPlaylists = useCallback(() => void refreshPlaylists(), [refreshPlaylists]);
  const playFrom = useCallback(
    (tracks: Track[], trackId: string) =>
      playContext(
        tracks,
        Math.max(
          tracks.findIndex((tr) => tr.id === trackId),
          0,
        ),
      ),
    [playContext],
  );

  const changeIcon = async (icon: string) => {
    if (!id) return;
    setIconBusy(true);
    try {
      await getApi().setPlaylistIcon(id, icon);
      setIconPicker(null);
      setBump((n) => n + 1);
      notify(t("toast.playlist.iconChanged"), "image");
      void refreshPlaylists();
    } catch (e) {
      notify(e instanceof Error ? e.message : t("toast.playlist.iconChangeFailed"), "x");
    } finally {
      setIconBusy(false);
    }
  };

  if (!id) return <p style={noteStyle}>{t("web.playlist.noId")}</p>;

  return (
    // suppressNativeMenu={false}: у браузера своё меню («Открыть в новой
    // вкладке», «Назад») — на сайте отбирать его нельзя. Строкам это не
    // мешает: их openMenu гасит нативное меню сам.
    <ContextMenuProvider ctx={menu.abilities} apiRef={menu.apiRef} suppressNativeMenu={false}>
      {/* .shared-screen гасит отступ зоны: общий экран приносит свои поля,
          как в приложении, где <main> голый (globals.css) */}
      <div className="shared-screen">
      <PlaylistView
        key={`${id}:${bump}`}
        api={getApi()}
        playlistId={id}
        userId={session?.user.id ?? ""}
        likes={[...likedIds]}
        currentId={current?.id ?? null}
        playing={playing}
        onPlayCatalog={playFrom}
        onLike={(trackId) => {
          const tr = rows.find((r) => r.id === trackId);
          if (tr) toggle(tr);
        }}
        onNotify={notify}
        onShare={(detail: PlaylistDetail) =>
          setShareData({
            kind: "playlist",
            name: detail.name,
            trackCount: detail.tracks.length,
            owner: detail.ownerUsername,
            covers: detail.tracks.map((tr) => tr.coverUrl).filter((c): c is string => c !== null),
          })
        }
        onReplaceVersion={(track, reload) => setReplaceCtx({ track, target: { kind: "playlist", playlistId: id, reload } })}
        onChanged={reloadPlaylists}
        onDeleted={() => router.replace("/library")}
        onChangeIcon={(fromTrack) =>
          setIconPicker({
            coverTile: fromTrack?.coverUrl ? { value: `track:${fromTrack.id}`, src: fromTrack.coverUrl } : null,
          })
        }
        onTracksChange={setRows}
      />
      </div>

      <ShareDialog
        data={shareData}
        // глиф лежит в public/: импорт картинки в общем модуле собирается у
        // площадок по-разному, поэтому ссылка приезжает пропом
        glyphSrc="/glyph.svg"
        onClose={() => setShareData(null)}
        onNotify={notify}
      />

      <ReplaceVersionDialog
        api={getApi()}
        ctx={replaceCtx}
        onClose={() => setReplaceCtx(null)}
        onNotify={notify}
        onPlayCatalog={playFrom}
        currentId={current?.id ?? null}
        playing={playing}
        // Плейлист перечитывает себя сам (reload уехал в ctx выше) — добавить
        // здесь нечего: «Любимого» этот путь не касается.
        onReplaced={() => undefined}
      />

      <PlaylistIconPicker
        open={iconPicker !== null}
        coverTile={iconPicker?.coverTile}
        busy={iconBusy}
        onClose={() => setIconPicker(null)}
        onPick={(icon) => void changeIcon(icon)}
      />

      {menu.overlay}
    </ContextMenuProvider>
  );
}

export default function PlaylistPage() {
  const { t } = useT();
  // useSearchParams в статическом экспорте обязан жить под Suspense
  return (
    <Suspense fallback={<p style={noteStyle}>{t("common.loading")}</p>}>
      <PlaylistBody />
    </Suspense>
  );
}

const noteStyle: React.CSSProperties = { margin: 0, fontFamily: "var(--font-ui)", color: "var(--text-3)" };
