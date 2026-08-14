/** Дрейф-математика useVideoSync (2026-07-21): est = pos + Δt·speed, сик
 *  только когда |video.currentTime − est| ПРЕВЫШАЕТ допуск 0.35с (граница —
 *  строго ">", не ">="). requestAnimationFrame стенд: мокаем rAF так, чтобы
 *  сами решали, когда исполнить очередной "кадр" — иначе тест либо ждал бы
 *  реальные кадры, либо гонялся бы за таймерами jsdom. */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoSync } from "./useVideoSync";

let rafCb: FrameRequestCallback | null = null;

/** Слушатели стенда: хук подписывается на события ЭЛЕМЕНТА (loadeddata как
 *  фолбэк «кадр появился», loadedmetadata как «можно перематывать»), а стенд —
 *  голый объект, не узел DOM. Держим крошечную свою реализацию вместо честного
 *  <video>: настоящий элемент в jsdom не открывает src, не двигает currentTime
 *  и не отдаёт readyState — то есть ровно та математика, ради которой файл и
 *  написан, стала бы непроверяемой. */
const fakeVideo = (over: Partial<HTMLVideoElement> = {}): HTMLVideoElement => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    readyState: 3,
    currentTime: 0,
    playbackRate: 1,
    paused: false,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    dispatchEvent: (e: Event) => {
      listeners.get(e.type)?.forEach((fn) => fn());
      return true;
    },
    ...over,
  } as unknown as HTMLVideoElement;
};

/** Поднять событие на стенде так же, как это сделал бы браузер. */
const fire = (video: HTMLVideoElement, type: string) => act(() => void video.dispatchEvent(new Event(type)));

beforeEach(() => {
  rafCb = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCb = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Прогнать один "кадр" rAF-цикла (step перерегистрирует себя же в rafCb). */
const tick = () => act(() => void rafCb?.(0));

describe("useVideoSync: дрейф-математика", () => {
  it("Δt·speed внутри допуска (0.3с < 0.35с) — currentTime НЕ трогаем", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));
    expect(rafCb).not.toBeNull();

    now.mockReturnValue(1_000 + 300); // Δt=0.3с, speed=1 → est=10.3, diff=0.3
    tick();

    expect(video.currentTime).toBe(10); // допуск не превышен — без перемотки
  });

  it("Δt·speed СТРОГО превышает допуск (0.4с > 0.35с) — жёсткая перемотка на est", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(2_000);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));

    now.mockReturnValue(2_000 + 400); // Δt=0.4с → est=10.4, diff=0.4 > 0.35
    tick();

    expect(video.currentTime).toBeCloseTo(10.4);
  });

  it("порог 0.35с — граница СТРОГО не включена: ровно 0.35 не перематывает", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(500);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));

    now.mockReturnValue(500 + 350); // diff РОВНО 0.35 — код требует ">", не ">="
    tick();

    expect(video.currentTime).toBe(10);
  });

  it("speed множит экстраполяцию: тот же Δt, но speed=2 удваивает est", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(3_000);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 2 }));

    now.mockReturnValue(3_000 + 200); // Δt=0.2с × speed=2 → est=10.4, diff=0.4>0.35
    tick();

    expect(video.currentTime).toBeCloseTo(10.4);
  });

  it("playing=false — БЕЗ экстраполяции (est=pos), даже с большим Δt перемотки нет", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(4_000);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: false, speed: 1 }));

    now.mockReturnValue(4_000 + 5_000); // 5с реального времени — но на паузе est не растёт
    tick();

    expect(video.currentTime).toBe(10); // est осталась 10 — диапазон не превышен
  });

  it("сик НА ПАУЗЕ выравнивает видео разово, без цикла кадров", () => {
    vi.spyOn(performance, "now").mockReturnValue(6_000);
    const video = fakeVideo({ currentTime: 10 });
    const videoRef = { current: video };

    const { rerender } = renderHook(
      ({ pos }) => useVideoSync(videoRef, { url: "http://x/a.mp4", pos, playing: false, speed: 1 }),
      { initialProps: { pos: 10 } },
    );
    expect(rafCb).toBeNull(); // кадры на паузе не запрашиваются вовсе

    rerender({ pos: 90 }); // перемотали ползунком, стоя на паузе

    expect(video.currentTime).toBe(90);
    expect(rafCb).toBeNull();
  });

  it("readyState=0 (src ещё не открылся) — currentTime не трогаем, даже если дрейф большой", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(5_000);
    const video = fakeVideo({ currentTime: 0, readyState: 0 });
    const videoRef = { current: video };

    renderHook(() => useVideoSync(videoRef, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));

    now.mockReturnValue(5_000 + 1_000);
    tick();

    expect(video.currentTime).toBe(0); // трогать currentTime рано — readyState 0
  });
});

