/** Звуковой тракт веба: уровни слотов плеера, 10-полосный эквалайзер и
 *  выравнивание громкости.
 *
 *  Было (до 2026-08-02): один <audio> и цепь только под эквалайзер. Стало: у
 *  плеера ДВА слота (player.tsx), и этот файл обслуживает оба — иначе нечем
 *  сделать кроссфейд и переход без паузы: они по определению требуют, чтобы
 *  два трека одновременно звучали с разными уровнями.
 *
 *  ДВА РЕЖИМА УРОВНЯ, и это не про красоту, а про риск. Web Audio-цепь
 *  строится ТОЛЬКО когда включён эквалайзер: MediaElementSource без
 *  CORS-чистого источника молча даёт тишину, и платить этим риском за фейды
 *  нельзя. Пока цепи нет, уровень слота — обычный `el.volume` (кроссфейд и
 *  выравнивание работают и так, только тише единицы: громкость элемента не
 *  умеет усиливать). Есть цепь — уровень идёт через гейн слота, и тихий трек
 *  можно ПОДНЯТЬ. Ровно так же устроен движок приложения: режимы webaudio и
 *  plain в apps/desktop/src/player/audioEngine.ts.
 *
 *  Требования к элементу: crossOrigin="anonymous" ДО первой загрузки (иначе
 *  MediaElementSource молча даёт тишину — гоча из десктопа), и сервер обязан
 *  отдавать CORS на /stream (muza-server отдаёт, CORS глобальный). Цепь на
 *  элемент создаётся ОДИН раз и не разбирается — MediaElementSource необратим;
 *  выключенный эквалайзер = все полосы в 0 дБ (biquad с gain 0 прозрачен). */

const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** И5-веб (2026-07-22): ключи EQ_PRESETS (рус. слова) — ПЕРСИСТЕНТНЫЕ значения
 *  prefs.eqPreset (localStorage), разделяемые форматом с desktop-эквивалентом
 *  (apps/desktop/src/views/SettingsView.tsx:1075). Сознательно НЕ переведены —
 *  та же договорённость, что у десктопа (переименование сломало бы уже
 *  сохранённые prefs обоих клиентов). "Свой" в settings/page.tsx — того же
 *  рода персистентное значение, тоже нетронуто. */
export const EQ_PRESETS: Record<string, number[]> = {
  Ровный: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Бас: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Рок: [5, 4, 2, 0, -1, 0, 2, 3, 4, 4],
  Поп: [-1, 0, 2, 4, 5, 4, 2, 0, -1, -1],
  Вокал: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
};

/** Целевая громкость выравнивания (стриминговый стандарт, как в приложении). */
const TARGET_LUFS = -14;

const dbToLin = (db: number) => Math.pow(10, db / 20);

/** Множитель выравнивания громкости трека: приводим измеренную сервером
 *  громкость (EBU R128, LUFS) к общей цели. Не измерена или выключено — 1
 *  (трек звучит как есть). Границы ±12 дБ — те же, что у приложения: без них
 *  один битый замер сделал бы трек оглушительным. */
export function normFactor(loudness: number | null, enabled: boolean): number {
  if (!enabled || loudness === null) return 1;
  return dbToLin(Math.max(-12, Math.min(12, TARGET_LUFS - loudness)));
}

let ctx: AudioContext | null = null;
let filters: BiquadFilterNode[] = [];
/** Гейн на каждый подключённый к цепи элемент (слот плеера). */
const gains = new Map<HTMLAudioElement, GainNode>();

/** Построить общую часть цепи (полосы + лимитер + выход). Один раз на вкладку. */
function buildShared(): boolean {
  if (ctx) return true;
  try {
    const c = new AudioContext();
    filters = EQ_FREQS.map((freq, i) => {
      const f = c.createBiquadFilter();
      f.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
      f.frequency.value = freq;
      f.Q.value = 1.0;
      f.gain.value = 0;
      return f;
    });
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    // Лимитер в конце (паритет с десктопом, ресёрч отчёт #9): буст полос без него
    // клиппит на выходе. DynamicsCompressor как страховка (не true-peak).
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    filters[filters.length - 1].connect(limiter);
    limiter.connect(c.destination);
    ctx = c;
    return true;
  } catch {
    ctx = null;
    filters = [];
    return false;
  }
}

/** Подключить слот к цепи (однократно на элемент). false — не вышло (нет
 *  CORS/жеста): звук остаётся нетронутым, уровень пойдёт через el.volume.
 *
 *  ⚠️ После успешного подключения el.volume больше не источник истины —
 *  вызывающий обязан заново применить уровень через setSlotLevel. */
export function ensureChain(el: HTMLAudioElement): boolean {
  if (gains.has(el)) {
    void ctx?.resume().catch(() => undefined);
    return true;
  }
  if (!buildShared() || !ctx) return false;
  try {
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    // Стартовый уровень — тот, что уже стоял на элементе: подключение цепи не
    // должно менять громкость играющего трека.
    gain.gain.value = el.volume;
    source.connect(gain);
    gain.connect(filters[0]);
    gains.set(el, gain);
    void ctx.resume().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Уровень слота: цепь есть — гейн (умеет усиливать выше единицы), нет —
 *  громкость элемента (клампим, усилить нечем).
 *
 *  Гейн ставится не присвоением, а короткой экспонентой: кроссфейд шагает
 *  таймером каждые 20 мс, и мгновенные скачки параметра дают щелчки. */
export function setSlotLevel(el: HTMLAudioElement, level: number): void {
  const gain = gains.get(el);
  const safe = Math.max(0, level);
  if (gain && ctx) gain.gain.setTargetAtTime(safe, ctx.currentTime, 0.01);
  else el.volume = Math.min(1, safe);
}

/** Применить полосы (дБ −12..+12); off = все нули (прозрачно). */
export function setEqBands(bands: number[], on: boolean): void {
  if (!filters.length) return;
  filters.forEach((f, i) => {
    f.gain.value = on ? Math.max(-12, Math.min(12, bands[i] ?? 0)) : 0;
  });
}

export function eqAttached(): boolean {
  return gains.size > 0;
}

/** Спит ли цепь. true — контекст есть, но не в состоянии `running`, и тогда
 *  МОЛЧАТ ОБА СЛОТА: после createMediaElementSource звук элемента идёт только
 *  через граф, мимо колонок. Цепи нет вовсе — false: там уровень несёт
 *  el.volume, и усыпить нечего. */
export function chainAsleep(): boolean {
  return ctx !== null && ctx.state !== "running";
}

/** Разбудить цепь.
 *
 *  ⚠️ ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ, если resume() уже есть внутри ensureChain.
 *  ensureChain зовут ровно два места, и оба — про ЖЕСТ человека: тумблер
 *  эквалайзера и клик по треку. Автопереход на следующий трек жестом не
 *  является и не звал НИКОГО — а контекст к этому моменту мог уснуть
 *  (переключение устройства вывода, прерывание в Safari/iOS, выгрузка вкладки
 *  из памяти). Получалась ровно жалоба 12.08: полоска идёт, звука нет, лечится
 *  повторным нажатием play — то есть жестом, который наконец звал resume.
 *  Разблокировка контексту уже не нужна: первый жест в сессии её выдал. */
export function resumeChain(): void {
  if (ctx && ctx.state !== "running") void ctx.resume().catch(() => undefined);
}
