# apps/desktop/src/lib/searchGrouping.ts

T37: человекочитаемые подписи категорий версий трека (remix/sped_up/slowed/.../tiktok) для карточки-группы в поиске + утилиты группировки (`flattenGroupedResults`, `nextGroupLimit`).

---

`flattenGroupedResults`/`GROUP_LIMIT_STEPS`/`nextGroupLimit` — не менялись.

**i18n (2026-07-14, эпик W5, T-media):** раньше был экспортный
`VARIANT_TYPE_LABELS: Record<VariantType, string>` с русским текстом — УДАЛЁН
(проверено grep — нигде больше не импортировался). Вместо него функции
принимают `lang: Lang = DEFAULT_LANG` (потребитель `views/SearchGroupCard.tsx`
вне зоны этой правки зовёт их без lang → EN по умолчанию, было RU):

- `variantLabel(type, lang?)` — `translate(lang, \`media.search.variants.${type}\`
  as TranslationKey)`. Ключи в словаре буквально совпадают с `VariantType`,
  включая snake_case (`sped_up`, `bass_boosted`) и `"8d"`.
- `pluralVersions(n, lang?)` — русское mod10/mod100-склонение сохранено ТОЛЬКО
  для `lang === "ru"`; для остальных языков — простое singular/plural
  (`n === 1 ? one : many`), т.к. EN не различает 2-4 vs 5+.

`searchGrouping.test.ts` обновлён: старые тесты предполагали неявный
дефолт-RU (сломались бы после смены дефолта на EN) — переписаны на явный
`"ru"` второй аргумент + добавлены EN-тесты дефолтного поведения.
