import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import { LanguageProvider } from "../i18n";
import { DEFAULT_PREFS } from "../types";
import { SettingsView } from "./SettingsView";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const noop = () => undefined;

/** Рендер с минимальными пропсами: serverSession=false и дефолтная вкладка
 *  «Внешний вид» не трогают api вовсе (эффекты гейтятся tab/sub/serverSession,
 *  listInstalled за isTauri() → [] в jsdom), поэтому пустой мок безопасен. */
function renderSettings(lang?: "ru") {
  const view = (
    <SettingsView
      api={{} as unknown as MuzaApi}
      serverSession={false}
      prefs={DEFAULT_PREFS}
      setPrefs={noop}
      username="tester"
      onLogout={noop}
      onNotify={noop}
      onOpenHotkeys={noop}
    />
  );
  // Без провайдера useT() фолбэкает на EN (прецедент PlaylistView.test.tsx).
  return render(lang ? <LanguageProvider lang={lang}>{view}</LanguageProvider> : view);
}

/* Скелет раскладки — это КОНТРАКТ между TSX и SettingsView.layout.css:
   селекторы там комбинаторами `>` привязаны ровно к этой вложенности
   (.muza-settings > __cols > nav + __pane). Переименуй класс или вставь
   обёртку — CSS отвалится молча; этот тест делает поломку громкой. */
describe("SettingsView — скелет раскладки (контракт с SettingsView.layout.css)", () => {
  it("держит цепочку .muza-settings > __cols > (nav[tablist] + __pane[tabpanel])", () => {
    const { container } = renderSettings();

    const root = container.querySelector(".muza-settings");
    expect(root).not.toBeNull();

    const cols = root!.querySelector(":scope > .muza-settings__cols");
    expect(cols).not.toBeNull();

    const nav = cols!.querySelector(":scope > nav.muza-settings-nav[role='tablist']");
    expect(nav).not.toBeNull();
    // Имя экрана у tablist не зависит от геометрии (заголовок в узком рельсе
    // и на низком окне прячется стилем) — aria-label обязан быть всегда.
    expect(nav!.getAttribute("aria-label")).toBeTruthy();
    expect(nav!.querySelector(":scope > h1.muza-settings-nav__title")).not.toBeNull();

    const pane = cols!.querySelector(":scope > .muza-settings__pane#muza-settings-pane");
    expect(pane).not.toBeNull();
    expect(pane!.getAttribute("role")).toBe("tabpanel");
  });

  it("у каждого из 10 пунктов есть aria-label и CSS-тултип __tip (подписи прячутся стилем)", () => {
    const { container } = renderSettings();
    // Скоуп — рельс: сегментные Tabs из @muza/ui внутри панели («Тема»,
    // «Язык интерфейса»...) тоже носят role="tab" и в счёт не входят.
    const nav = container.querySelector(".muza-settings-nav")!;
    const tabs = [...nav.querySelectorAll("[role='tab']")];
    expect(tabs).toHaveLength(10);
    for (const tab of tabs) {
      expect(tab.getAttribute("aria-label")).toBeTruthy();
      // Подсказку узкого рельса несёт __tip (язык ДС, app.css); нативный title
      // убран — он рисовал стоковую плашку WebView2 (жалоба 2026-07-16).
      expect(tab.getAttribute("title")).toBeNull();
      const tip = tab.querySelector(":scope > .muza-settings-nav__tip");
      expect(tip).not.toBeNull();
      expect(tip!.textContent).toBeTruthy();
      expect(tab.getAttribute("aria-controls")).toBe("muza-settings-pane");
    }
  });
});

describe("SettingsView — прокрутка панели", () => {
  it("смена раздела сбрасывает скролл панели к началу и перевешивает aria-labelledby", () => {
    renderSettings();
    const pane = document.getElementById("muza-settings-pane")!;
    // Дефолтная вкладка — «Внешний вид».
    expect(pane.getAttribute("aria-labelledby")).toBe("muza-settings-nav-appearance");

    // Проверяем предпосылку: jsdom хранит присвоенный scrollTop (лэйаута нет,
    // клампа к 0 не будет) — иначе ассерт ниже был бы пустым.
    pane.scrollTop = 400;
    expect(pane.scrollTop).toBe(400);

    fireEvent.click(document.getElementById("muza-settings-nav-playback")!);

    expect(pane.scrollTop).toBe(0);
    expect(pane.getAttribute("aria-labelledby")).toBe("muza-settings-nav-playback");
  });
});

/* Инвариант коммита 73b05bb: раскладка не зависит от длины подписей. Ширины —
   дело CSS (проверяются визуальной приёмкой), но структурная половина
   инварианта проверяема и в jsdom: EN и RU обязаны давать один и тот же
   набор узлов навигации — меняются только тексты. */
describe("SettingsView — EN и RU дают одинаковую структуру", () => {
  it("id пунктов и форма DOM навигации совпадают, подписи — различаются", () => {
    const en = renderSettings();
    const enIds = [...en.container.querySelectorAll(".muza-settings-nav [role='tab']")].map((el) => el.id);
    const enTitle = en.container.querySelector(".muza-settings-nav__title")!.textContent;
    const enNavChildren = en.container.querySelector(".muza-settings-nav")!.children.length;
    cleanup();

    const ru = renderSettings("ru");
    const ruIds = [...ru.container.querySelectorAll(".muza-settings-nav [role='tab']")].map((el) => el.id);
    const ruTitle = ru.container.querySelector(".muza-settings-nav__title")!.textContent;
    const ruNavChildren = ru.container.querySelector(".muza-settings-nav")!.children.length;

    expect(ruIds).toEqual(enIds);
    expect(ruNavChildren).toBe(enNavChildren);
    // Контроль, что сравнили не два одинаковых рендера: тексты реально разные.
    expect(ruTitle).not.toBe(enTitle);
  });
});
