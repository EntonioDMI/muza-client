/** Шеринг-карточки (Stage 7): canvas 1080×1080 → PNG. Всё на клиенте —
 *  публичных веб-страниц нет (беклог Stage 8). Три варианта: трек,
 *  плейлист, Wrapped-итоги. Дизайн: тёмная база ДС + акцентные блобы
 *  (глассморфизм бренда), обложка с закруглением, глиф+wordmark Muza. */

import glyphUrl from "@muza/ui/assets/logo/glyph.svg";
import { findContentBox } from "./coverArt";
import { DEFAULT_LANG, translate, type Lang } from "../i18n";

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

/** Границы контента без вшитых полей источника (letterbox/pillarbox) — та же
 *  эвристика, что у обложек плеера (lib/coverArt.findContentBox). null — полей
 *  нет либо канва «испорчена» CORS'ом: рисуем картинку как есть. */
function contentBoxOf(img: HTMLImageElement): { left: number; top: number; w: number; h: number } | null {
  try {
    const probe = document.createElement("canvas");
    probe.width = img.naturalWidth;
    probe.height = img.naturalHeight;
    const ctx = probe.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const box = findContentBox(ctx.getImageData(0, 0, probe.width, probe.height).data, probe.width, probe.height);
    if (!box) return null;
    return { left: box.left, top: box.top, w: box.right - box.left + 1, h: box.bottom - box.top + 1 };
  } catch {
    return null;
  }
}

/** Кроп-квадрат картинки в скруглённый бокс (cover-fit по центру контента).
 *  Центр считается ПОСЛЕ среза вшитых полей источника — иначе серые/чёрные
 *  рамки ytimg попадали в карточку (жалоба 2026-07-16, тот же класс бага,
 *  что в «Итогах года»). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, size: number, r: number) {
  const box = contentBoxOf(img);
  const bw = box?.w ?? img.naturalWidth;
  const bh = box?.h ?? img.naturalHeight;
  const side = Math.min(bw, bh);
  const sx = (box?.left ?? 0) + (bw - side) / 2;
  const sy = (box?.top ?? 0) + (bh - side) / 2;
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

/** Фон: сплошной цвет окна приложения (--bg-0). Никаких блобов/градиентов —
 *  ДС плоская (tokens/effects.css), и карточка обязана выглядеть как «кадр из
 *  приложения», а не как нейро-постер (жалоба владельца 2026-07-17). */
function drawBase(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#121110";
  ctx.fillRect(0, 0, SIZE, SIZE);
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
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(translate(DEFAULT_LANG, "media.shareCard.errors.canvasBlobFailed")))), "image/png");
  });
}

function makeCanvas(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(translate(DEFAULT_LANG, "media.shareCard.errors.canvas2dUnavailable"));
  return ctx;
}

/** Отрисовать карточку по данным. accent — живой цвет темы пользователя.
 *  `lang` — язык подписей на карточке; потребитель shell/ShareDialog.tsx
 *  (T34a) уже прокидывает свой lang из useT() — без явного lang дефолт EN. */
