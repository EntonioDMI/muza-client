/** ОБЗОР СОСТОЯНИЯ ВКЛЮЧЕНИЯ ТРЕКОВ: из груды записей — в ответы.
 *
 *  ЗАЧЕМ ЭТОТ ФАЙЛ ПОЯВИЛСЯ (13.08). Экран проверки показывал ровно то, что
 *  собиралось: ленту событий, ленту стартов и таблицу медиан. Всё правда, и всё
 *  требует, чтобы смотрящий заранее знал, что искать. Владелец сформулировал
 *  недостачу так: «нужен инструмент вроде журнала, но более сжатый», «при одном
 *  взгляде можно сразу понять содержимое». То есть не хватало не данных, а
 *  ОТВЕТОВ: всё ли в порядке, сколько это стоит, что именно сломано.
 *
 *  ⚠️ ГЛАВНОЕ ПРАВИЛО ФАЙЛА: здесь НЕТ ни одного показателя, который не выведен
 *  из уже собираемых записей. Ни одной оценки, ни одного «примерно». Если
 *  ответить нечем — поле null, и экран честно молчит вместо правдоподобной
 *  цифры. Диагностика, которая привирает, хуже отсутствующей: по ней принимают
 *  решения и ищут не там.
 *
 *  ⚠️ ТЕКСТОВ ЗДЕСЬ ТОЖЕ НЕТ. Наружу уходят КЛЮЧИ словаря и числа
 *  (OverviewNote), а слова подставляет экран. Иначе оценка состояния оказалась
 *  бы на одном языке, а интерфейс — на другом, и это всплыло бы у первого же
 *  англоязычного человека.
 *
 *  Пара к нему — DiagnosticsOverview.tsx (как это рисуется). Считает —
 *  здесь, рисует — там; ни один порог не живёт в разметке.
 */

import type { SearchSourceHealth } from "@muza/api-client";
import type { EngineHealth, TrackStartRecord } from "../platform";

/** Насколько всё плохо. Три ступени, а не пять: человек различает «можно не
 *  вникать», «стоит посмотреть» и «сломано», а полутона между ними — уже
 *  работа для того, кто и так вникает. */
export type OverviewLevel = "ok" | "warn" | "bad";

/** Строчка вердикта: ключ словаря + подстановки. Слова — на экране. */
export interface OverviewNote {
  key: string;
  params?: Record<string, string | number>;
  /** Своя ступень: у длинного списка причин первая может быть аварией, а
   *  вторая — мелочью, и красить их одинаково значило бы врать. */
  level: OverviewLevel;
}

/** Одно место, откуда играла музыка. */
export interface PlayPlace {
  /** Ключ группы: «soundcloud», «youtube», «other». */
  key: string;
  count: number;
  /** Из них не заиграло вовсе. */
  failed: number;
}

/** Один столбик ленты последних включений. */
export interface RecentStart {
  at: number;
  /** Сколько прошло от нажатия до звука; null — звука не было. */
  ms: number | null;
  /** Не заиграл (не считая перебитых следующим нажатием). */
  failed: boolean;
  /** Человек сам переключил дальше — это не сбой и красить в красный нельзя. */
  interrupted: boolean;
  /** Первый трек после запуска программы. */
  cold: boolean;
  title: string;
}

/** Шаг включения с его обычной длительностью. */
export interface PhaseShare {
  key: "sources" | "url" | "engine" | "bytes";
  ms: number;
}

/** Сгруппированная причина: одинаковые сбои — одной строкой. */
export interface FailureGroup {
  /** Причина как её назвала программа (сырой текст — единственная зацепка). */
  reason: string;
  count: number;
  lastAt: number;
}

/** Место поиска глазами человека. */
export interface SearchPlaceState {
  source: string;
  level: OverviewLevel;
  /** Чем закончились последние попытки. */
  attempts: number;
  failed: number;
  /** Причина последнего отказа; null — отказов не было. */
  lastFailure: string | null;
  /** Медиана времени ответа, мс; null — не отвечал ни разу. */
  medianMs: number | null;
  /** Молчит прямо сейчас: последний отказ ПОЗЖЕ последнего ответа. */
  downNow: boolean;
}

