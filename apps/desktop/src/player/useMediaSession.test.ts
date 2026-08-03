/** Media Session (SMTC Windows) под тиком позиции — аудит 2026-08-03.
 *
 *  Плеер перерисовывается ~4 раза в секунду (тик позиции), и оба эффекта хука
 *  сидели на зависимостях, которые при этом «менялись» по ССЫЛКЕ, ничего не
 *  меняя по существу: track пересобирается в App.tsx на каждый рендер
 *  (подмешивание чищенной обложки), controls — объектный литерал из рендера.
 *  Цена: пересборка MediaMetadata с обложкой-data-URL на сотни килобайт и
 *  10 обращений setActionHandler — четыре раза в секунду, в том числе при
 *  свёрнутом окне (timeupdate не троттлится).
 *
 *  Тесты меряют ровно это — ЧИСЛО обращений к системному API при рендерах, где
 *  по существу ничего не изменилось; плюс сторож на то, что экономия не съела
 *  свежесть (реальная смена трека доезжает, кнопки зовут актуальные колбэки). */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerTrack } from "./types";
import { useMediaSession } from "./useMediaSession";

const trk = (over: Partial<PlayerTrack> = {}): PlayerTrack => ({
  id: "a",
  kind: "catalog",
  title: "Track A",
  artist: "Artist",
  album: "Album",
  duration: 200,
  cover: "data:image/jpeg;base64,огромная-обложка",
  explicit: false,
  loudness: null,
  ...over,
});

let handlers: Record<string, ((d: { seekTime?: number }) => void) | null>;
let setActionHandler: ReturnType<typeof vi.fn>;
let metadataCtor: ReturnType<typeof vi.fn<(init: unknown) => void>>;

beforeEach(() => {
  handlers = {};
  setActionHandler = vi.fn((action: string, fn: ((d: { seekTime?: number }) => void) | null) => {
    handlers[action] = fn;
  });
  // jsdom не знает ни mediaSession, ни MediaMetadata — ставим минимальные
  // заглушки: считаем ровно обращения, которые в проде уходят в SMTC.
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: { metadata: null, playbackState: "none", setActionHandler, setPositionState: vi.fn() },
  });
  metadataCtor = vi.fn<(init: unknown) => void>();
  vi.stubGlobal(
    "MediaMetadata",
    class {
      constructor(init: unknown) {
        metadataCtor(init);
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
});

interface Props {
  track: PlayerTrack | null;
  pos: number;
  toggle: () => void;
}

const mount = (initial: Props) =>
  renderHook(
    (p: Props) =>
      useMediaSession(
        p.track,
        true,
        p.pos,
        // объектный литерал — ровно как в App.tsx: новый на каждый рендер
        { toggle: p.toggle, next: () => {}, prev: () => {}, seek: () => {}, pause: () => {} },
        true,
      ),
    { initialProps: initial },
  );

describe("useMediaSession: тик позиции не дёргает системный API", () => {
  it("метаданные с обложкой строятся один раз, а не на каждый тик позиции", () => {
    const track = trk();
    const { rerender } = mount({ track, pos: 0, toggle: () => {} });
    expect(metadataCtor).toHaveBeenCalledTimes(1);

    // Четыре тика позиции: трек ТОТ ЖЕ по существу, но объект каждый раз
    // новый — ровно то, что приходит из App.tsx (pb.track пересобирается).
    for (let i = 1; i <= 4; i++) {
      act(() => {
        rerender({ track: { ...track }, pos: i * 0.25, toggle: () => {} });
      });
    }

    expect(metadataCtor).toHaveBeenCalledTimes(1);
  });

  it("реально сменившийся трек метаданные всё-таки обновляет", () => {
    const { rerender } = mount({ track: trk(), pos: 0, toggle: () => {} });
    expect(metadataCtor).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ track: trk({ id: "b", title: "Track B" }), pos: 0, toggle: () => {} });
    });

    expect(metadataCtor).toHaveBeenCalledTimes(2);
    expect(metadataCtor).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Track B" }));
  });

  it("сменилась только обложка (кроп доехал) — метаданные обновляются", () => {
    const track = trk({ cover: null });
    const { rerender } = mount({ track, pos: 0, toggle: () => {} });

    act(() => {
      rerender({ track: { ...track, cover: "data:image/jpeg;base64,чищеная" }, pos: 0, toggle: () => {} });
    });

    expect(metadataCtor).toHaveBeenCalledTimes(2);
    expect(metadataCtor).toHaveBeenLastCalledWith(
      expect.objectContaining({ artwork: [{ src: "data:image/jpeg;base64,чищеная", sizes: "512x512" }] }),
    );
  });

  it("обработчики кнопок ставятся один раз, а не переустанавливаются каждый рендер", () => {
    const track = trk();
    const { rerender } = mount({ track, pos: 0, toggle: () => {} });
    const afterMount = setActionHandler.mock.calls.length; // 5 установок

    for (let i = 1; i <= 4; i++) {
      act(() => {
        rerender({ track: { ...track }, pos: i * 0.25, toggle: () => {} });
      });
    }

    expect(setActionHandler.mock.calls.length).toBe(afterMount);
  });

  it("экономия не съела свежесть: кнопка зовёт АКТУАЛЬНЫЙ колбэк, а не с монтирования", () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    const track = trk();
    const { rerender } = mount({ track, pos: 0, toggle: stale });

    act(() => {
      rerender({ track, pos: 0.25, toggle: fresh });
    });
    handlers.play?.({});

    expect(fresh).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });
});
