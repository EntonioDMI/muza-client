/** Нативный сигнал «видно ли окно» на уровне ЦЕЛОГО App (03.08).
 *
 *  Зачем интеграционный, а не юнит: гейты живут в общих компонентах и уже
 *  проверены поштучно (packages/app/src/shell/nowPlaying.test.tsx,
 *  playerBar.test.tsx), а здесь сторожится ПРОВОДКА — что приложение вообще
 *  подписано на событие Rust и что флаг доезжает до потребителей. Проверяем на
 *  анимированном фоне: он гейтится прямо в App.tsx (атрибут data-orb-paused,
 *  ставится на оба диска), поэтому виден в DOM без канваса и без Web Audio.
 *
 *  Почему вообще нужен нативный сигнал, а не document.hidden — в шапке
 *  src/lib/windowVisible.ts (коротко: WebView2 странице о свёрнутом окне не
 *  сообщает, а кадры при этом не тормозятся, а разгоняются). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => {
  const impl: Record<string, ReturnType<typeof vi.fn>> = {};
  const api = new Proxy(
    {},
    {
      get(_t, prop: string | symbol) {
        if (typeof prop !== "string" || prop === "then") return undefined;
        if (!(prop in impl)) impl[prop] = vi.fn().mockReturnValue(new Promise(() => {}));
        return impl[prop];
      },
    },
  );
  return { api, impl, listen: vi.fn(), emitTo: vi.fn() };
});

vi.mock("@muza/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@muza/api-client")>();
  return {
    ...actual,
    HttpMuzaApi: class {
      constructor() {
        return h.api as never;
      }
    },
  };
});

// Web Audio в jsdom нет — тот же стенд-класс, что в App.test.tsx.
vi.mock("./player/audioEngine", () => ({
  AudioEngine: class {
    static normFactor = () => 1;
    play = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    stop = vi.fn();
    seek = vi.fn();
    position = vi.fn(() => 0);
    preload = vi.fn();
    setVolume = vi.fn();
    setSpeed = vi.fn();
    setEq = vi.fn();
    analyser = vi.fn(() => null);
  },
}));

/** Единственный мок, ради которого этот файл отдельный: подменяем транспорт
 *  событий Tauri, чтобы дёрнуть «окно свернули» рукой. emitTo тоже здесь —
 *  его импортирует miniBridge (в jsdom не зовётся, но экспорт должен быть). */
vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen, emitTo: h.emitTo }));

import { App } from "./App";

function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
}

const session = {
  user: { id: "u-test", username: "qa", anonymous: false, createdAt: "2026-01-01" },
  accessToken: "at",
  refreshToken: null,
};

/** Фон «Анимированный» рисуется только при НАЛИЧИИ обложки — иначе крутить
 *  нечего и дисков в DOM нет вовсе. Поэтому у трека здесь обложка есть. */
function seedAnimatedBackground() {
  localStorage.setItem(
    "muza.prefs.v1",
    JSON.stringify({ resumePosition: true, language: "ru", bgType: "animated", anims: true }),
  );
  localStorage.setItem(
    "muza.resume.last.v1",
    JSON.stringify({
      id: "42",
      kind: "catalog",
      title: "Тестовый трек",
      artist: "Автор",
      album: "",
      duration: 200,
      cover: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      explicit: false,
      loudness: null,
    }),
  );
}

/** Доставить нагрузку тому обработчику, которого App отдал в listen. */
function emitVisible(value: boolean) {
  const call = h.listen.mock.calls.find((c) => c[0] === "muza-window-visible");
  if (!call) throw new Error("App не подписался на muza-window-visible");
  act(() => (call[1] as (e: { payload: boolean }) => void)({ payload: value }));
}

const orbs = () => document.querySelectorAll("[data-orb-paused]").length;

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia();
  seedAnimatedBackground();
  h.listen.mockReset();
  h.listen.mockResolvedValue(() => undefined);
  h.impl.restoreSession = vi.fn().mockResolvedValue(session);
  h.impl.getPlaylists = vi.fn().mockResolvedValue([]);
  h.impl.getFavorites = vi.fn().mockResolvedValue([]);
  h.impl.adminPing = vi.fn().mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  for (const key of Object.keys(h.impl)) delete h.impl[key];
});

describe("App — нативный сигнал «видно ли окно»", () => {
  it("свернули окно — вращение фона встаёт на паузу; вернули — крутится снова", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Любимое" });

    // Пока система молчит, считаем, что видно: диски крутятся.
    await waitFor(() => expect(document.querySelectorAll(".muza-orb-spin--cw").length).toBe(1));
    expect(orbs()).toBe(0);

    emitVisible(false);
    // Оба диска: атрибут ставится на каждый.
    expect(orbs()).toBe(2);

    emitVisible(true);
    expect(orbs()).toBe(0);
  }, 15_000);

  it("окно ВИДНО, но не в фокусе — ничего не гасим (граница, поставленная владельцем)", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Любимое" });
    await waitFor(() => expect(document.querySelectorAll(".muza-orb-spin--cw").length).toBe(1));

    // Единственный вход выключателя — событие «не видно». Потеря фокуса окном
    // такого события не порождает (это решает Rust), и уходить в паузу от
    // window.blur приложение не должно: окно на втором мониторе человек видит.
    act(() => {
      window.dispatchEvent(new Event("blur"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(orbs()).toBe(0);
  }, 15_000);
});
