/** Каркас настроек: правило выдачи поиска, переход из результата и встроенный
 *  раздел клавиш.
 *
 *  Поведение поиска — ответ приёмки волны 4 (в браузере поиск выдавал ~26
 *  рядов, которых на экране нет) и её же второй волны: обход разметки видел
 *  ряды только у разделов, написанных прямо на странице, а четыре раздела из
 *  девяти приезжают готовым компонентом — их ряды поиск не находил ВОВСЕ.
 *  Теперь правило одно для всех разделов: опись рядов от площадки. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsScreen } from "./SettingsScreen";
import { paneRows } from "./settingsContext";
import { SettingRow } from "./primitives";
import { DEFAULT_LANG, translate } from "../../i18n";

const THEME_ROW = translate(DEFAULT_LANG, "settings.appearance.theme.title");
const GLASS_ROW = translate(DEFAULT_LANG, "settings.appearance.glass.title");
/** Ряд, который живёт в готовом компоненте раздела «Аккаунт». */
const PROFILE_ROW = translate(DEFAULT_LANG, "settings.account.profile.title");
/** Ряд, который живёт в ПОД-ЭКРАНЕ «Данные аккаунта» (sub: "privacy"). */
const EXPORT_ROW = translate(DEFAULT_LANG, "settings.privacy.export.title");
const PLACEHOLDER = translate(DEFAULT_LANG, "settings.search.placeholder");
const NOTHING_FOUND = translate(DEFAULT_LANG, "settings.search.empty");
const ACCOUNT_TAB = translate(DEFAULT_LANG, "settings.tabs.account");
const APPEARANCE_TAB = translate(DEFAULT_LANG, "settings.tabs.appearance");

// Каркас монтируется в каждом тесте — без уборки в документе копятся прошлые
// экраны, и getByRole находит по два рельса (общая привычка тестов пакета).
afterEach(cleanup);

/** Раздел, приехавший ГОТОВЫМ КОМПОНЕНТОМ: его ряды спрятаны внутри — ровно
 *  так веб отдаёт «Аккаунт», «Интеграции», «Медиатеку» и «Систему». */
function AccountLikePane() {
  return <SettingRow title={PROFILE_ROW} hint="" />;
}

/** Площадка «как веб»: один раздел написан на странице, другой приехал готовым,
 *  и опись честно перечисляет ряды обоих. */
function renderScreen(props: Partial<Parameters<typeof SettingsScreen>[0]> = {}) {
  return render(
    <SettingsScreen
      panes={{ appearance: <SettingRow title={THEME_ROW} hint="" />, account: <AccountLikePane /> }}
      rows={{ "settings.appearance.theme.title": null, "settings.account.profile.title": null }}
      initialTab="appearance"
      {...props}
    />,
  );
}

function search(text: string) {
  fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: text } });
}

describe("SettingsScreen — поиск", () => {
  it("находит ряд, который площадка перечислила в описи", () => {
    renderScreen();
    search(THEME_ROW);
    // Название встречается дважды: в результате поиска и в самом ряду раздела.
    expect(screen.getAllByText(THEME_ROW).length).toBeGreaterThan(0);
    expect(screen.queryByText(NOTHING_FOUND)).toBeNull();
  });

  it("находит ряд раздела, приехавшего готовым компонентом", () => {
    // Тот самый долг: обход разметки видел в узле только <AccountLikePane/> и
    // считал, что рядов у раздела нет вовсе.
    renderScreen();
    search(PROFILE_ROW);
    expect(screen.queryByText(NOTHING_FOUND)).toBeNull();
    expect(screen.getAllByText(PROFILE_ROW).length).toBeGreaterThan(0);
  });

  it("ряда нет в описи — нет и в выдаче, даже если раздел есть", () => {
    renderScreen();
    search(GLASS_ROW);
    expect(screen.queryByText(NOTHING_FOUND)).not.toBeNull();
  });

  it("описи нет — каркас верит индексу целиком (площадка рисует всё)", () => {
    // Так живёт приложение: у него есть каждый раздел и каждый ряд, и поиск
    // обязан работать без единого списка от площадки.
    render(<SettingsScreen panes={{ appearance: <div /> }} initialTab="appearance" />);
    search(GLASS_ROW);
    expect(screen.queryByText(NOTHING_FOUND)).toBeNull();
  });

  it("ряд из под-экрана, который площадка открыть не умеет, в выдачу не попадает", () => {
    renderScreen({ rows: { "settings.privacy.export.title": "privacy" }, subs: [] });
    search(EXPORT_ROW);
    expect(screen.queryByText(NOTHING_FOUND)).not.toBeNull();
  });

  it("опись переносит ряд: площадка рисует его прямо в разделе, хотя индекс кладёт в под-экран", () => {
    // Так живёт веб: «Шрифт текста» индекс числит в «Кастомизации», а страница
    // рисует его прямо во «Внешнем виде» — и под-экранов у неё нет вовсе.
    renderScreen({ rows: { "settings.privacy.export.title": null }, subs: [] });
    search(EXPORT_ROW);
    expect(screen.queryByText(NOTHING_FOUND)).toBeNull();
  });
});

