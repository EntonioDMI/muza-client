/** Шеринг-карточки (Stage 7): canvas 1080×1080 → PNG. Всё на клиенте —
 *  публичных веб-страниц нет (беклог Stage 8). Три варианта: трек,
 *  плейлист, Wrapped-итоги. Дизайн: тёмная база ДС + акцентные блобы
 *  (глассморфизм бренда), обложка с закруглением, глиф+wordmark Muza. */

import glyphUrl from "@muza/ui/assets/logo/glyph.svg";

export type ShareData =
  | { kind: "track"; title: string; artist: string; coverUrl: string | null }
  | { kind: "playlist"; name: string; trackCount: number; owner: string; covers: string[] }
  | {
      kind: "wrapped";
      year: number;
      minutes: number;
      plays: number;
      artists: number;
      topArtist: string | null;
      topTrack: string | null;
    };

const SIZE = 1080;

/** Загрузка картинки с CORS (ytimg отдаёт заголовки — canvas не «портится»);
 *  null — не загрузилась (рисуем заглушку). */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Кроп-квадрат картинки в скруглённый бокс (cover-fit по центру). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, size: number, r: number) {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  ctx.save();
  roundedPath(ctx, x, y, size, size, r);
  ctx.clip();
  ctx.drawImage(img, sx, sy, side, side, x, y, size, size);
  ctx.restore();
}

