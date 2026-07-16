/** Математика визуализатора: раскладка бинов FFT по барам, зеркало и
 *  сглаживание волны. Вынесено из `Visualizer.tsx` отдельным чистым модулем —
 *  canvas в юнит-тесте не поднять, а именно здесь живут решения, которые
 *  видит глазом пользователь. Тесты — `visualizerMath.test.ts`.
 *
 *  ПОЧЕМУ ЛОГ-ШКАЛА (это починка, а не вкусовщина). FFT линеен по частоте:
 *  бины 0..N равномерно размазаны по 0..sampleRate/2 (~24 кГц). Раньше бины
 *  делились между барами тоже линейно — и бар №28 из 56 садился на ~7.2 кГц,
 *  где у музыки почти пусто. Энергия сидит в низах-серединах, то есть в первых
 *  процентах бинов → внешние бары стояли мёртвыми. Это ровно то, что владелец
 *  увидел глазами: «первая половина активная, вторая почти не шейкается».
 *  Слух логарифмичен (октава = удвоение частоты), поэтому границы баров идут
 *  по логарифму — так каждый бар получает соизмеримый кусок того, что человек
 *  реально слышит, и оживают ВСЕ бары, а не первая треть. */

export interface Band {
  /** Индекс первого бина полосы (включительно). */
  lo: number;
  /** Индекс за последним бином полосы (исключительно), всегда > lo. */
  hi: number;
}

/** Низ шкалы: ниже 30 Гц музыки нет, а бин 0 — DC-смещение, не звук. */
const F_MIN = 30;
/** Верх шкалы: выше ~16 кГц у музыки (и у взрослых ушей) тишина. */
const F_MAX = 16000;

/** Границы баров по логарифму частоты: `barBands(56, 1024, 48000)`.
 *
 *  Полосы идут встык (`hi` предыдущей = `lo` следующей), ни одна не пуста.
 *  На низах лог даёт дубли (шаг шкалы меньше ширины бина — при fftSize 2048 и
 *  48 кГц бин это 23.4 Гц, а между 30 и 33.6 Гц бина просто нет): такие полосы
 *  схлопываются в один бин, а не выбрасываются — иначе в шкале появились бы
 *  дырки. Нижние бары получают по бину (детальнее физически некуда), лог
 *  перехватывает примерно с 700 Гц и дальше расширяет полосы к верхам.
 *
 *  Вырожденный случай (баров больше, чем бинов) хвост баров делит последний
 *  бин: лучше повтор, чем пустая полоса или выход за спектр. */
export function barBands(barCount: number, binCount: number, sampleRate: number): Band[] {
  const bands: Band[] = [];
  if (barCount <= 0 || binCount <= 0) return bands;

  const nyquist = sampleRate / 2;
  /** Частота → дробный индекс бина (FFT линеен по частоте). */
  const binOf = (f: number) => (f * binCount) / nyquist;
  const fTop = Math.min(F_MAX, nyquist);
  const top = Math.min(binCount, Math.max(2, Math.round(binOf(fTop))));
  const ratio = fTop / F_MIN;

  let lo = Math.min(Math.max(1, Math.floor(binOf(F_MIN))), binCount - 1);
  for (let i = 0; i < barCount; i++) {
    let hi = Math.round(binOf(F_MIN * Math.pow(ratio, (i + 1) / barCount)));
    // Оставить по бину каждому из оставшихся баров — иначе лог-хвост съел бы
    // весь спектр и последние бары остались бы пустыми.
    const reserve = top - (barCount - i - 1);
    if (hi > reserve) hi = reserve;
    if (hi < lo + 1) hi = lo + 1; // схлопнутый дубль на низах
    if (hi > binCount) {
      lo = binCount - 1;
      hi = binCount;
    }
    bands.push({ lo, hi });
    lo = hi;
  }
  return bands;
}

/** Сколько полос спектра нужно на `barCount` баров. С зеркалом вдвое меньше —
 *  каждая полоса рисуется дважды. */
export function bandCount(barCount: number, mirror: boolean): number {
  return mirror ? Math.ceil(barCount / 2) : barCount;
}

/** Какую полосу спектра читает бар `bar`.
 *
 *  Зеркало — ОПЦИЯ ВНЕШНЕГО ВИДА (классический симметричный спектр), а не
 *  починка мёртвых баров: их лечит лог-шкала выше. Низы кладутся в ЦЕНТР,
 *  верхи по краям — так «дышит» середина, где у музыки основная энергия.
 *  Платит за это разрешением: полос вдвое меньше при том же числе баров. */
export function bandIndexForBar(bar: number, barCount: number, mirror: boolean): number {
  if (!mirror) return bar;
  if (barCount % 2 === 0) {
    const half = barCount / 2;
    return bar < half ? half - 1 - bar : bar - half;
  }
  return Math.abs(bar - (barCount - 1) / 2);
}

