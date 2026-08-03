"use client";

import { useRef, useState } from "react";
import { Dialog, Icon } from "@muza/ui";
import type { PlaylistMeta, Track } from "@muza/api-client";
import { useT } from "@muza/app";
import type { ContextMenuApi, MenuAbilities, TrackPlace } from "@muza/app/shell/ContextMenu";
import { ReplaceVersionDialog, type ReplaceCtx } from "@muza/app/shell/ReplaceVersionDialog";
import { ShareDialog } from "@muza/app/shell/ShareDialog";
import { VersionsDialog } from "@muza/app/shell/VersionsDialog";
import type { ShareData } from "@muza/app/lib/shareCard";
import { getApi } from "../api";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { usePlaylists } from "../playlists";
import { useToast } from "../toast";

/** Правая кнопка по строке трека в вебе: умения площадки + диалоги, которые
 *  эти умения открывают.
 *
 *  ФАЙЛ БЫЛ TrackList.tsx. Своего списка треков у веба больше нет: строки
 *  рисуют общие экраны (@muza/app/views/*), они же таскают их общим слоем
 *  переноса. Компонент `TrackList`, кастомный ghost для HTML5-драга
 *  (`setTrackDragImage`) и его MIME (`TRACK_DND_MIME`) умерли вместе с
 *  переездом и снесены 2026-08-03 — вместе с мостом `externalDrop` в
 *  AppShell.tsx, который без источника ничего не принимал.
 *
 *  Тем же движением снят СВОЙ множественный выбор (`useMultiSelect`, своя
 *  панель `SelectionBar`, `openBlankMenu`/`eatSelectionClick`): выделение
 *  начиналось Ctrl/Shift-кликом ПО СТРОКЕ, а строки теперь чужие и про него не
 *  знают — счётчик всегда стоял на нуле, панель не показывалась, меню
 *  выделения было недостижимо.
 *
 *  ⚠️ А вот МАССОВЫЕ УМЕНИЯ (`addManyToPlaylist`, `likeMany`) остаются и живее
 *  всех живых: выделение теперь ведут сами общие экраны (SearchView,
 *  PlaylistView — свой useMultiSelect, своя панель), и пункты своей панели и
 *  своего меню выделения они берут ИЗ ЭТИХ ПОЛЕЙ через menuCtxRef. Уберёшь
 *  «мёртвое» поле — на поиске и в плейлисте молча исчезнут «В плейлист» и
 *  «В Любимое» у пачки треков.
 *
 *  ПОЧЕМУ ХУК, А НЕ КОПИЯ В КАЖДОМ СПИСКЕ: меню одинаково у ленты, поиска,
 *  «Любимого», статистики и плейлиста — а до 2026-08-02 у веба оно собиралось
 *  прямо в JSX двумя почти одинаковыми массивами, как когда-то в приложении
 *  (урок menuActions.ts). Здесь набор пунктов собирает та же общая
 *  buildMenuItems, что и в приложении.
 *
 *  ЧТО БРАУЗЕР НЕ УМЕЕТ — того в меню НЕТ (не серым): вставок в очередь,
 *  «сохранить офлайн», плагинов и «показать в папке». Проверка — по наличию
 *  поля-умения, поэтому пункт появится сам, как только умение появится у веба
 *  (правило описано в шапке общего menuActions.ts).
 *
 *  ЧТО ПРИЕХАЛО 2026-08-03: «Радио по треку», «Источники», «Поделиться» и
 *  «Заменить версию» в Любимом. Их не было не по умению, а по недосмотру — все
 *  четыре суть обычные запросы к серверу, ничего от устройства им не нужно.
 *  Диалоги трёх последних — ОБЩИЕ, те же, что в приложении, и живут в `overlay`
 *  этого хука: иначе их пришлось бы монтировать на пяти страницах поимённо.
 *
 *  Взамен есть умение, которого нет у приложения: «Скачать» — файл забирает
 *  браузер обычной загрузкой. */
export interface WebTrackMenu {
  /** Умения площадки — в <ContextMenuProvider ctx=…>. */
  abilities: MenuAbilities;
  apiRef: React.RefObject<ContextMenuApi<MenuAbilities> | null>;
  /** ПКМ или «⋯» по строке. */
  openRowMenu: (tr: Track, e: React.MouseEvent) => void;
  /** Диалоги меню — рендерить внутри провайдера. */
  overlay: React.ReactNode;
}

