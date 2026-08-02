/** ВИЛКА ПРИЛОЖЕНИЯ (Э2 веб-паритета, 2026-08-02): что умеет площадка Tauri.
 *  Розетка и правила — packages/app/src/platform/types.ts.
 *
 *  Файл СКЛЕИВАЕТ, а не реализует: вся механика остаётся там, где была
 *  (lib/dragOut.ts, lib/system.ts), здесь только сопоставление «порт → уже
 *  существующая функция». Поэтому у приложения нулевой дифф поведения:
 *  сегодня вью зовут те же функции напрямую, а вилка — параллельный вход,
 *  которым зоны будут пользоваться по мере переезда файлов в @muza/app.
 *
 *  ⚠️ Умения проверяются НА СТАРТЕ, один раз (createDesktopPlatform зовётся из
 *  App.tsx в useMemo). Это важно для запуска `pnpm dev` в ОБЫЧНОМ браузере
 *  (без Tauri): там выноса файла нет — и порта тоже нет, общий код увидит
 *  ровно то же, что увидит веб, а не падение при первом же перетаскивании. */

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { PlatformAdapter } from "@muza/app/platform";
import { dragOutAvailable, exportCachedTrack, startTrackFileDrag } from "../lib/dragOut";
import {
  loadServerIds,
  localAvailable,
  localForget,
  localList,
  localPickAndScan,
  localResolve,
  localScanPaths,
  saveServerId,
} from "../lib/localFiles";
import { cacheRemove } from "../lib/engine";
import { savePngFile } from "../lib/saveImage";
import { autostartEnabled, openExternal, syncAutostart, trayConfigure } from "../lib/system";
import { invalidateCachedSources } from "../player/sourcesCache";

export function createDesktopPlatform(): PlatformAdapter {
  return {
    // Поля НЕТ, когда возможности нет (окно открыли в браузере) — общий код
    // не спрашивает «ты десктоп?», он спрашивает «умеешь вынести файл?».
    ...(dragOutAvailable()
      ? {
          dragOut: {
            exportTrackFile: ({ id, artist, title }) => exportCachedTrack(id, artist, title),
            startFileDrag: (path) => startTrackFileDrag(path),
          },
        }
      : {}),
    // Файлы с диска (вкладка «Локальные» медиатеки). Того же условия, что у
    // выноса файла: в обычном браузере Tauri-команд нет — порта нет, и вкладка
    // не появляется вовсе (localAvailable() = isTauri(), ровно та проверка,
    // которой экран пользовался до переезда в @muza/app).
    ...(localAvailable()
      ? {
          localFiles: {
            list: localList,
            // без языка — как звал экран до переезда: подписи системного
            // окна выбора файлов остаются английскими (менять здесь = менять
            // поведение приложения, это отдельная правка)
            pickAndScan: (kind: "files" | "folder") => localPickAndScan(kind),
            scanPaths: localScanPaths,
            resolvePath: localResolve,
            forget: localForget,
            serverIds: loadServerIds,
            rememberServerId: saveServerId,
            reveal: (path: string) => revealItemInDir(path),
          },
        }
      : {}),
    system: {
      openExternal,
      setAutostart: syncAutostart,
      autostartEnabled,
      configureTray: trayConfigure,
    },
    // Сохранить картинку файлом («Поделиться» → «Сохранить PNG»). Условие то
    // же, что у выноса файла: без Tauri системного окна «куда сохранить» нет,
    // и кнопки в диалоге не появляется (раньше на её месте был тост «только в
    // приложении» — теперь объяснять нечего, кнопки просто нет).
    ...(dragOutAvailable() ? { saveImage: { savePng: savePngFile } } : {}),
    // Забыть подготовленное для трека — ОДИН порт на две прежние строки
    // диалога «Версии и источники»: файл трека на устройстве и разобранные
    // источники в памяти плеера протухают по одной причине (сменилась
    // версия) и всегда вместе. cacheRemove сам молчит вне Tauri, поэтому
    // условия здесь нет: в браузерном dev-окне вызов ничего не делает —
    // ровно как делал до переезда диалога.
    preparedTracks: {
      forget: async (trackId: string) => {
        await cacheRemove(trackId);
        invalidateCachedSources(trackId);
      },
    },
    // offline / window появятся здесь, когда соответствующие экраны поедут в
    // @muza/app: порт заводится ВМЕСТЕ с первым потребителем, иначе это
    // мёртвый код, который никто не проверял.
  };
}
