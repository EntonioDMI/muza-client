/** Drag-out: перетаскивание трека ИЗ приложения на рабочий стол / в проводник.
 *  Файл берётся из кэша добычи (engine_export_cached копирует его во времянку
 *  с человеческим именем «Артист - Название.ext»), нативный OLE-drag делает
 *  tauri-plugin-drag. В браузере (vite без Tauri) недоступно.
 *
 *  ⚠️ ЭТОТ ФАЙЛ — РЕАЛИЗАЦИЯ, А НЕ ТОЧКА ВХОДА (Э2 веб-паритета, 2026-08-02).
 *  Он тянет `@tauri-apps/*` и потому НИКОГДА не переедет в общий пакет: веб
 *  такой модуль не соберёт. Из-за прямых импортов отсюда Tauri протекал в
 *  шесть файлов, включая плеер-бар и четыре экрана из пяти, — их переезд был
 *  заблокирован.
 *  Теперь у этих функций есть РОЗЕТКА: packages/app/src/platform (порт
 *  DragOutPort), а вилка приложения — src/platform/desktopAdapter.ts —
 *  зовёт ровно эти функции. Приложение продолжает работать как раньше.
 *  ПРАВИЛО ДЛЯ ПЕРЕЕЗЖАЮЩИХ ФАЙЛОВ: как только файл уходит в @muza/app, он
 *  меняет `import … from "…/lib/dragOut"` на хук `useAltFileDrag()` /
 *  `useTrackDragOut()` из "@muza/app/platform". Новых прямых импортов отсюда
 *  не добавлять. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { DEFAULT_LANG, translate, type Lang } from "../i18n";
import { cacheNamespace } from "./engine";

export function dragOutAvailable(): boolean {
  return isTauri();
}

/** Подготовить файл для драга; бросает с человеческим сообщением,
 *  если трека нет в кэше (ещё не игранные треки). */
export async function exportCachedTrack(trackId: string, artist: string, title: string): Promise<string> {
  return invoke<string>("engine_export_cached", {
    trackId,
    fileName: `${artist} - ${title}`,
    cacheNs: cacheNamespace(),
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

/** T18, единый UX списков: обычный drag строки = в плейлист (pointer-перенос,
 *  shell/DragLayer), Alt+drag = нативный файл на рабочий стол / в проводник.
 *  Зовётся ПЕРВЫМ в onDragStart draggable-обёртки: если Alt зажат и мы в
 *  Tauri — HTML5-drag отменяется (preventDefault) и запускается файл-drag
 *  (кнопка мыши ещё зажата — OLE-drag подхватывает курсор, как в PlayerBar).
 *  Вернул false — вызывающий обязан погасить native drag сам (preventDefault):
 *  внутренний перенос идёт на pointer events, а стартовавший HTML5-drag убил бы
 *  его через pointercancel. Поэтому dragSource и держит draggable выключенным
 *  для всего, кроме Alt.
 *  exportFile бросает честную ошибку («Трека нет в кэше…») — она уходит в
 *  onError-тост, файл-drag просто не начинается. */
export function maybeAltFileDrag(
  e: React.DragEvent,
  exportFile: () => Promise<string>,
  onError: (message: string) => void,
  /** Язык фолбэк-сообщения об ошибке (потребители — views/*, вне зоны этой
   *  правки); без него — EN (DEFAULT_LANG). */
  lang: Lang = DEFAULT_LANG,
): boolean {
  if (!e.altKey || !dragOutAvailable()) return false;
  e.preventDefault();
  exportFile()
    .then((path) => startTrackFileDrag(path))
    .catch((err) => onError(err instanceof Error ? err.message : translate(lang, "media.dragOut.errors.prepareFailed")));
  return true;
}
