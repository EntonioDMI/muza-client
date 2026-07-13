# Sidecar-бинари движка добычи

Tauri бандлит два внешних бинарника рядом с приложением. Они не коммитятся из-за
размера: pinned-файлы скачивают локальный trust gate и GitHub Actions, а SHA-256
проверяется до распаковки и сборки.

Физические имена для `x86_64-pc-windows-msvc`:

- `yt-dlp-x86_64-pc-windows-msvc.exe` — `yt-dlp 2026.06.09`:
  `https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/yt-dlp.exe`;
  SHA-256 `3a48cb955d55c8821b60ccbdbbc6f61bc958f2f3d3b7ad5eaf3d83a543293a27`.
- `deno-x86_64-pc-windows-msvc.exe` — `Deno v2.9.2` из архива
  `https://github.com/denoland/deno/releases/download/v2.9.2/deno-x86_64-pc-windows-msvc.zip`;
  SHA-256 архива `5fe194d26ac5ef77fcc5288c2c438c7a0465f3b6180440ebf04092714bf2dcdf`.

Логические имена в `tauri.conf.json` остаются `bin/yt-dlp` и `bin/deno`.
В установленном приложении это соседние `yt-dlp.exe` и `deno.exe`.

Release-движок принимает только оба соседних обычных файла без symlink. Он не
читает `MUZA_YTDLP_PATH`, `MUZA_DENO_PATH` и не ищет их в `PATH`; диагностика
`engine_doctor` также проверяет только соседние файлы. Абсолютный путь Deno
передаётся yt-dlp явно через `--js-runtimes deno:<absolute-path>`.

Только debug-сборка, через скомпилированную `#[cfg(debug_assertions)]` ветку,
может при отсутствии соседнего файла использовать `MUZA_YTDLP_PATH`,
`MUZA_DENO_PATH` или `PATH`. Даже этот fallback принимает лишь канонизированный
обычный файл без symlink.
