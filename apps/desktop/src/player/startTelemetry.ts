/** Телеметрия «клик → первый звук» (И3, 2026-07-22).
 *
 *  ГЛАВНАЯ продуктовая метрика плеера до сих пор не была инструментирована —
 *  все замеры были ручными (CDP-стенд, notes/), и регрессии ловились «на глаз»
 *  («стало медленно», 19-20.07). Здесь — пофазовые тайм-марки каждого старта:
 *
 *    клик → [глушение старого трека] → источники получены → URL готов
 *         → play() вернулся → 'playing' активного слота (= звук слышен)
 *
 *  Раздельные фазы важны (отчёт I): «резолв» и «байты→звук» — разные болезни
 *  с разными лекарствами; смотреть надо и на дисперсию, не только медиану —
 *  поэтому экран диагностики показывает медиану И p90 (см. summarizeStarts).
 *
 *  Этот файл — ПРОТОКОЛ ОТМЕТОК: кто и когда зовёт mark*. Что такое запись,
 *  где она лежит между запусками и как из груды записей считается ответ —
 *  в паре к нему, lib/startLog.ts.
 *
 *  Модульный singleton по образцу sourcesCache: пишет usePlayback (один на
 *  окно), читает экран диагностики — тянуть через пропсы некуда. */

import {
  buildStartTsv,
  clearStoredStartLog,
  normalizeTimings,
  readStartLog,
  RING_MAX,
  summarizeStarts,
  writeStartLog,
  type StartClassStat,
  type StartPath,
  type StartRecord,
} from "../lib/startLog";

// Типы записи живут в журнале (lib/startLog.ts), но прежние потребители
// импортировали их отсюда — реэкспорт, чтобы переезд не тронул чужие файлы.
export type { StartPath, StartRecord } from "../lib/startLog";

const ring: StartRecord[] = [];
const listeners = new Set<() => void>();

let current: { rec: StartRecord; t0: number } | null = null;

/** Ждёт ли следующий beginStart отметки «первый после запуска». Один раз за
 *  жизнь окна: в dev его сбрасывает и перезагрузка от HMR — на замерах это
 *  видно как лишний холодный старт, и это честнее, чем не видеть его вовсе. */
let coldPending = true;

/** ⚠️ ЖУРНАЛ ПОДНИМАЕТСЯ ЛЕНИВО, и это главное, почему замер не стал налогом
 *  на то, что измеряет. Двести записей — это ~50 КБ JSON; разбирать их на
 *  импорте модуля значило бы платить за замер ровно в той точке, ради которой
 *  он заведён («первый трек после запуска особенно долгий»). Поэтому чтение
 *  случается при первом обращении: либо когда человек открыл диагностику, либо
 *  при первом старте — а он и так упирается в сеть, и на его фоне разбор JSON
 *  не виден. */
let restored = false;
function ensureRestored(): void {
  if (restored) return;
  restored = true;
  const stored = readStartLog();
  if (stored.length) ring.push(...stored); // кольцо в этот момент пусто
}

// …и всё же не в самый первый клик: к нему журнал лучше поднять ЗАРАНЕЕ, в
// простое после первой отрисовки. Иначе разбор JSON, пусть и в пару
// миллисекунд, ложится ровно на тот старт, который мы и подозреваем в
// медлительности. requestIdleCallback в WebView2 есть; там, где его нет
// (jsdom, старые движки), остаётся ленивое чтение по первому обращению.
if (typeof requestIdleCallback === "function") requestIdleCallback(() => ensureRestored());

/* ── Запись на диск: троттлинг + сброс перед уходом окна ─────────────────── */

/** Окно склейки записи (образец — DISK_COALESCE_MS в lib/durableState.ts).
 *  За один старт отметок 5–9, и без склейки это 5–9 синхронных сериализаций
 *  журнала целиком. Со склейкой — одна. */
const PERSIST_MS = 1000;
/** Потолок откладывания записи «пока старт в полёте» (см. persistTick):
 *  зависший старт не имеет права отменить сохранение навсегда. */
const PERSIST_MAX_DEFER_MS = 6000;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistSince = 0;
let dirty = false;

function startInFlight(): boolean {
  return current !== null && current.rec.soundMs === null && current.rec.error === null;
}

function schedulePersist(): void {
  dirty = true;
  armUnloadFlush();
  if (persistTimer !== null) return;
  persistSince = Date.now();
  persistTimer = setTimeout(persistTick, PERSIST_MS);
}

function persistTick(): void {
  persistTimer = null;
  // ⚠️ Пока старт В ПОЛЁТЕ, синхронную запись откладываем: localStorage.setItem
  // блокирует тот же поток, на котором мы меряем миллисекунды, и замер, влезший
  // в собственный измеряемый участок, врёт. Откладывание ограничено по времени —
  // старт мог и зависнуть, а журнал должен доехать до диска в любом случае.
  if (startInFlight() && Date.now() - persistSince < PERSIST_MAX_DEFER_MS) {
    persistTimer = setTimeout(persistTick, PERSIST_MS);
    return;
  }
  flushPersist();
}

/** Записать накопленное прямо сейчас. Вынесено из таймера, потому что зовётся
 *  ещё и на уходе окна. */
function flushPersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!dirty) return;
  dirty = false;
  writeStartLog(ring);
}

/** Сброс журнала при уходе страницы (образец — armUnloadFlush в
 *  lib/resumeStore.ts). Без него окно склейки съедало бы последний старт —
 *  а это ровно тот старт, после которого человек и закрывает приложение.
 *  pagehide WebView2 доводит до конца при закрытии окна, visibilitychange
 *  ловит сворачивание (после него обычно и «завершают задачу»),
 *  beforeunload — страховка. Слушатели вешаются лениво, с первой записи. */
