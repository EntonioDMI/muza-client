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
  AppInfoPort,
  AudioDeviceInfo,
  AudioDevicesPort,
  DiagnosticsPort,
  DiscordStatusPort,
  DragOutPort,
  EngineHealth,
  EngineHealthEvent,
  InstalledPluginRef,
  LocalFileEntry,
  LocalFilesPort,
  MiniPlayerPort,
  OfflinePort,
  PlatformAdapter,
  PluginErrorRecord,
  PluginsPort,
  PreparedTracksPort,
  SaveDataFilePort,
  SaveImagePort,
  StagedPluginRef,
  StoredMediaPort,
  StoredMediaStats,
  SystemPort,
  TrackFileRef,
  TrackStartRecord,
  UpdateFound,
  UpdatesPort,
  WindowPort,
} from "./types";
export { PlatformProvider, useAltFileDrag, useDragOut, useLocalFiles, usePlatform, useTrackDragOut } from "./PlatformContext";
