import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ListeningMode } from "./ListeningMode";
import type { PlayerTrack } from "../player/types";

afterEach(cleanup);

const track: PlayerTrack = {
  id: "t1",
  kind: "catalog",
  title: "Тестовый трек",
  artist: "Автор",
  album: "",
  duration: 200,
  cover: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
  explicit: false,
  loudness: null,
};

const noop = () => {};

/** Фейковый AnalyserNode: getByteFrequencyData всегда возвращает громкий бас. */
function loudAnalyser(): AnalyserNode {
  return {
    getByteFrequencyData: (arr: Uint8Array) => arr.fill(220),
  } as unknown as AnalyserNode;
}

function renderMode(props: Partial<ComponentProps<typeof ListeningMode>> = {}) {
  return render(
    <ListeningMode
      open
      track={track}
      lyrics={[]}
      playing={false}
      pos={0}
      activeLine={-1}
      onTogglePlay={noop}
      onPrev={noop}
      onNext={noop}
      onSeek={noop}
      onSeekLine={noop}
      onExplain={noop}
      onClose={noop}
      {...props}
    />,
  );
}

describe("ListeningMode — «Качание при басах» (T14)", () => {
  it("пульсирует transform оверлея, когда bassShake+anims включены и analyser отдаёт бас", async () => {
    const { getByTestId } = renderMode({ bassShake: true, anims: true, getAnalyser: loudAnalyser });
    await waitFor(() => {
      const t = getByTestId("listening-mode").style.transform;
      expect(t).toMatch(/scale\(1\.0[1-9]/);
    });
  });

  it("не трогает transform, когда преф bassShake выключен (дефолт)", async () => {
    const { getByTestId } = renderMode({ bassShake: false, anims: true, getAnalyser: loudAnalyser });
    await new Promise((r) => setTimeout(r, 150));
    expect(getByTestId("listening-mode").style.transform).toBe("");
  });

  it("уважает общий anims=false — качание выключено принудительно", async () => {
    const { getByTestId } = renderMode({ bassShake: true, anims: false, getAnalyser: loudAnalyser });
    await new Promise((r) => setTimeout(r, 150));
    expect(getByTestId("listening-mode").style.transform).toBe("");
  });

  it("без analyser (демо/plain-режим) ничего не делает и не падает", async () => {
    const { getByTestId } = renderMode({ bassShake: true, anims: true, getAnalyser: undefined });
    await new Promise((r) => setTimeout(r, 150));
    expect(getByTestId("listening-mode").style.transform).toBe("");
  });

  it("уважает OS prefers-reduced-motion даже при bassShake+anims включённых", async () => {
    const original = window.matchMedia;
    // jsdom не реализует matchMedia — эмулируем «уменьшить анимацию» для теста.
    // @ts-expect-error — минимальная заглушка контракта MediaQueryList
    window.matchMedia = (query: string) => ({ media: query, matches: true });
    try {
      const { getByTestId } = renderMode({ bassShake: true, anims: true, getAnalyser: loudAnalyser });
      await new Promise((r) => setTimeout(r, 150));
      expect(getByTestId("listening-mode").style.transform).toBe("");
    } finally {
      window.matchMedia = original;
    }
  });
});
