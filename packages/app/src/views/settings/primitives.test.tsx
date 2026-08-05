import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SettingRow } from "./primitives";

/** Ряд настроек — самый длинный список приложения (до ~150 рядов на экране), и
 *  до 2026-08-05 каждый держал собственный useState ради подсветки: проход
 *  курсора по разделу стоил перерисовки на каждый ряд.
 *
 *  Цвета под курсором здесь не проверить — jsdom не считает :hover; каскад
 *  разбирает @muza/ui, src/interactions.test.js. Здесь — подключение к каналу и
 *  граница «подсвечивается только то, что нажимается». */

afterEach(cleanup);

describe("SettingRow: подсветка ушла в CSS", () => {
  it("кликабельный ряд читает канал", () => {
    const { container } = render(<SettingRow title="Тема" onClick={() => undefined} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.tagName).toBe("BUTTON");
    expect(row.className).toContain("muza-setting-row");
    expect(row.style.background).toBe("var(--setting-bg)");
  });

  it("некликабельный ряд канал НЕ читает", () => {
    // Подсветка обещает нажатие. Ряду-контейнеру (ползунок, тумблер внутри)
    // обещать нечего — он и не должен реагировать на курсор.
    const { container } = render(<SettingRow title="Громкость" />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.tagName).toBe("DIV");
    expect(row.style.background).toBe("var(--surface-2)");
  });

  it("проход курсора не меняет разметку ряда", () => {
    const { container } = render(<SettingRow title="Тема" hint="подсказка" onClick={() => undefined} />);
    const row = container.firstElementChild as HTMLElement;
    const html = container.innerHTML;
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    expect(container.innerHTML).toBe(html);
  });

  it("якорь поиска по настройкам не потерялся", () => {
    // searchSettings ведёт к ряду по видимому названию: ручной разметки ~150
    // рядов нет, и атрибут — единственная дорога.
    const { container } = render(<SettingRow title="Тема" onClick={() => undefined} />);
    expect((container.firstElementChild as HTMLElement).getAttribute("data-rowtitle")).toBe("Тема");
  });
});
