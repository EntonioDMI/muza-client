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

import type { PlatformAdapter } from "@muza/app/platform";
import { dragOutAvailable, exportCachedTrack, startTrackFileDrag } from "../lib/dragOut";
import { autostartEnabled, openExternal, syncAutostart, trayConfigure } from "../lib/system";

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
    system: {
      openExternal,
      setAutostart: syncAutostart,
      autostartEnabled,
      configureTray: trayConfigure,
    },
    // localFiles / offline / window появятся здесь, когда соответствующие
    // экраны поедут в @muza/app: порт заводится ВМЕСТЕ с первым потребителем,
    // иначе это мёртвый код, который никто не проверял.
  };
}
