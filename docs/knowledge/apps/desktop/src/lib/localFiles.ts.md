# apps/desktop/src/lib/localFiles.ts

Локальные файлы (Stage 4): JS-мост к Rust-реестру (`src-tauri/src/local.rs`). Файлы device-bound — на сервер уходят только теги+sha256, байты остаются на диске.

---

Реестр (`loadServerIds`/`saveServerId`), скан (`localList`/`localScanPaths`),
регистрация на сервере (`registerLocalTracks`) — не менялись.

**i18n (2026-07-14, эпик W5, T-media):** `localPickAndScan(kind, lang?)` —
второй опциональный параметр `lang: Lang = DEFAULT_LANG`, переводит подписи
НАТИВНОГО диалога выбора файлов/папки Tauri (`@tauri-apps/plugin-dialog`
`open()`): заголовок диалога и имя фильтра «Аудио». Единственный потребитель
— `views/LibraryView.tsx`, вне зоны этой правки, зовёт без lang → диалог
теперь на английском («Choose audio files»/«Audio»/«Choose a music folder»),
было по-русски.
