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
import { mediaAnchor } from "./mediaAnchor";
import { createPositionStore, type PositionStore } from "./positionStore";
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
let setPositionState: ReturnType<typeof vi.fn>;
/** Позиция приезжает сюда хранилищем, а не пропом — см. шапку positionStore.ts. */
let store: PositionStore;

beforeEach(() => {
  handlers = {};
  store = createPositionStore(0);
  setPositionState = vi.fn();
  setActionHandler = vi.fn((action: string, fn: ((d: { seekTime?: number }) => void) | null) => {
    handlers[action] = fn;
  });
  // jsdom не знает ни mediaSession, ни MediaMetadata — ставим минимальные
  // заглушки: считаем ровно обращения, которые в проде уходят в SMTC.
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: { metadata: null, playbackState: "none", setActionHandler, setPositionState },
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
  // Хук держит якорь сессии (mediaAnchor.ts) настоящим `<audio>`, а jsdom
  // объявляет play/pause «не реализовано». Глушим их на весь файл: тесты выше
  // про якорь ничего не знают и знать не должны.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
});

interface Props {
  track: PlayerTrack | null;
  toggle: () => void;
}

const mount = (initial: Props) =>
  renderHook(
    (p: Props) =>
      useMediaSession(
        p.track,
        true,
        store,
        // объектный литерал — ровно как в App.tsx: новый на каждый рендер
        { toggle: p.toggle, next: () => {}, prev: () => {}, seek: () => {}, pause: () => {} },
        true,
      ),
    { initialProps: initial },
  );

describe("useMediaSession: тик позиции не дёргает системный API", () => {
  it("метаданные с обложкой строятся один раз, а не на каждый тик позиции", () => {
    const track = trk();
    const { rerender } = mount({ track, toggle: () => {} });
    expect(metadataCtor).toHaveBeenCalledTimes(1);

    // Четыре тика позиции: трек ТОТ ЖЕ по существу, но объект каждый раз
    // новый — ровно то, что приходит из App.tsx (pb.track пересобирается).
    for (let i = 1; i <= 4; i++) {
      act(() => {
        store.set(i * 0.25);
        rerender({ track: { ...track }, toggle: () => {} });
      });
    }

    expect(metadataCtor).toHaveBeenCalledTimes(1);
  });

  it("реально сменившийся трек метаданные всё-таки обновляет", () => {
    const { rerender } = mount({ track: trk(), toggle: () => {} });
    expect(metadataCtor).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ track: trk({ id: "b", title: "Track B" }), toggle: () => {} });
    });

    expect(metadataCtor).toHaveBeenCalledTimes(2);
    expect(metadataCtor).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Track B" }));
  });

  it("сменилась только обложка (кроп доехал) — метаданные обновляются", () => {
    const track = trk({ cover: null });
    const { rerender } = mount({ track, toggle: () => {} });

    act(() => {
      rerender({ track: { ...track, cover: "data:image/jpeg;base64,чищеная" }, toggle: () => {} });
    });

    expect(metadataCtor).toHaveBeenCalledTimes(2);
    expect(metadataCtor).toHaveBeenLastCalledWith(
      expect.objectContaining({ artwork: [{ src: "data:image/jpeg;base64,чищеная", sizes: "512x512" }] }),
    );
  });

  it("обработчики кнопок ставятся один раз, а не переустанавливаются каждый рендер", () => {
    const track = trk();
    const { rerender } = mount({ track, toggle: () => {} });
    const afterMount = setActionHandler.mock.calls.length; // 5 установок

    for (let i = 1; i <= 4; i++) {
      act(() => {
        store.set(i * 0.25);
        rerender({ track: { ...track }, toggle: () => {} });
      });
    }

    expect(setActionHandler.mock.calls.length).toBe(afterMount);
  });

  it("экономия не съела свежесть: кнопка зовёт АКТУАЛЬНЫЙ колбэк, а не с монтирования", () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    const track = trk();
    const { rerender } = mount({ track, toggle: stale });

    act(() => {
      store.set(0.25);
      rerender({ track, toggle: fresh });
    });
    handlers.play?.({});

    expect(fresh).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });
});