// ────────────────────────────────────────────────────────────────────────────
// Ручки визуализатора (T50): диапазоны, дефолты, нормализация.

/** Диапазоны и дефолты ползунков — одна точка правды для настроек
 *  (SettingsView), рендера (Visualizer) и пресетов (lib/visualizerPresets).
 *  Дефолты продублированы литералами в DEFAULT_PREFS (types.ts) — расхождение
 *  ловит тест «дефолты согласованы». */
export const VIS_LIMITS = {
  /** Плотность баров, штук: ниже 24 спектр не читается как спектр, выше 96
   *  бары тоньше зазора — каша (диапазон T48, переехал из SettingsView). */
  bars: { min: 24, max: 96, def: 56 },
  /** Ширина бара, % слота: 100 — сплошная лента. Дефолт 84 ≈ прежний зазор
   *  slot/6 — вид «как было» с точностью до долей пикселя. */
  barFill: { min: 30, max: 100, def: 84 },
  /** Скругление, % от половины ширины: 0 — прямоугольники, 100 — пилюли
   *  (прежний вид). */
  barRound: { min: 0, max: 100, def: 100 },
  /** Плавность спада баров: 0 — сырой кадр (как было), 100 — тягучее падение.
   *  Дефолт 30 — лёгкая доводка «все виды красивее» (задание T50). */
  barCalm: { min: 0, max: 100, def: 30 },
  /** Пространственное сглаживание волны вдоль X (ФНЧ, см. waveShape). */
  waveSmooth: { min: 0, max: 100, def: 60 },
  /** Межкадровая инерция волны — главное лекарство от «дёргается». */
  waveCalm: { min: 0, max: 100, def: 60 },
  /** Толщина ядра волны: 0 — прежняя нитка 2px, 100 — плотная лента. */
  waveThick: { min: 0, max: 100, def: 45 },
  /** Заливка от линии к центру: тело волны. 0 — только линия (как было). */
  waveFill: { min: 0, max: 100, def: 45 },
  /** Размах волны, % высоты её полосы. */
  waveAmp: { min: 25, max: 150, def: 100 },
  /** Насыщенность канваса на сцене; раньше жёсткие 50 в ListeningMode. */
  opacity: { min: 15, max: 100, def: 50 },
} as const;

export type VisLimitKey = keyof typeof VIS_LIMITS;

/** Все ручки одним объектом — то, что течёт из Prefs через ListeningMode в
 *  рендер. Числа в пользовательских единицах (как в Prefs, обычно %). */
export interface VisualizerTuning extends Record<VisLimitKey, number> {
  mirror: boolean;
}

/** Кламп одного значения: в диапазоне — округляется до целого, за диапазоном —
 *  граница, мусор (NaN/Infinity/не-число) — дефолт, а НЕ граница: prefs пишут
 *  не только ползунки (плагины, localStorage руками), и криво записанное не
 *  должно ни ронять рендер, ни прилипать к краю диапазона. */
