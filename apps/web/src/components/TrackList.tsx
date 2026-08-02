"use client";

import { useRef, useState } from "react";
import { Dialog, Icon, TrackRow } from "@muza/ui";
import type { PlaylistMeta, Track } from "@muza/api-client";
import { useT } from "@muza/app";
import { ContextMenuProvider, type ContextMenuApi, type MenuAbilities } from "@muza/app/shell/ContextMenu";
import { SelectionBar } from "@muza/app/shell/SelectionBar";
import { useMultiSelect, type MultiSelect } from "@muza/app/lib/useMultiSelect";
import { getApi } from "../api";
import { fmtTime } from "../format";
import { useLikes } from "../likes";
import { usePlayer } from "../player";
import { usePlaylists } from "../playlists";
import { useToast } from "../toast";

/** Тип данных внутреннего DnD (строка трека → плейлист сайдбара). */
export const TRACK_DND_MIME = "application/x-muza-track";

/** Кастомный ghost для драга: мини-пилюля с названием вместо полупрозрачного
 *  скриншота строки. Убирается сам после старта драга. Экспортирован для
 *  других веб-списков (единственный потребитель, выдача поиска, переехал на
 *  общий экран @muza/app 2026-08-02 и таскает строки уже общим слоем). */
export function setTrackDragImage(e: React.DragEvent, track: Track) {
  const ghost = document.createElement("div");
  ghost.textContent = `${track.artist} — ${track.title}`;
  Object.assign(ghost.style, {
    position: "fixed",
    top: "-100px",
    left: "-100px",
    maxWidth: "260px",
    padding: "8px 14px",
    borderRadius: "999px",
    background: "var(--glass-panel)",
    color: "var(--text-1)",
    font: "600 13px var(--font-ui)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    pointerEvents: "none",
    zIndex: "100",
  } as CSSStyleDeclaration);
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 16, 16);
  setTimeout(() => ghost.remove(), 0);
}

/** Правая кнопка и множественный выбор для списков треков веба.
 *
 *  ПОЧЕМУ ХУК, А НЕ КОПИЯ В КАЖДОМ СПИСКЕ: меню и выделение одинаковы у
 *  плоского списка и у выдачи с группировкой — а до 2026-08-02 у веба меню
 *  собиралось прямо в JSX двумя почти одинаковыми массивами, как когда-то в
 *  приложении (урок menuActions.ts). Здесь набор пунктов собирает та же общая
 *  buildMenuItems, что и в приложении.
 *
 *  ЧТО БРАУЗЕР НЕ УМЕЕТ — того в меню НЕТ (не серым): вставки в очередь, радио,
 *  версий, «сохранить офлайн», плагинов и «показать в папке». Проверка — по
 *  наличию поля-умения, поэтому пункт появится сам, как только умение появится
 *  у веба (правило описано в шапке общего menuActions.ts).
 *
 *  Взамен есть умение, которого нет у приложения: «Скачать» — файл забирает
 *  браузер обычной загрузкой. */
export interface WebTrackMenu {
  /** Умения площадки — в <ContextMenuProvider ctx=…>. */
  abilities: MenuAbilities;
  apiRef: React.RefObject<ContextMenuApi<MenuAbilities> | null>;
  multi: MultiSelect;
  /** ПКМ или «⋯» по строке: по выделенному — меню выделения, иначе — трека. */
  openRowMenu: (tr: Track, e: React.MouseEvent) => void;
  /** ПКМ по пустому месту списка: вход в выбор («Выбрать треки»). */
  openBlankMenu: (e: React.MouseEvent) => void;
  /** onClickCapture строки: true — клик съело выделение, играть не надо. */
  eatSelectionClick: (id: string, e: React.MouseEvent) => boolean;
  /** Диалог «В плейлист» и панель выделения — рендерить внутри провайдера. */
  overlay: React.ReactNode;
}

