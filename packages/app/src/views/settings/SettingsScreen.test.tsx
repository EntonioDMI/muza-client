/** Каркас настроек: правило выдачи поиска и встроенный раздел клавиш.
 *
 *  Оба поведения — ответ приёмки волны 4: в браузере поиск выдавал ~26 рядов,
 *  которых на экране нет (фильтр спрашивал «есть ли РАЗДЕЛ»), а раздел
 *  «Горячие клавиши» пропадал молча, хотя клавиши работали. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsScreen } from "./SettingsScreen";
import { SettingRow } from "./primitives";
import { DEFAULT_LANG, translate } from "../../i18n";

const THEME_ROW = translate(DEFAULT_LANG, "settings.appearance.theme.title");
const GLASS_ROW = translate(DEFAULT_LANG, "settings.appearance.glass.title");
const PLACEHOLDER = translate(DEFAULT_LANG, "settings.search.placeholder");
const NOTHING_FOUND = translate(DEFAULT_LANG, "settings.search.empty");

// Каркас монтируется в каждом тесте — без уборки в документе копятся прошлые
// экраны, и getByRole находит по два рельса (общая привычка тестов пакета).
afterEach(cleanup);

/** Площадка «как веб»: раздел «Внешний вид» есть, но в нём один-единственный
 *  ряд из десятков, которые знает индекс поиска. */
function renderScreen() {
  return render(<SettingsScreen panes={{ appearance: <SettingRow title={THEME_ROW} hint="" /> }} />);
}

function search(text: string) {
  fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: text } });
}

describe("SettingsScreen — поиск", () => {
  it("находит ряд, который площадка реально рисует", () => {
    renderScreen();
    search(THEME_ROW);
    // Название встречается дважды: в результате поиска и в самом ряду раздела.
    expect(screen.getAllByText(THEME_ROW).length).toBeGreaterThan(0);
    expect(screen.queryByText(NOTHING_FOUND)).toBeNull();
  });

  it("ряд, которого на экране нет, в выдачу не попадает — даже если раздел есть", () => {
    renderScreen();
    search(GLASS_ROW);
    expect(screen.queryByText(NOTHING_FOUND)).not.toBeNull();
  });
});

describe("SettingsScreen — горячие клавиши", () => {
  it("раздел появляется сам, когда площадка не передала свой", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("tab", { name: translate(DEFAULT_LANG, "settings.tabs.hotkeys") }));
    expect(screen.getByText(translate(DEFAULT_LANG, "media.hotkeys.actions.playPause"))).toBeTruthy();
    expect(screen.getByText("Space")).toBeTruthy();
  });

  it("узел площадки побеждает встроенный", () => {
    render(
      <SettingsScreen
        panes={{ appearance: <SettingRow title={THEME_ROW} />, hotkeys: <SettingRow title="Свой раздел клавиш" /> }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: translate(DEFAULT_LANG, "settings.tabs.hotkeys") }));
    expect(screen.getByText("Свой раздел клавиш")).toBeTruthy();
    expect(screen.queryByText("Space")).toBeNull();
  });
});
