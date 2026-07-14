# apps/desktop/src/shell/ShareDialog.tsx

Шеринг-карточка (Stage 7): предпросмотр canvas-PNG (через
`lib/shareCard.ts::renderShareCard`) + скопировать картинку/текст, сохранить
файл (Tauri `save` + `share_save_file` invoke). Всё на клиенте.

---

**i18n (2026-07-14, T34a, эпик W5):** строки извлечены в `dialogs.share.*`
через `const { t, lang } = useT();`. Ключевая часть правки — не сами тосты
(которые были обычным «строка → t()»), а проводка `lang`:
- `renderShareCard(data, accent, lang)` и `shareText(data, lang)`
  (`lib/shareCard.ts`) уже принимали опциональный `lang: Lang = DEFAULT_LANG`,
  но раньше звались без него (карточка/копируемый текст всегда рисовались на
  EN независимо от языка интерфейса). Теперь оба вызова получают `lang` из
  `useT()`.
- `lang` добавлен в deps `useEffect`, который перерисовывает превью
  карточки — иначе смена языка на лету не перерисовала бы уже открытую
  карточку.
- Заголовок диалога переиспользует `menu.catalog.share` («Share» — тот же
  текст уже был в словаре); кнопка «Закрыть» — общий `dialogs.close`;
  ошибка копирования текста — общий `dialogs.copyFailed`.
