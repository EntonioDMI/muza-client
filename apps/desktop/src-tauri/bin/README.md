# Sidecar-бинари движка добычи

Сюда кладутся внешние бинари, которые Tauri бандлит рядом с приложением
(`bundle.externalBin` в `tauri.conf.json`). В git они не коммитятся (размер) —
качаются при настройке окружения.

Имя обязано включать target-triple (соглашение Tauri):

- `yt-dlp-x86_64-pc-windows-msvc.exe` — с https://github.com/yt-dlp/yt-dlp/releases
  (файл `yt-dlp.exe`, переименовать). Dev-версия лежит в `spike-stage0/yt-dlp.exe`
  рабочей папки.

В dev и в бандле Tauri кладёт бинарь рядом с exe приложения как `yt-dlp.exe` —
движок (`src/engine.rs`) ищет его там, потом по `MUZA_YTDLP_PATH`, потом в PATH.

⚠️ yt-dlp требует JS-рантайм (Deno) для n-challenge YouTube — в dev ставится
`winget install DenoLand.Deno`; в релизный бандл deno.exe добавится отдельным
externalBin (движок прокидывает каталог exe в PATH ребёнка, найдётся сам).
