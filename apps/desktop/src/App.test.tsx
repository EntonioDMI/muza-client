/** Интеграционный тест каркаса App: выход из режима прослушивания обязан
 *  вернуть пользователя на ТУ ЖЕ вкладку, с которой режим открыли (жалоба
 *  владельца 2026-07-16: «выкидывает на главную»).
 *
 *  Уровень — настоящий <App/> с реальными Sidebar/PlayerBar/ListeningMode и
 *  реальным view-стейтом: юнит на ListeningMode этот класс багов не поймает,
 *  связка «оверлей ↔ вкладки» живёт целиком в App.tsx. Замокан только край:
 *  HttpMuzaApi (сеть) и AudioEngine (Web Audio, в jsdom его нет). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => {
  /** Незамоканный явно метод API возвращает вечный pending — как медленная
   *  сеть: каркас обязан строиться, не дожидаясь ни одного ответа. */
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
  return { api, impl };
});

// Сеть: App сам делает `new HttpMuzaApi(...)` — подсовываем прокси-стенд.
// importActual, а не полный мок: LoginScreen/SettingsView импортируют из
// пакета runtime-значения (ApiError, zod-схемы) — они нужны настоящие.
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

// Web Audio в jsdom нет — тот же стенд-класс, что в usePlayback.test.ts.
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

import { App } from "./App";

/** jsdom не реализует matchMedia (см. ListeningMode.test.tsx) — минимальная
 *  заглушка для useMediaQuery/prefersReducedMotion. matches=false: узкое окно,
 *  панель «Сейчас играет» не рендерится — тесту она не нужна. */
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

/** Трек в баре ещё до кликов: prefs.resumePosition + указатель «последний
 *  активный» (T2) — иначе оба входа в режим прослушивания недоступны.
 *  language фиксируем явно: без него resolveMigratedLanguage() даёт "ru" —
 *  не полагаемся на дефолт миграции, строки ниже подобраны под ru. */
function seedResumedTrack() {
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

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia();
  seedResumedTrack();
  h.impl.restoreSession = vi.fn().mockResolvedValue(session);
  h.impl.getPlaylists = vi.fn().mockResolvedValue([]);
  h.impl.getFavorites = vi.fn().mockResolvedValue([]);
  h.impl.adminPing = vi.fn().mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  for (const key of Object.keys(h.impl)) delete h.impl[key];
});

describe("App — выход из режима прослушивания возвращает исходную вкладку", () => {
  it("Любимое → режим прослушивания → Escape → снова Любимое, не главная", async () => {
    render(<App />);

    // Каркас собрался (restoreSession отработал), уходим с главной на «Любимое»
    const favTab = await screen.findByRole("button", { name: "Любимое" });
    fireEvent.click(favTab);
    await screen.findByRole("heading", { name: "Любимое" });

    // Вход в режим прослушивания: у бара ДВА входа с одним именем (обложка
    // и кнопка «развернуть») — берём первый, обложку
    fireEvent.click(screen.getAllByRole("button", { name: "Режим прослушивания" })[0]);
    const lm = screen.getByTestId("listening-mode");
    await waitFor(() => expect(lm.style.opacity).toBe("1"));

    // Выход по Escape
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("listening-mode").style.opacity).toBe("0"));

    // Исходная вкладка на месте, на главную не выкинуло
    expect(screen.getByRole("heading", { name: "Любимое" })).toBeTruthy();
    // Рендер целого App: под полным сьютом (36 файлов параллельно) дефолтных
    // 5с не хватает — изолированно тест идёт ~3с, под нагрузкой ловил 5.9с
  }, 15_000);

  /** Корень жалобы: Alt+← (и боковые кнопки мыши в Tauri) листали вкладки ПОД
   *  оверлеем — визуально ноль реакции, пользователь жмёт «назад» до упора,
   *  дно истории — всегда стартовая главная. Правильное поведение: «назад»
   *  внутри режима — это выход ИЗ режима, вкладка остаётся исходной. */
  it("Alt+← внутри режима закрывает его и НЕ листает вкладки под ним", async () => {
    render(<App />);

    const favTab = await screen.findByRole("button", { name: "Любимое" });
    fireEvent.click(favTab);
    await screen.findByRole("heading", { name: "Любимое" });

    fireEvent.click(screen.getAllByRole("button", { name: "Режим прослушивания" })[0]);
    await waitFor(() => expect(screen.getByTestId("listening-mode").style.opacity).toBe("1"));

    // Жест «назад» — выход из оверлея, а не невидимый navBack (история под
    // оверлеем: [главная, Любимое] — navBack увёл бы на главную)
    fireEvent.keyDown(window, { key: "ArrowLeft", code: "ArrowLeft", altKey: true });
    await waitFor(() => expect(screen.getByTestId("listening-mode").style.opacity).toBe("0"));

    expect(screen.getByRole("heading", { name: "Любимое" })).toBeTruthy();
  }, 15_000);

  it("выход кнопкой «Свернуть» тоже сохраняет вкладку", async () => {
    render(<App />);

    const favTab = await screen.findByRole("button", { name: "Любимое" });
    fireEvent.click(favTab);
    await screen.findByRole("heading", { name: "Любимое" });

    fireEvent.click(screen.getAllByRole("button", { name: "Режим прослушивания" })[0]);
    await waitFor(() => expect(screen.getByTestId("listening-mode").style.opacity).toBe("1"));

    // Слой контролов просыпается на входе — кнопка кликабельна сразу
    fireEvent.click(screen.getByRole("button", { name: "Свернуть" }));
    await waitFor(() => expect(screen.getByTestId("listening-mode").style.opacity).toBe("0"));

    expect(screen.getByRole("heading", { name: "Любимое" })).toBeTruthy();
  }, 15_000);
});
