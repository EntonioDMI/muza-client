"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, SearchInput } from "@muza/ui";
import { pickRandomPlaylistIcon } from "@muza/core";
import { ApiError, humanError } from "@muza/api-client";
import { useT } from "@muza/app";
import { ContextMenuProvider, type ContextMenuApi, type MenuAbilities } from "@muza/app/shell/ContextMenu";
import { AddLinkDialog } from "@muza/app/shell/AddLinkDialog";
import { ImportDialog } from "@muza/app/shell/ImportDialog";
import { JoinPlaylistDialog } from "@muza/app/shell/JoinPlaylistDialog";
import { LibraryView } from "@muza/app/views/LibraryView";
import { getApi } from "../../../src/api";
import { useLikes } from "../../../src/likes";
import { usePlayer } from "../../../src/player";
import { usePlayPlaylist, usePlaylists } from "../../../src/playlists";
import { useToast } from "../../../src/toast";

/** «Твоя медиатека» — тот же экран, что в приложении
 *  (@muza/app/views/LibraryView, волна экранов веб-паритета 2026-08-02).
 *  Своей вёрстки у страницы больше нет: раньше здесь была вторая реализация
 *  сетки плиток и своя плитка «Любимое», которые уже разъезжались с
 *  приложением по подписям, отступам и поведению.
 *
 *  ЧТО ПРИШЛО ВМЕСТЕ С ОБЩИМ ЭКРАНОМ: приём трека на плитку перетаскиванием,
 *  порядок плиток за ручку-⠿, выделение нескольких плейлистов с массовым
 *  удалением, контекстные меню плитки и пустого места, закреплённые и
 *  подписки — всего этого в вебе не было вовсе.
 *
 *  ЧЕГО НЕТ И БЫТЬ НЕ МОЖЕТ: вкладки «Локальные» — браузер не знает путей к
 *  файлам на диске (порт localFiles ему не выдан), поэтому вкладка не серая,
 *  а отсутствует.
 *
 *  ДОБРАНО В ХВОСТАХ (2026-08-02): «По ссылке», «Импорт плейлиста» и «История»
 *  вернулись/появились здесь. Все три — чистая работа сервера (addDirectTrack,
 *  importPlaylist, getHistory) без единого касания устройства, так что браузеру
 *  для них ничего особенного не нужно; «По коду» переехал на общий диалог
 *  (@muza/app/shell/JoinPlaylistDialog) — своей копии у веба больше нет. */
