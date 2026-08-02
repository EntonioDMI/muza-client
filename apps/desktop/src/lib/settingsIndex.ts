/** Пенёк: индекс поиска по настройкам переехал в @muza/app (волна веб-паритета
 *  «настройки», 2026-08-02) — поиск по настройкам появился и в браузере, а
 *  вторая копия индекса означала бы, что в вебе поиск приводит к рядам,
 *  которых там нет (история playlistIcon.ts / PlaylistIconPicker.tsx).
 *
 *  Приложение зовёт searchSettings БЕЗ списка умений — значит «умеет всё», и
 *  выдача ровно та же, что до переезда. Браузер передаёт свой набор
 *  (SettingsCapability), и ряды трея, автозапуска, обновлений и диагностики из
 *  результатов исчезают вместе с самими рядами.
 *
 *  Новый код импортирует из "@muza/app/lib/settingsIndex". */
export {
  SETTINGS_INDEX,
  searchSettings,
  type SettingsCapability,
  type SettingsIndexEntry,
  type SettingsSearchHit,
} from "@muza/app/lib/settingsIndex";
