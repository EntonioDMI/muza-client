/** Визуализатор (Stage 6, встроенное расширение): canvas в такт музыке.
 *  Источник — AnalyserNode движка (конец Web Audio-цепи: сигнал как слышит
 *  юзер). Демо-треки и plain-режим без графа — анализатора нет, канвас
 *  честно пуст. Режимы: бары (спектр) и волна (time-domain).
 *
 *  Авто-gain (T14): на тихих треках сырой байт getByteFrequencyData еле
 *  шевелится — держим скользящий максимум (~5с, экспоненциальный конверт,
 *  не буфер сэмплов) и делим на него, так тихий трек раскачивает визуализатор
 *  почти как громкий. Пол максимума (GAIN_FLOOR) не даёт полной тишине
 *  раздувать шум мимо usable-диапазона. Гейн считается от максимума ПРОШЛОГО
 *  кадра (лаг в 1 кадр, ~16мс — незаметно), это позволяет обновлять и
 *  применять его за один проход без двойного чтения analyser-данных. */

import { useEffect, useRef } from "react";

const BAR_COUNT = 56;
/** Верхние ~40% спектра почти всегда пусты у музыки — не тратим на них бары. */
const SPECTRUM_PART = 0.6;
/** «Пол» скользящего максимума (0..1 от 255) — полная тишина не раздувает шум. */
const GAIN_FLOOR = 24 / 255;
/** Характерное время спада скользящего максимума (окно авто-gain). */
const GAIN_WINDOW_SEC = 5;

export function Visualizer({
  mode,
  active,
  getAnalyser,
  style,
}: {
  mode: "bars" | "wave";
  /** false — цикл не крутится (оверлей закрыт/пауза не мешает — рисуем хвост). */
  active: boolean;
  getAnalyser: () => AnalyserNode | null;
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
    const freq = new Uint8Array(1024);
    const wave = new Uint8Array(2048);
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
        analyser.getByteFrequencyData(freq);
        const usable = Math.floor(freq.length * SPECTRUM_PART);
        const step = usable / BAR_COUNT;
        const gap = Math.max(2 * dpr, w / BAR_COUNT / 6);
        const bw = (w - gap * (BAR_COUNT - 1)) / BAR_COUNT;
        ctx.fillStyle = accent;
        for (let i = 0; i < BAR_COUNT; i++) {
          // максимум в корзине — живее среднего
          let peak = 0;
          for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) {
            if (freq[j] > peak) peak = freq[j];
          }
          const raw = peak / 255;
          if (raw > framePeak) framePeak = raw;
          const norm = Math.min(1, raw * gain);
          const bh = Math.max(2 * dpr, norm * h);
          const x = i * (bw + gap);
          ctx.globalAlpha = 0.28 + norm * 0.5;
          ctx.beginPath();
          ctx.roundRect(x, h - bh, bw, bh, bw / 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        analyser.getByteTimeDomainData(wave);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 2 * dpr;
        ctx.lineJoin = "round";
        ctx.beginPath();
        const mid = h / 2;
        for (let i = 0; i < wave.length; i++) {
          const dev = (wave[i] - 128) / 128; // -1..1
          const adev = Math.abs(dev);
          if (adev > framePeak) framePeak = adev;
          const devGained = Math.max(-1, Math.min(1, dev * gain));
          const x = (i / (wave.length - 1)) * w;
          const y = mid + devGained * (h / 2 - 2 * dpr);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
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
  }, [mode, active]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ display: "block", width: "100%", height: "100%", ...style }} />;
}
