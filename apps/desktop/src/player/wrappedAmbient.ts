/** Эмбиент-канал Wrapped (редизайн 2026-07-16): пока открыт оверлей «Итоги
 *  года», тихо играет топ-трек пользователя. НАМЕРЕННО отдельный <audio>, а не
 *  usePlayback.startAt: startAt перезаписал бы очередь/позицию пользователя, и
 *  восстановление после закрытия оверлея было бы хрупким. Каналу не нужны
 *  EQ/нормализация/кроссфейды основного движка — только тихий фон с фейдами.
 *
 *  Контракт (бриф владельца 16.07.2026):
 *  - вход: основной плеер играл → пауза СРАЗУ (не после резолва), запомнить;
 *  - fade-in только ПОСЛЕ готовности резолва — кэш-мисс добычи занимает
 *    секунды, оверлей звук не ждёт и спиннеров из-за него не показывает;
 *  - выход: fade-out ~200 мс → стоп + снять src (не держать файл кэша);
 *    плеер вернуть, если играл на входе И сейчас молчит — медиа-клавишей
 *    (SMTC) его могли возобновить поверх оверлея раньше нас;
 *  - ошибка резолва → молча без звука, оверлей полноценно живёт;
 *  - stop до конца резолва → звук НЕ стартует (session-токен, тот же приём,
 *    что playSeqRef в usePlayback).
 *
 *  URL добывается тем же путём, что у плеера (lib/engine.resolvePlayable →
 *  Rust engine_resolve, общий LRU-кэш) — прямые googlevideo-URL в <audio>
 *  запрещены: без Range-цепочки они троттлятся до 32 КБ/с (разбор в
 *  docs/notes/2026-07-15-почему-песни-грузятся-долго.md §2). */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Слайдер 0..100 → гейн 0..1: та же перцептивная квадратичная кривая, что
 *  volCurve у основного движка — «20%» эмбиента ощущается как 20% плеера. */
export const ambientGain = (v: number): number => clamp01(v / 100) ** 2;

export const AMBIENT_FADE_IN_MS = 900;
export const AMBIENT_FADE_OUT_MS = 200;
/** Шаг рампы; setInterval, а не rAF — фейд доигрывает и в скрытом окне. */
const FADE_STEP_MS = 20;

export interface WrappedAmbientDeps {
  /** Резолв URL топ-трека (asset:// поверх файла кэша). Может занять секунды
   *  и может бросить — оба случая канал переживает молча. */
  resolve: () => Promise<string>;
  pausePlayer: () => void;
  resumePlayer: () => void;
  /** Свежее состояние основного плеера (не снапшот на момент start). */
  isPlayerPlaying: () => boolean;
  /** Фабрика элемента: тестам — стаб, приложению — дефолт (скрытый <audio>
   *  в DOM, виден в инспекторе/CDP как audio[data-muza-ambient]). */
  createAudio?: () => HTMLAudioElement;
}

function defaultCreateAudio(): HTMLAudioElement {
  const el = new Audio();
  el.preload = "auto";
  el.style.display = "none";
  el.dataset.muzaAmbient = "wrapped";
  document.body.appendChild(el);
  return el;
}

export class WrappedAmbient {
  private el: HTMLAudioElement | null = null;
  /** Токен актуальности start(): резолв, добежавший после stop()/нового
   *  start(), не имеет права заводить звук. */
  private session = 0;
  private active = false;
  private wasPlaying = false;
  private vol = 20;
  /** Множитель фейда 0..1 поверх ambientGain(vol). */
  private fadeLevel = 0;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: WrappedAmbientDeps) {}

  /** Запустить эмбиент; volume — позиция слайдера 0..100. Плеер ставится на
   *  паузу немедленно: «тихая комната» оверлея не должна ждать добычу. */
  start(volume: number): void {
    this.vol = volume;
    this.session++;
    const session = this.session;
    this.active = true;
    this.wasPlaying = this.deps.isPlayerPlaying();
    if (this.wasPlaying) this.deps.pausePlayer();
    this.deps.resolve().then(
      (url) => {
        if (this.session !== session || !this.active) {
          // уже закрыли/перезапустили — молча, но в dev след оставляем:
          // «эмбиент не заиграл» без этого лога не расследуется (репро 16.07)
          if (import.meta.env?.DEV) console.debug("[wrapped ambient] резолв отброшен: сессия устарела");
          return;
        }
        const el = (this.el ??= (this.deps.createAudio ?? defaultCreateAudio)());
        el.loop = true; // история может длиться дольше трека — фон не обрывается
        el.src = url;
        this.fadeLevel = 0;
        this.apply();
        // Провал play() (автоплей-политика вне Tauri) — тот же класс, что
        // ошибка резолва: молча без звука.
        void el.play().catch(() => undefined);
        this.fadeTo(1, AMBIENT_FADE_IN_MS);
      },
      (e) => {
        // ошибка резолва — оверлей живёт без звука; в dev причину видно
        if (import.meta.env?.DEV) console.debug("[wrapped ambient] резолв не удался:", e);
      },
    );
  }

  /** Громкость слайдера 0..100; действует сразу, фейды масштабируются. */
  setVolume(v: number): void {
    this.vol = v;
    this.apply();
  }

  /** Погасить канал и вернуть основной плеер (если возвращать есть что). */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.session++;
    const finish = () => {
      if (this.el) {
        this.el.pause();
        this.el.removeAttribute("src");
        this.el.load(); // реально освободить файл кэша, не просто «пауза»
      }
      if (this.wasPlaying && !this.deps.isPlayerPlaying()) this.deps.resumePlayer();
      this.wasPlaying = false;
    };
    if (this.el && this.el.src) {
      this.fadeTo(0, AMBIENT_FADE_OUT_MS, finish);
    } else {
      finish(); // звук так и не стартовал — возвращаем плеер сразу
    }
  }

  private apply(): void {
    if (this.el) this.el.volume = ambientGain(this.vol) * this.fadeLevel;
  }

  /** Линейная рампа fadeLevel к target за ms; onDone — по завершении. */
  private fadeTo(target: number, ms: number, onDone?: () => void): void {
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    const from = this.fadeLevel;
    const delta = target - from;
    if (delta === 0 || ms <= 0) {
      this.fadeLevel = target;
      this.apply();
      onDone?.();
      return;
    }
    const startedAt = Date.now();
    this.fadeTimer = setInterval(() => {
      const t = Math.min(1, (Date.now() - startedAt) / ms);
      this.fadeLevel = from + delta * t;
      this.apply();
      if (t >= 1 && this.fadeTimer !== null) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        onDone?.();
      }
    }, FADE_STEP_MS);
  }
}
