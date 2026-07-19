import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PLAYLIST_ICON_IDS } from "@muza/core";
import { LanguageProvider } from "../i18n";
import { PlaylistIconPicker } from "./PlaylistIconPicker";

afterEach(cleanup);

/** Дымовой тест Э0: доказывает, что пакет @muza/app вообще работает как пакет —
 *  React-компонент внутри него собирается, тянет @muza/ui (Dialog) и
 *  @muza/core (манифест), переводится своим же i18n. Если сломается граница
 *  пакета, красным станет именно этот тест, а не прод. */
function renderPicker(lang: "en" | "ru", props: Partial<Parameters<typeof PlaylistIconPicker>[0]> = {}) {
  return render(
    <LanguageProvider lang={lang}>
      <PlaylistIconPicker open currentIcon={null} onClose={vi.fn()} onPick={vi.fn()} {...props} />
    </LanguageProvider>,
  );
}

describe("PlaylistIconPicker (общий, @muza/app)", () => {
  it("рисует все 38 иконок манифеста", () => {
    renderPicker("ru");
    const imgs = document.querySelectorAll('img[src^="/playlist-icons/"]');
    expect(imgs).toHaveLength(PLAYLIST_ICON_IDS.length);
    expect(imgs[0].getAttribute("src")).toBe("/playlist-icons/pi-01.png");
  });

  it("клик отдаёт id иконки наверх", () => {
    const onPick = vi.fn();
    renderPicker("ru", { onPick });
    fireEvent.click(screen.getByLabelText("Иконка pi-07"));
    expect(onPick).toHaveBeenCalledWith("pi-07");
  });

  it("busy блокирует клик (запрос setPlaylistIcon в полёте)", () => {
    const onPick = vi.fn();
    renderPicker("ru", { onPick, busy: true });
    fireEvent.click(screen.getByLabelText("Иконка pi-07"));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("переводится: тот же компонент даёт RU и EN", () => {
    const ru = renderPicker("ru");
    expect(screen.getByText("Сменить иконку")).toBeTruthy();
    ru.unmount();
    renderPicker("en");
    expect(screen.getByText("Change icon")).toBeTruthy();
  });

  it("текущая иконка помечена aria-pressed", () => {
    renderPicker("ru", { currentIcon: "pi-12" });
    expect(screen.getByLabelText("Иконка pi-12").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Иконка pi-11").getAttribute("aria-pressed")).toBe("false");
  });

  it("сетка иконок — скролл-контейнер (полосу красит глобальное правило ДС)", () => {
    renderPicker("ru");
    // родитель свотча — тот самый скролл-контейнер сетки (maxHeight + overflowY)
    const grid = screen.getByLabelText("Иконка pi-01").parentElement as HTMLElement;
    expect(grid.style.overflowY).toBe("auto"); // якорь: взят именно скролл-контейнер
    expect(grid.style.overflowX).toBe("hidden");
  });
});
