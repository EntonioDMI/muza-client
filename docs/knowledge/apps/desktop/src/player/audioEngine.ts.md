# apps/desktop/src/player/audioEngine.ts

`AudioEngine` — Web Audio-движок плеера Stage 3: два `<audio>`-слота (кроссфейд/преднагрузка) → граф (гейн → преамп → 10-полосный EQ → мастер-громкость → лимитер). Не React-класс.

---

Ключевое устройство графа и gain staging — см. шапку файла (не менялось в
этой правке). `EngineCallbacks.onError(message: string)` получает уже
ГОТОВУЮ строку (не код ошибки).

**i18n (2026-07-14, эпик W5, T-media):** класс не подписан на
`LanguageProvider` (не React-компонент), поэтому конструктор принимает
второй опциональный параметр — функцию перевода
`t: (key: TranslationKey, params?: TParams) => string`, которую передаёт
владелец (`usePlayback.ts`, у него есть `prefs.language`). Без переданного
`t` — фолбэк `(key) => key` (используется, если кто-то создаст `AudioEngine`
напрямую без второго аргумента, напр. в тесте). Два места, раньше
хардкодившие русский текст в `this.cb.onError(...)`, теперь зовут
`this.t("media.player.errors.playFailed" | "playbackDidNotStart")`. Ветка
`e.message` (нативная ошибка `<audio>.play()`) не переводится — это текст
браузера, не наш UI-текст.

См. `docs/knowledge/apps/desktop/src/player/usePlayback.ts.md` — там описано,
как строится `t` и передаётся в конструктор.