describe("SettingsScreen — переход из результата", () => {
  it("открывает и раздел, и под-экран, в котором ряд живёт", () => {
    const onSubChange = vi.fn();
    renderScreen({ rows: { "settings.privacy.export.title": "privacy" }, subs: ["privacy"], onSubChange });
    search(EXPORT_ROW);
    fireEvent.click(screen.getByText(EXPORT_ROW));
    // Раньше человек попадал в «Аккаунт» и искал выгрузку дальше руками.
    expect(onSubChange).toHaveBeenCalledWith("privacy");
    // Рельса с вкладками больше нет (вход — сетка карточек), поэтому «в каком
    // мы разделе» читается по заголовку экрана: он показывает имя раздела.
    expect(screen.getByRole("heading", { name: ACCOUNT_TAB })).toBeTruthy();
  });

  it("ряд прямо в разделе закрывает открытый под-экран", () => {
    const onSubChange = vi.fn();
    renderScreen({ onSubChange, sub: "privacy" });
    search(THEME_ROW);
    fireEvent.click(screen.getAllByText(THEME_ROW)[0]!);
    expect(onSubChange).toHaveBeenCalledWith(null);
  });

  // ⚠️ ЗДЕСЬ БЫЛ ТЕСТ «смена раздела в рельсе закрывает под-экран». Снят
  // 2026-08-11 вместе с рельсом: разделы больше не стоят рядом, и одним
  // кликом из под-экрана одного раздела в другой не попасть — выход из
  // под-экрана даёт его собственная шапка. Сам инвариант (переход в раздел
  // закрывает под-экран) живёт в goToTab и проверяется выше, на переходе из
  // результата поиска.
});

describe("paneRows — опись раздела, приехавшего готовым", () => {
  it("берёт ряды раздела из индекса вместе с их местом", () => {
    const rows = paneRows("account");
    expect(rows["settings.account.profile.title"]).toBe(null);
    expect(rows["settings.privacy.export.title"]).toBe("privacy");
    expect(rows["settings.appearance.theme.title"]).toBeUndefined();
  });

  it("ряда без умения площадки в описи нет вовсе", () => {
    // Пустой список умений — вкладка браузера: ни трея, ни обновлений.
    const rows = paneRows("system", []);
    expect(rows["settings.system.tray.title"]).toBeUndefined();
    expect(rows["settings.system.licenses.rowTitle"]).toBe(null);
  });
});

describe("SettingsScreen — горячие клавиши", () => {
  it("раздел появляется сам, когда площадка не передала свой", () => {
    renderScreen({ initialTab: "hotkeys" });
    expect(screen.getByText(translate(DEFAULT_LANG, "media.hotkeys.actions.playPause"))).toBeTruthy();
    expect(screen.getByText("Space")).toBeTruthy();
  });

  it("узел площадки побеждает встроенный", () => {
    render(
      <SettingsScreen
        panes={{ appearance: <SettingRow title={THEME_ROW} />, hotkeys: <SettingRow title="Свой раздел клавиш" /> }}
        initialTab="hotkeys"
      />,
    );
    expect(screen.getByText("Свой раздел клавиш")).toBeTruthy();
    expect(screen.queryByText("Space")).toBeNull();
  });
});
