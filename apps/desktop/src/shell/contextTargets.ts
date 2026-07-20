import type { Track } from "@muza/api-client";
import type { LocalEntry } from "../lib/localFiles";
import type { PlayerTrack } from "../player/types";

/** Цель контекстного меню (ПКМ / кнопка «⋯») — только данные, без React.
 *
 *  Разделение, на котором стоит механизм меню (2026-07-20):
 *  - ТРАНСПОРТ (стейт {open,x,y}, один <Menu> на приложение, клампинг в
 *    самом Menu) — shell/ContextMenu.tsx;
 *  - СОДЕРЖИМОЕ (какие пункты при какой роли) — чистая buildMenuItems в
 *    shell/menuActions.ts, тестируется матрицей без React.
 *
 *  Глобальные действия (радио, «В плейлист», шеринг…) живут в MenuContext и
 *  собираются один раз в App. Вьюшно-локальные (removeTrack плейлиста,
 *  forget локального файла, операции очереди) едут сюда замыканиями
 *  вызывателя в ctl — иначе их пришлось бы поднимать в App, где они не нужны. */

/** Где показана строка трека: от места зависит набор пунктов
 *  («Заменить версию» — только Любимое; правка состава — только плейлист;
 *  для играющего сейчас (player) нет «Играть следующим» — он уже играет). */
export type TrackPlace = "search" | "home" | "favorites" | "stats" | "playlist" | "player";

export type ContextTarget =
  | {
      kind: "track";
      track: Track;
      place: TrackPlace;
      /** Вьюшно-локальные действия страницы плейлиста (place === "playlist"). */
      ctl?: {
        changeIcon: () => void;
        replaceVersion: () => void;
        removeTrack: () => void;
        moveToStart: () => void;
        moveToEnd: () => void;
        /** Владелец живого плейлиста: пункт «Сменить иконку плейлиста». */
        canChangeIcon: boolean;
        /** false у viewer/оффлайн — состав не правится. */
        canEdit: boolean;
      };
    }
  | { kind: "playlist"; id: string; name: string }
  | {
      kind: "queueTrack";
      track: PlayerTrack;
      ctl: {
        play: () => void;
        playNext: () => void;
        remove: () => void;
        clearAfter: () => void;
        /** false — это текущий или уже следующий трек. */
        canPlayNext: boolean;
        /** false — последний в очереди, чистить нечего. */
        canClearAfter: boolean;
      };
    }
  | {
      kind: "libraryBlank";
      /** Мультивыбор плиток (2026-07-20); нет — пункты выбора не показываются. */
      ctl?: {
        enterSelect: () => void;
        selectAll: () => void;
      };
    }
  | {
      kind: "playlistBlank";
      ctl: {
        /** Режим выбора: обычный клик начинает выделять. */
        enterSelect: () => void;
        selectAll: () => void;
      };
    }
  | {
      kind: "selection";
      /** Выделенные треки — id уже развёрнуты списком-хозяином в Track[]. */
      tracks: Track[];
      /** queue — без «Играть следующим»/«В очередь»: они ДОБАВЛЯЮТ копии,
       *  а выделенное уже стоит в очереди. */
      place: "list" | "queue";
      ctl: {
        /** Убрать выделенное; scope выбирает подпись (плейлист/очередь). */
        remove?: { scope: "playlist" | "queue"; run: () => void };
        clear: () => void;
      };
    }
  | {
      kind: "playlistSelection";
      /** Выделенные плитки плейлистов медиатеки (свои и совместные —
       *  подписки вне выделения, как и вне реордера). */
      playlists: { id: string; name: string }[];
      ctl: {
        saveOffline: () => void;
        /** Открыть подтверждение массового удаления (диалог у вью). */
        requestDelete: () => void;
        clear: () => void;
      };
    }
  | {
      kind: "localTrack";
      entry: LocalEntry;
      ctl: {
        /** null — файл не зарегистрирован на сервере, класть в плейлист некуда. */
        addToPlaylist: (() => void) | null;
        /** null — файла нет на этом устройстве, показывать нечего. */
        reveal: (() => void) | null;
        forget: () => void;
      };
    };
