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
import { BAR_BUTTON_KEYS } from "../lib/barButtons";
import { withDefaults, type HotkeyAction } from "../lib/hotkeys";
import { legacyInvertFromSpin, normalizeSpin, spinFromLegacyInvert } from "./backdrop";
import { MIGRATED_PREF_KEYS, migrateLegacyValue } from "./legacyPrefs";
import { DEFAULT_PREFS, LOOK_VERSION, type Prefs } from "./types";

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

/** ПЕРЕЕЗД НА ВНЕШНИЙ ВИД 2 (редизайн 2026-08-04): [ключ, старый дефолт, новый].
 *
 *  Поле переезжает, ТОЛЬКО если в сохранении лежит ровно старый дефолт — то
 *  есть человек его никогда не трогал. Настроенное руками неприкосновенно:
 *  редизайн меняет умолчания, а не чужие решения (правило владельца —
 *  «редизайн задаёт значения по умолчанию, а не отменяет настройку»).
 *
 *  Ключа `radius` здесь нет НАМЕРЕННО: пресеты mild/soft/round поменяли числа
 *  в tokens/radius.css, а не имена, поэтому новая шкала приезжает ко всем сама,
 *  а выбор «Меньше/Обычные/Больше» остаётся тем, который человек сделал.
 *  Плотность (--pad-zone) тоже не здесь: её считает формула densityPad в
 *  themeVars.ts, и она уже отдаёт 16 вместо 20 при том же ползунке. */
const LOOK_V2_MOVES: ReadonlyArray<readonly [key: keyof Prefs, was: number, now: number]> = [
  ["gapZone", 12, 8],
  ["wSidebar", 280, 240],
  ["hPlayerBar", 92, 72],
  ["coverBarSize", 60, 48],
  // Поштучная плотность зон обязана совпадать с лестницей материалов, иначе
  // тумблер «стекло по зонам» перекрашивает окно в момент включения.
  ["glassSidebar", 59, 62],
  ["glassNowPlaying", 59, 62],
];

/** Ступень v3 существовала ОДИН вечер (флет-вид дефолтом, gapZone 8 → 0) и
 *  была развёрнута тем же вечером: владелец решил, что основной вид —
 *  «воздушный», а плоский — личный тумблер. Ходов у ступени больше нет, но
 *  номер версии НЕ переиспользовать: профили, успевшие проехать v3, уже
 *  помечены тройкой, и новый смысл той же цифры их бы не догнал. Профилям с
 *  gapZone 0 от того вечера возвращает 8 сам тумблер «Плоский вид» (выкл). */
const LOOK_V3_MOVES: ReadonlyArray<readonly [key: keyof Prefs, was: number, now: number]> = [];

/** Прежний дефолт раскладки бара — все кнопки включены в каноническом порядке.
 *  Совпало буква в букву — человек раскладку не трогал, и она переезжает на
 *  новую (часть кнопок уехала в «⋯»). Любое отличие означает его выбор. */
function isUntouchedBarLayout(saved: unknown): boolean {
  if (!Array.isArray(saved) || saved.length !== BAR_BUTTON_KEYS.length) return false;
  return saved.every((b, i) => b && typeof b === "object" && b.key === BAR_BUTTON_KEYS[i] && b.on === true);
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
  //
  // ⚠️ ЗАПАСНОЙ ВАРИАНТ ДЛЯ СУЩЕСТВУЮЩЕГО ПРОФИЛЯ — "ru", А НЕ ДЕФОЛТ ПЛОЩАДКИ.
  // Раньше нераспознанное значение уходило в base.language ("en"), и это тихая
  // ловушка: дефолт "en" по замыслу предназначен НОВЫМ профилям (так и написано
  // в шапке resolveMigratedLanguage), а тут профиль заведомо не новый. Хуже
  // того, подмена НЕОБРАТИМА: стоит человеку тронуть любую настройку — и
  // "en" уезжает на диск уже как его осознанный выбор. Ровно так профиль
  // владельца оказался английским (03.08; момент подмены восстановить не
  // удалось, значение уже перезаписано).
  //
  // Сюда попадает всё, что не совпало со словарём буква в букву: локаль вида
  // "ru-RU", язык из будущей версии, значение из чужого профиля. Для таких
  // случаев «как у существующих профилей» честнее, чем «как у новых».
  const storedLang = typeof stored.language === "string" ? stored.language : undefined;
  prefs.language = LANGS.includes(storedLang as Lang)
    ? (storedLang as Lang)
    : // Локаль с регионом: "ru-RU" → "ru", если такой словарь у нас есть.
      (LANGS.find((l) => storedLang?.toLowerCase().startsWith(`${l}-`)) ?? resolveMigratedLanguage(undefined));
  // миграция «пресеты → ползунки»: строковые значения старых сохранений
  // («sharper», «compact»…) конвертируются в числа, мусор — к дефолту
  const bag = prefs as unknown as Record<string, unknown>;
  for (const key of MIGRATED_PREF_KEYS) {
    const v = (stored as Record<string, unknown>)[key];
    if (v === undefined) continue;
    bag[key] = migrateLegacyValue(key, v) ?? base[key as keyof Prefs];
  }
  // ПЕРЕЕЗД ВНЕШНЕГО ВИДА. Отсутствие метки И ЕСТЬ версия 1: поля lookVersion
  // до редизайна 2026-08-04 не существовало (см. Prefs.lookVersion). Ступени
  // складываются, а не заменяют друг друга, — профиль версии 2 при появлении
  // версии 3 проедет только третий шаг.
  const lookFrom = typeof stored.lookVersion === "number" ? stored.lookVersion : 1;
  if (lookFrom < 2) {
    const src = stored as unknown as Record<string, unknown>;
    for (const [key, was, now] of LOOK_V2_MOVES) {
      if (src[key] === was) bag[key] = now;
    }
    // Кнопки бара — тот же принцип, но значение списочное: «не тронуто» —
    // это ровно прежний дефолт, все десять включены в каноническом порядке.
    // Выключил хоть одну или переставил — это его раскладка, не трогаем.
    if (isUntouchedBarLayout(stored.barButtons)) prefs.barButtons = [...base.barButtons];
  }
  if (lookFrom < 3) {
    for (const [key, was, now] of LOOK_V3_MOVES) {
      // Сверяем ТЕКУЩЕЕ значение, а не сохранённое: профиль версии 1 к этому
      // шагу уже проехал v2, и его дефолтные 12 стали 8 — ступени складываются.
      if (bag[key] === was) bag[key] = now;
    }
  }
  prefs.lookVersion = LOOK_VERSION;
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
