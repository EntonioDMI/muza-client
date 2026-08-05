/** ЖУРНАЛ СТАРТОВ «клик → первый звук»: формат записи, хранение между
 *  запусками программы и разбор накопленного.
 *
 *  Пара к player/startTelemetry.ts. Там — ПРОТОКОЛ ОТМЕТОК (кто, когда и в
 *  каком порядке зовёт mark*), здесь — журнал как ДАННЫЕ: из чего состоит
 *  запись, где она лежит между запусками и как из груды записей получается
 *  ответ «сколько это стоит».
 *
 *  ⚠️ ПОЧЕМУ ЖУРНАЛ ОБЯЗАН ПЕРЕЖИВАТЬ ПЕРЕЗАПУСК. Жалоба владельца звучит
 *  дословно так: «первый трек ПОСЛЕ ЗАПУСКА приложения особенно долгий».
 *  Пока кольцо жило только в памяти модуля, ровно этот прогон измерить было
 *  НЕЧЕМ: единственная запись о нём умирала вместе с процессом, а следующий
 *  запуск начинал с чистого листа — то есть стирал предыдущий замер. Поэтому
 *  кольцо лежит в localStorage и переживает и перезапуск, и «завершить задачу».
 *
 *  ⚠️ Ключ НАМЕРЕННО не входит в MIRROR_KEYS (lib/durableState.ts): зеркало на
 *  диск заведено для того, чья потеря стоит человеку входа или настроек. Здесь
 *  цена потери — «последние замеры не доехали», и она заметно дешевле
 *  межпроцессной записи файла на каждый старт трека. */

/** Каким путём добыли URL: stream — первые байты из muza-stream;
 *  resolve — обычная добыча (кэш/ступень 0/лестница) до готового файла;
 *  preloaded — URL был преднагружен (gapless). */
export type StartPath = "stream" | "resolve" | "preloaded";

/** Отметка ИЗНУТРИ добычи: [метка, сколько заняла эта работа в мс].
 *
 *  Это ДЛИТЕЛЬНОСТЬ шага, а не момент: Rust не знает мгновения клика и может
 *  честно измерить только собственные шаги. Без них urlMs — один чёрный ящик
 *  на несколько секунд, а у владельца (SoundCloud) внутри него четыре
 *  последовательных сетевых шага, и неизвестно, который из них длинный.
 *
 *  Метки, которые ставит добыча: warm_hit, sc_client_id, sc_api_v2,
 *  sc_transcoding, sc_probe, sc_m3u8, yt_innertube, first_chunk_wait, ladder.
 *  Список НЕ закрытый и не проверяется: незнакомая метка печатается как есть —
 *  это дешевле, чем держать две копии перечня (в Rust и здесь) в согласии. */
export type PhaseTiming = readonly [label: string, ms: number];

export interface StartRecord {
  trackId: string;
  title: string;
  /** Что запустило старт: manual (клик/скип человека) | auto (авто-переход).
   *  Строка, не union — детализация (next/prev/heal) добавится без ломки. */
  reason: string;
  /** Момент начала (Date.now) — для отображения времени в диагностике. */
  at: number;
  /** Фазы, мс от начала старта. null = фаза не случилась (ещё/вообще). */
  sourcesMs: number | null;
  urlMs: number | null;
  path: StartPath | null;
  playCallMs: number | null;
  soundMs: number | null;
  /** Ошибка старта либо "superseded" — старт перебит следующим до звука. */
  error: string | null;
  /** Момент, когда старый трек ЗАГЛУШЕН, мс от начала старта. Отсюда и до
   *  soundMs человек слышит тишину — это и есть воспринимаемая задержка. */
  silenceMs?: number | null;
  /** Класс прогона для матрицы замеров. Ставится markClass; если никто не
   *  назвал — выводится из того, что и так известно (см. startClass). */
  cls?: string | null;
  /** Первый старт в ЭТОМ запуске программы — та самая жалоба владельца. */
  cold?: boolean;
  /** Пофазовые отметки изнутри добычи. Поле НЕобязательное: записи, снятые до
   *  его появления, обязаны читаться как есть, без миграции. */
  timings?: PhaseTiming[];
}

