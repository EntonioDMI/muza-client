# apps/desktop/src/lib/searchGrouping.test.ts

Тесты `variantLabel`/`pluralVersions`/`flattenGroupedResults`/`nextGroupLimit` (lib/searchGrouping.ts).

---

**i18n (2026-07-14, эпик W5, T-media):** `variantLabel`/`pluralVersions`
получили опциональный `lang` (дефолт EN, было неявное RU через хардкод) —
тесты этих двух функций переписаны: явный EN-блок (без аргумента) + явный
RU-блок (второй аргумент `"ru"`), чтобы проверить обе стороны словаря
(en.media.ts/ru.media.ts) и не полагаться на дефолт молча. При добавлении
новых `VariantType` — обновлять оба блока + оба файла словаря.
