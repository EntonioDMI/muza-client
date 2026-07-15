/** Визуализатор (Stage 6, встроенное расширение): canvas в такт музыке.
 *  Источник — AnalyserNode движка (конец Web Audio-цепи: сигнал как слышит
 *  юзер). Демо-треки и plain-режим без графа — анализатора нет, канвас
 *  честно пуст. Режимы: бары (спектр) и волна (time-domain).
 *
 *  Раскладка бинов по барам, зеркало и сглаживание волны — в `visualizerMath`
 *  (чистые функции, юнит-тесты без canvas). Здесь только рисование и авто-gain.
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
 *  «самый громкий из показанных бинов», просто бины теперь разложены по барам
 *  логарифмически. Самый громкий бин у музыки всё равно в басах и попадает в
 *  шкалу в обоих случаях, поэтому runningMax тот же. Бин 0 (DC-смещение, не
 *  звук) из шкалы ушёл — постоянная составляющая больше не может раздуть гейн.
 *  Пик берётся по ПОЛОСАМ, а не по барам: с зеркалом бар читает полосу дважды,
 *  и максимум от этого не меняется. */

import { useEffect, useRef } from "react";
import { bandCount, bandIndexForBar, barBands, waveShape, type Band } from "./visualizerMath";

/** «Пол» скользящего максимума (0..1 от 255) — полная тишина не раздувает шум. */
const GAIN_FLOOR = 24 / 255;
/** Характерное время спада скользящего максимума (окно авто-gain). */
const GAIN_WINDOW_SEC = 5;
/** Примерно столько CSS-пикселей на точку волны: меньше точек — мягче линия,
 *  но угловатее на широком экране. 8px ≈ незаметный глазу шаг. */
const WAVE_PX_PER_POINT = 8;
const WAVE_MIN_POINTS = 32;
const WAVE_MAX_POINTS = 256;

export function Visualizer({
  mode,
  active,
  getAnalyser,
  barCount = 56,
  mirror = false,
  waveSmooth = 0.6,
  style,
}: {
  mode: "bars" | "wave";
  /** false — цикл не крутится (оверлей закрыт/пауза не мешает — рисуем хвост). */
  active: boolean;
  getAnalyser: () => AnalyserNode | null;
  /** Число баров (преф «Плотность баров»). */
  barCount?: number;
  /** Зеркальный спектр: низы в центре, верхи по краям (преф). */
  mirror?: boolean;
  /** Сглаживание волны 0..1 (преф): 0 — сырая пила, 1 — мягкая линия. */
  waveSmooth?: number;
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

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // цвет из токена: canvas не умеет var() — читаем computed
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#3b82f6";
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
    const bandPeak: number[] = [];
    // Скользящий максимум авто-gain (нормализовано 0..1, где 1 = байт 255).
    let runningMax = GAIN_FLOOR;
    let lastT = performance.now();

    const draw = () => {
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

      const now = performance.now();
      const dt = Math.min(0.25, Math.max(0, (now - lastT) / 1000));
      lastT = now;
      // Гейн — от максимума ПРОШЛОГО кадра (лаг ~16мс, незаметно): позволяет
      // применить его и параллельно накопить пик текущего кадра за один проход.
      const gain = 1 / runningMax;
      let framePeak = 0;

      if (mode === "bars") {
        const bins = analyser.frequencyBinCount;
        if (!freq || freq.length !== bins) freq = new Uint8Array(bins);
        analyser.getByteFrequencyData(freq);

        const nBands = bandCount(barCount, mirror);
        const key = `${nBands}:${bins}:${analyser.context.sampleRate}`;
        if (key !== bandsKey) {
          bands = barBands(nBands, bins, analyser.context.sampleRate);
          bandsKey = key;
        }

        // Пик по полосам — каждый бин смотрим один раз (с зеркалом бар читает
        // полосу дважды, максимум от этого не меняется).
        for (let b = 0; b < nBands; b++) {
          const band = bands[b];
          let peak = 0;
          for (let j = band.lo; j < band.hi; j++) {
            if (freq[j] > peak) peak = freq[j];
          }
          const raw = peak / 255;
          bandPeak[b] = raw;
          if (raw > framePeak) framePeak = raw;
        }

        const gap = Math.max(2 * dpr, w / barCount / 6);
        const bw = (w - gap * (barCount - 1)) / barCount;
        ctx.fillStyle = accent;
        for (let i = 0; i < barCount; i++) {
          const norm = Math.min(1, bandPeak[bandIndexForBar(i, barCount, mirror)] * gain);
          const bh = Math.max(2 * dpr, norm * h);
          const x = i * (bw + gap);
          ctx.globalAlpha = 0.28 + norm * 0.5;
          ctx.beginPath();
          ctx.roundRect(x, h - bh, bw, bh, bw / 2);
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
        const pts = waveShape(wave, points, waveSmooth);

        // Пик берём с УЖЕ сглаженной волны — с того, что реально нарисовано:
        // иначе сильное сглаживание ужимало бы линию, а гейн этого не замечал.
        // «Тишина не раздувает шум» держится: 0 × любой гейн = 0.
        for (let i = 0; i < pts.length; i++) {
          const a = Math.abs(pts[i]);
          if (a > framePeak) framePeak = a;
        }

        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 2 * dpr;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        const mid = h / 2;
        const amp = h / 2 - 2 * dpr;
        const xAt = (i: number) => (i / (pts.length - 1)) * w;
        const yAt = (i: number) => mid + Math.max(-1, Math.min(1, pts[i] * gain)) * amp;

        ctx.beginPath();
        ctx.moveTo(xAt(0), yAt(0));
        // Квадратичные кривые через середины отрезков: узлы становятся
        // контрольными точками, излом на каждой точке пропадает — это то, что
        // отличает «мягкую волну» от полилинии даже при одинаковых данных.
        for (let i = 1; i < pts.length; i++) {
          const xc = (xAt(i - 1) + xAt(i)) / 2;
          const yc = (yAt(i - 1) + yAt(i)) / 2;
          ctx.quadraticCurveTo(xAt(i - 1), yAt(i - 1), xc, yc);
        }
        ctx.lineTo(xAt(pts.length - 1), yAt(pts.length - 1));
        ctx.stroke();
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
    draw();
    return () => cancelAnimationFrame(raf);
  }, [mode, active, barCount, mirror, waveSmooth]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ display: "block", width: "100%", height: "100%", ...style }} />;
}
