# apps/desktop/src/shell/MeaningDialog.test.tsx

Тесты `MeaningDialog`: закрытие по клику снаружи/на кнопке/Escape, что клик
внутри не закрывает, что Escape не «протекает» в оверлей под диалогом
(`ListeningMode`), и что при закрытии `MeaningDialog` через Escape
`ListeningMode` под ним остаётся открытым.

---

Рендерит компонент БЕЗ `<LanguageProvider>` — `useT()` фолбэкает на
`DEFAULT_LANG="en"` (см. `i18n/index.tsx::useT`).

**T34a (2026-07-14, эпик W5):** после извлечения строки «Закрыть» в
`dialogs.close` (`MeaningDialog.tsx`), ассерт `getByRole("button", { name:
"Закрыть" })` (строка ~47) обновлён на `"Close"` — иначе тест ловил бы
русский текст, которого больше нет в DOM без `<LanguageProvider>`. Тот же
паттерн уже применялся к соседнему ассерту на `ListeningMode`'s "Minimize"
(комментарий T31, строка ~99) — оба зафиксированы явным комментарием в
файле, объясняющим, почему EN, а не RU.
