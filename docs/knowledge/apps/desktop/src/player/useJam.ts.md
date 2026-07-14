# apps/desktop/src/player/useJam.ts

`useJam()` — Jam «слушать вместе» (Stage 7): хост-авторитарная модель, хост пушит состояние (трек/позиция/пауза) на сервер, гости следуют. Байты каждый добывает сам.

---

Устройство (host/guest роли, applyState, subscribe на SSE-события, heartbeat,
детект сика) — не менялось в этой правке, см. существующие комментарии.

**i18n (2026-07-14, эпик W5, T-media):** хук — React (`useState`/`useEffect`),
но вызывается из `App.tsx` (вне зоны этой правки: shell/App запрещены),
поэтому `prefs.language` туда НЕ прокинут. Добавлен опциональный проп `lang?:
Lang` (дефолт `DEFAULT_LANG` = EN) в аргументах хука — App.tsx его пока не
передаёт (не трогали), значит тосты jam сейчас ВСЕГДА на английском
независимо от языка интерфейса, ПОКА кто-то не допишет
`useJam({ ..., lang: prefs.language })` в App.tsx. Локальный `t(key, params)`
= `translate(lang, key, params)`.

Осторожно: `t` замыкается в обработчике SSE-событий (`subscribe()` →
`api.subscribeJamEvents(code, (event) => {...})`), который создаётся один
раз при входе/создании jam, а не при каждом рендере — если `lang` начнёт
реально меняться на лету (после будущей правки App.tsx), обработчик уже
подписанной сессии не подхватит смену языка до следующего `subscribe()`.
Сейчас не критично, т.к. `lang` всегда константа (не передаётся).

Переведённые тосты: `media.jam.{hostTrackFetchFailed, trackAdded, ended,
hostEnded, createFailed, joinedAs, joinFailed, left, addFailed}`.