export async function renderShareCard(data: ShareData, accent: string, lang: Lang = DEFAULT_LANG): Promise<Blob> {
  await document.fonts.ready; // Unbounded/Golos уже подключены приложением
  const ctx = makeCanvas();
  const glyph = await loadImage(glyphUrl);
  drawBase(ctx);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (data.kind === "track") {
    const cover = data.coverUrl ? await loadImage(data.coverUrl) : null;
    const cs = 560;
    const cx = (SIZE - cs) / 2;
    const cy = 128;
    // без теней: ДС плоская, обложка лежит на базе как плитка в приложении
    if (cover) drawCover(ctx, cover, cx, cy, cs, 44);
    else drawCoverFallback(ctx, accent, glyph, cx, cy, cs, 44);
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
    // без теней: ДС плоская, сетка обложек лежит на базе как плитки
    if (covers.length >= 4) {
      const half = cs / 2 - 6;
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
    ctx.font = "700 58px 'Golos Text', sans-serif";
    ctx.fillStyle = "#f4f3f1";
    ctx.fillText(ellipsize(ctx, data.name, SIZE - 160), SIZE / 2, 796);
    ctx.font = "400 38px 'Golos Text', sans-serif";
    ctx.fillStyle = "rgba(244, 243, 241, 0.62)";
    const meta =
      translate(lang, "media.shareCard.trackCount", { count: data.trackCount }) +
      (data.owner ? translate(lang, "media.shareCard.fromOwner", { owner: data.owner }) : "");
    ctx.fillText(ellipsize(ctx, meta, SIZE - 200), SIZE / 2, 862);
    drawBranding(ctx, glyph, 984);
  } else {
    // Wrapped — редизайн 2026-07-17 (жалоба владельца: свечения и блобы —
    // «полнейший нейрослоп», ДС плоская). Карточка теперь «кадр из приложения»:
    // плоская панель-зона на цвете окна, типографика и цвета — токены ДС,
    // герой-минуты акцентом БЕЗ свечения, разделитель — как в панелях
    // статистики, пары «значение + тихая подпись» — язык BigStat.
    const locale = lang === "ru" ? "ru" : "en";

    // Панель-зона: surface-1 на bg-0, скругление как у зон приложения.
    const px = 64;
    const pw = SIZE - px * 2;
    roundedPath(ctx, px, px, pw, pw, 56);
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    ctx.fill();
    const left = 160; // внутренний отступ контента
    const right = SIZE - 160;
    const maxW = right - left;

    ctx.textBaseline = "alphabetic";

    // Шапка: глиф + Muza слева, «Итоги <год>» справа — как заголовок зоны.
    ctx.textAlign = "left";
    if (glyph) ctx.drawImage(glyph, left, 148, 44, 50);
    ctx.font = "600 44px Unbounded, sans-serif";
    ctx.fillStyle = "#f4f3f1";
    ctx.fillText("Muza", left + 64, 190);
    ctx.textAlign = "right";
    ctx.font = "500 36px 'Golos Text', sans-serif";
    ctx.fillStyle = "rgba(244, 243, 241, 0.62)";
    ctx.fillText(translate(lang, "media.shareCard.wrappedTitle", { year: data.year }), right, 188);

    // Герой — минуты: плоский акцент, без свечения; подпись — text-2.
    ctx.textAlign = "left";
    ctx.font = "700 248px Unbounded, sans-serif";
    ctx.fillStyle = accent;
    ctx.fillText(ellipsize(ctx, data.minutes.toLocaleString(locale), maxW), left, 560);
    ctx.font = "500 48px 'Golos Text', sans-serif";
    ctx.fillStyle = "rgba(244, 243, 241, 0.62)";
    ctx.fillText(translate(lang, "media.shareCard.minutesOfMusic"), left, 642);

    // Разделитель — 2px surface-2, как между блоками панелей статистики.
    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    ctx.fillRect(left, 716, maxW, 2);

    // Топ-пары в языке BigStat: тихая подпись text-3 над значением text-1.
    let y = 796;
    if (data.topArtist) {
      ctx.font = "400 34px 'Golos Text', sans-serif";
      ctx.fillStyle = "rgba(244, 243, 241, 0.38)";
      ctx.fillText(translate(lang, "media.shareCard.artistOfYear"), left, y);
      ctx.font = "700 68px 'Golos Text', sans-serif";
      ctx.fillStyle = "#f4f3f1";
      ctx.fillText(ellipsize(ctx, data.topArtist, maxW), left, y + 78);
      y += 138;
    }
    if (data.topTrack) {
      ctx.font = "500 42px 'Golos Text', sans-serif";
      ctx.fillStyle = "rgba(244, 243, 241, 0.62)";
      ctx.fillText(ellipsize(ctx, data.topTrack, maxW), left, y);
    }

    // Низ: адрес — тихо, по правому краю (бренд уже в шапке).
    ctx.textAlign = "right";
    ctx.font = "400 30px 'Golos Text', sans-serif";
    ctx.fillStyle = "rgba(244, 243, 241, 0.38)";
    ctx.fillText("muza.lol", right, 964);
  }

  return toBlob(ctx.canvas);
}

/** Текст для «Скопировать текст» — вставляется в любой мессенджер.
 *  `lang` — потребитель shell/ShareDialog.tsx (T34a) уже прокидывает свой
 *  lang из useT(); без явного lang дефолт EN. */
export function shareText(data: ShareData, lang: Lang = DEFAULT_LANG): string {
  const locale = lang === "ru" ? "ru" : "en";
  if (data.kind === "track") return translate(lang, "media.share.track", { title: data.title, artist: data.artist });
  if (data.kind === "playlist") return translate(lang, "media.share.playlist", { name: data.name, count: data.trackCount });
  const top = data.topArtist ? translate(lang, "media.share.wrappedTopArtist", { topArtist: data.topArtist }) : "";
  return translate(lang, "media.share.wrapped", {
    year: data.year,
    minutes: data.minutes.toLocaleString(locale),
    plays: data.plays.toLocaleString(locale),
    top,
  });
}
