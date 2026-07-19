/** Очередь прогрева добычи (Фаза 1, спека 2026-07-16-прогрев-и-стрим-дизайн).
 *
 *  Прогрев одного трека стоит ~3.3с процесса yt-dlp и параллелится только до
 *  2 — экран из 20 треков греется ~35с, на первый клик по свежему экрану
 *  прогрев может не успеть, и это нормально: ПОРЯДОК ВАЖНЕЕ ОХВАТА. Отсюда
 *  приоритеты: hover (курсор приходит на строку раньше клика) > видимые
 *  строки сверху вниз > очередь воспроизведения.
 *
 *  Лимиты (параллелизм 2, 30/мин скользящим окном) — решение владельца,
 *  ЖЁСТКИЙ режим, не ослаблять: бот-детект YouTube бьёт по IP владельца и
 *  ломает ВСЮ добычу (и клики тоже), цена ошибки сильно выше выигрыша от
 *  агрессивного прогрева.
 *
 *  Чистый класс без React/Tauri: сигналы (hover/видимость/очередь) подаёт
 *  useWarmer, сам прогрев (getTrackSources + engine_warm) — инъекция `run`.
 *  Ошибки run не всплывают: прогрев best-effort по определению — трек,
 *  который не прогрелся, просто добудется обычной лестницей на клике. */

export type WarmOutcome = "warmed" | "cached";
export type WarmSignal = "hover" | "visible" | "queue";

export const WARM_PARALLELISM = 2;
export const WARM_RATE_PER_MINUTE = 30;
/** После ошибки прогрева трек не дёргается повторно, пока не остынет:
 *  сигналы видимости сыплются на каждый скролл, а причина ошибки (нет сети,
 *  бот-детект, мёртвые источники) за секунды не рассосётся. */
export const WARM_FAIL_COOLDOWN_MS = 60_000;
/** Успех помнится долго: повторный запрос — лишний IPC и слот лимита 30/мин,
 *  а протухание warm-записи (~6ч) и эвикцию кэша Rust переживёт сам —
 *  просто снова прогреем после истечения этой памяти. */
export const WARM_DONE_TTL_MS = 30 * 60_000;

const PRIORITY: Record<WarmSignal, number> = { hover: 0, visible: 1, queue: 2 };

export class WarmQueue {
  private run: (id: string) => Promise<WarmOutcome>;
  private parallelism: number;
  private ratePerMinute: number;
  /** Ждущие заявки в порядке поступления; выбор — по приоритету, внутри
   *  приоритета FIFO (для видимых это и есть «сверху вниз» — useWarmer подаёт
   *  их в порядке строк). */
  private pending: { id: string; priority: number }[] = [];
  private inflight = new Set<string>();
  /** id → момент, до которого трек не трогаем (успех/кэш/ошибка). */
  private coolUntil = new Map<string, number>();
  /** Моменты стартов за последнюю минуту — скользящее окно лимита. */
  private starts: number[] = [];
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    run: (id: string) => Promise<WarmOutcome>,
    opts?: { parallelism?: number; ratePerMinute?: number },
  ) {
    this.run = run;
    this.parallelism = opts?.parallelism ?? WARM_PARALLELISM;
    this.ratePerMinute = opts?.ratePerMinute ?? WARM_RATE_PER_MINUTE;
  }

  request(id: string, signal: WarmSignal): void {
    if (this.disposed || this.inflight.has(id)) return;
    const until = this.coolUntil.get(id);
    if (until !== undefined) {
      if (Date.now() < until) return;
      this.coolUntil.delete(id);
    }
    const priority = PRIORITY[signal];
    const existing = this.pending.find((p) => p.id === id);
    if (existing) {
      // повторный сигнал важнее — поднимаем заявку (hover по ждущему в очереди)
      if (priority < existing.priority) existing.priority = priority;
    } else {
      this.pending.push({ id, priority });
    }
    this.pump();
  }

  /** Строка ушла с экрана — ждущая заявка снимается (прогрев в полёте не
   *  отменить: yt-dlp уже запущен, а результат всё равно ляжет в память и
   *  пригодится). Трек из очереди воспроизведения вернётся следующим сигналом
   *  очереди — сигналы идемпотентны. */
  cancel(id: string): void {
    this.pending = this.pending.filter((p) => p.id !== id);
  }

  dispose(): void {
    this.disposed = true;
    this.pending = [];
    if (this.wakeTimer !== null) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }

  private pump(): void {
    if (this.disposed) return;
    const now = Date.now();
    this.starts = this.starts.filter((t) => now - t < 60_000);
    while (this.pending.length > 0 && this.inflight.size < this.parallelism) {
      if (this.starts.length >= this.ratePerMinute) {
        // окно забито — проснёмся, когда самый старый старт выйдет из минуты
        this.scheduleWake(this.starts[0] + 60_000 - now + 1);
        return;
      }
      const next = this.takeNext();
      if (!next) return;
      this.starts.push(now);
      this.inflight.add(next.id);
      this.run(next.id)
        .then((outcome) => this.settle(next.id, outcome))
        .catch(() => this.settle(next.id, "failed"));
    }
  }

  private takeNext(): { id: string; priority: number } | null {
    if (this.pending.length === 0) return null;
    let best = 0;
    for (let i = 1; i < this.pending.length; i++) {
      if (this.pending[i].priority < this.pending[best].priority) best = i;
    }
    return this.pending.splice(best, 1)[0];
  }

  private settle(id: string, outcome: WarmOutcome | "failed"): void {
    this.inflight.delete(id);
    const ttl = outcome === "failed" ? WARM_FAIL_COOLDOWN_MS : WARM_DONE_TTL_MS;
    this.coolUntil.set(id, Date.now() + ttl);
    this.pump();
  }

  private scheduleWake(delayMs: number): void {
    if (this.wakeTimer !== null) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.pump();
    }, Math.max(delayMs, 1));
  }
}
