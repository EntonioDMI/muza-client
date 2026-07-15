import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DEFAULT_LANG, LANGS, LanguageProvider, resolveMigratedLanguage, translate, useT } from "./index";
import { en } from "./en";
import { ru } from "./ru";

afterEach(cleanup);

describe("translate", () => {
  it("отдаёт строку на запрошенном языке (en и ru реально различаются)", () => {
    expect(translate("en", "settings.tabs.appearance")).toBe(en.settings.tabs.appearance);
    expect(translate("ru", "settings.tabs.appearance")).toBe(ru.settings.tabs.appearance);
    expect(translate("en", "settings.tabs.appearance")).not.toBe(translate("ru", "settings.tabs.appearance"));
  });

  it("вложенные ключи (settings.appearance.language.*) резолвятся точечным путём", () => {
    expect(translate("en", "settings.appearance.language.title")).toBe("Interface language");
    expect(translate("ru", "settings.appearance.language.title")).toBe("Язык интерфейса");
  });

  it("несуществующий ключ — фолбэк на сам ключ, БЕЗ исключения и без пустой строки", () => {
    // @ts-expect-error — намеренно передан ключ мимо TranslationKey, проверяем рантайм-устойчивость
    expect(translate("en", "no.such.key")).toBe("no.such.key");
    // @ts-expect-error
    expect(translate("ru", "totally.made.up")).toBe("totally.made.up");
  });

  it("подстановка плейсхолдеров {name} работает, в т.ч. на фолбэк-ветке (ключ содержит {x})", () => {
    // Ни один реальный ключ стартового набора не использует плейсхолдеры —
    // сознательно бьём мимо словаря, чтобы честно проверить именно подстановку,
    // не полагаясь на конкретный будущий текст (см. i18n/index.tsx::applyParams).
    // @ts-expect-error
    expect(translate("en", "missing.key.{x}", { x: "42" })).toBe("missing.key.42");
  });

  it("недостающий параметр плейсхолдера оставляет {токен} как есть (не подставляет undefined/пустоту)", () => {
    // @ts-expect-error
    expect(translate("en", "a {known} and {unknown} b", { known: "K" })).toBe("a K and {unknown} b");
  });

  it("params не переданы — плейсхолдеры не трогаются", () => {
    // @ts-expect-error
    expect(translate("en", "raw {value}")).toBe("raw {value}");
  });

  it("числовой параметр подставляется как строка", () => {
    // @ts-expect-error
    expect(translate("ru", "{count}", { count: 3 })).toBe("3");
  });
});

describe("словари en/ru", () => {
  it("одинаковая форма (типизировано через typeof en, но проверим и рантайм-JSON)", () => {
    const shape = (o: unknown): unknown =>
      typeof o === "object" && o !== null
        ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)]))
        : typeof o;
    expect(shape(ru)).toEqual(shape(en));
  });

  it("LANGS содержит en и ru, DEFAULT_LANG='en' (дефолт нового профиля — английский)", () => {
    expect(LANGS).toEqual(["en", "ru"]);
    expect(DEFAULT_LANG).toBe("en");
  });
});

describe("resolveMigratedLanguage (App.loadPrefs, T28)", () => {
  it("существующий профиль БЕЗ language мигрирует в 'ru' (привычный язык, не дефолт новых)", () => {
    expect(resolveMigratedLanguage(undefined)).toBe("ru");
  });

  it("существующий профиль С language — значение сохраняется как есть", () => {
    expect(resolveMigratedLanguage("en")).toBe("en");
    expect(resolveMigratedLanguage("ru")).toBe("ru");
  });
});

function Probe() {
  const { t, lang } = useT();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="label">{t("settings.appearance.language.title")}</span>
    </div>
  );
}

/** Переключатель меняет prop `lang` у LanguageProvider (как App меняет
 *  prefs.language) — компоненты, зовущие useT(), должны перерендериться. */
function ProbeWithSwitcher() {
  const [lang, setLang] = useState<"en" | "ru">("en");
  return (
    <LanguageProvider lang={lang}>
      <Probe />
      <button onClick={() => setLang(lang === "en" ? "ru" : "en")}>toggle</button>
    </LanguageProvider>
  );
}

describe("LanguageProvider + useT (реактивность)", () => {
  it("useT() без Provider фолбэкает на DEFAULT_LANG, не падает", () => {
    render(<Probe />);
    expect(screen.getByTestId("lang").textContent).toBe(DEFAULT_LANG);
    expect(screen.getByTestId("label").textContent).toBe(en.settings.appearance.language.title);
  });

  it("LanguageProvider отдаёт заданный язык вложенным useT()", () => {
    render(
      <LanguageProvider lang="ru">
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("ru");
    expect(screen.getByTestId("label").textContent).toBe(ru.settings.appearance.language.title);
  });

  it("смена lang у Provider перерисовывает потребителей useT() без размонтирования — живой переключатель", () => {
    render(<ProbeWithSwitcher />);
    expect(screen.getByTestId("label").textContent).toBe(en.settings.appearance.language.title);

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("lang").textContent).toBe("ru");
    expect(screen.getByTestId("label").textContent).toBe(ru.settings.appearance.language.title);

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("label").textContent).toBe(en.settings.appearance.language.title);
  });
});