let unloadArmed = false;
function armUnloadFlush(): void {
  if (unloadArmed || typeof window === "undefined") return;
  unloadArmed = true;
  window.addEventListener("pagehide", flushPersist);
  window.addEventListener("beforeunload", flushPersist);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPersist();
  });
}

function notify(): void {
  schedulePersist();
  for (const l of listeners) l();
}

/* ── Отметки ─────────────────────────────────────────────────────────────── */

/** Начать запись старта. Прошлый незавершённый старт помечается superseded —
 *  это честная судьба перебитых кликов (playSeq в usePlayback). */
export function beginStart(trackId: string, title: string, reason: string): void {
  ensureRestored();
  if (current && current.rec.soundMs === null && current.rec.error === null) {
    current.rec.error = "superseded";
  }
  const rec: StartRecord = {
    trackId,
    title,
    reason,
    at: Date.now(),
    sourcesMs: null,
    urlMs: null,
    path: null,
    playCallMs: null,
    soundMs: null,
    error: null,
    silenceMs: null,
    cls: null,
    cold: coldPending,
    timings: undefined,
  };
  coldPending = false;
  ring.push(rec);
  if (ring.length > RING_MAX) ring.shift();
  current = { rec, t0: performance.now() };
  notify();
}

function mark(): number | null {
  return current ? Math.round(performance.now() - current.t0) : null;
}

export function markSources(): void {
  if (current) {
    current.rec.sourcesMs = mark();
    notify();
  }
}

export function markUrl(path: StartPath): void {
  if (current) {
    current.rec.urlMs = mark();
    current.rec.path = path;
    notify();
  }
}

export function markPlayCall(): void {
  if (current) {
    current.rec.playCallMs = mark();
    notify();
  }
}

/** СТАРЫЙ ТРЕК ЗАГЛУШЕН — с этого мгновения и до звука человек слышит ТИШИНУ,
 *  и это она, а не общее время старта, воспринимается как задержка.
 *
 *  ⚠️ Отметка отдельная НАРОЧНО. Сегодня usePlayback глушит играющее сразу же
 *  (осознанное решение по жалобе владельца 2026-07-15,
 *  startPlan.shouldSilenceBeforeResolve), и окно тишины почти совпадает с
 *  soundMs — но лишь потому, что pause() стоит рядом с началом. Стоит
 *  переставить порядок, и «тишина = soundMs» тихо перестанет быть правдой,
 *  а метрика продолжит показывать цифру. Явная отметка это исключает. */
export function markSilence(): void {
  if (current && (current.rec.silenceMs === null || current.rec.silenceMs === undefined)) {
    current.rec.silenceMs = mark();
    notify();
  }
}

/** 'playing' активного слота — звук реально пошёл. Зовёт audioEngine через
 *  колбэк onPlaying; относится к ПОСЛЕДНЕМУ начатому старту. */
export function markSound(): void {
  if (current && current.rec.soundMs === null) {
    current.rec.soundMs = mark();
    notify();
  }
}

export function markError(message: string): void {
  if (current && current.rec.error === null && current.rec.soundMs === null) {
    current.rec.error = message.slice(0, 200);
    notify();
  }
}

/** ПРИЁМНИК ОТМЕТОК ДОБЫЧИ. Их присылает Rust вместе с результатом добычи —
 *  форма приходящего проверяется в normalizeTimings, потому что это ЧУЖИЕ
 *  данные и телеметрия не имеет права ронять из-за них плеер. Отметки
 *  накапливаются: за один старт добыча может отчитаться несколько раз
 *  (прогрев, стрим, лестница). */
export function markTimings(input: unknown): void {
  if (!current) return;
  const add = normalizeTimings(input);
  if (!add) return;
  current.rec.timings = [...(current.rec.timings ?? []), ...add];
  notify();
}

/** Назвать класс прогона (провайдер/вид трека) — по нему складывается сводка.
 *  Не позвали — класс выведется сам из отметок добычи и пути (см. startClass). */
export function markClass(cls: string): void {
  if (current && cls) {
    current.rec.cls = cls.slice(0, 40);
    notify();
  }
}

/* ── Чтение ──────────────────────────────────────────────────────────────── */

/** Свежие записи, новые первыми (копия — кольцо не отдаём наружу). */
export function getStartLog(): StartRecord[] {
  ensureRestored();
  return [...ring].reverse();
}

/** Журнал в TSV — для кнопки «Скопировать журнал» в диагностике. */
export function getStartTsv(): string {
  ensureRestored();
  return buildStartTsv(ring);
}

/** Медиана и p90 фаз по классам прогонов — сводка над списком в диагностике. */
export function getStartSummary(): StartClassStat[] {
  ensureRestored();
  return summarizeStarts(ring);
}

/** Подписка экрана диагностики; возврат — отписка. */
export function subscribeStartLog(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Только для тестов: обнулить состояние модуля. keepStored — оставить
 *  накопленное в хранилище: так проверяется, что журнал переживает
 *  перезагрузку окна (модуль поднимается заново, данные на месте). */
export function resetStartTelemetryForTests(opts?: { keepStored?: boolean }): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  ring.length = 0;
  listeners.clear();
  current = null;
  restored = false;
  dirty = false;
  coldPending = true;
  if (!opts?.keepStored) clearStoredStartLog();
}
