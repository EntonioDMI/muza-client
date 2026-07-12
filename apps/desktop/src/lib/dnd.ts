/** Внутренний drag-and-drop треков (строка → плейлист сайдбара).
 *  HTML5 DnD с кастомным ghost: мини-пилюля с названием вместо мутного
 *  скриншота строки. Тип данных свой — чужие переносы не срабатывают. */

export const TRACK_DND_MIME = "application/x-muza-track";

export interface TrackDragData {
  id: string;
  title: string;
}

/** Повесить на draggable-обёртку строки: onDragStart={(e) => startTrackDrag(e, id, title)}. */
export function startTrackDrag(e: React.DragEvent, id: string, title: string, artist?: string): void {
  e.dataTransfer.setData(TRACK_DND_MIME, JSON.stringify({ id, title } satisfies TrackDragData));
  e.dataTransfer.effectAllowed = "copy";

  const ghost = document.createElement("div");
  ghost.textContent = artist ? `${artist} — ${title}` : title;
  Object.assign(ghost.style, {
    position: "fixed",
    top: "-100px",
    left: "-100px",
    maxWidth: "260px",
    padding: "8px 14px",
    borderRadius: "999px",
    background: "var(--glass-panel)",
    color: "var(--text-1)",
    font: "600 13px var(--font-ui)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    pointerEvents: "none",
    zIndex: "200",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 16, 16);
  setTimeout(() => ghost.remove(), 0);
}

/** Достать данные дропа; null — переносили не трек. */
export function readTrackDrag(e: React.DragEvent): TrackDragData | null {
  const raw = e.dataTransfer.getData(TRACK_DND_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TrackDragData;
  } catch {
    return null;
  }
}

/** true, если над элементом тащат именно трек (для dragover-подсветки). */
export function isTrackDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(TRACK_DND_MIME);
}
