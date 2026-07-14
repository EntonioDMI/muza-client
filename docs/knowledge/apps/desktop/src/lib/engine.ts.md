# apps/desktop/src/lib/engine.ts

JS-мост к Rust-движку добычи (Stage 3, `src-tauri/src/engine.rs`): резолв играбельного URL (`resolveTrack`/`resolvePlayable`), кэш (`cacheStats`/`cacheClear`/`cacheRemove`), оффлайн-пины, диагностика (`engineDoctor`).

---

Логика резолва (локальные источники first, кэш добычи как оффлайн-фолбэк) —
не менялась.

**i18n (2026-07-14, эпик W5, T-media):** `resolvePlayable(trackId, sources,
quality?, lang?)` — четвёртый опциональный параметр `lang: Lang =
DEFAULT_LANG`. Единственная строка, брошенная как `Error` внутри этого
файла — «локальный источник трека есть, но файла нет на диске» — теперь
`translate(lang, "media.engine.errors.localTrackMissing")`. Единственный
потребитель — `usePlayback.ts` (`resolveForTrack`, В ЗОНЕ этой правки) —
передаёт `prefsRef.current.language`, так что эта ошибка РЕАЛЬНО переключается
живьём (в отличие от большинства других lib/*-функций этой правки, чьи
потребители — вне зоны).
