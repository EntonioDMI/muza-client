/** Интеграция редизайна Wrapped (2026-07-16): оверлей владеет жизненным
 *  циклом эмбиент-канала (player/wrappedAmbient) и регулятором громкости за
 *  иконкой в правом верхнем углу.
 *
 *  Канал замокан: его собственное поведение (фейды, гонки, восстановление
 *  плеера) уже покрыто player/wrappedAmbient.test.ts — здесь проверяется
 *  ТОЛЬКО контракт оверлея: когда start/stop, что уходит в resolve, как
 *  слайдер бьёт в setVolume и в prefs-колбэк.
 *
 *  Рендер без LanguageProvider → useT() фолбэкает на EN (прецедент
 *  PlaylistView.test.tsx) — ассерты на английские строки. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, Track, Wrapped } from "@muza/api-client";
import type { WrappedAmbientDeps } from "../player/wrappedAmbient";
import { WrappedOverlay, type WrappedOverlayAmbient } from "./WrappedOverlay";

const h = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  setVolume: vi.fn(),
  deps: { current: null as unknown as WrappedAmbientDeps },
}));

vi.mock("../player/wrappedAmbient", () => ({
  WrappedAmbient: class {
    start = h.start;
    stop = h.stop;
    setVolume = h.setVolume;
    constructor(deps: WrappedAmbientDeps) {
      h.deps.current = deps;
    }
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const track = (id: string, title: string): Track => ({
  id,
  artist: `Artist ${id}`,
  title,
  durationSec: 200,
  coverUrl: null,
  isCached: false,
  sources: ["youtube"],
  loudness: null,
  localHash: null,
});

const fullWrapped: Wrapped = {
  year: 2026,
  totalPlays: 320,
  totalMs: 5_400_000,
  uniqueTracks: 80,
  uniqueArtists: 30,
  activeDays: 120,
  longestStreakDays: 9,
  peakDay: { date: "2026-03-08", ms: 3_600_000 },
  topHour: 17,
  favoritesAdded: 12,
  topTracks: [
    { track: track("t1", "Alpha"), plays: 42, playedMs: 900_000 },
    { track: track("t2", "Beta"), plays: 30, playedMs: 700_000 },
  ],
  topArtists: [
    { artist: "Nova", plays: 50, playedMs: 1_200_000 },
    { artist: "Echo", plays: 20, playedMs: 400_000 },
  ],
  firstTrack: track("t0", "First"),
  firstPlayAt: "2026-01-02T10:00:00Z",
};

const emptyWrapped: Wrapped = {
  ...fullWrapped,
  totalPlays: 0,
  totalMs: 0,
  uniqueTracks: 0,
  uniqueArtists: 0,
  topTracks: [],
  topArtists: [],
  firstTrack: null,
  firstPlayAt: null,
  topHour: null,
  peakDay: null,
};

function makeAmbientProps() {
  return {
    resolveTrackUrl: vi.fn(async (_id: string) => "asset://top"),
    playerPlaying: false,
    pausePlayer: vi.fn(),
    resumePlayer: vi.fn(),
    volume: 20,
    onVolumeChange: vi.fn((_v: number) => undefined),
  } satisfies WrappedOverlayAmbient;
}

function renderOverlay(data: Wrapped, ambient = makeAmbientProps()) {
  const api = { getWrapped: vi.fn().mockResolvedValue(data) } as unknown as MuzaApi;
  const onClose = vi.fn();
  const view = render(
    <WrappedOverlay api={api} open onClose={onClose} onShare={() => undefined} ambient={ambient} />,
  );
  return { view, api, onClose, ambient };
}

describe("WrappedOverlay × эмбиент", () => {
  it("год с прослушиваниями: канал стартует с громкостью из prefs, резолв бьёт в топ-трек", async () => {
    const { ambient } = renderOverlay(fullWrapped);
    await waitFor(() => expect(h.start).toHaveBeenCalledWith(20));
    // Обёртка resolve, которую оверлей отдал каналу, должна добывать топ-трек года
    await h.deps.current.resolve();
    expect(ambient.resolveTrackUrl).toHaveBeenCalledWith("t1");
  });

  it("пустой год: слайд-заглушка без эмбиента", async () => {
    renderOverlay(emptyWrapped);
    await waitFor(() =>
      expect(screen.getByText("This year is still waiting for its first track")).toBeTruthy(),
    );
    expect(h.start).not.toHaveBeenCalled();
  });

  it("размонтирование оверлея гасит канал", async () => {
    const { view } = renderOverlay(fullWrapped);
    await waitFor(() => expect(h.start).toHaveBeenCalled());
    view.unmount();
    expect(h.stop).toHaveBeenCalled();
  });

  it("регулятор за иконкой: клик открывает поповер, слайдер меняет громкость канала и prefs", async () => {
    const { ambient } = renderOverlay(fullWrapped);
    await waitFor(() => expect(h.start).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Sound of the year" }));
    const slider = await screen.findByRole("slider", { name: "Sound of the year volume" });
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight", code: "ArrowRight" });

    expect(h.setVolume).toHaveBeenCalledWith(21);
    expect(ambient.onVolumeChange).toHaveBeenCalledWith(21);
    // Стрелка в слайдере НЕ листает историю: window-слушатель оверлея capture
    // и получает keydown раньше stopPropagation слайдера (живой репро 16.07)
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
  });
});

describe("WrappedOverlay × слайды (фиксация поведения)", () => {
  it("полные данные: шесть слайдов в прогрессе, история начинается с intro", async () => {
    renderOverlay(fullWrapped);
    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuemax")).toBe("6");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(screen.getByText("This was your year.", { exact: false })).toBeTruthy();
  });

  it("Escape закрывает оверлей", async () => {
    const { onClose } = renderOverlay(fullWrapped);
    await waitFor(() => expect(h.start).toHaveBeenCalled());
    fireEvent.keyDown(window, { code: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

/** Уход слайда знают двое: CSS-анимация .is-leaving-* и таймер, снимающий
 *  уходящую копию из дерева. До 05.08 у них были РАЗНЫЕ числа (240мс и 260мс),
 *  и они успели разъехаться; теперь число одно — оно живёт в TSX и уезжает в
 *  CSS переменной --wr-leave на корне оверлея.
 *
 *  ⚠️ Что именно стережёт первый тест: ПРОВОДКУ. Стилей в jsdom нет, сверить
 *  таймер с реальной длительностью анимации отсюда нельзя — поэтому он
 *  проверяет, что переменная вообще выставлена и что таймер отрабатывает
 *  ровно её значение. Развяжут их снова (переменную выставят одним числом, а
 *  таймер заведут другим) — тест упадёт. */