/** Ключ хранилища. Версия в имени — чтобы несовместимая смена формата не
 *  требовала миграции: старый ключ просто перестают читать. */
const STORE_KEY = "muza.starts.v1";

/** Матрица замера — пять классов треков по десять повторов плюс два особых
 *  прогона по десять: семьдесят записей за ОДИН проход, и это без ошибочных и
 *  перебитых стартов. Прежних двадцати не хватало даже на один класс. */
export const RING_MAX = 200;

/** Потолок числа отметок добычи в записи. Метки приходят из Rust, а всё, что
 *  приходит снаружи, обязано иметь предел: иначе цикл с ошибкой на той стороне
 *  раздувает и запись, и хранилище. */
const TIMINGS_MAX = 32;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Привести отметки добычи к паре [метка, мс], что бы ни прислали.
 *
 *  Принимаем три формы, потому что форму диктует ЧУЖАЯ сторона (Rust), и
 *  договорённость о ней дешевле починить здесь, чем ронять весь замер:
 *  [["sc_api_v2", 340], …] | [{label, ms}, …] | {sc_api_v2: 340, …}.
 *  Мусор молча отбрасывается — телеметрия не имеет права ронять плеер. */
export function normalizeTimings(input: unknown): PhaseTiming[] | undefined {
  const out: PhaseTiming[] = [];
  const push = (label: unknown, ms: unknown) => {
    const n = num(ms);
    if (typeof label !== "string" || !label || n === null) return;
    out.push([label.slice(0, 40), Math.round(n)]);
  };
  if (Array.isArray(input)) {
    for (const item of input) {
      if (Array.isArray(item)) push(item[0], item[1]);
      else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        push(o.label ?? o.name, o.ms ?? o.value);
      }
    }
  } else if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) push(k, v);
  }
  return out.length ? out.slice(0, TIMINGS_MAX) : undefined;
}

/** Запись из хранилища — чужой текст: её мог написать СТАРЫЙ клиент (без
 *  timings/cls/silence) или испортить кто угодно. Не прошла проверку — просто
 *  выбрасывается, остальной журнал при этом читается. */
function sanitize(v: unknown): StartRecord | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const at = num(r.at);
  if (at === null) return null; // без времени запись не показать и не отсортировать
  return {
    trackId: str(r.trackId),
    title: str(r.title),
    reason: str(r.reason),
    at,
    sourcesMs: num(r.sourcesMs),
    urlMs: num(r.urlMs),
    path: r.path === "stream" || r.path === "resolve" || r.path === "preloaded" ? r.path : null,
    playCallMs: num(r.playCallMs),
    soundMs: num(r.soundMs),
    error: typeof r.error === "string" ? r.error : null,
    silenceMs: num(r.silenceMs),
    cls: typeof r.cls === "string" && r.cls ? r.cls : null,
    cold: r.cold === true,
    timings: normalizeTimings(r.timings),
  };
}

/** Прочитать журнал прошлых запусков. Старое первым (порядок кольца). */
export function readStartLog(): StartRecord[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: StartRecord[] = [];
    for (const item of parsed) {
      const rec = sanitize(item);
      if (rec) out.push(rec);
    }
    return out.length > RING_MAX ? out.slice(-RING_MAX) : out;
  } catch {
    return []; // битый JSON/недоступное хранилище — журнал начинается заново
  }
}

/** Записать журнал целиком. Синхронно и без затей: вызывающий (startTelemetry)
 *  сам решает, КОГДА платить эту цену, — см. троттлинг там.
 *
 *  Окон у программы два и localStorage у них ОДИН на origin, но спорить за
 *  ключ им не из-за чего: мини-плеер только отражает состояние (mini/MiniPlayer
 *  не заводит движок и не ставит ни одной отметки), поэтому пишет ровно то
 *  окно, в котором треки и стартуют. */