/** РЕГРЕСС 12.08: панель «Сейчас играет» зависала на кадре.
 *
 *  Жалоба владельца (3 из семи): «иногда мини-плеер зависает на определённом
 *  моменте, примерно через десять секунд после начала». На скриншоте — не
 *  обложка, а застывший кадр ВИДЕО.
 *
 *  Механизм самоподдерживающийся. Кадр в панели — удалённый googlevideo-URL,
 *  любая перемотка требует добуферизации. Догон крутился 60 раз в секунду и НЕ
 *  проверял, закончилась ли предыдущая перемотка: пока она шла, дрейф не
 *  уменьшался, и следующий же кадр присваивал currentTime заново — отменяя
 *  незавершённую перемотку и начиная новую. Стоило сети один раз не успеть за
 *  реальным временем — и выйти из петли было уже нельзя.
 *
 *  «Примерно через десять секунд» объясняется ленивым резолвом видео
 *  (useTrackVideo): кадр появляется через секунды после старта трека, и
 *  зависать раньше ему просто нечем. */
describe("useVideoSync: не устраивать шторм перемоток", () => {
  it("перемотка ещё в полёте — currentTime не трогаем ВООБЩЕ", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    // seeking=true — браузер ещё догружает предыдущую цель.
    const video = fakeVideo({ currentTime: 10, seeking: true });

    renderHook(() => useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));

    now.mockReturnValue(1_000 + 5_000); // дрейф огромный
    tick();

    // Именно этой строки не хватало: присвоение здесь отменяло бы перемотку
    // и запускало новую — на 60 кадрах в секунду навсегда.
    expect(video.currentTime).toBe(10);
  });

  it("буфер не тянет вперёд (readyState 2) — перемотка только добавила бы подгрузки", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const video = fakeVideo({ currentTime: 10, readyState: 2 });

    renderHook(() => useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));

    now.mockReturnValue(1_000 + 5_000);
    tick();

    expect(video.currentTime).toBe(10);
  });

  it("троттл: подряд идущие кадры дают ОДНУ перемотку, а не шестьдесят", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(10_000);
    const video = fakeVideo({ currentTime: 10 });

    renderHook(() => useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1 }));

    now.mockReturnValue(10_000 + 1_000); // дрейф 1с — перематываем
    tick();
    expect(video.currentTime).toBeCloseTo(11);

    // Следующие кадры внутри той же секунды: видео «не доехало», дрейф прежний.
    video.currentTime = 10;
    now.mockReturnValue(10_000 + 1_100);
    tick();
    now.mockReturnValue(10_000 + 1_500);
    tick();
    expect(video.currentTime).toBe(10); // ни одной новой перемотки

    // Секунда прошла — коррекция снова разрешена.
    now.mockReturnValue(10_000 + 2_100);
    tick();
    expect(video.currentTime).toBeCloseTo(12.1);
  });

  it("перемотка ползунком на паузе не ждёт троттла: это намерение, а не догон", () => {
    vi.spyOn(performance, "now").mockReturnValue(20_000);
    const video = fakeVideo({ currentTime: 10 });

    const { rerender } = renderHook(
      ({ pos }) => useVideoSync({ current: video }, { url: "http://x/a.mp4", pos, playing: false, speed: 1 }),
      { initialProps: { pos: 10 } },
    );

    rerender({ pos: 90 });
    expect(video.currentTime).toBe(90);
    // И сразу ещё раз — троттл к ручной перемотке отношения не имеет.
    rerender({ pos: 150 });
    expect(video.currentTime).toBe(150);
  });
});

describe("useVideoSync: кадр застыл — зовём хозяина", () => {
  it("звук идёт, кадр не двигается дольше пяти секунд — onStuck", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    // Ровно наблюдаемая картина зависания: перемотка не завершается,
    // currentTime стоит на цели, звук при этом идёт.
    const video = fakeVideo({ currentTime: 42, seeking: true });
    const onStuck = vi.fn();

    renderHook(() =>
      useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 42, playing: true, speed: 1, onStuck }),
    );

    tick(); // первый кадр — запоминаем время кадра
    expect(onStuck).not.toHaveBeenCalled();

    now.mockReturnValue(1_000 + 6_000);
    tick();

    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it("кадр движется — не жалуемся, сколько бы ни шло время", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const video = fakeVideo({ currentTime: 10 });
    const onStuck = vi.fn();

    renderHook(() =>
      useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 10, playing: true, speed: 1, onStuck }),
    );

    for (let i = 1; i <= 10; i++) {
      video.currentTime = 10 + i; // видео честно играет
      now.mockReturnValue(1_000 + i * 1_000);
      tick();
    }

    expect(onStuck).not.toHaveBeenCalled();
  });

  it("на паузе неподвижный кадр — это норма, а не поломка", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const video = fakeVideo({ currentTime: 10 });
    const onStuck = vi.fn();

    // playing=false: rAF-цикла нет вовсе, но и разовое выравнивание не должно
    // принять стоящий кадр за зависание.
    const { rerender } = renderHook(
      ({ pos }) => useVideoSync({ current: video }, { url: "http://x/a.mp4", pos, playing: false, speed: 1, onStuck }),
      { initialProps: { pos: 10 } },
    );
    now.mockReturnValue(1_000 + 60_000);
    rerender({ pos: 10 });

    expect(onStuck).not.toHaveBeenCalled();
  });
});