describe("WrappedOverlay × уход слайда: одно число на анимацию и на таймер", () => {
  /** Пролистнуть вперёд кликом по сцене (тот же путь, что у пользователя). */
  const flip = (root: HTMLElement) => fireEvent.click(root);

  it("таймер снятия копии отрабатывает ровно то число, что уехало в CSS", async () => {
    renderOverlay(fullWrapped);
    const root = await screen.findByRole("dialog");

    // Часы подменяем ПОСЛЕ загрузки данных: иначе промис api не доехал бы.
    vi.useFakeTimers();
    try {
      flip(root);
      expect(root.querySelector(".wrapped__slide.is-leaving")).toBeTruthy();

      const declared = root.style.getPropertyValue("--wr-leave");
      expect(declared).toMatch(/^\d+ms$/);
      const ms = Number.parseInt(declared, 10);

      // За миг до конца анимации копия обязана быть на месте…
      act(() => void vi.advanceTimersByTime(ms - 1));
      expect(root.querySelector(".wrapped__slide.is-leaving")).toBeTruthy();
      // …и ровно на нём — исчезнуть. Разъедься числа снова — упадёт одна из двух.
      act(() => void vi.advanceTimersByTime(1));
      expect(root.querySelector(".wrapped__slide.is-leaving")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("уходящая копия — стоп-кадр: цифра не пересчитывается с нуля на лету", async () => {
    renderOverlay(fullWrapped);
    const root = await screen.findByRole("dialog");

    flip(root); // intro → minutes
    flip(root); // minutes → tracks, уходит копия слайда с count-up
    const leaving = root.querySelector(".wrapped__slide.is-leaving");

    // 5 400 000 мс = 90 минут. Копия показывает ИТОГ; до фикса CountUp
    // монтировался с нуля, и улетающий слайд начинал считать заново.
    expect(leaving?.textContent).toContain("90");
  });
});