export function useWebTrackMenu(
  tracks: Track[],
  opts: {
    /** Есть только на странице плейлиста: добавляет «Убрать из плейлиста»
     *  и в меню трека, и в меню выделения. */
    onRemoveFromPlaylist?: (track: Track) => void;
  } = {},
): WebTrackMenu {
  const { onRemoveFromPlaylist } = opts;
  const { likedIds, toggle } = useLikes();
  const { playlists, loaded, refresh: refreshPlaylists } = usePlaylists();
  const notify = useToast();
  const { t } = useT();
  const apiRef = useRef<ContextMenuApi<MenuAbilities> | null>(null);
  // пикер «В плейлист» работает и на один трек, и на пачку — список, а не трек
  const [plPick, setPlPick] = useState<Track[] | null>(null);
  const multi = useMultiSelect(tracks.map((tr) => tr.id));

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
  const selectedTracks = () => tracks.filter((tr) => multi.has(tr.id));

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

  const removeSelected = () => {
    if (!onRemoveFromPlaylist) return;
    for (const tr of selectedTracks()) onRemoveFromPlaylist(tr);
    multi.clear();
  };

  const abilities: MenuAbilities = {
    addToPlaylist: (tr) => openPlaylistPick([tr]),
    isLiked: (id) => likedIds.has(id),
    toggleLike: (id) => {
      const tr = byId(id);
      if (tr) toggle(tr);
    },
    downloadTrack: (tr) => void download(tr),
    addManyToPlaylist: (picked) => openPlaylistPick(picked),
    likeMany,
  };

  const openRowMenu = (tr: Track, e: React.MouseEvent) => {
    // ПКМ по выделенному — меню выделения; по невыделенному — сброс, как в
    // приложении (SearchView/PlaylistView): иначе действие уехало бы не туда
    if (multi.count > 0 && multi.has(tr.id)) {
      apiRef.current?.openMenu(e, {
        kind: "selection",
        tracks: selectedTracks(),
        count: multi.count,
        place: "list",
        ctl: {
          remove: onRemoveFromPlaylist ? { scope: "playlist", run: removeSelected } : undefined,
          clear: multi.clear,
        },
      });
      return;
    }
    if (multi.count > 0) multi.clear();
    apiRef.current?.openMenu(e, {
      kind: "track",
      track: tr,
      place: onRemoveFromPlaylist ? "playlist" : "search",
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

  const openBlankMenu = (e: React.MouseEvent) => {
    apiRef.current?.openMenu(e, {
      kind: "playlistBlank",
      ctl: { enterSelect: multi.enterMode, selectAll: multi.selectAll },
    });
  };

  const eatSelectionClick = (id: string, e: React.MouseEvent) => {
    if (!multi.onItemClick(id, e)) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };

  const overlay = (
    <>
      {multi.count > 0 ? (
        <SelectionBar
          label={t("menu.selection.count", { count: multi.count })}
          clearLabel={t("menu.selection.clear")}
          onClear={multi.clear}
          actions={[
            { icon: "plus", label: t("menu.addToPlaylist"), onClick: () => openPlaylistPick(selectedTracks()) },
            { icon: "heart", label: t("menu.catalog.like"), onClick: () => likeMany(multi.ids) },
            ...(onRemoveFromPlaylist
              ? [
                  {
                    icon: "list-x",
                    label: t("views.playlist.removeFromPlaylist"),
                    danger: true,
                    onClick: removeSelected,
                  },
                ]
              : []),
          ]}
        />
      ) : null}

      {/* Выбор плейлиста для «В плейлист…» */}
      <Dialog open={plPick !== null} title={t("web.trackList.choosePlaylist")} onClose={() => setPlPick(null)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 300, maxHeight: 320, overflowY: "auto", overflowX: "hidden" }}>
          {!loaded ? (
            <span style={{ fontFamily: "var(--font-ui)", color: "var(--text-3)", padding: "var(--sp-2)" }}>{t("common.loading")}</span>
          ) : playlists.length === 0 ? (
            <span style={{ fontFamily: "var(--font-ui)", color: "var(--text-3)", padding: "var(--sp-2)" }}>
              {t("web.trackList.noPlaylistsHint")}
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
    </>
  );

  return { abilities, apiRef, multi, openRowMenu, openBlankMenu, eatSelectionClick, overlay };
}

/** Список треков на TrackRow ДС: клик/даблклик — playContext, лайк — общий
 *  контекст, «⋯» и ПКМ — общее меню приложения (см. useWebTrackMenu), строка
 *  перетаскивается в плейлисты сайдбара. Ctrl/Shift-клик — множественный
 *  выбор с панелью массовых действий внизу. Локальные треки других устройств
 *  не играбельны на вебе — приглушены. */
export function TrackList({
  tracks,
  onRemoveFromPlaylist,
}: {
  tracks: Track[];
  /** Передаётся только со страницы плейлиста: добавляет в меню пункт
   *  «Убрать из плейлиста» (список — не общий контекст, только владелец
   *  страницы знает playlistId и умеет перезагрузить detail). */
  onRemoveFromPlaylist?: (track: Track) => void;
}) {
  const { likedIds, toggle } = useLikes();
  const { current, playing, playContext } = usePlayer();
  const { t } = useT();
  const menu = useWebTrackMenu(tracks, { onRemoveFromPlaylist });
  const { multi } = menu;

  return (
    // suppressNativeMenu={false}: у браузера своё меню («Открыть в новой
    // вкладке», «Назад») — на сайте отбирать его нельзя. Строкам это не
    // мешает: их openMenu гасит нативное меню сам.
    <ContextMenuProvider ctx={menu.abilities} apiRef={menu.apiRef} suppressNativeMenu={false}>
      <div style={{ display: "flex", flexDirection: "column" }} onContextMenu={menu.openBlankMenu}>
        {tracks.map((tr, i) => {
          const isLocal = Boolean(tr.localHash);
          return (
            // вся строка — тач-таргет и драг-источник; клики по кнопкам внутри
            // (лайк/⋯) не перехватываем
            <div
              key={`${tr.id}-${i}`}
              draggable={!isLocal}
              onDragStart={(e) => {
                e.dataTransfer.setData(TRACK_DND_MIME, JSON.stringify({ id: tr.id, title: tr.title }));
                e.dataTransfer.effectAllowed = "copy";
                setTrackDragImage(e, tr);
              }}
              style={isLocal ? { opacity: 0.45, pointerEvents: "none" } : { cursor: "pointer" }}
              // Ctrl/Shift/режим — клик выделяет (capture: раньше play-кнопки строки)
              onClickCapture={(e) => menu.eatSelectionClick(tr.id, e)}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                playContext(tracks, i);
              }}
            >
              <TrackRow
                index={i + 1}
                cover={tr.coverUrl ?? undefined}
                title={isLocal ? t("web.trackList.fileOnOtherDevice", { title: tr.title }) : tr.title}
                artist={tr.artist}
                duration={fmtTime(tr.durationSec)}
                active={current?.id === tr.id}
                playing={current?.id === tr.id && playing}
                liked={likedIds.has(tr.id)}
                selected={multi.has(tr.id)}
                onPlay={() => playContext(tracks, i)}
                onLike={() => toggle(tr)}
                onMore={(e) => menu.openRowMenu(tr, e)}
              />
            </div>
          );
        })}
      </div>
      {menu.overlay}
    </ContextMenuProvider>
  );
}