export function visClamp(key: VisLimitKey, value: unknown): number {
  const { min, max, def } = VIS_LIMITS[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return def;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Сырые пропсы → полный набор ручек с гарантированными диапазонами. */
export function normalizeVisualizerTuning(raw?: Partial<VisualizerTuning>): VisualizerTuning {
  const out = {} as VisualizerTuning;
  for (const key of Object.keys(VIS_LIMITS) as VisLimitKey[]) out[key] = visClamp(key, raw?.[key]);
  out.mirror = raw?.mirror === true;
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Межкадровая инерция (T50).
//
// ПОЧЕМУ ИМЕННО ОНА ЧИНИТ «дёргается при любых настройках»: time-domain срез
// (getByteTimeDomainData) каждый кадр — целиком новый кусок сигнала (окно
// 43 мс сдвигается на ~800 сэмплов между кадрами 60 Гц), поэтому форма
// прыгала с частотой кадров. smoothingTimeConstant анализатора волну НЕ
// сглаживает — он действует только на частотные данные (баров это и
// спасало). Пространственный ползунок «мягкости» (waveShape) сглаживает
// вдоль X и межкадровый прыжок не лечит в принципе.
//
// Инерция — экспоненциальное приближение к цели с постоянной времени tau:
// кадронезависимо (два шага по dt/2 = один шаг по dt — тест держит),
// без буфера истории, один Float32Array состояния.

/** Доля пути к цели за кадр длиной dt (сек) при постоянной времени tau. */
export function smoothingStep(dt: number, tau: number): number {
  if (tau <= 0) return 1;
  return 1 - Math.exp(-dt / tau);
}

/** Ползунок «плавности» 0..100 → постоянная времени 0..maxTau (сек), линейно:
 *  0 — сырое покадровое (инерции нет), 100 — максимум тягучести. */
export function calmTau(calm: number, maxTau: number): number {
  return (Math.min(100, Math.max(0, calm)) / 100) * maxTau;
}

/** Шаг инерции волны: state ← state + (target − state)·k, по месту, симметрично
 *  (волна и растёт, и опадает плавно — асимметрия тут читалась бы как рывки
 *  вверх). Возвращает пик |state| ПОСЛЕ шага: авто-gain обязан считаться с
 *  того, что реально нарисовано, — инерция ужимает движение, и не видящий
 *  этого гейн недокачивал бы тихие треки. Длины равны — за пересоздание при
 *  смене числа точек отвечает вызывающий код (свежий state + k=1 = старт с
 *  цели без прыжка). */
export function glideWave(state: Float32Array, target: Float32Array, k: number): number {
  let peak = 0;
  for (let i = 0; i < state.length; i++) {
    const v = state[i] + (target[i] - state[i]) * k;
    state[i] = v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  return peak;
}

/** Шаг огибающей баров: атака МГНОВЕННАЯ (удар виден в тот же кадр — это
 *  ритм), спад — на долю kDown за кадр (классика анализаторов: плавное
 *  падение убирает мельтешение, не размазывая бит). Возвращает пик state —
 *  тем же проходом, что и раньше пик по полосам. */
export function fallBars(state: Float32Array, target: ArrayLike<number>, kDown: number): number {
  let peak = 0;
  for (let i = 0; i < state.length; i++) {
    const t = target[i];
    const v = t >= state[i] ? t : state[i] + (t - state[i]) * kDown;
    state[i] = v;
    if (v > peak) peak = v;
  }
  return peak;
}

/** Геометрия баров: слот = width/count, бар занимает fill% слота по центру
 *  (поля симметричны), но не тоньше 1px — иначе на узком канвасе с высокой
 *  плотностью бары исчезали бы совсем. */
export function barGeometry(width: number, count: number, fillPct: number): { slot: number; bw: number; pad: number } {
  if (width <= 0 || count <= 0) return { slot: 0, bw: 0, pad: 0 };
  const slot = width / count;
  const bw = Math.min(slot, Math.max(1, (slot * Math.min(100, Math.max(0, fillPct))) / 100));
  return { slot, bw, pad: (slot - bw) / 2 };
}

/** Форма волны для отрисовки: `points` значений в −1..1 из сырых байтов
 *  `getByteTimeDomainData` (128 = ноль).
 *
 *  ПОЧЕМУ ЭТО НУЖНО. Раньше полилиния шла по ВСЕМ 2048 сэмплам подряд —
 *  а это 43 мс сигнала, где верхов десятки периодов. Рисовалась не волна, а
 *  шумовая пила: `lineTo` на каждый сэмпл честно передавал частоту Найквиста.
 *
 *  Сглаживание — ЦЕНТРИРОВАННОЕ скользящее среднее, то есть честный ФНЧ с
 *  нулевой групповой задержкой: пила срезается, форма низов и сама фаза
 *  остаются на месте (одностороннее окно сдвинуло бы волну вбок). Радиус
 *  окна привязан к шагу прореживания, поэтому `smooth` читается одинаково
 *  при любом числе точек: 0 — сырое прореживание (как было), 1 — окно в
 *  соседние точки целиком.
 *
 *  Усреднять сэмплы сырой волны опасно и потому окно НЕ шире шага: на широком
 *  окне плюсы и минусы периода взаимно сократятся и волна схлопнется в линию.
 *  Тест «не съедает пики» держит эту границу. */
export function waveShape(samples: Uint8Array, points: number, smooth: number): Float32Array {
  const out = new Float32Array(Math.max(0, points));
  const len = samples.length;
  if (len === 0 || points <= 0) return out; // нет данных — честный ноль, не шум

  const bucket = points > 1 ? (len - 1) / (points - 1) : len - 1;
  const radius = Math.max(0, Math.min(1, smooth)) * bucket;

  for (let p = 0; p < points; p++) {
    const c = p * bucket;
    let lo = Math.ceil(c - radius);
    let hi = Math.floor(c + radius);
    // Окно уже одного сэмпла (smooth≈0) — берём ближайший: прореживание.
    if (lo > hi) lo = hi = Math.round(c);
    if (lo < 0) lo = 0;
    if (hi > len - 1) hi = len - 1;

    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += samples[i];
    const dev = (sum / (hi - lo + 1) - 128) / 128;
    out[p] = dev < -1 ? -1 : dev > 1 ? 1 : dev;
  }
  return out;
}