export interface EngineOverview {
  level: OverviewLevel;
  /** Почему именно такая оценка. Пусто при «ok» — сказать нечего, и это
   *  само по себе ответ. */
  notes: OverviewNote[];
  /** Сколько включений вообще разобрано. 0 — экран показывает пустое
   *  состояние, а не нули (ноль неудач из нуля попыток — не «всё хорошо»). */
  total: number;
  failed: number;
  interrupted: number;
  /** Обычное время «нажал → звук», мс. */
  typicalMs: number | null;
  /** Время самых медленных включений (одно из десяти дольше этого). */
  slowMs: number | null;
  /** Первый трек после запуска программы — отдельная жалоба владельца. */
  coldMs: number | null;
  /** Обычная длительность шагов. Ширины полосы считаются по НИМ, а не по
   *  доле от typicalMs: медианы шагов в сумме не равны медиане целого, и
   *  полоса «до полного» рисовала бы несуществующий остаток. */
  phases: PhaseShare[];
  recent: RecentStart[];
  places: PlayPlace[];
  failures: FailureGroup[];
  /** Места поиска; пусто — сервер не спрашивали или он не умеет отвечать. */
  searchPlaces: SearchPlaceState[];
}

/* ── Пороги ───────────────────────────────────────────────────────────────
   Все до единого стоят ЗДЕСЬ и объяснены. Порог без объяснения — это чужое
   мнение, замаскированное под факт: следующий человек не знает, можно ли его
   двигать, и не двигает. */

/** Сколько последних включений разбирает обзор. Сорок — это примерно один
 *  вечер прослушивания: достаточно, чтобы «стало медленно» проявилось, и
 *  достаточно мало, чтобы позавчерашняя авария не тянула оценку сегодня. */
export const RECENT_WINDOW = 40;

/** Доля неудач, после которой это уже авария, а не невезение. Пятая часть —
 *  это каждый пятый трек не заиграл; на таком человек уже перестаёт доверять
 *  программе, а не списывает на сеть. */
const FAIL_RATE_BAD = 0.2;
/** Доля неудач, о которой стоит сказать, но паниковать рано. */
const FAIL_RATE_WARN = 0.05;
/** Минимум включений, до которого доля вообще не считается: одна неудача из
 *  двух — это 50%, и кричать по такому поводу значит кричать всегда. */
const FAIL_RATE_MIN_SAMPLE = 8;

/** Время, после которого «включается медленно» перестаёт быть придиркой.
 *  Три секунды — примерно та граница, где ожидание из «сейчас заиграет»
 *  превращается в «оно вообще работает?». */
const SLOW_TYPICAL_MS = 3000;

/** Доля отказов места поиска, при которой оно считается сломанным даже если
 *  последним ответом был успех: половина запросов в никуда — это уже не
 *  «иногда моргает». */
const SOURCE_FAIL_RATE_BAD = 0.5;

/* ── Счёт ─────────────────────────────────────────────────────────────── */

function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = (s.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return Math.round(s[lo]);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (idx - lo));
}

/** Перебитый старт — не сбой. Человек нажал «дальше» раньше, чем заиграло, и
 *  это его право; считать это неудачей программы значит объявлять аварией
 *  обычное перелистывание. Метка приходит из площадки (startTelemetry). */
const INTERRUPTED = "superseded";

/** К какому месту отнести запись. Класс уже разрешён площадкой (см.
 *  startProvider в apps/desktop/src/lib/startLog.ts) — здесь только
 *  укрупнение до тех групп, которые человек называет своими словами. */
function placeKey(cls: string | null | undefined): string {
  if (!cls) return "other";
  const base = cls.startsWith("cold:") ? cls.slice(5) : cls;
  if (base === "soundcloud" || base === "youtube" || base === "bandcamp") return base;
  return "other";
}

/** Причина, укрупнённая до строки-группы. Сырой хвост после « — » режется:
 *  в нём у каждого сбоя свои идентификаторы, и без среза двадцать одинаковых
 *  поломок выглядели бы двадцатью разными. */
function failureKey(raw: string): string {
  const cut = raw.split(" — ")[0].split(": http")[0];
  return cut.slice(0, 120).trim() || raw.slice(0, 120);
}

/** ЧТО ПРОИСХОДИТ С МЕСТОМ ПОИСКА ПРЯМО СЕЙЧАС.
 *
 *  ⚠️ Ключевое различие — «сломалось и не чинится» против «сбоило и прошло».
 *  Доля отказов у них одинаковая, а сказать надо противоположное. Разводит их
 *  порядок событий: отказ ПОЗЖЕ последнего ответа = молчит сейчас. Ровно ради
 *  этого на сервере и заведена отметка lastOkAt. */
