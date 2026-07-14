/** i18n-инфраструктура (T28, эпик W5). Свой минимальный модуль — без
 *  тяжёлых библиотек (i18next и т.п. не нужны на ~сотни ключей).
 *
 *  Устройство:
 *  - `en.ts`/`ru.ts` — вложенные словари ключ→строка (форма ru ЖЁСТКО
 *    типизирована как `typeof en`, см. ru.ts — расхождение ключей ловит tsc).
 *  - `translate(lang, key, params?)` — чистая функция: ищет ключ в словаре
 *    языка → фолбэк на EN → фолбэк на сам ключ (никогда не бросает и не
 *    возвращает пустую строку, даже для опечатки в ключе или ключа, которого
 *    ещё нет ни в одном словаре — так и остальные ~2260 строк можно
 *    извлекать постепенно в T29-T33, не боясь сломать рендер).
 *  - `TranslationKey` — union всех точечных путей словаря (`Paths<typeof en>`),
 *    выведенный автоматически из формы `en`: опечатка в ключе — ошибка типов,
 *    а не молчаливый фолбэк на рантайме.
 *  - `LanguageProvider` + `useT()` — реактивность: язык лежит в Prefs.language
 *    (App/Player), но t() читается через React-контекст, а НЕ проп-дриллинг
 *    prefs через каждый компонент (большинство файлов T29-T33 не получают
 *    prefs вообще). Смена языка = новый `value` контекста → перерендер ровно
 *    тех компонентов, что зовут useT() (React.Context, не глобальная
 *    мутируемая переменная — обычный, предсказуемый путь ре-рендера).
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { en } from "./en";
import { ru } from "./ru";

export type Lang = "en" | "ru";
export const DEFAULT_LANG: Lang = "en";
/** Порядок пунктов переключателя (SettingsView). */
export const LANGS: readonly Lang[] = ["en", "ru"];

const DICTS: Record<Lang, typeof en> = { en, ru };

/** Все точечные пути листьев-строк словаря, напр. "settings.tabs.appearance". */
type Paths<T> = T extends string
  ? never
  : { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}` }[keyof T & string];

export type TranslationKey = Paths<typeof en>;

/** Значения плейсхолдеров `{name}` в строке перевода. */
export type TParams = Record<string, string | number>;

function applyParams(str: string, params?: TParams): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/** Достаёт строку по точечному пути из (возможно чужого/битого) объекта —
 *  без исключений: не тот тип на любом шаге → undefined, а не throw. */
function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Перевод ключа на языке `lang`. Фолбэк-цепочка: `lang` → EN → сам ключ —
 *  функция никогда не падает и не возвращает пустую строку (T29-T33 могут
 *  переводить строки по одной, не боясь сломать ещё непереведённые места). */
export function translate(lang: Lang, key: TranslationKey, params?: TParams): string {
  const raw = lookup(DICTS[lang], key) ?? lookup(DICTS.en, key) ?? key;
  return applyParams(raw, params);
}

interface LanguageContextValue {
  lang: Lang;
  t: (key: TranslationKey, params?: TParams) => string;
}

const noopT = (key: TranslationKey, params?: TParams) => translate(DEFAULT_LANG, key, params);
const LanguageContext = createContext<LanguageContextValue>({ lang: DEFAULT_LANG, t: noopT });

/** Оборачивает поддерево приложения; `lang` — обычно `prefs.language`
 *  (контролируемый компонент, источник истины — Prefs, не свой стейт). */
export function LanguageProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo<LanguageContextValue>(
    () => ({ lang, t: (key, params) => translate(lang, key, params) }),
    [lang],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Хук перевода: `const { t, lang } = useT();`. Вне `LanguageProvider` тихо
 *  фолбэкает на DEFAULT_LANG (напр. изолированный юнит-тест компонента). */
export function useT(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** Миграция Prefs.language для СУЩЕСТВУЮЩИХ профилей (вызывается из
 *  App.loadPrefs только в ветке, где localStorage-запись УЖЕ существовала —
 *  для новых профилей играет просто DEFAULT_PREFS.language="en", сюда даже
 *  не доходим). Профиль без поля language — это профиль ДО i18n: владелец и
 *  текущие тестеры привыкли к русскому интерфейсу, поэтому мигрируем именно
 *  в "ru" (не в дефолт "en", который предназначен для НОВЫХ профилей). */
export function resolveMigratedLanguage(storedLanguage: Lang | undefined): Lang {
  return storedLanguage ?? "ru";
}
