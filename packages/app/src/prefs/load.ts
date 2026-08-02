/** Чтение профиля настроек из localStorage + ВСЕ миграции старых сохранений.
 *
 *  ПЕРЕЕЗД 2026-08-02 (волна веб-паритета, фаза 2): логика жила функцией
 *  `loadPrefs` внутри apps/desktop/src/App.tsx. Держать её там было нельзя:
 *  веб теперь хранит тот же профиль тем же ключом, и вторая реализация слияния
 *  означала бы, что часть миграций в браузере просто не отрабатывает —
 *  человек открывает сайт, и половина его оформления «сбрасывается».
 *
 *  Ключ хранения ОДИН на оба клиента: `muza.prefs.v1`. Это не совпадение —
 *  профиль задуман переносимым (экспорт/импорт, будущая синхронизация через
 *  аккаунт), и разные имена ключей сделали бы перенос ручной работой.
 *
 *  Правило слияния: сохранённое НАКЛАДЫВАЕТСЯ на дефолты, а не заменяет их —
 *  поле, появившееся в новой версии, у старого пользователя берёт дефолт и
 *  ничего не ломает. Вложенные объекты мерджатся на уровень глубже по той же
 *  причине (иначе новое под-поле теряло бы соседей). */

import { resolveMigratedLanguage } from "../i18n";
import { withDefaults } from "../lib/hotkeys";
import { MIGRATED_PREF_KEYS, migrateLegacyValue } from "./legacyPrefs";
import { DEFAULT_PREFS, type Prefs } from "./types";

/** Единственный ключ профиля настроек. Читают его ещё и в обход этого модуля
 *  (мини-плеер, экран ошибки — им нужен только язык до загрузки приложения),
 *  поэтому строка экспортируется, а не прячется. */
export const PREFS_KEY = "muza.prefs.v1";

/** Форма СОХРАНЁННОГО: не Partial<Prefs>, потому что в старых профилях лежат
 *  поля, которых в модели уже нет (bgCover — предок bgType), и значения не тех
 *  типов (строковые пресеты вместо чисел). Всё это разбирается ниже. */
export type StoredPrefs = Partial<Prefs> & { bgCover?: boolean };

/** Слить сохранённое с дефолтами и прогнать миграции.
 *
 *  `base` — профиль дефолтов ЭТОЙ площадки: приложение отдаёт DEFAULT_PREFS,
 *  веб — их же с парой своих начальных значений (см. apps/web/src/prefs.tsx).
 *  Значение из сохранения всегда главнее base: приехавший профиль не
 *  переписывается предпочтениями площадки. */
export function mergePrefs(stored: StoredPrefs, base: Prefs = DEFAULT_PREFS): Prefs {
  const prefs = { ...base, ...stored } as Prefs;
  // миграция Stage 6: старый bgCover=true → bgType="cover"
  if (stored.bgCover && stored.bgType === undefined) prefs.bgType = "cover";
  // вложенные объекты мерджатся глубже: новое под-поле не теряет соседей
  prefs.sourcesEnabled = { ...base.sourcesEnabled, ...stored.sourcesEnabled };
  prefs.rowShow = { ...base.rowShow, ...stored.rowShow };
  // хоткеи — так же: новое действие (напр. T16 navBack/navForward) не теряется
  // в старых сохранениях, где его ещё не было (иначе бинд молча пуст, "—" в хелпе)
  prefs.hotkeys = withDefaults(stored.hotkeys);
  // T28 (i18n): раз мы здесь, сохранение СУЩЕСТВОВАЛО (первый запуск в
  // loadPrefs ниже до слияния не доходит) — см. i18n/index.tsx::
  // resolveMigratedLanguage для полного обоснования «старый профиль → ru».
  prefs.language = resolveMigratedLanguage(stored.language);
  // миграция «пресеты → ползунки»: строковые значения старых сохранений
  // («sharper», «compact»…) конвертируются в числа, мусор — к дефолту
  const bag = prefs as unknown as Record<string, unknown>;
  for (const key of MIGRATED_PREF_KEYS) {
    const v = (stored as Record<string, unknown>)[key];
    if (v === undefined) continue;
    bag[key] = migrateLegacyValue(key, v) ?? base[key as keyof Prefs];
  }
  return prefs;
}

/** Разобрать сырую строку из хранилища. null — пусто или битый JSON
 *  (звонящий решает, что делать: у площадок разные «первые запуски»). */
export function parseStoredPrefs(raw: string | null): StoredPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as StoredPrefs;
  } catch {
    return null;
  }
}

/** Профиль из localStorage; ничего не сохранено или сохранение битое — `base`. */
export function loadPrefs(base: Prefs = DEFAULT_PREFS): Prefs {
  try {
    const stored = parseStoredPrefs(localStorage.getItem(PREFS_KEY));
    if (!stored) return base;
    return mergePrefs(stored, base);
  } catch {
    return base;
  }
}

/** Записать профиль целиком. Именно целиком: площадка хранит ВСЕ поля, даже
 *  те, которые применить не умеет, — иначе заход из браузера обрезал бы
 *  профиль, собранный в приложении (инвариант площадок, prefs/types.ts). */
export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
