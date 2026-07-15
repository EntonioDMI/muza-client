import type { Annotation } from "@muza/api-client";
import type { LyricLine } from "./types";

export function shouldFetchAnnotations(
  serverSession: boolean,
  meaningMode: boolean,
  lyricsLoading: boolean,
  loadedTrackId: string | null,
  /** null — ничего не играет; тогда и строк нет, и lineCount отрежет ниже. */
  currentTrackId: string | null,
  lineCount: number,
): boolean {
  return serverSession
    && meaningMode
    && !lyricsLoading
    && loadedTrackId === currentTrackId
    && lineCount > 0;
}

export function buildAnnotationNotes(annotations: Annotation[] | null): Map<number, Annotation> {
  const notes = new Map<number, Annotation>();
  for (const annotation of annotations ?? []) {
    const indexes = annotation.lineIdxs.length > 0
      ? annotation.lineIdxs
      : annotation.lineIdx !== null
        ? [annotation.lineIdx]
        : [];
    for (const index of indexes) {
      if (!notes.has(index)) notes.set(index, annotation);
    }
  }
  return notes;
}

export function decorateLyrics(lines: LyricLine[], notes: Map<number, Annotation>, enabled: boolean): LyricLine[] {
  if (!enabled) {
    return lines.some((line) => line.note)
      ? lines.map((line) => ({ ...line, note: undefined }))
      : lines;
  }
  if (notes.size === 0) return lines;
  return lines.map((line, index) => {
    const annotation = notes.get(index);
    return annotation ? { ...line, note: annotation.body } : line;
  });
}
