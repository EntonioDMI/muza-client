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

import { LANGS, resolveMigratedLanguage, type Lang } from "../i18n";
import { withDefaults, type HotkeyAction } from "../lib/hotkeys";
import { legacyInvertFromSpin, normalizeSpin, spinFromLegacyInvert } from "./backdrop";
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

/** НАЛОЖИТЬ СОХРАНЁННОЕ НА ДЕФОЛТЫ, СВЕРЯЯ ВИД ЗНАЧЕНИЯ (2026-08-03).
 *
 *  Профиль задуман переносимым (шапка файла) — значит, вход извне тут штатный,
 *  а не экзотика: файл правят руками, приносят с чужой машины, пишут скриптом.
 *  До этой правки слияние было простым спредом, и в Prefs попадало ЧТО УГОДНО:
 *  `"statsBlocks": null` роняло под-экран «Статистика» и страницу статистики
 *  (lib/statsBlocks.ts итерировал список без защиты), `"rowShow": null` —
 *  «Кастомизацию». Отдельные поля валидировались ниже по функции, но списком
 *  «какие вспомнили», а дырой оказывалось как раз невспомненное.
 *
 *  Правило одно на все поля: значение берётся, только если оно ТОГО ЖЕ ВИДА,
 *  что дефолт (массив ↔ массив, объект ↔ объект, число ↔ число). Не совпало —
 *  поле берёт дефолт площадки, как будто его в сохранении не было. Ключи,
 *  которых в модели нет вовсе (bgCover старых профилей), сюда не переезжают —
 *  их разбирают миграции ниже. */
function typedOverlay(stored: StoredPrefs, base: Prefs): Prefs {
  const defaults = base as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...defaults };
  const src = stored as Record<string, unknown>;
  for (const key of Object.keys(defaults)) {
    const v = src[key];
    if (v === undefined) continue;
    const d = defaults[key];
    if (d !== null && typeof d === "object") {
      if (v === null || typeof v !== "object" || Array.isArray(v) !== Array.isArray(d)) continue;
    } else if (typeof v !== typeof d) continue;
    out[key] = v;
  }
  return out as unknown as Prefs;
}

/** Слить сохранённое с дефолтами и прогнать миграции.
 *
 *  `base` — профиль дефолтов ЭТОЙ площадки: приложение отдаёт DEFAULT_PREFS,
 *  веб — их же с парой своих начальных значений (см. apps/web/src/prefs.tsx).
 *  Значение из сохранения всегда главнее base: приехавший профиль не
 *  переписывается предпочтениями площадки. */
export function mergePrefs(stored: StoredPrefs, base: Prefs = DEFAULT_PREFS): Prefs {
  const prefs = typedOverlay(stored, base);
  // миграция Stage 6: старый bgCover=true → bgType="cover"
  if (stored.bgCover && stored.bgType === undefined) prefs.bgType = "cover";
  // МИГРАЦИЯ ВРАЩЕНИЯ ФОНА (2026-08-03). До этого дня направление жило одним
  // тумблером bgAnimatedInvert; теперь их четыре (bgAnimSpin). Человек с
  // настроенным invert=true обязан увидеть ровно то же, что видел, — переносим
  // его значение, а не сбрасываем к дефолту. Условие «нового поля ещё нет»
  // важно: у профиля, где человек УЖЕ выбрал направление, старый флаг — всего
  // лишь зеркало, и переезжать ему некуда.
  if (stored.bgAnimSpin === undefined && typeof stored.bgAnimatedInvert === "boolean") {
    prefs.bgAnimSpin = spinFromLegacyInvert(stored.bgAnimatedInvert);
  } else {
    prefs.bgAnimSpin = normalizeSpin(prefs.bgAnimSpin);
  }
  // Зеркало пересчитывается ВСЕГДА: пока фон приложения рисует App.tsx по
  // старому флагу, второй правды быть не должно (см. Prefs.bgAnimatedInvert).
  prefs.bgAnimatedInvert = legacyInvertFromSpin(prefs.bgAnimSpin);
  // вложенные объекты мерджатся глубже: новое под-поле не теряет соседей.
  // Спред здесь идёт от УЖЕ проверенного значения (typedOverlay выше отбросил
  // null и не-объекты), а не напрямую от stored.
  prefs.sourcesEnabled = { ...base.sourcesEnabled, ...prefs.sourcesEnabled };
  prefs.rowShow = { ...base.rowShow, ...prefs.rowShow };
  // хоткеи — так же: новое действие (напр. T16 navBack/navForward) не теряется
  // в старых сохранениях, где его ещё не было (иначе бинд молча пуст, "—" в хелпе).
  // Не-строковые бинды выбрасываются: сочетание печатает formatCombo, число или
  // null превратились бы в мусор на плашке клавиши в справке.
  prefs.hotkeys = withDefaults(
    Object.fromEntries(Object.entries(prefs.hotkeys).filter(([, v]) => typeof v === "string")) as Partial<
      Record<HotkeyAction, string>
    >,
  );
  // T28 (i18n): раз мы здесь, сохранение СУЩЕСТВОВАЛО (первый запуск в
  // loadPrefs ниже до слияния не доходит) — см. i18n/index.tsx::
  // resolveMigratedLanguage для полного обоснования «старый профиль → ru».
  // Язык не из словаря (чужой/битый профиль) — как будто площадка своё и
  // оставила: интерфейс без словаря показывал бы голые ключи строк.
  prefs.language = LANGS.includes(stored.language as Lang)
    ? (stored.language as Lang)
    : stored.language === undefined
      ? resolveMigratedLanguage(undefined)
      : base.language;
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
