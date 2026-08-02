import { afterEach, describe, expect, it } from "vitest";
import {
  applyCustomFont,
  CUSTOM_FONT_FAMILY,
  installCustomFontFile,
  loadCustomFont,
  removeCustomFont,
} from "./customFont";
import { CUSTOM_FONT_CHOICE_KEY, fontFamily } from "./fonts";

/* Свой шрифт (2026-07-20): файл → dataURL в localStorage → рантайм-@font-face. */

const fontFile = (name = "MyFont.ttf", bytes = 64) =>
  new File([new Uint8Array(bytes)], name, { type: "font/ttf" });

afterEach(() => removeCustomFont());

describe("installCustomFontFile", () => {
  it("сохраняет dataURL, инжектит @font-face и отдаёт имя без расширения", async () => {
    const stored = await installCustomFontFile(fontFile());
    expect(stored.name).toBe("MyFont");
    expect(stored.dataUrl.startsWith("data:")).toBe(true);
    expect(loadCustomFont()?.name).toBe("MyFont");
    const style = document.getElementById("muza-custom-font");
    expect(style?.textContent).toContain(CUSTOM_FONT_FAMILY);
    expect(style?.textContent).toContain("font-display: swap");
  });

  it("не-шрифт отвергается ключом badExtension", async () => {
    await expect(installCustomFontFile(fontFile("virus.exe"))).rejects.toThrow("badExtension");
  });

  it("тяжелее лимита — tooLarge (не читаем и не сохраняем)", async () => {
    const big = new File([new Uint8Array(1)], "big.ttf");
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });
    await expect(installCustomFontFile(big)).rejects.toThrow("tooLarge");
  });
});

describe("removeCustomFont / applyCustomFont", () => {
  it("удаление снимает и хранилище, и <style>", async () => {
    await installCustomFontFile(fontFile());
    removeCustomFont();
    expect(loadCustomFont()).toBeNull();
    expect(document.getElementById("muza-custom-font")).toBeNull();
    expect(applyCustomFont()).toBeNull();
  });
});

describe("fontFamily(custom)", () => {
  it("ключ custom отдаёт family своего шрифта с системным хвостом", () => {
    const fam = fontFamily(CUSTOM_FONT_CHOICE_KEY);
    expect(fam).toContain(CUSTOM_FONT_FAMILY);
    expect(fam).toContain("Segoe UI");
  });
});
