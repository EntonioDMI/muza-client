/** Визуализатор (Stage 6, встроенное расширение): canvas в такт музыке.
 *  Источник — AnalyserNode движка (конец Web Audio-цепи: сигнал как слышит
 *  юзер). Демо-треки и plain-режим без графа — анализатора нет, канвас
 *  честно пуст. Режимы: бары (спектр) и волна (time-domain). */

import { useEffect, useRef } from "react";

const BAR_COUNT = 56;
/** Верхние ~40% спектра почти всегда пусты у музыки — не тратим на них бары. */
const SPECTRUM_PART = 0.6;

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
      const analyser = getAnalyser();
      if (!analyser) return; // демо/plain — тишина без данных

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
          const bh = Math.max(2 * dpr, (peak / 255) * h);
          const x = i * (bw + gap);
          ctx.globalAlpha = 0.28 + (peak / 255) * 0.5;
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
          const x = (i / (wave.length - 1)) * w;
          const y = mid + ((wave[i] - 128) / 128) * (h / 2 - 2 * dpr);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [mode, active, getAnalyser]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ display: "block", width: "100%", height: "100%", ...style }} />;
}
