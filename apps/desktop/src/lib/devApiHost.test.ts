import { describe, expect, it } from "vitest";
import { devApiHost } from "./devApiHost";

// Подпись «дев-сборка смотрит вот сюда» в диалогах ввода кода. Появилась после
// 2026-07-15: код с прода не находился в локальной сборке, а UI ничем не намекал,
// что база вообще другая — владелец завёл два бага на исправные фичи.
// Разбор — docs/notes/2026-07-15-кросс-бэкенд-ловушка-коды.md.

describe("devApiHost", () => {
  it("в проде молчит — обычному пользователю хост не нужен", () => {
    expect(devApiHost("https://api.muza.lol/api", false)).toBeNull();
  });

  it("в дев-сборке на локалхосте показывает хост с портом", () => {
    expect(devApiHost("http://localhost:8000/api", true)).toBe("localhost:8000");
  });

  it("в дев-сборке, направленной на прод, показывает прод-хост", () => {
    expect(devApiHost("https://api.muza.lol/api", true)).toBe("api.muza.lol");
  });

  it("мусорный URL не роняет диалог — подпись просто исчезает", () => {
    expect(devApiHost("не-урл", true)).toBeNull();
    expect(devApiHost("", true)).toBeNull();
  });
});
