/** Пенёк: модуль переехал в @muza/app (`@muza/app/prefs/customFont`) — лежит
 *  рядом с реестром шрифтов, который знает про ключ "custom". Платформенного
 *  кода в нём нет: <input type="file"> + localStorage работают и в браузере.
 *
 *  Файл существует, чтобы потребители `from "../lib/customFont"` не получили
 *  дифф в этапе, который к ним отношения не имеет (паттерн Э0, см. i18n). */
export * from "@muza/app/prefs/customFont";
