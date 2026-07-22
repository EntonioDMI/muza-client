/** Телеметрия «клик → первый звук» (И3, 2026-07-22).
 *
 *  ГЛАВНАЯ продуктовая метрика плеера до сих пор не была инструментирована —
 *  все замеры были ручными (CDP-стенд, notes/), и регрессии ловились «на глаз»
 *  («стало медленно», 19-20.07). Здесь — пофазовые тайм-марки каждого старта:
 *
 *    клик → источники получены → URL готов (стрим/резолв) → play() вернулся
 *         → 'playing' активного слота (= звук слышен)
 *
 *  Раздельные фазы важны (отчёт I): «резолв» и «байты→звук» — разные болезни
 *  с разными лекарствами; смотреть надо и на дисперсию, не только медиану.
 *
 *  Кольцо последних стартов показывается в Настройки → Система → Диагностика.
 *  Модульный singleton по образцу sourcesCache: пишет usePlayback (один на
 *  окно), читает экран диагностики — тянуть через пропсы некуда. */

/** Каким путём добыли URL: stream — первые байты из muza-stream;
 *  resolve — обычная добыча (кэш/ступень 0/лестница) до готового файла;
 *  preloaded — URL был преднагружен (gapless). */
export type StartPath = "stream" | "resolve" | "preloaded";

export interface StartRecord {
  trackId: string;
  title: string;
  /** Что запустило старт: click | next | prev | auto | resume-heal | … */
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
}

const RING_MAX = 20;
const ring: StartRecord[] = [];
const listeners = new Set<() => void>();

let current: { rec: StartRecord; t0: number } | null = null;

function notify(): void {
  for (const l of listeners) l();
}

/** Начать запись старта. Прошлый незавершённый старт помечается superseded —
 *  это честная судьба перебитых кликов (playSeq в usePlayback). */
export function beginStart(trackId: string, title: string, reason: string): void {
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
  };
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

/** Свежие записи, новые первыми (копия — кольцо не отдаём наружу). */
export function getStartLog(): StartRecord[] {
  return [...ring].reverse();
}

/** Подписка экрана диагностики; возврат — отписка. */
export function subscribeStartLog(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Только для тестов: обнулить состояние модуля. */
export function resetStartTelemetryForTests(): void {
  ring.length = 0;
  listeners.clear();
  current = null;
}
