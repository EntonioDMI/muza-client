/** Очередь прогрева добычи (Фаза 1, спека 2026-07-16-прогрев-и-стрим-дизайн).
 *
 *  Прогрев одного трека стоит ~3.3с процесса yt-dlp и параллелится только до
 *  2 — экран из 20 треков греется ~35с, на первый клик по свежему экрану
 *  прогрев может не успеть, и это нормально: ПОРЯДОК ВАЖНЕЕ ОХВАТА. Отсюда
 *  приоритеты: hover (курсор приходит на строку раньше клика) > видимые
 *  строки сверху вниз > очередь воспроизведения.
 *
 *  Лимиты (параллелизм 2, 30/мин и 120/час скользящими окнами, dwell 1.5с
 *  на сигнал видимости) — решение владельца, ЖЁСТКИЙ режим, не ослаблять:
 *  бот-детект YouTube бьёт по IP владельца и ломает ВСЮ добычу (и клики
 *  тоже), цена ошибки сильно выше выигрыша от агрессивного прогрева.
 *
 *  Чистый класс без React/Tauri: сигналы (hover/видимость/очередь) подаёт
 *  useWarmer, сам прогрев (getTrackSources + engine_warm) — инъекция `run`.
 *  Ошибки run не всплывают: прогрев best-effort по определению — трек,
 *  который не прогрелся, просто добудется обычной лестницей на клике. */

export type WarmOutcome = "warmed" | "cached";
export type WarmSignal = "hover" | "visible" | "queue";

export const WARM_PARALLELISM = 2;
export const WARM_RATE_PER_MINUTE = 30;
/** Часовое окно (2026-07-19): 30/мин без него = до 1800/час при лимите
 *  гостевой сессии YouTube ~300 видео/час — долгая сессия скролла сама
 *  загоняла IP под бот-гейт, ломая ВСЮ добычу. Тот же жёсткий режим. */
export const WARM_RATE_PER_HOUR = 120;
/** Dwell видимости (2026-07-19): заявка от IntersectionObserver становится
 *  реальной только после непрерывной видимости строки. Быстрый скролл поиска
 *  (118 результатов → волна прогрева → бот-гейт → CPU-лавина yt-dlp)
 *  становится бесплатным; hover/queue — единичные намерения, без задержки. */
export const WARM_VISIBLE_DWELL_MS = 1500;
/** После ошибки прогрева трек не дёргается повторно, пока не остынет:
 *  сигналы видимости сыплются на каждый скролл, а причина ошибки (нет сети,
 *  бот-детект, мёртвые источники) за секунды не рассосётся. */
export const WARM_FAIL_COOLDOWN_MS = 60_000;
/** Успех помнится долго: повторный запрос — лишний IPC и слот лимита 30/мин,
 *  а протухание warm-записи (~6ч) и эвикцию кэша Rust переживёт сам —
 *  просто снова прогреем после истечения этой памяти. */
export const WARM_DONE_TTL_MS = 30 * 60_000;

const PRIORITY: Record<WarmSignal, number> = { hover: 0, visible: 1, queue: 2 };
/** Обратное соответствие приоритет → сигнал: run получает сигнал ПОБЕДИВШЕЙ
 *  заявки (Rust в кулдауне breaker'а глушит yt-dlp-фолбэк только для visible —
 *  массового сигнала; hover/queue — единичные намерения). */
const SIGNAL_BY_PRIORITY: WarmSignal[] = ["hover", "visible", "queue"];

