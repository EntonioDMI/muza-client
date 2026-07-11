import { describe, expect, it } from "vitest";
import type { Annotation } from "@muza/api-client";
import { buildAnnotationNotes, decorateLyrics, shouldFetchAnnotations } from "./annotations";

function annotation(body: string, lineIdxs: number[], lineIdx: number | null = null): Annotation {
  return {
    fragment: "Фрагмент",
    body,
    votes: 1,
    verified: false,
    lineIdx,
    lineCount: lineIdxs.length,
    lineIdxs,
  };
}

describe("buildAnnotationNotes", () => {
  it("expands all indexes of a multi-line annotation", () => {
    const item = annotation("Объяснение", [2, 3]);

    const notes = buildAnnotationNotes([item]);

    expect(notes.get(2)).toBe(item);
    expect(notes.get(3)).toBe(item);
  });

  it("keeps the first annotation when Genius returns overlaps", () => {
    const first = annotation("Первое", [1]);
    const second = annotation("Второе", [1]);

    expect(buildAnnotationNotes([first, second]).get(1)).toBe(first);
  });
});

describe("decorateLyrics", () => {
  it("adds explanations to plain lyrics without timestamps", () => {
    const item = annotation("Смысл plain-строки", [1]);
    const lines = [{ t: 0, text: "Первая" }, { t: 0, text: "Вторая" }];

    expect(decorateLyrics(lines, buildAnnotationNotes([item]), true)[1].note).toBe("Смысл plain-строки");
  });

  it("removes every explanation when meaning mode is disabled", () => {
    const lines = [{ t: 0, text: "Демо", note: "Демо-смысл" }];

    expect(decorateLyrics(lines, new Map(), false)).toEqual([{ t: 0, text: "Демо", note: undefined }]);
  });
});

describe("shouldFetchAnnotations", () => {
  it("waits until the loaded lyrics belong to the current track", () => {
    expect(shouldFetchAnnotations(true, true, false, "previous-track", "current-track", 20)).toBe(false);
    expect(shouldFetchAnnotations(true, true, false, "current-track", "current-track", 20)).toBe(true);
  });
});
