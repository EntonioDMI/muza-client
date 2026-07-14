# apps/desktop/src/lib/dragOut.ts

Drag-out: перетаскивание трека ИЗ приложения на рабочий стол/в проводник (нативный OLE-drag через `tauri-plugin-drag`), файл берётся из кэша добычи.

---

`exportCachedTrack`/`dragIcon`/`startTrackFileDrag` — не менялись.

**i18n (2026-07-14, эпик W5, T-media):** `maybeAltFileDrag(e, exportFile,
onError, lang?)` — четвёртый опциональный параметр `lang: Lang =
DEFAULT_LANG`, переводит фолбэк-сообщение об ошибке подготовки файла
(`media.dragOut.errors.prepareFailed`), если `exportFile()` бросил не-Error
или Error без `.message`. Потребители (views/PlaylistView.tsx,
views/LibraryView.tsx и т.п.) вне зоны этой правки, зовут без lang → EN по
умолчанию, было RU.
