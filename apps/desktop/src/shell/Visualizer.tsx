/** Визуализатор (Stage 6, встроенное расширение): canvas в такт музыке.
 *  Источник — AnalyserNode движка (конец Web Audio-цепи: сигнал как слышит
 *  юзер). Демо-треки и plain-режим без графа — анализатора нет, канвас
 *  честно пуст. Режимы: бары (спектр) и волна (time-domain).
 *
 *  Математика (раскладка бинов, зеркало, сглаживание, инерция, геометрия,
 *  диапазоны ручек) — в `visualizerMath` (чистые функции, юнит-тесты без
 *  canvas). Здесь только рисование, авто-gain и жизненный цикл rAF-цикла.
 *
 *  Ручки (T50) приезжают одним объектом `tuning` и живут в ref: цикл на их
 *  смену НЕ перезапускается — новые значения подхватываются на следующем же
 *  кадре (ползунки настроек крутятся «живьём»), а конверты (авто-gain,
 *  инерция) не сбрасываются. До T50 смена плотности баров перезапускала
 *  эффект и роняла скользящий максимум — после каждого движения ползунка
 *  тихий трек раскачивался заново ~5 секунд.
 *
 *  Волна (T50) рисуется слоями по одному Path2D: широкое тихое «эхо» →
 *  полупрозрачная заливка к центру (тело) → ядро переменной толщины.
 *  Свечение сделано эхом, НЕ shadowBlur: гауссово размытие на канвасе во всю
 *  ширину окна в WebView2 заметно дороже второго прохода по готовому пути.
 *
 *  Reduced-motion: OS «уменьшить анимацию» — жёсткий выключатель (прецедент
 *  bassShake: сильнее любых префов): цикл не крутится, канвас пустой; смена
 *  настройки OS подхватывается на лету change-листенером.
 *
 *  Авто-gain (T14): на тихих треках сырой байт getByteFrequencyData еле
 *  шевелится — держим скользящий максимум (~5с, экспоненциальный конверт,
 *  не буфер сэмплов) и делим на него, так тихий трек раскачивает визуализатор
 *  почти как громкий. Пол максимума (GAIN_FLOOR) не даёт полной тишине
 *  раздувать шум мимо usable-диапазона. Гейн считается от максимума ПРОШЛОГО
 *  кадра (лаг в 1 кадр, ~16мс — незаметно), это позволяет обновлять и
 *  применять его за один проход без двойного чтения analyser-данных.
 *
 *  Авто-gain и лог-шкала (T48) не мешают друг другу: `framePeak` как и раньше
 *  «самый громкий из показанных бинов», просто бины разложены по барам
 *  логарифмически. Бин 0 (DC-смещение, не звук) из шкалы ушёл — постоянная
 *  составляющая не может раздуть гейн. Пик берётся по ПОЛОСАМ, а не по барам
 *  (с зеркалом бар читает полосу дважды — максимум не меняется), и с T50 —
 *  с ОГИБАЮЩЕЙ, а не сырой цели: гейн обязан видеть ровно то, что рисуется,
 *  иначе инерция ужимала бы картинку незаметно для него. */

import { useEffect, useRef } from "react";
import {
  bandCount,
  bandIndexForBar,
  barBands,
  barGeometry,
  calmTau,
  fallBars,
  glideWave,
  normalizeVisualizerTuning,
  smoothingStep,
  waveShape,
  type Band,
  type VisualizerTuning,
} from "./visualizerMath";

/** «Пол» скользящего максимума (0..1 от 255) — полная тишина не раздувает шум. */
const GAIN_FLOOR = 24 / 255;
/** Характерное время спада скользящего максимума (окно авто-gain). */
const GAIN_WINDOW_SEC = 5;
/** Примерно столько CSS-пикселей на точку волны: меньше точек — мягче линия,
 *  но угловатее на широком экране. 8px ≈ незаметный глазу шаг. */
const WAVE_PX_PER_POINT = 8;
const WAVE_MIN_POINTS = 32;
const WAVE_MAX_POINTS = 256;
/** Инерция на максимуме ползунков (сек). Барам спад длиннее волны: они
 *  падают с высоты всей полосы, и короткий хвост читается как дребезг. */
const WAVE_CALM_MAX_TAU = 0.4;
const BAR_FALL_MAX_TAU = 0.7;
/** Толщина ядра волны (CSS px) на краях ползунка «толщина». */
const WAVE_CORE_MIN_PX = 2;
const WAVE_CORE_MAX_PX = 16;
/** Эхо: во сколько раз шире ядра и с какой альфой — «свечение» без blur. */
const WAVE_ECHO_SCALE = 2.6;
const WAVE_ECHO_ALPHA = 0.1;
/** Плотность заливки тела волны при ползунке 100%. */
const WAVE_FILL_ALPHA_MAX = 0.32;
/** Как часто перечитывать --accent: смена темы/акцента подхватывается живьём
 *  (раньше цвет читался один раз на маунт и до перезахода в оверлей висел
 *  старый), а getComputedStyle не дёргается каждый кадр. */