function readSearchPlace(s: SearchSourceHealth): SearchPlaceState {
  const downNow = s.lastFailure !== null && (s.lastOkAt === null || s.lastFailure.at > s.lastOkAt);
  const level: OverviewLevel = downNow
    ? "bad"
    : s.failureRate >= SOURCE_FAIL_RATE_BAD
      ? "warn"
      : s.failed > 0
        ? "warn"
        : "ok";
  return {
    source: s.source,
    level,
    attempts: s.attempts,
    failed: s.failed,
    lastFailure: s.lastFailure?.reason ?? null,
    medianMs: s.medianMs,
    downNow,
  };
}

const WORST: Record<OverviewLevel, number> = { ok: 0, warn: 1, bad: 2 };
const worse = (a: OverviewLevel, b: OverviewLevel): OverviewLevel => (WORST[b] > WORST[a] ? b : a);

export interface OverviewInput {
  /** Журнал включений, НОВЫЕ ПЕРВЫМИ (как отдаёт площадка). */
  starts: readonly TrackStartRecord[];
  health: EngineHealth | null;
  /** Ответ сервера про места поиска; null — не спрашивали или не ответил. */
  searchSources: readonly SearchSourceHealth[] | null;
}

export function buildOverview({ starts, health, searchSources }: OverviewInput): EngineOverview {
  const window = starts.slice(0, RECENT_WINDOW);

  const interrupted = window.filter((r) => r.error === INTERRUPTED).length;
  const failedRecords = window.filter((r) => r.error !== null && r.error !== INTERRUPTED);
  const played = window.filter((r) => r.soundMs !== null && r.error === null);

  const totals = played.map((r) => r.soundMs as number);
  const typicalMs = quantile(totals, 0.5);
  const slowMs = quantile(totals, 0.9);

  // Первый трек после запуска: берём САМЫЙ СВЕЖИЙ такой, а не медиану по ним.
  // Их в окне единицы, и вопрос владельца звучит про последний запуск, а не
  // про «обычно после запуска».
  const coldMs = played.find((r) => r.cold)?.soundMs ?? null;

  // Шаги считаются только по доигравшим до звука: у оборванного старта
  // последние шаги отсутствуют, и включать его значило бы занижать их.
  const phaseValues: Record<PhaseShare["key"], number[]> = { sources: [], url: [], engine: [], bytes: [] };
  for (const r of played) {
    if (r.sourcesMs !== null) phaseValues.sources.push(r.sourcesMs);
    if (r.urlMs !== null) phaseValues.url.push(r.urlMs - (r.sourcesMs ?? 0));
    if (r.playCallMs !== null && r.urlMs !== null) phaseValues.engine.push(r.playCallMs - r.urlMs);
    if (r.soundMs !== null && r.playCallMs !== null) phaseValues.bytes.push(r.soundMs - r.playCallMs);
  }
  const phases: PhaseShare[] = (["sources", "url", "engine", "bytes"] as const)
    .map((key) => ({ key, ms: quantile(phaseValues[key], 0.5) ?? 0 }))
    // Шаг, которого в этих включениях не было или который занял меньше
    // миллисекунды, в полосе не рисуется: волосок без подписи только мешает.
    .filter((p) => p.ms > 0);

  // Лента идёт СТАРОЕ СЛЕВА — так её и читают: время течёт вправо.
  const recent: RecentStart[] = [...window].reverse().map((r) => ({
    at: r.at,
    ms: r.soundMs,
    failed: r.error !== null && r.error !== INTERRUPTED,
    interrupted: r.error === INTERRUPTED,
    cold: r.cold === true,
    title: r.title,
  }));

  const placeMap = new Map<string, PlayPlace>();
  for (const r of window) {
    if (r.error === INTERRUPTED) continue; // перебитый не рассказывает о месте
    const key = placeKey(r.cls);
    const cur = placeMap.get(key) ?? { key, count: 0, failed: 0 };
    cur.count += 1;
    if (r.error !== null) cur.failed += 1;
    placeMap.set(key, cur);
  }
  const places = [...placeMap.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const failureMap = new Map<string, FailureGroup>();
  for (const r of failedRecords) {
    const reason = failureKey(r.error as string);
    const cur = failureMap.get(reason) ?? { reason, count: 0, lastAt: 0 };
    cur.count += 1;
    cur.lastAt = Math.max(cur.lastAt, r.at);
    failureMap.set(reason, cur);
  }
  const failures = [...failureMap.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);

  const searchPlaces = (searchSources ?? []).map(readSearchPlace);

  /* ── Вердикт ────────────────────────────────────────────────────────
     Порядок причин = порядок важности: сверху то, из-за чего человек сюда и
     пришёл. Молчащее место поиска идёт первым, потому что его последствие
     (однобокая выдача) человек видит каждый день, а причину — никогда. */
  const notes: OverviewNote[] = [];
  let level: OverviewLevel = "ok";

  for (const p of searchPlaces) {
    if (!p.downNow) continue;
    notes.push({ key: "searchPlaceDown", params: { place: p.source }, level: "bad" });
    level = worse(level, "bad");
  }

  const failRate = window.length > 0 ? failedRecords.length / window.length : 0;
  if (window.length >= FAIL_RATE_MIN_SAMPLE && failRate >= FAIL_RATE_WARN) {
    const bad = failRate >= FAIL_RATE_BAD;
    notes.push({
      key: "someDidNotPlay",
      params: { failed: failedRecords.length, total: window.length },
      level: bad ? "bad" : "warn",
    });
    level = worse(level, bad ? "bad" : "warn");
  }

  if (health?.cooldown_until_ms) {
    notes.push({ key: "fastPathPaused", params: { until: health.cooldown_until_ms }, level: "warn" });
    level = worse(level, "warn");
  }

  if (typicalMs !== null && typicalMs > SLOW_TYPICAL_MS) {
    notes.push({ key: "slowTypical", params: { sec: (typicalMs / 1000).toFixed(1) }, level: "warn" });
    level = worse(level, "warn");
  }

  // Места поиска, которые сбоят, но всё-таки отвечают, — отдельной мягкой
  // строкой и ТОЛЬКО если ничего страшнее не нашлось: иначе они оттеснят
  // настоящую аварию вниз списка.
  if (level === "ok") {
    for (const p of searchPlaces) {
      if (p.level !== "warn") continue;
      notes.push({ key: "searchPlaceShaky", params: { place: p.source }, level: "warn" });
      level = worse(level, "warn");
    }
  }

  return {
    level,
    notes,
    total: window.length,
    failed: failedRecords.length,
    interrupted,
    typicalMs,
    slowMs,
    coldMs,
    phases,
    recent,
    places,
    failures,
    searchPlaces,
  };
}

/** СЖАТЫЙ ЖУРНАЛ СОБЫТИЙ.
 *
 *  ⚠️ ПОЧЕМУ СЖАТЫЙ. Одна авария производит десятки одинаковых записей: три
 *  провала подряд, кулдаун, снова три провала. Лента показывала их подряд, и
 *  экран превращался в простыню, где двадцать строк — это ОДНА новость.
 *  Владелец попросил дословно «журнал, но более сжатый и лаконичный».
 *
 *  Склейка идёт по началу текста (до « — »): хвост у каждого события свой
 *  (идентификаторы, куски ответа), и без среза одинаковые поломки выглядели бы
 *  разными. Хвост САМОГО СВЕЖЕГО события группы сохраняется — он и есть
 *  зацепка, ради которой журнал открывают. */
export interface JournalEntry {
  /** Начало текста — то, что повторяется. */
  head: string;
  /** Хвост самого свежего события группы; пусто — хвоста не было. */
  detail: string;
  count: number;
  lastAt: number;
}

export function compressJournal(events: readonly { at_ms: number; text: string }[]): JournalEntry[] {
  const map = new Map<string, JournalEntry>();
  for (const e of events) {
    const sep = e.text.indexOf(" — ");
    const head = sep === -1 ? e.text : e.text.slice(0, sep);
    const detail = sep === -1 ? "" : e.text.slice(sep + 3);
    const cur = map.get(head);
    if (!cur) {
      map.set(head, { head, detail, count: 1, lastAt: e.at_ms });
      continue;
    }
    cur.count += 1;
    // Хвост держим от самого свежего: старый уже разобран, а свежий — то, что
    // происходит сейчас.
    if (e.at_ms > cur.lastAt) {
      cur.lastAt = e.at_ms;
      cur.detail = detail;
    }
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
}
