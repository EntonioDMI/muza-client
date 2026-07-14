# apps/desktop/src/lib/hourLabel.ts

`hourLabel(hour)` — подпись любимого часа прослушивания («night owl», «early bird»…), общая для Wrapped-слайдов и блока «Ритм дня» статистики.

---

Логика выбора порога (наибольший ключ `HOURS_LABEL_KEY` ≤ `hour`) — не
менялась, только значения стали ключами перевода.

**i18n (2026-07-14, эпик W5, T-media):** функция принимает `lang: Lang =
DEFAULT_LANG` (потребители `views/WrappedOverlay.tsx`/`views/StatsView.tsx`
вне зоны этой правки зовут без lang → EN по умолчанию, было RU).
`HOURS_LABEL_KEY: Record<number, TranslationKey>` хранит i18n-ключи
(`media.hour.{midnighty,earlyBird,daytime,eveningListener}`), не текст;
`hourLabel()` переводит найденный ключ через `translate(lang, key)`.
