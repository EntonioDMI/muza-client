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

    // РЕЛЬСА РАЗДЕЛОВ БОЛЬШЕ НЕТ (редизайн 04.08). Жалоба владельца: «два
    // одинаковых сайдбара стоят рядом — это совсем не выглядит». Его роль
    // исполняет сетка карточек на входе, колонка осталась одна.
    expect(cols!.querySelector("nav.muza-settings-nav")).toBeNull();
    expect(cols!.children).toHaveLength(1);

    const pane = cols!.querySelector(":scope > .muza-settings__pane#muza-settings-pane");
    expect(pane).not.toBeNull();
    expect(pane!.getAttribute("aria-label")).toBeTruthy();
    const head = pane!.querySelector(":scope > .muza-settings__head > h1.muza-settings__title");
    expect(head, "заголовок экрана обязан стоять в шапке панели").not.toBeNull();
  });

  it("вход в настройки — сетка из 10 карточек разделов, а не сразу раздел", () => {
    const { container } = renderSettings();
    const pane = container.querySelector(".muza-settings__pane")!;
    const cards = [...pane.querySelectorAll("button")].filter((b) => b.className.includes("muza-press"));
    expect(cards).toHaveLength(10);
    for (const card of cards) {
      // Две строки: название и «что внутри». Пустое описание превращает
      // карточку в просто крупную кнопку, ради которой всё и не затевалось.
      expect(card.textContent!.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("SettingsView — переходы между уровнями", () => {
  it("клик по карточке открывает раздел, кнопка возврата возвращает к сетке", () => {
    const { container } = renderSettings();
    const pane = document.getElementById("muza-settings-pane")!;
    const card = [...pane.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Playback"))!;
    expect(card, "карточка «Playback» обязана быть на входе").toBeTruthy();

    // Предпосылка: jsdom хранит присвоенный scrollTop (лэйаута нет, клампа к 0
    // не будет) — иначе ассерт про сброс прокрутки был бы пустым.
    pane.scrollTop = 400;
    expect(pane.scrollTop).toBe(400);
    fireEvent.click(card);

    expect(container.querySelector(".muza-settings__title")!.textContent).toBe("Playback");
    expect([...pane.querySelectorAll("button")].filter((b) => b.className.includes("muza-press"))).toHaveLength(0);
    expect(pane.scrollTop).toBe(0);

    fireEvent.click(container.querySelector(".muza-settings__head button")!);
    expect(container.querySelector(".muza-settings__title")!.textContent).toBe("Settings");
  });
});

/* Инвариант коммита 73b05bb: раскладка не зависит от длины подписей. Ширины —
   дело CSS (проверяются визуальной приёмкой), но структурная половина
   инварианта проверяема и в jsdom: EN и RU обязаны давать один и тот же
   набор узлов навигации — меняются только тексты. */
describe("SettingsView — EN и RU дают одинаковую структуру", () => {
  it("форма DOM входа совпадает, подписи — различаются", () => {
    const en = renderSettings();
    const enCards = en.container.querySelectorAll(".muza-settings__pane button").length;
    const enTitle = en.container.querySelector(".muza-settings__title")!.textContent;
    cleanup();

    const ru = renderSettings("ru");
    const ruCards = ru.container.querySelectorAll(".muza-settings__pane button").length;
    const ruTitle = ru.container.querySelector(".muza-settings__title")!.textContent;

    expect(ruCards).toBe(enCards);
    // Контроль, что сравнили не два одинаковых рендера: тексты реально разные.
    expect(ruTitle).not.toBe(enTitle);
  });
});
