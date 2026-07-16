import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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

  it("без analyser (plain-режим) ничего не делает и не падает", async () => {
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

describe("ListeningMode — скрытие текста (кнопка в слое авто-прячущихся контролов)", () => {
  const lines = [
    { t: 0, text: "Первая строка" },
    { t: 5, text: "Вторая строка" },
  ];

  it("кнопка живёт в слое контролов: видна после открытия, прячется вместе с ним по бездействию", () => {
    vi.useFakeTimers();
    try {
      const { getByLabelText } = renderMode({ lyrics: lines, lyricsShown: true, onToggleLyrics: vi.fn() });
      // Тесты без LanguageProvider — английский фолбэк (DEFAULT_LANG="en").
      const btn = getByLabelText("Hide lyrics");
      const layer = btn.parentElement!;
      expect(layer.style.opacity).toBe("1"); // wake() на открытии
      act(() => {
        vi.advanceTimersByTime(2600); // таймер спокойствия — 2500мс
      });
      expect(layer.style.opacity).toBe("0");
      expect(layer.style.pointerEvents).toBe("none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("клик по кнопке зовёт onToggleLyrics; в скрытом состоянии подпись меняется на «показать»", () => {
    const onToggle = vi.fn();
    const shown = renderMode({ lyrics: lines, lyricsShown: true, onToggleLyrics: onToggle });
    fireEvent.click(shown.getByLabelText("Hide lyrics"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    cleanup();
    const hidden = renderMode({ lyrics: lines, lyricsShown: false, onToggleLyrics: onToggle });
    fireEvent.click(hidden.getByLabelText("Show lyrics"));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("по умолчанию (пропа нет) текст показан", () => {
    const { getByTestId } = renderMode({ lyrics: lines, onToggleLyrics: vi.fn() });
    const wrap = getByTestId("lm-lyrics");
    expect(wrap.style.opacity).toBe("1");
    expect(wrap.getAttribute("aria-hidden")).not.toBe("true");
  });

  it("lyricsShown=false прячет блок текста и отдаёт место обложке (0fr + центрирование)", () => {
    const { getByTestId } = renderMode({ lyrics: lines, lyricsShown: false, onToggleLyrics: vi.fn() });
    const wrap = getByTestId("lm-lyrics");
    expect(wrap.style.opacity).toBe("0");
    expect(wrap.getAttribute("aria-hidden")).toBe("true");
    expect(wrap.style.pointerEvents).toBe("none");
    const stage = wrap.parentElement!;
    expect(stage.style.gridTemplateColumns).toMatch(/0fr\s*$/);
    expect(stage.style.justifyContent).toBe("center");
  });

  it("той же кнопкой прячется и плашка «Текст не найден» (трек без текста)", () => {
    const { getByTestId, getByText } = renderMode({ lyrics: [], lyricsShown: false, onToggleLyrics: vi.fn() });
    expect(getByTestId("lm-lyrics").style.opacity).toBe("0");
    // плашка остаётся в DOM (плавный возврат), но скрыта обёрткой
    expect(getByText("Lyrics not found")).toBeTruthy();
  });

  it("клавиша T переключает текст; с модификаторами и поверх диалога — нет", () => {
    const onToggle = vi.fn();
    renderMode({ lyrics: lines, lyricsShown: true, onToggleLyrics: onToggle });
    fireEvent.keyDown(window, { code: "KeyT" });
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { code: "KeyT", ctrlKey: true });
    fireEvent.keyDown(window, { code: "KeyT", shiftKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
    // поверх режима открыт диалог (например, модалка смысла) — T не срабатывает
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    document.body.appendChild(dlg);
    try {
      fireEvent.keyDown(window, { code: "KeyT" });
      expect(onToggle).toHaveBeenCalledTimes(1);
    } finally {
      dlg.remove();
    }
  });
});