/** Позиция едет в системный оверлей ПОДПИСКОЙ, а не пропом (03.08).
 *
 *  Сторож против «упрощения назад»: вернуть сюда `pos: number` — значит
 *  вернуть перерисовку всего App четыре раза в секунду, потому что зовут этот
 *  хук из тела App (см. шапку positionStore.ts). Проверяем оба свойства
 *  сделки: свежесть в SMTC осталась (иначе на медиа-оверлее Windows встанут
 *  часы) и рендеров при этом ноль. */
describe("useMediaSession: позиция уезжает в SMTC без рендера", () => {
  it("смена целой секунды доезжает до оверлея, хотя хук не перерисовывался", () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useMediaSession(
        trk(),
        true,
        store,
        { toggle: () => {}, next: () => {}, prev: () => {}, seek: () => {}, pause: () => {} },
        true,
      );
    });
    act(() => {
      store.set(45);
    });
    const rendersAtStart = renders;
    setPositionState.mockClear();

    // Внутри секунды системному оверлею сообщать нечего — он дорисовывает сам
    act(() => {
      store.set(45.25);
      store.set(45.5);
      store.set(45.75);
    });
    expect(setPositionState).not.toHaveBeenCalled();

    act(() => {
      store.set(46);
    });

    expect(setPositionState).toHaveBeenCalledTimes(1);
    expect(setPositionState).toHaveBeenLastCalledWith(expect.objectContaining({ position: 46, duration: 200 }));
    expect(renders).toBe(rendersAtStart); // ни одного рендера ради часов оверлея
  });
});

/** Якорь сессии — фундамент под всем, что делает этот хук (регрессия 10.08).
 *
 *  Здесь проверяется только ПРОВОДКА: хук обязан держать якорь ровно тогда,
 *  когда система должна видеть Музу играющей. Сам якорь и его свойства — в
 *  mediaAnchor.test.ts, физика вопроса и замер — в шапке mediaAnchor.ts. */
describe("useMediaSession: якорь системной сессии", () => {
  let hold: ReturnType<typeof vi.spyOn>;
  let suspend: ReturnType<typeof vi.spyOn>;
  let release: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hold = vi.spyOn(mediaAnchor, "hold").mockImplementation(() => {});
    suspend = vi.spyOn(mediaAnchor, "suspend").mockImplementation(() => {});
    release = vi.spyOn(mediaAnchor, "release").mockImplementation(() => {});
  });
  afterEach(() => {
    hold.mockRestore();
    suspend.mockRestore();
    release.mockRestore();
  });

  interface AnchorProps {
    track: PlayerTrack | null;
    playing: boolean;
    enabled?: boolean;
  }
  const mountAnchor = (initial: AnchorProps) =>
    renderHook(
      (p: AnchorProps) =>
        useMediaSession(
          p.track,
          p.playing,
          store,
          { toggle: () => {}, next: () => {}, prev: () => {}, seek: () => {}, pause: () => {} },
          p.enabled ?? true,
        ),
      { initialProps: initial },
    );

  it("трек играет — якорь держим (без него метаданные выше уходят в никуда)", () => {
    mountAnchor({ track: trk(), playing: true });

    expect(hold).toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("пауза — якорь усыплён, но НЕ отпущен: карточка Музы обязана пережить паузу", () => {
    const { rerender } = mountAnchor({ track: trk(), playing: true });

    act(() => {
      rerender({ track: trk(), playing: false });
    });

    expect(suspend).toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("трек кончился — сессию отпускаем", () => {
    const { rerender } = mountAnchor({ track: trk(), playing: true });
    release.mockClear();

    act(() => {
      rerender({ track: null, playing: false });
    });

    expect(release).toHaveBeenCalled();
  });

  it("медиаклавиши выключены в настройках — якоря нет вовсе", () => {
    mountAnchor({ track: trk(), playing: true, enabled: false });

    expect(hold).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it("тик позиции якорь не дёргает: трек приходит новым объектом 4 раза в секунду", () => {
    const track = trk();
    const { rerender } = mountAnchor({ track, playing: true });
    hold.mockClear();

    for (let i = 1; i <= 4; i++) {
      act(() => {
        store.set(i * 0.25);
        rerender({ track: { ...track }, playing: true });
      });
    }

    expect(hold).not.toHaveBeenCalled();
  });

  it("размонтирование отпускает сессию — закрытое окно не должно держать медиаклавиши", () => {
    const { unmount } = mountAnchor({ track: trk(), playing: true });
    release.mockClear();

    unmount();

    expect(release).toHaveBeenCalled();
  });
});
