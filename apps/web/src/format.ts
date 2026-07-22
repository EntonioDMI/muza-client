/** "3:47" из секунд; NaN/бесконечность → "0:00" (метаданные ещё не пришли). */
export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** «N трек/трека/треков» — вместо канцелярского «трек(ов)» (паритет 21.07). */
export function tracksLabel(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} треков`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n} трек`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} трека`;
  return `${n} треков`;
}
