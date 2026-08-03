/** ТИК ПОЗИЦИИ НЕ ТРОГАЕТ КАРКАС — приёмка переноса позиции из состояния
 *  React (03.08, см. player/positionStore.ts).
 *
 *  Зачем интеграционный, а не юнит: юниты уже стерегут само хранилище и
 *  усечённых потребителей (positionStore.test.ts, usePlayback.test.ts,
 *  useJam.test.ts, useMediaSession.test.ts). Здесь проверяется то, ради чего
 *  всё делалось, и что видно только на живом дереве: <audio> тикает четыре
 *  раза в секунду — и сайдбар при этом не перерисовывается НИ РАЗУ, а время в
 *  полосе плеера всё-таки идёт. Обе половины обязательны: без первой нет
 *  экономии, без второй — «оптимизировали так, что часы встали».
 *
 *  Сайдбар взят подопытным потому, что он самый дешёвый для подмены и при этом
 *  честно представляет весь каркас: он висит рядом с текущим экраном, очередью
 *  и диалогами, которые до правки перерисовывались тем же тиком.
 *
 *  Тут же сторож на мемоизацию rootStyle: движок темы (клон профиля настроек,
 *  цветовая арифметика, объект из ~40 CSS-переменных) не имеет права
 *  пересчитываться на каждый рендер App. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EngineCallbacks } from "./player/audioEngine";

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
  return {
    api,
    impl,
    listen: vi.fn(),
    emitTo: vi.fn(),
    /** Колбэки, которые usePlayback отдал движку — ими эмулируем timeupdate. */
    cb: { current: null as EngineCallbacks | null },
    /** Сколько раз перерисовался сайдбар (подопытный кусок каркаса). */
    sidebarRenders: { count: 0 },
    buildThemeVars: vi.fn(),
  };
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

vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen, emitTo: h.emitTo }));

// Web Audio в jsdom нет — стенд-класс, который ещё и отдаёт наружу колбэки.
vi.mock("./player/audioEngine", () => ({
  AudioEngine: class {
    static normFactor = () => 1;
    play = vi.fn(async () => {});
    pause = vi.fn();
    resume = vi.fn(async () => true);
    stop = vi.fn();
    seek = vi.fn();
    position = vi.fn(() => 0);
    preload = vi.fn();
    setVolume = vi.fn();
    setSpeed = vi.fn();
    setEq = vi.fn();
    setOutputs = vi.fn();
    setMicConfig = vi.fn();
    analyser = vi.fn(() => null);
    constructor(cb: EngineCallbacks) {
      h.cb.current = cb;
    }
  },
}));

// Движок добычи: в jsdom его нет, а нам нужно, чтобы трек реально «завёлся» —
// иначе usePlayback не дойдёт до создания AudioEngine и тикать будет нечем.
vi.mock("./lib/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/engine")>();
  return {
    ...actual,
    engineAvailable: () => true,
    engineStreamStart: vi.fn(async () => false),
    resolvePlayable: vi.fn(async () => ({ url: "track.webm", fromCache: true, provider: "youtube" })),
    enginePins: vi.fn(async () => []),
    enginePin: vi.fn(async () => undefined),
    applyRecipe: vi.fn(async () => undefined),
    setCacheLimit: vi.fn(async () => undefined),
  };
});

// Сайдбар подменён счётчиком: считаем ЕГО рендеры как рендеры каркаса.
vi.mock("./shell/Sidebar", () => ({
  Sidebar: () => {
    h.sidebarRenders.count++;
    return <div data-testid="sidebar-stub" />;
  },
}));

// Движок темы — шпион поверх настоящего: считаем пересборки rootStyle.
vi.mock("@muza/app/theme/themeVars", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@muza/app/theme/themeVars")>();
  h.buildThemeVars.mockImplementation(actual.buildThemeVars);
  return { ...actual, buildThemeVars: h.buildThemeVars };
});

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

/** Восстановленный трек в баре: играть его можно сразу, кликом по «Слушать». */
function seedRestoredTrack() {
  localStorage.setItem("muza.prefs.v1", JSON.stringify({ resumePosition: true, language: "ru" }));
  localStorage.setItem(
    "muza.resume.last.v1",
    JSON.stringify({
      id: "42",
      kind: "catalog",
      title: "Тестовый трек",
      artist: "Автор",
      album: "",
      duration: 200,
      cover: null,
      explicit: false,
      loudness: null,
    }),
  );
}

