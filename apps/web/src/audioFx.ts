/** Эквалайзер веба: Web Audio-цепь поверх `<audio>` (лёгкая версия десктопного
 *  audioEngine — только 10-полосный EQ, без кроссфейда/нормализации).
 *
 *  Требования: элементу нужен crossOrigin="anonymous" ДО первой загрузки
 *  (иначе MediaElementSource молча даёт тишину — гоча из десктопа), а сервер
 *  должен отдавать CORS на /stream (muza-server отдаёт, CORS глобальный).
 *  Цепь создаётся ОДИН раз и только по явному включению EQ (жест пользователя
 *  → AudioContext разрешён); выключенный EQ = все полосы в 0 дБ (biquad с
 *  gain 0 прозрачен), цепь не разбирается — MediaElementSource необратим. */

const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: Record<string, number[]> = {
  Ровный: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Бас: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Рок: [5, 4, 2, 0, -1, 0, 2, 3, 4, 4],
  Поп: [-1, 0, 2, 4, 5, 4, 2, 0, -1, -1],
  Вокал: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
};

let ctx: AudioContext | null = null;
let filters: BiquadFilterNode[] = [];
let attachedTo: HTMLAudioElement | null = null;

/** Построить цепь (однократно). false — не вышло (нет CORS/жеста), звук
 *  остаётся нетронутым, EQ честно недоступен. */
export function ensureEq(el: HTMLAudioElement): boolean {
  if (attachedTo === el && ctx) {
    void ctx.resume().catch(() => undefined);
    return true;
  }
  if (attachedTo) return false; // цепь уже на другом элементе — не бывает, но честно
  try {
    ctx = new AudioContext();
    const source = ctx.createMediaElementSource(el);
    filters = EQ_FREQS.map((freq, i) => {
      const f = ctx!.createBiquadFilter();
      f.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
      f.frequency.value = freq;
      f.Q.value = 1.0;
      f.gain.value = 0;
      return f;
    });
    let node: AudioNode = source;
    for (const f of filters) {
      node.connect(f);
      node = f;
    }
    // Лимитер в конце (паритет с десктопом, ресёрч отчёт #9): буст полос без него
    // клиппит на выходе. DynamicsCompressor как страховка (не true-peak).
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    node.connect(limiter);
    limiter.connect(ctx.destination);
    attachedTo = el;
    void ctx.resume().catch(() => undefined);
    return true;
  } catch {
    ctx = null;
    filters = [];
    return false;
  }
}

/** Применить полосы (дБ −12..+12); off = все нули (прозрачно). */
export function setEqBands(bands: number[], on: boolean): void {
  if (!filters.length) return;
  filters.forEach((f, i) => {
    f.gain.value = on ? Math.max(-12, Math.min(12, bands[i] ?? 0)) : 0;
  });
}

export function eqAttached(): boolean {
  return attachedTo !== null;
}
