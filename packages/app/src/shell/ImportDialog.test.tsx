import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ImportPreview, MuzaApi } from "@muza/api-client";
import { ImportDialog } from "./ImportDialog";

// Плашка про персонализацию (2026-07-15). Плейлисты, которыми владеет сам
// Spotify, подмешивают рекомендации конкретного слушателя: человек у себя видит
// свою версию, а импортируется общая. Импорт при этом ИСПРАВЕН — но без плашки
// расхождение неотличимо от бага: владелец потерял на нём полдня и подал два
// ложных баг-репорта. Разбор — docs/notes/2026-07-15-spotify-персонализирует-плейлисты.md
//
// Тексты сверяются по EN: без LanguageProvider useT() отдаёт DEFAULT_LANG.

const PERSONALIZED: ImportPreview = {
  previewable: true,
  name: "Today's Top Hits",
  owner: "Spotify",
  trackCount: 50,
  mayBePersonalized: true,
};

const PLAIN: ImportPreview = {
  previewable: true,
  name: "Vibe songs",
  owner: "Bruh",
  trackCount: 12,
  mayBePersonalized: false,
};

const SPOTIFY_URL = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";
const PLATE = /Spotify tailors its own playlists to each listener/i;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function show(previewImport: () => Promise<ImportPreview>) {
  const api = { previewImport: vi.fn(previewImport), importPlaylist: vi.fn() } as unknown as MuzaApi;
  render(<ImportDialog api={api} open onClose={vi.fn()} onImported={vi.fn()} onNotify={vi.fn()} />);
  return api;
}

function paste(url: string): void {
  fireEvent.change(screen.getByPlaceholderText(/Link to a playlist or album/i), {
    target: { value: url },
  });
}

/** Переждать дебаунс и дать промису превью долететь. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

describe("ImportDialog — превью ссылки до импорта", () => {
  it("плейлист самого Spotify → плашка про подстройку под слушателя", async () => {
    show(async () => PERSONALIZED);

    paste(SPOTIFY_URL);
    await settle();

    expect(screen.getByText(PLATE)).toBeTruthy();
  });

  it("плейлист живого человека → плашки НЕТ (у него этой проблемы нет)", async () => {
    show(async () => PLAIN);

    paste("https://open.spotify.com/playlist/759gD1zxheoWbS1n8rI6w3");
    await settle();

    expect(screen.getByText("Vibe songs")).toBeTruthy(); // превью пришло…
    expect(screen.queryByText(PLATE)).toBeNull(); // …а плашки нет
  });

  it("показывает название и число позиций ещё до импорта", async () => {
    show(async () => PERSONALIZED);

    paste(SPOTIFY_URL);
    await settle();

    expect(screen.getByText("Today's Top Hits")).toBeTruthy();
    expect(screen.getByText("50 tr.")).toBeTruthy();
  });

  it("пока введённое не ссылка — сервер не дёргаем вовсе", async () => {
    const api = show(async () => PERSONALIZED);

    paste("open.spotify");
    await settle();

    expect(api.previewImport).not.toHaveBeenCalled();
  });

  it("не бежит на сервер сразу — сперва ждёт паузы в вводе", async () => {
    // Каждый вызов — поход сервера на страницу Spotify. Ссылку могут и
    // допечатывать руками, поэтому ждём, пока человек остановится.
    const api = show(async () => PERSONALIZED);

    paste(SPOTIFY_URL);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(api.previewImport).not.toHaveBeenCalled(); // ещё печатает

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(api.previewImport).toHaveBeenCalledTimes(1);
  });

  it("ссылку дописали — запрос уходит один, по последней версии", async () => {
    const api = show(async () => PERSONALIZED);

    paste("https://open.spotify.com/playlist/1");
    paste("https://open.spotify.com/playlist/12");
    paste(SPOTIFY_URL);
    await settle();

    expect(api.previewImport).toHaveBeenCalledTimes(1);
    expect(api.previewImport).toHaveBeenCalledWith(SPOTIFY_URL);
  });

  it("превью отказало → диалог цел и импорт по-прежнему доступен", async () => {
    // Превью — любезность, а не этап импорта: 429/гео-блок/лежащий Spotify не
    // имеют права мешать человеку импортировать.
    show(async () => {
      throw new Error("429 Too Many Requests");
    });

    paste(SPOTIFY_URL);
    await settle();

    expect(screen.queryByText(PLATE)).toBeNull();
    expect(screen.getByText("Import")).toBeTruthy();
  });

  it("сказать нечего (previewable=false) → не рисуем ничего", async () => {
    show(async () => ({ ...PERSONALIZED, previewable: false }));

    paste("https://www.youtube.com/playlist?list=PLabc");
    await settle();

    expect(screen.queryByText(PLATE)).toBeNull();
    expect(screen.queryByText("Today's Top Hits")).toBeNull();
  });

  it("ссылку сменили — прошлая плашка не залипает", async () => {
    let next: ImportPreview = PERSONALIZED;
    show(async () => next);

    paste(SPOTIFY_URL);
    await settle();
    expect(screen.getByText(PLATE)).toBeTruthy();

    next = PLAIN;
    paste("https://open.spotify.com/playlist/759gD1zxheoWbS1n8rI6w3");
    await settle();

    expect(screen.queryByText(PLATE)).toBeNull();
  });
});