/** Довести трек до играющего состояния: после этого движок создан и тикает. */
async function startPlayback() {
  const play = await screen.findByRole("button", { name: "Слушать" });
  await act(async () => {
    fireEvent.click(play);
  });
  await waitFor(() => expect(h.cb.current).not.toBeNull());
  // добыча отпущена (resolvePlayable мгновенный) — startPending снят
  await act(async () => {
    await Promise.resolve();
  });
}

const tick = (sec: number) =>
  act(() => {
    h.cb.current?.onTime(sec);
  });

/** Приём файлов перетаскиванием (`App.tsx`, `getCurrentWebview()`) читает
 *  `window.__TAURI_INTERNALS__.metadata` — в jsdom его нет, и эффект роняет
 *  НЕОБРАБОТАННОЕ отклонение промиса. Тест при этом ЗЕЛЁНЫЙ, а vitest честно
 *  предупреждает, что дальше пойдут ложные результаты: следующий тест может
 *  упасть от чужого мусора.
 *
 *  ⚠️ Сообщение обманчиво — «Cannot read properties of undefined (reading
 *  'metadata')» читается как проблема системного плеера (`mediaSession.metadata`),
 *  и я сначала пошёл чинить именно его. Это Tauri, а не медиа. */
function stubTauriInternals() {
  const label = "main";
  vi.stubGlobal("__TAURI_INTERNALS__", {
    metadata: { currentWindow: { label }, currentWebview: { windowLabel: label, label } },
    invoke: () => Promise.resolve(null),
    transformCallback: (cb: unknown) => cb,
  });
  // Второй внутренний объект — его трогает СНЯТИЕ подписки при размонтировании.
  // Без него всё зелено ровно до cleanup, а падает уже «после теста», и связь с
  // причиной теряется.
  vi.stubGlobal("__TAURI_EVENT_PLUGIN_INTERNALS__", { unregisterListener: () => Promise.resolve() });
}

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia();
  stubTauriInternals();
  seedRestoredTrack();
  h.cb.current = null;
  h.sidebarRenders.count = 0;
  h.buildThemeVars.mockClear();
  h.listen.mockReset();
  h.listen.mockResolvedValue(() => undefined);
  h.impl.restoreSession = vi.fn().mockResolvedValue(session);
  h.impl.getPlaylists = vi.fn().mockResolvedValue([]);
  h.impl.getFavorites = vi.fn().mockResolvedValue([]);
  h.impl.adminPing = vi.fn().mockResolvedValue(false);
  h.impl.getTrackSources = vi.fn().mockResolvedValue([]);
  h.impl.getLyrics = vi.fn().mockResolvedValue({ synced: null, plain: null });
});

afterEach(() => {
  cleanup();
  for (const key of Object.keys(h.impl)) delete h.impl[key];
});

describe("App — тик позиции", () => {
  it("четыре тика подряд не перерисовывают каркас, но время в баре идёт", async () => {
    render(<App />);
    await startPlayback();

    const framesBefore = h.sidebarRenders.count;
    await tick(12.25);
    await tick(12.5);
    await tick(12.75);
    await tick(13);

    // Каркас не тронут: до правки каждый из этих тиков перерисовывал его —
    // вместе с текущим экраном, очередью и обеими копиями текста песни.
    expect(h.sidebarRenders.count).toBe(framesBefore);
    // …и при этом часы в полосе плеера показывают новое время.
    expect(screen.getByText("0:13")).toBeTruthy();
  }, 20_000);

  it("время в баре продолжает идти дальше, а не замирает после первого тика", async () => {
    render(<App />);
    await startPlayback();

    await tick(30);
    expect(screen.getByText("0:30")).toBeTruthy();
    await tick(95);
    expect(screen.getByText("1:35")).toBeTruthy();
  }, 20_000);

  it("движок темы не пересобирает переменные корня на каждый рендер", async () => {
    render(<App />);
    await startPlayback(); // пара рендеров каркаса: playing, буферизация, трек

    expect(h.sidebarRenders.count).toBeGreaterThan(1); // рендеры реально были
    expect(h.buildThemeVars).toHaveBeenCalledTimes(1); // а тему пересчитали один раз
  }, 20_000);
});
