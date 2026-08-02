import { describe, expect, it } from "vitest";
import { parsePlaylistCode, parsePlaylistHandle } from "./playlistCode";

// Детект кода PL_… в строке поиска (2026-07-17): валидный код = ВЕСЬ запрос
// целиком, иначе это обычный текстовый поиск. Разделитель гибкий (_ - пробел) —
// коды диктуют голосом; строгую проверку делает сервер.

describe("parsePlaylistCode", () => {
  it.each([
    ["PL_GGCRYGB8", "PL_GGCRYGB8"],
    ["pl_ggcrygb8", "PL_GGCRYGB8"],
    ["  PL_GGCRYGB8  ", "PL_GGCRYGB8"],
    ["PL GGCRYGB8", "PL_GGCRYGB8"],
    ["PL-GGCRYGB8", "PL_GGCRYGB8"],
  ])("распознаёт %s", (raw, want) => {
    expect(parsePlaylistCode(raw)).toBe(want);
  });

  it.each(["фонк", "PLGG", "PL_", "PL_ABC", "playlist", "PL_GGCRYGB8 фонк", "скинь PL_GGCRYGB8"])(
    "не код: %s",
    (raw) => {
      expect(parsePlaylistCode(raw)).toBeNull();
    },
  );
});

// @Адрес (2026-07-17): весь запрос целиком = @имя; возврат нормализован БЕЗ @.
describe("parsePlaylistHandle", () => {
  it.each([
    ["@fonk_2026", "fonk_2026"],
    ["@Fonk_2026", "fonk_2026"],
    ["  @fonk_2026  ", "fonk_2026"],
  ])("распознаёт %s", (raw, want) => {
    expect(parsePlaylistHandle(raw)).toBe(want);
  });

  it.each(["fonk_2026", "@ab", "@фонк", "@fonk 2026", "скинь @fonk_2026", "@", "@fonk!"])(
    "не адрес: %s",
    (raw) => {
      expect(parsePlaylistHandle(raw)).toBeNull();
    },
  );
});
