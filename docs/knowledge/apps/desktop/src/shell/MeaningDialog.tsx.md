# apps/desktop/src/shell/MeaningDialog.tsx

«Смысл строки»: карточка с объяснением строки лирики (Genius annotation или
демо-заметка), открывается из `ListeningMode.tsx`.

---

**i18n (2026-07-14, T34a, эпик W5):** строки извлечены в `dialogs.meaning.*`
через `const { t } = useT();`. Заголовок headerAction-кнопки закрытия —
общий `dialogs.close`. `Genius` (бренд-имя источника) остался нетронутым
литералом — не текст интерфейса, а название сервиса.

**Тест (`MeaningDialog.test.tsx`):** ассерт `getByRole("button", { name:
"Закрыть" })` обновлён на `"Close"` — тест рендерит компонент БЕЗ
`<LanguageProvider>`, `useT()` там фолбэкает на `DEFAULT_LANG="en"` (тот же
паттерн, что уже был у соседнего ассерта на `ListeningMode`'s "Minimize",
см. комментарий T31 в том же файле).