/** Заглушка обложки: акцентный градиент + глиф. */
function drawCoverFallback(
  ctx: CanvasRenderingContext2D,
  accent: string,
  glyph: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
  r: number,
) {
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, accent);
  g.addColorStop(1, "#17161499");
  ctx.save();
  roundedPath(ctx, x, y, size, size, r);
  ctx.clip();
  ctx.fillStyle = "#171614";
  ctx.fillRect(x, y, size, size);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = g;
  ctx.fillRect(x, y, size, size);
  ctx.globalAlpha = 1;
  if (glyph) {
    const gs = size * 0.34;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(glyph, x + (size - gs) / 2, y + (size - gs * 1.15) / 2, gs, gs * 1.15);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Фон: тёмная база + два акцентных блоба (как blob'ы бренда на лендинге). */
function drawBackdrop(ctx: CanvasRenderingContext2D, accent: string) {
  ctx.fillStyle = "#121110";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const blob = (cx: number, cy: number, radius: number, alpha: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, accent);
    g.addColorStop(1, "#12111000");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalAlpha = 1;
  };
  blob(SIZE * 0.85, SIZE * 0.1, SIZE * 0.75, 0.22);
  blob(SIZE * 0.05, SIZE * 0.95, SIZE * 0.65, 0.16);
}

/** Глиф + «Muza» по центру снизу. */
function drawBranding(ctx: CanvasRenderingContext2D, glyph: HTMLImageElement | null, y: number) {
  ctx.font = "600 40px Unbounded, sans-serif";
  ctx.fillStyle = "#f4f3f1";
  ctx.textBaseline = "middle";
  const label = "Muza";
  const tw = ctx.measureText(label).width;
  const gw = glyph ? 34 : 0;
  const gap = glyph ? 16 : 0;
  const total = gw + gap + tw;
  const x = (SIZE - total) / 2;
  if (glyph) ctx.drawImage(glyph, x, y - 22, gw, gw * 1.15);
  ctx.textAlign = "left";
  ctx.fillText(label, x + gw + gap, y);
  ctx.textAlign = "center";
  ctx.font = "400 26px 'Golos Text', sans-serif";
  ctx.fillStyle = "rgba(244, 243, 241, 0.45)";
  ctx.fillText("muza.lol", SIZE / 2, y + 52);
}

/** Строка с эллипсисом под максимальную ширину. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

async function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob вернул null"))), "image/png");
  });
}

function makeCanvas(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d недоступен");
  return ctx;
}

/** Отрисовать карточку по данным. accent — живой цвет темы пользователя. */
export async function renderShareCard(data: ShareData, accent: string): Promise<Blob> {
  await document.fonts.ready; // Unbounded/Golos уже подключены приложением
  const ctx = makeCanvas();
  const glyph = await loadImage(glyphUrl);
  drawBackdrop(ctx, accent);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (data.kind === "track") {
    const cover = data.coverUrl ? await loadImage(data.coverUrl) : null;
    const cs = 560;
    const cx = (SIZE - cs) / 2;
    const cy = 128;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 64;
    ctx.shadowOffsetY = 20;
    if (cover) drawCover(ctx, cover, cx, cy, cs, 44);
    else drawCoverFallback(ctx, accent, glyph, cx, cy, cs, 44);
    ctx.restore();
    ctx.font = "700 58px 'Golos Text', sans-serif";
    ctx.fillStyle = "#f4f3f1";
    ctx.fillText(ellipsize(ctx, data.title, SIZE - 160), SIZE / 2, 796);
    ctx.font = "400 40px 'Golos Text', sans-serif";
    ctx.fillStyle = "rgba(244, 243, 241, 0.62)";
    ctx.fillText(ellipsize(ctx, data.artist, SIZE - 200), SIZE / 2, 862);
    drawBranding(ctx, glyph, 984);
  } else if (data.kind === "playlist") {
    // сетка обложек 2×2 (меньше четырёх — первая крупно)
    const covers = (await Promise.all(data.covers.slice(0, 4).map(loadImage))).filter(
      (i): i is HTMLImageElement => i !== null,
    );
    const cs = 560;
    const cx = (SIZE - cs) / 2;
    const cy = 128;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 64;
    ctx.shadowOffsetY = 20;
    if (covers.length >= 4) {
      const half = cs / 2 - 6;
      ctx.shadowColor = "transparent";
      roundedPath(ctx, cx, cy, cs, cs, 44);
      ctx.save();
      ctx.clip();
      drawCover(ctx, covers[0], cx, cy, half, 0);
      drawCover(ctx, covers[1], cx + half + 12, cy, half, 0);
      drawCover(ctx, covers[2], cx, cy + half + 12, half, 0);
      drawCover(ctx, covers[3], cx + half + 12, cy + half + 12, half, 0);
      ctx.restore();
    } else if (covers.length > 0) {
      drawCover(ctx, covers[0], cx, cy, cs, 44);
    } else {
      drawCoverFallback(ctx, accent, glyph, cx, cy, cs, 44);
    }
    ctx.restore();
    ctx.font = "700 58px 'Golos Text', sans-serif";
    ctx.fillStyle = "#f4f3f1";
    ctx.fillText(ellipsize(ctx, data.name, SIZE - 160), SIZE / 2, 796);
    ctx.font = "400 38px 'Golos Text', sans-serif";
    ctx.fillStyle = "rgba(244, 243, 241, 0.62)";
    const meta = `${data.trackCount} тр.${data.owner ? ` · от ${data.owner}` : ""}`;
    ctx.fillText(ellipsize(ctx, meta, SIZE - 200), SIZE / 2, 862);
    drawBranding(ctx, glyph, 984);
  } else {
    // Wrapped: цифры — герои
    ctx.font = "600 48px Unbounded, sans-serif";
    ctx.fillStyle = "rgba(244, 243, 241, 0.85)";
    ctx.fillText(`Мои итоги ${data.year}`, SIZE / 2, 150);
    ctx.font = "700 176px 'Golos Text', sans-serif";
    ctx.fillStyle = accent;
    ctx.fillText(String(data.minutes.toLocaleString("ru")), SIZE / 2, 340);
    ctx.font = "400 44px 'Golos Text', sans-serif";
    ctx.fillStyle = "rgba(244, 243, 241, 0.62)";
    ctx.fillText("минут музыки", SIZE / 2, 452);

    const line = (label: string, value: string, y: number) => {
      ctx.font = "400 34px 'Golos Text', sans-serif";
      ctx.fillStyle = "rgba(244, 243, 241, 0.5)";
      ctx.fillText(label, SIZE / 2, y);
      ctx.font = "700 48px 'Golos Text', sans-serif";
      ctx.fillStyle = "#f4f3f1";
      ctx.fillText(ellipsize(ctx, value, SIZE - 200), SIZE / 2, y + 56);
    };
    let y = 566;
    if (data.topArtist) {
      line("артист года", data.topArtist, y);
      y += 130;
    }
    if (data.topTrack) {
      line("трек года", data.topTrack, y);
      y += 130;
    }
    ctx.font = "400 34px 'Golos Text', sans-serif";
    ctx.fillStyle = "rgba(244, 243, 241, 0.5)";
    ctx.fillText(`${data.plays.toLocaleString("ru")} прослушиваний · ${data.artists} артистов`, SIZE / 2, y + 10);
    drawBranding(ctx, glyph, 984);
  }

  return toBlob(ctx.canvas);
}

/** Текст для «Скопировать текст» — вставляется в любой мессенджер. */
export function shareText(data: ShareData): string {
  if (data.kind === "track") return `«${data.title}» — ${data.artist} · слушаю в Muza · https://muza.lol`;
  if (data.kind === "playlist")
    return `Плейлист «${data.name}» — ${data.trackCount} тр. · собран в Muza · https://muza.lol`;
  const top = data.topArtist ? ` Артист года — ${data.topArtist}.` : "";
  return `Мой ${data.year} в Muza: ${data.minutes.toLocaleString("ru")} минут музыки, ${data.plays.toLocaleString("ru")} прослушиваний.${top} · https://muza.lol`;
}