export function useWebTrackMenu(
  tracks: Track[],
  opts: {
    /** Есть только на странице плейлиста: добавляет «Убрать из плейлиста». */
    onRemoveFromPlaylist?: (track: Track) => void;
    /** Откуда открыли меню. Решает ровно один пункт: «Заменить версию» есть
     *  только в «Любимом» (в плейлисте у замены свой путь — через ctl экрана).
     *  По умолчанию "search" — как у приложения, где хоум, поиск и статистика
     *  идут одним и тем же местом. */
    place?: TrackPlace;
  } = {},
): WebTrackMenu {
  const { onRemoveFromPlaylist, place = "search" } = opts;
  const { likedIds, toggle, refresh: refreshLikes } = useLikes();
  const { current, playing, playContext } = usePlayer();
  const { playlists, loaded, refresh: refreshPlaylists } = usePlaylists();
  const notify = useToast();
  const { t } = useT();
  const apiRef = useRef<ContextMenuApi<MenuAbilities> | null>(null);
  // пикер «В плейлист» работает и на один трек, и на пачку — список, а не трек
  const [plPick, setPlPick] = useState<Track[] | null>(null);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [versionsTrack, setVersionsTrack] = useState<Track | null>(null);
  const [replaceCtx, setReplaceCtx] = useState<ReplaceCtx | null>(null);

  const openPlaylistPick = (picked: Track[]) => {
    if (picked.length === 0) return;
    setPlPick(picked);
    if (!loaded) void refreshPlaylists();
  };

  const addToPlaylist = async (pl: PlaylistMeta, picked: Track[]) => {
    setPlPick(null);
    try {
      for (const tr of picked) await getApi().addPlaylistTrack(pl.id, tr.id);
      notify(
        picked.length === 1
          ? t("toast.playlist.addedTrack", { name: pl.name })
          : t("toast.playlist.addedTracks", { name: pl.name, count: picked.length }),
        "list-music",
      );
      void refreshPlaylists();
    } catch (e) {
      notify(e instanceof Error ? e.message : t("toast.playlist.addFailed"), "x");
    }
  };

  /** «Радио по треку»: очередь = сам трек + похожие с сервера. Тот же вызов и
   *  те же тосты, что в приложении (App.tsx → startRadio). */
  const startRadio = async (track: Track) => {
    notify(t("toast.radio.building"), "radio");
    try {
      const radio = await getApi().getRadio(track.id);
      playContext([track, ...radio], 0);
      notify(t("toast.radio.byTrack", { title: track.title }), "radio");
    } catch (e) {
      notify(e instanceof Error ? e.message : t("toast.radio.buildFailed"), "x");
    }
  };

  /** Скачать: сервер отдаёт файл с Content-Disposition (?dl=1). Холодный трек
   *  сервер сперва подготовит — браузер честно покажет ожидание в загрузках. */
  const download = async (track: Track) => {
    try {
      const { url } = await getApi().getStreamUrl(track.id);
      const a = document.createElement("a");
      a.href = `${url}&dl=1`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      notify(t("web.trackList.downloadStarted"), "download");
    } catch (e) {
      notify(e instanceof Error ? e.message : t("web.trackList.downloadFailed"), "x");
    }
  };

  const byId = (id: string) => tracks.find((tr) => tr.id === id);

  /** Массовый лайк только ДОБАВЛЯЕТ: toggle снял бы лайк с уже лайкнутых
   *  (тот же урок, что у приложения — favoritesDrop 20.07). */
  const likeMany = (ids: string[]) => {
    const fresh = ids.map(byId).filter((tr): tr is Track => tr !== undefined && !likedIds.has(tr.id));
    if (fresh.length === 0) {
      notify(t("toast.favorites.already"), "heart");
      return;
    }
    for (const tr of fresh) toggle(tr);
    notify(t("toast.favorites.likedMany", { count: fresh.length }), "heart");
  };

  const abilities: MenuAbilities = {
    startRadio: (tr) => void startRadio(tr),
    addToPlaylist: (tr) => openPlaylistPick([tr]),
    isLiked: (id) => likedIds.has(id),
    toggleLike: (id) => {
      const tr = byId(id);
      if (tr) toggle(tr);
    },
    shareTrack: (tr) => setShareData({ kind: "track", title: tr.title, artist: tr.artist, coverUrl: tr.coverUrl }),
    showVersions: (tr) => setVersionsTrack(tr),
    replaceInFavorites: (tr) => setReplaceCtx({ track: tr, target: { kind: "favorites" } }),
    downloadTrack: (tr) => void download(tr),
    // Массовые: их читают ОБЩИЕ экраны — своя панель выделения и своё меню
    // выделения (menuCtxRef). См. предупреждение в шапке файла.
    addManyToPlaylist: (picked) => openPlaylistPick(picked),
    likeMany,
  };

  const openRowMenu = (tr: Track, e: React.MouseEvent) => {
    apiRef.current?.openMenu(e, {
      kind: "track",
      track: tr,
      place: onRemoveFromPlaylist ? "playlist" : place,
      ctl: onRemoveFromPlaylist
        ? {
            canEdit: true,
            // иконку плейлиста и перестановку веб пока не умеет — полей нет,
            // и пунктов в меню тоже нет
            canChangeIcon: false,
            removeTrack: () => onRemoveFromPlaylist(tr),
          }
        : undefined,
    });
  };

  const overlay = (
    <>
      {/* Выбор плейлиста для «В плейлист…». Заголовок — ОБЩАЯ строка диалога
          (app.addToPlaylistDialog.*): у веба был свой текст про то же самое
          («В какой плейлист?»), и одно понятие звучало на двух клиентах
          по-разному. */}
      <Dialog
        open={plPick !== null}
        title={
          plPick && plPick.length === 1
            ? t("app.addToPlaylistDialog.titleWithTrack", { title: plPick[0].title })
            : t("app.addToPlaylistDialog.titleWithCount", { count: plPick?.length ?? 0 })
        }
        onClose={() => setPlPick(null)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 300, maxHeight: 320, overflowY: "auto", overflowX: "hidden" }}>
          {!loaded ? (
            <span style={{ fontFamily: "var(--font-ui)", color: "var(--text-3)", padding: "var(--sp-2)" }}>{t("common.loading")}</span>
          ) : playlists.length === 0 ? (
            <span style={{ fontFamily: "var(--font-ui)", color: "var(--text-3)", padding: "var(--sp-2)" }}>
              {t("app.addToPlaylistDialog.empty")}
            </span>
          ) : (
            playlists.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => plPick && void addToPlaylist(p, plPick)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-3)",
                  padding: "var(--sp-2) var(--sp-3)",
                  border: "none",
                  borderRadius: "var(--r-sm)",
                  background: "transparent",
                  color: "var(--text-1)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-body)",
                  fontWeight: 500,
                  textAlign: "left",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Icon name="list-music" size={18} color="var(--accent-text)" />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{p.trackCount}</span>
              </button>
            ))
          )}
        </div>
      </Dialog>

      {/* «Поделиться» — общая карточка-картинка. glyphSrc пропом: ссылка на
          глиф у площадок разная (в вебе он лежит в public/). Кнопку «Сохранить
          PNG» диалог прячет сам — порта saveImage у браузера нет. */}
      <ShareDialog data={shareData} glyphSrc="/glyph.svg" onClose={() => setShareData(null)} onNotify={notify} />

      {/* «Источники»: выбор конкретной версии трека — чистая серверная
          настройка (UserTrackSource). Шаг «забыть подготовленное» диалог
          пропускает сам, браузер заранее ничего не готовит. */}
      <VersionsDialog api={getApi()} track={versionsTrack} onClose={() => setVersionsTrack(null)} onNotify={notify} />

      {/* «Заменить версию» в Любимом. Позиции сохраняет сервер; список лайков
          после замены перечитываем целиком — править его оптимистично нечем:
          старого id уже нет, а новый трек знает только сервер. */}
      <ReplaceVersionDialog
        api={getApi()}
        ctx={replaceCtx}
        onClose={() => setReplaceCtx(null)}
        onNotify={notify}
        onPlayCatalog={(list, id) => {
          const i = list.findIndex((tr) => tr.id === id);
          playContext(list, i < 0 ? 0 : i);
        }}
        currentId={current?.id ?? null}
        playing={playing}
        onReplaced={() => void refreshLikes()}
      />
    </>
  );

  return { abilities, apiRef, openRowMenu, overlay };
}
