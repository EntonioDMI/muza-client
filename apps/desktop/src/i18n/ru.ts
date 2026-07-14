/** Русский словарь (T28, эпик W5 i18n) — привычный язык владельца и текущих
 *  тестеров (миграция существующих профилей без Prefs.language ставит именно
 *  его, см. App.loadPrefs). Тип `typeof en` заставляет форму СОВПАДАТЬ с
 *  английским словарём 1:1 — лишний/отсутствующий ключ здесь = ошибка typecheck,
 *  а не молчаливый фолбэк в рантайме. */
import { en } from "./en";

export const ru: typeof en = {
  common: {
    ok: "ОК",
    cancel: "Отмена",
    save: "Сохранить",
  },
  settings: {
    title: "Настройки",
    tabs: {
      account: "Аккаунт",
      appearance: "Внешний вид",
      playback: "Воспроизведение",
      sources: "Источники",
      lyrics: "Тексты",
      library: "Библиотека",
      integrations: "Интеграции",
      hotkeys: "Клавиши",
      extensions: "Расширения",
      system: "Система",
    },
    appearance: {
      language: {
        title: "Язык интерфейса",
        hint: "Меняет переведённые места живьём, без перезапуска",
        optionEn: "English",
        optionRu: "Русский",
      },
    },
  },
};