const ACCENT_REFRESH_MS = 500;

/** OS-«уменьшить анимацию», jsdom-safe (без matchMedia считаем «нет»). */
function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)");
  } catch {
    return null;
  }
}

export function Visualizer({
  mode,
  active,
  getAnalyser,
  tuning,
  style,
}: {
  mode: "bars" | "wave";
  /** false — цикл не крутится (оверлей закрыт/пауза не мешает — рисуем хвост). */
  active: boolean;
  getAnalyser: () => AnalyserNode | null;
  /** Ручки вида (проценты, как в Prefs). Отсутствующие/мусорные значения
   *  нормализуются к дефолтам VIS_LIMITS — рендер мусора не боится. */
  tuning?: Partial<VisualizerTuning>;
  style?: React.CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // getAnalyser — новая функция на каждый ре-рендер родителя (usePlayback
  // пересобирает объект при каждом тике pos, несколько раз в секунду). Без
  // этой стабилизации через ref эффект ниже пересоздавался бы вместе с ним,
  // обнуляя скользящий максимум гейна раньше, чем он успевает накопиться
  // за окно ~5с — держим актуальную функцию в ref, эффект от неё не зависит.
  const getAnalyserRef = useRef(getAnalyser);
  useEffect(() => {
    getAnalyserRef.current = getAnalyser;
  }, [getAnalyser]);
  // tuning — тоже новый объект на каждый рендер (App собирает литерал из
  // prefs): тот же приём, эффект без депсов — одно присваивание за рендер.
  const view = normalizeVisualizerTuning(tuning);
  const tuningRef = useRef<VisualizerTuning>(view);
  useEffect(() => {
    tuningRef.current = view;
  });

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    // Размеры буферов знает только analyser (fftSize движка), а он появляется
    // позже маунта — выделяем на первом кадре с данными. Тип с ArrayBuffer
    // явно: getByte*Data не принимает вид на SharedArrayBuffer, а без
    // аннотации вывелся бы более широкий ArrayBufferLike.
    let freq: Uint8Array<ArrayBuffer> | null = null;
    let wave: Uint8Array<ArrayBuffer> | null = null;
    // Лог-границы полос: считаются не каждый кадр, а при смене входных данных.
    let bands: Band[] = [];
    let bandsKey = "";
    const bandTarget: number[] = [];
    // Огибающие (инерция T50). Пересоздание при смене размера + шаг с k=1 —
    // старт ровно с цели, без прыжка от нулей.
    let barEnv = new Float32Array(0);
    let waveEnv = new Float32Array(0);
    // Скользящий максимум авто-gain (нормализовано 0..1, где 1 = байт 255).
    let runningMax = GAIN_FLOOR;
    let lastT = performance.now();
    // цвет из токена: canvas не умеет var() — читаем computed и кэшируем
    let accent = "#3b82f6";
    let accentAt = -Infinity;

    const mql = reducedMotionQuery();
    let reduced = mql?.matches ?? false;

    const draw = () => {
      if (reduced) return; // страховка: в reduced новые кадры не планируются
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      const analyser = getAnalyserRef.current();
      if (!analyser) return; // plain-режим — тишина без данных

      const t = tuningRef.current;
      const now = performance.now();
      const dt = Math.min(0.25, Math.max(0, (now - lastT) / 1000));
      lastT = now;
      if (now - accentAt > ACCENT_REFRESH_MS) {
        accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || accent;
        accentAt = now;
      }
      // Гейн — от максимума ПРОШЛОГО кадра (лаг ~16мс, незаметно): позволяет
      // применить его и параллельно накопить пик текущего кадра за один проход.
      const gain = 1 / runningMax;
      let framePeak = 0;

      if (mode === "bars") {
        const bins = analyser.frequencyBinCount;
        if (!freq || freq.length !== bins) freq = new Uint8Array(bins);
        analyser.getByteFrequencyData(freq);

        const barCount = t.bars;
        const nBands = bandCount(barCount, t.mirror);
        const key = `${nBands}:${bins}:${analyser.context.sampleRate}`;
        if (key !== bandsKey) {
          bands = barBands(nBands, bins, analyser.context.sampleRate);
          bandsKey = key;
        }

        // Цель по полосам — каждый бин смотрим один раз (с зеркалом бар
        // читает полосу дважды, максимум от этого не меняется).
        bandTarget.length = nBands;
        for (let b = 0; b < nBands; b++) {
          const band = bands[b];
          let peak = 0;
          for (let j = band.lo; j < band.hi; j++) {
            if (freq[j] > peak) peak = freq[j];
          }
          bandTarget[b] = peak / 255;
        }

        let kDown = smoothingStep(dt, calmTau(t.barCalm, BAR_FALL_MAX_TAU));
        if (barEnv.length !== nBands) {
          barEnv = new Float32Array(nBands);
          kDown = 1;
        }
        framePeak = fallBars(barEnv, bandTarget, kDown);

        const { slot, bw, pad } = barGeometry(w, barCount, t.barFill);
        const radius = (bw / 2) * (t.barRound / 100);
        ctx.fillStyle = accent;
        for (let i = 0; i < barCount; i++) {
          const norm = Math.min(1, barEnv[bandIndexForBar(i, barCount, t.mirror)] * gain);
          const bh = Math.max(2 * dpr, norm * h);
          ctx.globalAlpha = 0.28 + norm * 0.5;
          ctx.beginPath();
          ctx.roundRect(i * slot + pad, h - bh, bw, bh, radius);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        if (!wave || wave.length !== analyser.fftSize) wave = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(wave);

        const points = Math.max(
          WAVE_MIN_POINTS,
          Math.min(WAVE_MAX_POINTS, Math.round(canvas.clientWidth / WAVE_PX_PER_POINT)),
        );
        const pts = waveShape(wave, points, t.waveSmooth / 100);

        // Инерция формы — главная починка «дёргается» (см. visualizerMath).
        let k = smoothingStep(dt, calmTau(t.waveCalm, WAVE_CALM_MAX_TAU));
        if (waveEnv.length !== points) {
          waveEnv = new Float32Array(points);
          k = 1;
        }
        // Пик — с УЖЕ инерционной волны: гейн видит ровно то, что рисуется.
        // «Тишина не раздувает шум» держится: 0 × любой гейн = 0.
        framePeak = glideWave(waveEnv, pts, k);

        const core = (WAVE_CORE_MIN_PX + ((WAVE_CORE_MAX_PX - WAVE_CORE_MIN_PX) * t.waveThick) / 100) * dpr;
        const mid = h / 2;
        // Запас под толщину: лента и на пике не срезается краем полосы.
        const amp = Math.max(0, mid - core / 2 - dpr) * (t.waveAmp / 100);
        const xAt = (i: number) => (i / (waveEnv.length - 1)) * w;
        const yAt = (i: number) => mid + Math.max(-1, Math.min(1, waveEnv[i] * gain)) * amp;

        // Квадратичные кривые через середины отрезков: узлы становятся
        // контрольными точками, излом на каждой точке пропадает — это то, что
        // отличает «мягкую волну» от полилинии даже при одинаковых данных.
        const path = new Path2D();
        path.moveTo(xAt(0), yAt(0));
        for (let i = 1; i < waveEnv.length; i++) {
          const xc = (xAt(i - 1) + xAt(i)) / 2;
          const yc = (yAt(i - 1) + yAt(i)) / 2;
          path.quadraticCurveTo(xAt(i - 1), yAt(i - 1), xc, yc);
        }
        path.lineTo(xAt(waveEnv.length - 1), yAt(waveEnv.length - 1));

        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = accent;
        ctx.fillStyle = accent;

        // Слой 1 — эхо: широкий тихий след, «свечение» без дорогого blur.
        ctx.globalAlpha = WAVE_ECHO_ALPHA;
        ctx.lineWidth = core * WAVE_ECHO_SCALE;
        ctx.stroke(path);

        // Слой 2 — тело: заливка от линии к центру.
        if (t.waveFill > 0) {
          const body = new Path2D(path);
          body.lineTo(w, mid);
          body.lineTo(0, mid);
          body.closePath();
          ctx.globalAlpha = (WAVE_FILL_ALPHA_MAX * t.waveFill) / 100;
          ctx.fill(body);
        }

        // Слой 3 — ядро.
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = core;
        ctx.stroke(path);
        ctx.globalAlpha = 1;
      }

      // Обновить скользящий максимум для следующего кадра: мгновенный рост
      // на пик, экспоненциальный спад к текущему кадру за GAIN_WINDOW_SEC.
      if (framePeak > runningMax) {
        runningMax = framePeak;
      } else {
        const decay = Math.exp(-dt / GAIN_WINDOW_SEC);
        runningMax = Math.max(GAIN_FLOOR, framePeak + (runningMax - framePeak) * decay);
      }
    };

    // reduced на лету: выключили анимации в OS — канвас гаснет тут же,
    // включили обратно — цикл оживает (draw в reduced-состоянии кадры не
    // планирует, поэтому перезапуск отсюда).
    const onReducedChange = (e: MediaQueryListEvent) => {
      reduced = e.matches;
      if (reduced) {
        cancelAnimationFrame(raf);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        lastT = performance.now();
        draw();
      }
    };
    mql?.addEventListener?.("change", onReducedChange);

    if (reduced) ctx.clearRect(0, 0, canvas.width, canvas.height);
    else draw();

    return () => {
      cancelAnimationFrame(raf);
      mql?.removeEventListener?.("change", onReducedChange);
    };
  }, [mode, active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: "100%", opacity: view.opacity / 100, ...style }}
    />
  );
}
