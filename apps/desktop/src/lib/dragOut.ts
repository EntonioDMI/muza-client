/** Drag-out: перетаскивание трека ИЗ приложения на рабочий стол / в проводник.
 *  Файл берётся из кэша добычи (engine_export_cached копирует его во времянку
 *  с человеческим именем «Артист - Название.ext»), нативный OLE-drag делает
 *  tauri-plugin-drag. В браузере (vite без Tauri) недоступно. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

export function dragOutAvailable(): boolean {
  return isTauri();
}

/** Подготовить файл для драга; бросает с человеческим сообщением,
 *  если трека нет в кэше (демо-треки, ещё не игранные). */
export async function exportCachedTrack(trackId: string, artist: string, title: string): Promise<string> {
  return invoke<string>("engine_export_cached", {
    trackId,
    fileName: `${artist} - ${title}`,
  });
}

// Иконка драга рисуется канвасом один раз (плагину нужен путь или base64;
// сетевые обложки сюда не годятся — CORS и скорость)
let iconCache: string | null = null;
function dragIcon(): string {
  if (iconCache) return iconCache;
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  g.fillStyle = "#171614";
  g.beginPath();
  g.roundRect(0, 0, 48, 48, 12);
  g.fill();
  g.fillStyle = "#327ad9";
  g.font = "700 26px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("♪", 24, 26);
  iconCache = c.toDataURL("image/png");
  return iconCache;
}

/** Запустить нативный drag файла (зовётся из pointermove-жеста). */
export async function startTrackFileDrag(path: string): Promise<void> {
  await startDrag({ item: [path], icon: dragIcon() });
}