export class WarmQueue {
  private run: (id: string, signal: WarmSignal) => Promise<WarmOutcome>;
  private parallelism: number;
  private ratePerMinute: number;
  private ratePerHour: number;
  /** Ждущие заявки в порядке поступления; выбор — по приоритету, внутри
   *  приоритета FIFO (для видимых это и есть «сверху вниз» — useWarmer подаёт
   *  их в порядке строк). */
  private pending: { id: string; priority: number }[] = [];
  private inflight = new Set<string>();
  /** id → момент, до которого трек не трогаем (успех/кэш/ошибка). */
  private coolUntil = new Map<string, number>();
  /** Моменты стартов за последнюю минуту — скользящее окно лимита. */
  private starts: number[] = [];
  /** Моменты стартов за последний час — второе окно (WARM_RATE_PER_HOUR). */
  private hourStarts: number[] = [];
  /** id → dwell-таймер видимости: заявка ещё НЕ в pending, ждёт выдержку. */
  private dwell = new Map<string, ReturnType<typeof setTimeout>>();
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    run: (id: string, signal: WarmSignal) => Promise<WarmOutcome>,
    opts?: { parallelism?: number; ratePerMinute?: number; ratePerHour?: number },
  ) {
    this.run = run;
    this.parallelism = opts?.parallelism ?? WARM_PARALLELISM;
    this.ratePerMinute = opts?.ratePerMinute ?? WARM_RATE_PER_MINUTE;
    this.ratePerHour = opts?.ratePerHour ?? WARM_RATE_PER_HOUR;
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
      this.clearDwell(id);
      this.pump();
      return;
    }
    if (signal === "visible") {
      // dwell: мелькнувшая при скролле строка не рождает заявку; повторный
      // visible по уже тикающему таймеру НЕ сбрасывает выдержку
      if (!this.dwell.has(id)) {
        this.dwell.set(
          id,
          setTimeout(() => {
            this.dwell.delete(id);
            this.enqueue(id, PRIORITY.visible);
          }, WARM_VISIBLE_DWELL_MS),
        );
      }
      return;
    }
    // hover/queue — прямое намерение: ждущий dwell (если был) поглощается
    this.clearDwell(id);
    this.enqueue(id, priority);
  }

  /** Строка ушла с экрана — ждущая заявка (и dwell-выдержка) снимается
   *  (прогрев в полёте не отменить: yt-dlp уже запущен, а результат всё равно
   *  ляжет в память и пригодится). Трек из очереди воспроизведения вернётся
   *  следующим сигналом очереди — сигналы идемпотентны. */
  cancel(id: string): void {
    this.clearDwell(id);
    this.pending = this.pending.filter((p) => p.id !== id);
  }

  dispose(): void {
    this.disposed = true;
    this.pending = [];
    for (const timer of this.dwell.values()) clearTimeout(timer);
    this.dwell.clear();
    if (this.wakeTimer !== null) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }

  private clearDwell(id: string): void {
    const timer = this.dwell.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.dwell.delete(id);
    }
  }

  /** Заявка становится реальной. Проверки повторяются: пока dwell тикал,
   *  трек мог прогреться сигналом queue (coolUntil) или уйти в полёт. */
  private enqueue(id: string, priority: number): void {
    if (this.disposed || this.inflight.has(id)) return;
    const until = this.coolUntil.get(id);
    if (until !== undefined && Date.now() < until) return;
    if (!this.pending.some((p) => p.id === id)) this.pending.push({ id, priority });
    this.pump();
  }

  private pump(): void {
    if (this.disposed) return;
    const now = Date.now();
    this.starts = this.starts.filter((t) => now - t < 60_000);
    this.hourStarts = this.hourStarts.filter((t) => now - t < 3_600_000);
    while (this.pending.length > 0 && this.inflight.size < this.parallelism) {
      if (this.starts.length >= this.ratePerMinute) {
        // окно забито — проснёмся, когда самый старый старт выйдет из минуты
        this.scheduleWake(this.starts[0] + 60_000 - now + 1);
        return;
      }
      if (this.hourStarts.length >= this.ratePerHour) {
        this.scheduleWake(this.hourStarts[0] + 3_600_000 - now + 1);
        return;
      }
      const next = this.takeNext();
      if (!next) return;
      this.starts.push(now);
      this.hourStarts.push(now);
      this.inflight.add(next.id);
      this.run(next.id, SIGNAL_BY_PRIORITY[next.priority])
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
