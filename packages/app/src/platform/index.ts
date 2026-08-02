/** Розетка платформы — единственный вход. Импорт всегда так:
 *
 *      import { usePlatform, useAltFileDrag, type PlatformAdapter } from "@muza/app/platform";
 *
 *  Внутрь пакета (".../platform/PlatformContext") не импортировать: подпуть
 *  один, переставлять файлы внутри папки можно без правок у потребителей.
 *
 *  Устройство: types.ts — что это и правила порта, PlatformContext.tsx —
 *  провайдер и хуки. Вилки площадок живут В ПРИЛОЖЕНИЯХ:
 *  apps/desktop/src/platform/desktopAdapter.ts, apps/web/src/platform/webAdapter.ts. */

export type {
  DragOutPort,
  LocalFileEntry,
  LocalFilesPort,
  OfflinePort,
  PlatformAdapter,
  SystemPort,
  TrackFileRef,
  WindowPort,
} from "./types";
export { PlatformProvider, useAltFileDrag, useDragOut, usePlatform, useTrackDragOut } from "./PlatformContext";
