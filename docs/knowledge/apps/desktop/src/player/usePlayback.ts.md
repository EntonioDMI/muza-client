# apps/desktop/src/player/usePlayback.ts

`usePlayback()` — оркестратор воспроизведения Stage 3: очередь-контекст, реальный движок для каталожных треков (добыча → LRU-кэш → `<audio>` через `AudioEngine`), демо-треки — симуляция таймером.

---

Общее устройство (очередь, gapless/fast-follow, шаффл, undo для
removeFromQueue и т.п.) — не менялось в этой правке, см. существующие
комментарии в файле.

**i18n (2026-07-14, эпик W5, T-media):** хук рендерится ВНУТРИ
`LanguageProvider` (тот выше, в Player/App), но как и T31 в `App.tsx`
(не-React вызов вне провайдера), здесь используется чистая
`translate(prefsRef.current.language, key, params)`, а не хук `useT()` —
проще и не требует прокидывать контекст через слой хуков. Есть локальный
`const t = (key, params) => translate(prefsRef.current.language, key, params)`,
НО он используется только там, где локальная переменная не называется `t`
(в `resolveForTrack`/`startAt` параметр/локальная переменная САМА называется
`t: PlayerTrack` — там переводы делаются через прямой вызов
`translate(prefsRef.current.language, key)`, не через хелпер `t()`, иначе
тень переменной). При правке — не полагаться на глобальный `t()` внутри этих
двух функций, использовать `translate(...)` напрямую.

`t` передаётся вторым аргументом в `new AudioEngine({...}, t)` — движок сам
не умеет читать язык, см.
`docs/knowledge/apps/desktop/src/player/audioEngine.ts.md`.

`resolveForTrack()` передаёt `prefsRef.current.language` четвёртым
аргументом в `resolvePlayable()` (`lib/engine.ts`) — единственное место в
lib/engine.ts, где бросается локализуемая ошибка.

Переведённые тосты/ошибки: `media.player.errors.{localFileNotFound,
desktopOnly, trackFetchFailed}` (плюс два в audioEngine.ts).