export function writeStartLog(records: readonly StartRecord[]): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(records));
  } catch {
    /* квота/приватный режим — замер не стоит того, чтобы падать */
  }
}

/** Только для тестов и кнопки «очистить»: забыть накопленное. */
export function clearStoredStartLog(): void {
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* см. writeStartLog */
  }
}

/* ── Разбор: из записей в ответ «сколько это стоит» ──────────────────────── */

/** Фазы пути, в порядке прохождения. Считаются РАЗНОСТЯМИ: в сыром виде поля
 *  записи — моменты от клика, и «urlMs 1800» без вычитания источников врёт про
 *  добычу. Разности названы так, чтобы каждая имела своё лекарство:
 *  sources — сходили за источниками, url — добыли ссылку (внутри неё живут
 *  timings), engine — завели движок (целиком построение графа Web Audio),
 *  bytes — от play() до реального звука, silence — окно тишины, total — всё. */
export const START_PHASES = ["sources", "url", "engine", "bytes", "silence", "total"] as const;
export type StartPhaseKey = (typeof START_PHASES)[number];

export function phaseMs(r: StartRecord, phase: StartPhaseKey): number | null {
  switch (phase) {
    case "sources":
      return r.sourcesMs;
    case "url":
      // Источников могло не быть вовсе (файл с устройства, преднагрузка) —
      // тогда добыча ссылки началась от клика.
      return r.urlMs === null ? null : r.urlMs - (r.sourcesMs ?? 0);
    case "engine":
      return r.playCallMs === null || r.urlMs === null ? null : r.playCallMs - r.urlMs;
    case "bytes":
      return r.soundMs === null || r.playCallMs === null ? null : r.soundMs - r.playCallMs;
    case "silence":
      // ⚠️ Считается ОТ ЯВНОЙ отметки глушения, а не «примерно от начала».
      // Сегодня pause() стоит рядом с beginStart и окно тишины почти равно
      // total — но это совпадение расположения, а не смысл метрики.
      return r.soundMs === null || r.silenceMs === null || r.silenceMs === undefined ? null : r.soundMs - r.silenceMs;
    case "total":
      return r.soundMs;
  }
}

/** Класс прогона — то, по чему записи имеет смысл складывать в одну кучу.
 *
 *  Явный markClass побеждает; если его не звали — класс выводится из того, что
 *  известно и так: метки добычи выдают провайдера (sc_* / yt_*), иначе годится
 *  сам путь добычи. Холодный старт помечается приставкой: он и есть «два
 *  особых прогона» матрицы, и мешать его с тёплыми нельзя — вопрос ровно в
 *  том, насколько он дороже. */
export function startClass(r: StartRecord): string {
  const base =
    r.cls ??
    (r.timings?.some(([l]) => l.startsWith("sc_"))
      ? "soundcloud"
      : r.timings?.some(([l]) => l.startsWith("yt_"))
        ? "youtube"
        : (r.path ?? "?"));
  return r.cold ? `cold:${base}` : base;
}

export interface StartPhaseStat {
  median: number;
  p90: number;
}

export interface StartClassStat {
  cls: string;
  /** Сколько прогонов в классе (включая ошибочные — их фазы просто неполные). */
  count: number;
  /** Фазы, до которых прогоны доходили. Нет ключа — фазы не было ни разу. */
  phases: Partial<Record<StartPhaseKey, StartPhaseStat>>;
}

/** Квантиль по возрастающему списку, с линейной интерполяцией — ровно как
 *  считают МЕДИАНА и ПЕРСЕНТИЛЬ.ВКЛ в таблице. Это не педантизм: тот же журнал
 *  выгружается TSV и пересчитывается в Excel/Sheets, и цифры на экране обязаны
 *  сойтись с цифрами в таблице, иначе спорить будут о них, а не о плеере. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Медиана и p90 фаз по классам прогонов.
 *
 *  ⚠️ Именно p90, а не среднее. Жалоба владельца звучит как «ИНОГДА долго», а
 *  «иногда» — это хвост распределения: среднее его размазывает, медиана вообще
 *  не видит. p90 читается «девять прогонов из десяти уложились в это время». */
