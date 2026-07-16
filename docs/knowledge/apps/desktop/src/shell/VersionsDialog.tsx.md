# apps/desktop/src/shell/VersionsDialog.tsx

Разворот «Версии и источники» (Stage 4): выбор конкретного источника
канонического трека (per-user на сервере, `UserTrackSource`). Смена выбора
выбивает трек из локального кэша добычи (`cacheRemove`). Обновлён: 2026-07-16.

---

**i18n (2026-07-14, T34a, эпик W5):** строки извлечены в `dialogs.versions.*`
через `const { t } = useT();`. Особенности:
- `PROVIDER_LABEL`/`KIND_LABEL` были модульными `Record<string,string>`
  константами — переехали частично: youtube/soundcloud/bandcamp остались
  модульной константой `PROVIDER_LABEL` (бренд-имена, не переводятся), а
  "local"/kind-метки стали функциями `providerLabel(provider)`/
  `kindLabel(kind)` ВНУТРИ компонента (замыкают `t`, т.к. Record не может
  зависеть от языка на уровне модуля).
- Заголовок диалога без трека переиспользует `menu.catalog.versions`
  («Versions & sources» — идентичный текст уже был в словаре); с треком —
  `dialogs.versions.titleWithTrack` со встроенным тем же хвостом.
- Кнопка «Закрыть» — общий `dialogs.close`.

**Кэш источников плеера (2026-07-16):** choose/reset после `cacheRemove` зовут
`invalidateCachedSources(track.id)` (`player/sourcesCache.ts` — кэш ответа
`getTrackSources` в `resolveForTrack`, TTL 5 мин). Это единственное клиентское
место, меняющее источники существующего трека на сервере: без инвалидации
выбранная версия молча игнорировалась бы плеером до истечения TTL. Оба сброса
(файл добычи + запись источников) держать парой. Подробности — корневая база,
`sourcesCache.ts.md`.