export default function LibraryPage() {
  const router = useRouter();
  const notify = useToast();
  const { t } = useT();
  const { favorites } = useLikes();
  // reorder — общий с боковой панелью: порядок плиток и порядок строк панели
  // это ОДИН порядок, и считается он теперь в одном месте (см. playlists.tsx)
  const { playlists, refresh, reorder } = usePlaylists();
  // «Слушать» — общий с боковой панелью хук (playlists.tsx): состав плейлиста
  // не держит ни один из экранов, и путь «взять с сервера → отдать плееру» был
  // тут копией
  const playPlaylist = usePlayPlaylist();
  const { current, playing, playContext } = usePlayer();
  const menuApiRef = useRef<ContextMenuApi<MenuAbilities> | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [joinOpen, setJoinOpen] = useState(false);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const sidebarVisible = useSidebarVisible();

  /** Трек уронили на плитку плейлиста. */
  const dropOnPlaylist = async (playlistId: string, trackId: string) => {
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    try {
      await getApi().addPlaylistTrack(playlistId, trackId);
      notify(t("toast.playlist.addedTrack", { name: pl.name }), "list-music");
      void refresh();
    } catch (err) {
      notify(humanError(err, t("toast.playlist.addFailed")), "x");
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCreateName("");
  };

  const create = async () => {
    const name = createName.trim();
    if (!name) return;
    setCreateBusy(true);
    try {
      const usedIcons = playlists.map((p) => p.icon).filter((v): v is string => Boolean(v));
      const playlist = await getApi().createPlaylist(name, pickRandomPlaylistIcon(usedIcons));
      await refresh();
      closeCreate();
      router.push(`/playlist?id=${playlist.id}`);
    } catch (e) {
      notify(humanError(e, t("toast.playlist.createFailed")), "x");
    } finally {
      setCreateBusy(false);
    }
  };

  /** Умения браузера для меню плитки и пустого места. Чего тут нет (радио,
   *  офлайн, переименование, иконка плейлиста) — того и в меню нет: пункт
   *  появится сам, как только умение появится у веба.
   *
   *  «По ссылке» и «Импорт» стоят и на кнопках шапки, и ЗДЕСЬ — как в
   *  приложении: меню пустого места это второй, более быстрый вход к тем же
   *  диалогам (они смонтированы ниже на этой же странице). Их отсутствие было
   *  не решением, а пропуском: умения у веба есть, оба вызова чисто серверные
   *  (addDirectTrack/importPlaylist), а половина меню разъезжалась с шапкой. */
  const abilities: MenuAbilities = {
    openPlaylist: (id) => router.push(`/playlist?id=${id}`),
    playlistRole: (id) => playlists.find((p) => p.id === id)?.role ?? "owner",
    playPlaylist: (id) => void playPlaylist(id),
    openCreatePlaylist: () => setCreateOpen(true),
    openAddLink: () => setAddLinkOpen(true),
    openImport: () => setImportOpen(true),
    openJoinCode: () => setJoinOpen(true),
  };

  return (
    // suppressNativeMenu={false}: у браузера своё меню — на сайте отбирать его
    // нельзя (плиткам это не мешает, их openMenu гасит нативное сам)
    <ContextMenuProvider ctx={abilities} apiRef={menuApiRef} suppressNativeMenu={false}>
      {/* .shared-screen гасит отступ зоны: общий экран приносит свои поля,
          как в приложении, где <main> голый (globals.css) */}
      <div className="shared-screen">
        <LibraryView
          api={getApi()}
          canSearch
          srvPlaylists={playlists}
          currentId={current?.id ?? null}
          playing={playing}
          favoritesCount={favorites.length}
          onOpenFavorites={() => router.push("/favorites")}
          onOpenPlaylist={(id) => router.push(`/playlist?id=${id}`)}
          onPlaylistMenu={(p, e) => menuApiRef.current?.openMenu(e, { kind: "playlist", id: p.id, name: p.name })}
          onAddLink={() => setAddLinkOpen(true)}
          onImport={() => setImportOpen(true)}
          onJoinCode={() => setJoinOpen(true)}
          // Кнопка «Создать плейлист» — только там, где боковой панели с её
          // кнопкой нет (телефон). С панелью на экране было бы две одинаковые
          // двери, и шапка веба переставала совпадать с шапкой приложения.
          onCreatePlaylist={sidebarVisible ? undefined : () => setCreateOpen(true)}
          onPlayHistory={(tracks, index) => playContext(tracks, index)}
          onDropTrack={(playlistId, trackId) => void dropOnPlaylist(playlistId, trackId)}
          onReorderPlaylists={(id, to) => void reorder(id, to)}
          onPlaylistsChanged={() => void refresh()}
          onNotify={(text, icon) => notify(text, icon)}
        />
      </div>

      <Dialog
        open={createOpen}
        title={t("app.newPlaylistName")}
        onClose={closeCreate}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={closeCreate}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="lg" icon="check" disabled={createBusy || !createName.trim()} onClick={() => void create()}>
              {createBusy ? t("common.busy") : t("app.newPlaylistDialog.create")}
            </Button>
          </>
        }
      >
        <div
          style={{ minWidth: 280 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        >
          <SearchInput value={createName} onChange={setCreateName} placeholder={t("common.namePlaceholder")} icon="list-music" autoFocus />
        </div>
      </Dialog>

      {/* «По коду» — общий диалог (@muza/app/shell/JoinPlaylistDialog). Своя
          копия у веба была и разъезжалась с приложением: другая ширина, другой
          красный у ошибки. apiHost=null: строка «дев-сервер» — примета сборки
          приложения, в браузере такой развилки нет. */}
      <JoinPlaylistDialog
        api={getApi()}
        open={joinOpen}
        apiHost={null}
        onClose={() => setJoinOpen(false)}
        onJoined={(p) => {
          setJoinOpen(false);
          void refresh();
          notify(t("toast.playlist.joined", { name: p.name, owner: p.ownerUsername }), "users");
          router.push(`/playlist?id=${p.id}`);
        }}
      />

      {/* «По ссылке»: сервер сам достаёт трек по адресу — браузеру для этого
          ничего сверх обычного запроса не нужно. В приложении после добавления
          сразу предлагают положить трек в плейлист; здесь выбора плейлиста на
          странице нет, поэтому честно говорим, что трек добавлен. */}
      <AddLinkDialog
        api={getApi()}
        open={addLinkOpen}
        onClose={() => setAddLinkOpen(false)}
        onNotify={(text, icon) => notify(text, icon)}
        onAdded={(added) => notify(t("toast.link.trackAdded", { title: added.title }), "link")}
      />

      {/* «Импорт плейлиста»: тоже целиком серверная работа. Готовый плейлист
          сразу открываем — как в приложении. */}
      <ImportDialog
        api={getApi()}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onNotify={(text, icon) => notify(text, icon)}
        onImported={(report) => {
          void refresh();
          router.push(`/playlist?id=${report.playlist.id}`);
        }}
      />
    </ContextMenuProvider>
  );
}

/** Видна ли сейчас боковая панель.
 *
 *  Нужна ровно одному решению: показывать ли в шапке медиатеки «Создать
 *  плейлист». Кнопка — запасная дверь для телефона, где панели нет; рядом с
 *  панелью она была бы второй дверью в ту же комнату, которой в приложении
 *  нет, — из-за неё шапки веба и приложения не совпадали.
 *
 *  Спрашиваем саму панель (есть ли у неё прямоугольник на экране), а НЕ
 *  повторяем её медиа-запрос: условие в globals.css составное — ширина,
 *  ориентация и высота окна, — и вторая копия рано или поздно разъедется с
 *  первой. Стартуем с «панель есть»: лишней кнопки в первом кадре быть не
 *  должно, а на телефоне она появится сразу после монтирования. */
function useSidebarVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const check = () => setVisible((document.querySelector(".sidebar")?.getClientRects().length ?? 0) > 0);
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);
  return visible;
}