/** ⚠️ ЦЕНА КАДРОВ (жалоба владельца 02.08: плеер роняет ФПС в играх). Дорого
 *  здесь не сравнение времён, а ДЕКОДИРОВАНИЕ видео — оно идёт, пока элемент
 *  не на паузе, даже когда кадр физически некому показать. */
describe("useVideoSync: когда видео не должно декодироваться", () => {
  /** Подменить document.hidden (в jsdom это read-only геттер прототипа). */
  const setHidden = (v: boolean) =>
    Object.defineProperty(document, "hidden", { configurable: true, get: () => v });

  afterEach(() => setHidden(false));

  it("playing=false — ни одного запрошенного кадра и элемент на паузе", () => {
    const video = fakeVideo();
    renderHook(() => useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 0, playing: false, speed: 1 }));

    expect(rafCb).toBeNull();
    expect(video.pause).toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
  });

  it("окно свёрнуто на момент запуска — играть не начинаем, кадр уезжает с декодера", () => {
    setHidden(true);
    const video = fakeVideo();
    renderHook(() => useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 0, playing: true, speed: 1 }));

    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalled();
  });

  it("свернули и развернули окно на ходу — пауза и возврат к игре", () => {
    const video = fakeVideo();
    renderHook(() => useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 0, playing: true, speed: 1 }));
    expect(video.play).toHaveBeenCalledTimes(1);

    setHidden(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(video.pause).toHaveBeenCalled();

    setHidden(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it("развернули окно, но музыка на паузе — видео так и остаётся стоять", () => {
    setHidden(true);
    const video = fakeVideo();
    renderHook(() => useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 0, playing: false, speed: 1 }));

    setHidden(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(video.play).not.toHaveBeenCalled();
  });
});

/** «ЕСТЬ ЛИ ЧТО ПОКАЗЫВАТЬ» — ответ, ради которого хук вообще что-то возвращает.
 *
 *  Жалоба владельца 14.08: «когда включается видео справа, экран моргает».
 *  Замер кадрами: обложка → пустота ~0.7 с → кадр. Пустота — это <video> без
 *  единого декодированного кадра: по спеке HTML он рисует прозрачную черноту.
 *  Панель обязана спрашивать не «есть ли адрес», а «есть ли КАДР», и ответ
 *  живёт здесь — рядом с элементом, а не в каждом потребителе. */
describe("useVideoSync: кадр есть или кадра нет", () => {
  it("свежий url — кадра ещё нет; loadeddata (фолбэк без rVFC) его объявляет", () => {
    const video = fakeVideo();
    const { result } = renderHook(() =>
      useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 0, playing: true, speed: 1 }),
    );
    expect(result.current).toBe(false);

    fire(video, "loadeddata");
    expect(result.current).toBe(true);
  });

  it("сменился url — ответ мгновенно снова «нет», не дожидаясь новой загрузки", () => {
    const video = fakeVideo();
    const { result, rerender } = renderHook(
      ({ url }) => useVideoSync({ current: video }, { url, pos: 0, playing: true, speed: 1 }),
      { initialProps: { url: "http://x/a.mp4" } },
    );
    fire(video, "loadeddata");
    expect(result.current).toBe(true);

    // Перерезолв протухшего адреса: элемент грузится заново, показывать нечего.
    rerender({ url: "http://x/b.mp4" });
    expect(result.current).toBe(false);
  });

  it("url снят (видео сдалось) — ответ «нет», подписок не остаётся", () => {
    const video = fakeVideo();
    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => useVideoSync({ current: video }, { url, pos: 0, playing: true, speed: 1 }),
      { initialProps: { url: "http://x/a.mp4" as string | null } },
    );
    fire(video, "loadeddata");
    expect(result.current).toBe(true);

    rerender({ url: null });
    expect(result.current).toBe(false);
    // событие после отписки ничего не воскрешает
    fire(video, "loadeddata");
    expect(result.current).toBe(false);
  });

  it("первый кадр берётся сразу С ПОЗИЦИИ ЗВУКА, а не с начала клипа", () => {
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    // readyState 1: метаданные есть, играть вперёд нечем — догон в этот момент
    // ещё молчит, и без разового выравнивания первым нарисованным кадром был бы
    // ноль, а следом сразу прыжок на позицию звука. Две смены картинки там, где
    // договорились не иметь ни одной.
    const video = fakeVideo({ currentTime: 0, readyState: 1 });
    renderHook(() =>
      useVideoSync({ current: video }, { url: "http://x/a.mp4", pos: 87, playing: true, speed: 1 }),
    );

    fire(video, "loadedmetadata");

    expect(video.currentTime).toBe(87);
  });
});