export function summarizeStarts(records: readonly StartRecord[]): StartClassStat[] {
  const groups = new Map<string, StartRecord[]>();
  for (const r of records) {
    const cls = startClass(r);
    const list = groups.get(cls);
    if (list) list.push(r);
    else groups.set(cls, [r]);
  }
  const out: StartClassStat[] = [];
  for (const [cls, list] of groups) {
    const phases: Partial<Record<StartPhaseKey, StartPhaseStat>> = {};
    for (const phase of START_PHASES) {
      const values: number[] = [];
      for (const r of list) {
        const v = phaseMs(r, phase);
        if (v !== null) values.push(v);
      }
      if (!values.length) continue; // фазы не было ни в одном прогоне класса
      values.sort((a, b) => a - b);
      phases[phase] = { median: Math.round(quantile(values, 0.5)), p90: Math.round(quantile(values, 0.9)) };
    }
    out.push({ cls, count: list.length, phases });
  }
  // Крупные классы сверху: на них и стоит смотреть первым делом.
  return out.sort((a, b) => b.count - a.count || a.cls.localeCompare(b.cls));
}

/** ⚠️ ПОРЯДОК КОЛОНОК ЗАФИКСИРОВАН договорённостью о выгрузке. silenceMs
 *  приписан В КОНЕЦ (а не рядом с soundMs, где ему место по смыслу) именно
 *  поэтому: у владельца уже могут быть вставленные в таблицу прогоны, и
 *  вставка колонки в середину развалила бы им формулы. */
const TSV_COLUMNS = [
  "at",
  "reason",
  "class",
  "sourcesMs",
  "urlMs",
  "path",
  "playCallMs",
  "soundMs",
  "error",
  "timings",
  "silenceMs",
] as const;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Местное время без часового пояса: «2026-08-05 14:03:12.412». Таблица
 *  разбирает такую строку сама, а ISO с Z заставил бы человека пересчитывать
 *  часы в уме — журнал смотрят рядом с собственными часами. */
function tsvClock(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/** Табы и переводы строк внутри ячейки развалили бы таблицу — глушим их. */
const cell = (v: string): string => v.replace(/[\t\r\n]+/g, " ").trim();

/** Пустая ячейка вместо «null»: таблица считает медиану по пустым клеткам
 *  правильно (пропускает), а по тексту "null" — отказывается считать вовсе. */
const numCell = (v: number | null | undefined): string => (typeof v === "number" ? String(Math.round(v)) : "");

/** Журнал в TSV для буфера обмена.
 *
 *  Именно TSV, а не JSON: он вставляется прямо в таблицу и там же считает
 *  медианы — от владельца не требуется ни парсера, ни нашей помощи.
 *  Порядок строк ХРОНОЛОГИЧЕСКИЙ (старое сверху), в отличие от экрана: в
 *  таблице так читается серия повторов, а на экране нужен последний старт. */
export function buildStartTsv(records: readonly StartRecord[]): string {
  const lines = [TSV_COLUMNS.join("\t")];
  for (const r of records) {
    lines.push(
      [
        tsvClock(r.at),
        cell(r.reason),
        cell(startClass(r)),
        numCell(r.sourcesMs),
        numCell(r.urlMs),
        r.path ?? "",
        numCell(r.playCallMs),
        numCell(r.soundMs),
        cell(r.error ?? ""),
        // Отметки добычи — одной ячейкой: «sc_api_v2=340;sc_m3u8=120».
        (r.timings ?? []).map(([l, ms]) => `${l}=${ms}`).join(";"),
        numCell(r.silenceMs),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}
