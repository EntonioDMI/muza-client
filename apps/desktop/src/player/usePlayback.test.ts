/** Репро жалобы владельца (2026-07-15): «включаешь песню, она ещё не
 *  загрузилась — играет старая, и её никак не выключить, пока новая не
 *  загрузится».
 *
 *  Оба дефекта проверяются по НАБЛЮДАЕМОМУ поведению движка (шпионы
 *  play/pause), а не по внутренним флагам хука и не по новым модулям:
 *  тест обязан краснеть на СТАРОМ коде по существу («старый трек не
 *  заглушили», «трек заиграл после паузы»), а не на отсутствии импорта.
 *
 *  Управляемая добыча (deferResolve) — стенд вместо живого cache-miss:
 *  yt-dlp качает файл секундами, и всё окно между кликом и engine.play()
 *  и есть предмет бага. */

import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MuzaApi, TrackSource } from "@muza/api-client";
import { DEFAULT_PREFS, type Prefs } from "../types";
import type { EngineCallbacks } from "./audioEngine";
import type { PlayerTrack } from "./types";
import { usePlayback } from "./usePlayback";

const h = vi.hoisted(() => ({
  resolvePlayable: vi.fn(),
  getTrackSources: vi.fn(),
  onError: vi.fn(),
  engine: {
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    position: vi.fn(),
    preload: vi.fn(),
    setVolume: vi.fn(),
    setSpeed: vi.fn(),
    setEq: vi.fn(),
    analyser: vi.fn(),
  },
  /** Колбэки, которые usePlayback отдал движку — ими эмулируем timeupdate. */
  cb: { current: null as EngineCallbacks | null },
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  isTauri: () => true,
  invoke: vi.fn(),
}));

vi.mock("../lib/engine", () => ({
  engineAvailable: () => true,
  resolvePlayable: h.resolvePlayable,
}));

vi.mock("./audioEngine", () => ({
  AudioEngine: class {
    static normFactor = () => 1;
    play = h.engine.play;
    pause = h.engine.pause;
    resume = h.engine.resume;
    stop = h.engine.stop;
    seek = h.engine.seek;
    position = h.engine.position;
    preload = h.engine.preload;
    setVolume = h.engine.setVolume;
    setSpeed = h.engine.setSpeed;
    setEq = h.engine.setEq;
    analyser = h.engine.analyser;
    constructor(cb: EngineCallbacks) {
      h.cb.current = cb;
    }
  },
}));

const trk = (id: string): PlayerTrack => ({
  id,
  kind: "catalog",
  title: `Track ${id}`,
  artist: "Artist",
  album: "",
  duration: 200,
  cover: null,
  explicit: false,
  loudness: null,
});

const A = trk("a");
const B = trk("b");

const api = { getTrackSources: h.getTrackSources } as unknown as MuzaApi;

const mount = (prefs: Partial<Prefs> = {}) =>
  renderHook(() =>
    usePlayback({
      api,
      initialQueue: [A, B],
      prefs: { ...DEFAULT_PREFS, ...prefs },
      onError: h.onError,
    }),
  );

type Hook = RenderHookResult<ReturnType<typeof usePlayback>, unknown>;

/** Держим добычу «висящей», как yt-dlp на cache-miss; вернувшийся колбэк её отпускает. */
function deferResolve(url: string): () => void {
  let release!: () => void;
  h.resolvePlayable.mockReturnValueOnce(
    new Promise((res) => {
      release = () => res({ url, fromCache: false, provider: "youtube" });
    }),
  );
  return release;
}

/** Довести трек A до реально играющего состояния (добыча мгновенна = кэш-хит). */
async function playA({ result }: Hook): Promise<void> {
  h.resolvePlayable.mockResolvedValueOnce({ url: "a.webm", fromCache: true, provider: "youtube" });
  await act(async () => {
    result.current.playContext([A, B], "a");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Реализации задаём явно: clearAllMocks стирает только вызовы, а reset —
  // и реализации; position без неё вернул бы undefined и remaining стал бы NaN.
  h.engine.play.mockImplementation(async () => {});
  h.engine.resume.mockImplementation(async () => {});
  h.engine.position.mockReturnValue(0);
  h.engine.analyser.mockReturnValue(null);
  h.resolvePlayable.mockReset();
  h.getTrackSources.mockImplementation(async () => []);
  h.cb.current = null;
});

describe("usePlayback: старый трек и добыча нового", () => {
  it("ручной клик глушит играющий трек ДО добычи нового, а не после", async () => {
    const hook = mount();
    await playA(hook);
    expect(h.engine.play).toHaveBeenCalledTimes(1);
    h.engine.pause.mockClear();

    const releaseB = deferResolve("b.webm");
    await act(async () => {
      hook.result.current.playContext([A, B], "b");
    });

    // Добыча B ещё идёт (releaseB не вызван) — ровно то окно, в котором
    // владелец слышит старую песню. Движок обязан уже молчать.
    expect(h.engine.pause).toHaveBeenCalledTimes(1);
    expect(h.engine.play).toHaveBeenCalledTimes(1); // новый ещё не заводился
    expect(hook.result.current.buffering).toBe(true);

    await act(async () => {
      releaseB();
    });
    expect(h.engine.play).toHaveBeenCalledTimes(2); // добыли — заиграл
  });

  it("пауза во время добычи не даёт треку заиграть, когда добыча пришла", async () => {
    const hook = mount();
    await playA(hook);

    const releaseB = deferResolve("b.webm");
    await act(async () => {
      hook.result.current.playContext([A, B], "b");
    });
    expect(hook.result.current.buffering).toBe(true);

    // Пользователь жмёт паузу, пока крутится спиннер добычи
    await act(async () => {
      hook.result.current.toggle();
    });
    expect(hook.result.current.playing).toBe(false);

    const playsBefore = h.engine.play.mock.calls.length;
    await act(async () => {
      releaseB();
    });

    // Нажатие паузы обязано пережить приход добычи: трек не заводится сам.
    expect(h.engine.play).toHaveBeenCalledTimes(playsBefore);
    expect(hook.result.current.playing).toBe(false);
    // Спиннер тоже обязан погаснуть — ждать больше нечего.
    expect(hook.result.current.buffering).toBe(false);
  });

  it("после паузы во время добычи play заводит трек заново", async () => {
    const hook = mount();
    await playA(hook);

    const releaseB = deferResolve("b.webm");
    await act(async () => {
      hook.result.current.playContext([A, B], "b");
    });
    await act(async () => {
      hook.result.current.toggle();
    });
    await act(async () => {
      releaseB();
    });

    // Отменённый старт не оставил движок заряженным — play обязан добыть
    // заново, а не «возобновить» слот (там ещё старый трек: resume завёл бы
    // ЕГО, а бар показывал бы новый — ровно тот рассинхрон, от которого
    // startedIdRef и заведён, см. T2 в knowledge).
    h.resolvePlayable.mockResolvedValueOnce({ url: "b.webm", fromCache: true, provider: "youtube" });
    await act(async () => {
      hook.result.current.toggle();
    });
    expect(hook.result.current.playing).toBe(true);
    expect(h.engine.resume).not.toHaveBeenCalled();
    expect(h.engine.play).toHaveBeenLastCalledWith("b.webm", 1, 0);
  });

  it("автопереход с кроссфейдом НЕ глушит старый трек — он перетекает в новый", async () => {
    const hook = mount({ crossfade: true });
    await playA(hook);
    // Шаффл — чтобы соседа НЕ преднагрузили (usePlayback не греет его при
    // shuffle) и авто-переход пошёл через живую добычу. Иначе тест прошёл бы
    // по мгновенной ветке preloaded и про auto не доказал бы ничего.
    act(() => {
      hook.result.current.toggleShuffle();
    });
    h.engine.pause.mockClear();

    const releaseB = deferResolve("b.webm");
    await act(async () => {
      h.cb.current?.onTime(197); // remaining 3с ≤ кроссфейд 4с → ранний стык
    });

    expect(h.engine.pause).not.toHaveBeenCalled();
    await act(async () => {
      releaseB();
    });
    // Кроссфейд доехал до движка — глушение его не подменило
    expect(h.engine.play).toHaveBeenLastCalledWith("b.webm", 1, 4);
  });

  it("предзагруженный трек стартует мгновенно — глушить нечего", async () => {
    const hook = mount();
    await playA(hook);

    // Прогреваем преднагрузку соседа (remaining 15с ≤ PRELOAD_AHEAD_SEC)
    h.resolvePlayable.mockResolvedValueOnce({ url: "b.webm", fromCache: true, provider: "youtube" });
    await act(async () => {
      h.cb.current?.onTime(185);
    });
    expect(h.engine.preload).toHaveBeenCalledWith("b.webm");
    h.engine.pause.mockClear();

    // Ручной next: URL уже в руках, добычи не будет — паузе взяться неоткуда
    await act(async () => {
      hook.result.current.next();
    });

    expect(h.engine.pause).not.toHaveBeenCalled();
    expect(h.engine.play).toHaveBeenCalledTimes(2);
  });
});

/** Кэш источников (getTrackSources) в resolveForTrack: до него КАЖДЫЙ резолв —
 *  даже повторный клик по треку, чей файл давно в Rust LRU-кэше — платил полный
 *  RTT до сервера. Проверяем по вызовам api-мока, как и весь файл: краснота на
 *  старом коде — по существу (лишние сетевые вызовы), не по отсутствию импорта,
 *  поэтому сам модуль кэша здесь НЕ импортируется. Кэш в реализации — модульный
 *  singleton, он переживает соседние тесты файла: у каждого теста СВОИ id
 *  треков, чтобы не ловить чужие прогретые записи. */
describe("usePlayback: кэш источников (getTrackSources)", () => {
  /** Сколько раз ходили на сервер за источниками ИМЕННО этого трека. */
  const callsFor = (id: string) => h.getTrackSources.mock.calls.filter((c) => c[0] === id).length;

  const source = (trackId: string): TrackSource => ({
    id: `s-${trackId}`,
    provider: "youtube",
    sourceId: `yt-${trackId}`,
    url: "",
    priority: 100,
    kind: "catalog",
    durationSec: 0,
    isChosen: false,
  });

  it("повторный резолв того же трека не дёргает getTrackSources — источники из кэша", async () => {
    const T1 = trk("c1");
    const T2 = trk("c2");
    h.getTrackSources.mockImplementation(async (id: string) => [source(id)]);
    const hook = mount();

    h.resolvePlayable.mockResolvedValue({ url: "c.webm", fromCache: true, provider: "youtube" });
    await act(async () => {
      hook.result.current.playContext([T1, T2], "c1");
    });
    expect(callsFor("c1")).toBe(1);

    // ушли на соседний трек и вернулись — второй резолв c1 обязан пройти без сети
    await act(async () => {
      hook.result.current.playContext([T1, T2], "c2");
    });
    await act(async () => {
      hook.result.current.playContext([T1, T2], "c1");
    });

    expect(callsFor("c1")).toBe(1);
    // кэш скормил движку РЕАЛЬНУЮ лестницу, а не пустую (иначе «экономия»
    // сломала бы добычу: пустая лестница = только оффлайн-кэш)
    expect(h.resolvePlayable.mock.calls.at(-1)?.[1]).toEqual([
      expect.objectContaining({ sourceId: "yt-c1" }),
    ]);
    expect(h.engine.play).toHaveBeenCalledTimes(3); // само воспроизведение кэш не тронул
  });

  it("ошибка резолва сбрасывает запись кэша — следующая попытка берёт свежие источники", async () => {
    const T1 = trk("e1");
    const T2 = trk("e2");
    h.getTrackSources.mockImplementation(async (id: string) => [source(id)]);
    const hook = mount();

    // прогрев: успешный старт e1, затем уход на e2
    h.resolvePlayable.mockResolvedValueOnce({ url: "e1.webm", fromCache: false, provider: "youtube" });
    await act(async () => {
      hook.result.current.playContext([T1, T2], "e1");
    });
    h.resolvePlayable.mockResolvedValueOnce({ url: "e2.webm", fromCache: false, provider: "youtube" });
    await act(async () => {
      hook.result.current.playContext([T1, T2], "e2");
    });
    expect(callsFor("e1")).toBe(1);

    // возврат к e1: источники берутся из кэша, но лестница целиком не заиграла
    // (источник умер на стороне провайдера)
    const resolvesBefore = h.resolvePlayable.mock.calls.length;
    const playsBefore = h.engine.play.mock.calls.length;
    h.resolvePlayable.mockRejectedValueOnce(new Error("умер источник"));
    await act(async () => {
      hook.result.current.playContext([T1, T2], "e1");
    });
    expect(callsFor("e1")).toBe(1); // упавший резолв шёл по кэшу, не по сети
    // семантика ошибки не изменилась: честный тост, БЕЗ авто-повтора внутри клика
    expect(h.onError).toHaveBeenCalledWith("умер источник");
    expect(h.resolvePlayable.mock.calls.length).toBe(resolvesBefore + 1);
    expect(h.engine.play.mock.calls.length).toBe(playsBefore);
    expect(hook.result.current.playing).toBe(false);

    // повторная попытка человека: запись сброшена — за источниками идём заново
    h.resolvePlayable.mockResolvedValueOnce({ url: "e1-fresh.webm", fromCache: false, provider: "youtube" });
    await act(async () => {
      hook.result.current.toggle();
    });
    expect(callsFor("e1")).toBe(2);
    expect(hook.result.current.playing).toBe(true);
    expect(h.engine.play).toHaveBeenLastCalledWith("e1-fresh.webm", 1, 0);
  });

  it("внутри TTL источники живут в кэше, после истечения — свежий запрос", async () => {
    const T1 = trk("t1");
    const T2 = trk("t2");
    // Должен совпадать с SOURCES_TTL_MS в player/sourcesCache.ts — дубль
    // намеренный, как регресс-тест константы (смена TTL — осознанное решение).
    const TTL_MS = 5 * 60_000;
    const t0 = 1_700_000_000_000;
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(t0);
    try {
      h.getTrackSources.mockImplementation(async (id: string) => [source(id)]);
      h.resolvePlayable.mockResolvedValue({ url: "t.webm", fromCache: true, provider: "youtube" });
      const hook = mount();

      await act(async () => {
        hook.result.current.playContext([T1, T2], "t1");
      });
      expect(callsFor("t1")).toBe(1);

      // почти истёк — запись ещё живая
      dateNow.mockReturnValue(t0 + TTL_MS - 1_000);
      await act(async () => {
        hook.result.current.playContext([T1, T2], "t2");
      });
      await act(async () => {
        hook.result.current.playContext([T1, T2], "t1");
      });
      expect(callsFor("t1")).toBe(1);

      // истёк — резолв обязан сходить за свежими источниками
      dateNow.mockReturnValue(t0 + TTL_MS + 1);
      await act(async () => {
        hook.result.current.playContext([T1, T2], "t2");
      });
      await act(async () => {
        hook.result.current.playContext([T1, T2], "t1");
      });
      expect(callsFor("t1")).toBe(2);
    } finally {
      dateNow.mockRestore();
    }
  });
});

/** Граница трека (расследование 2026-07-16: «повтор сам останавливается»,
 *  «радио/очередь встают на паузу на 0:00 следующего трека»). Три корня:
 *
 *  1. repeat-one: advance() делал только engine.seek(0). По HTML-спеке на
 *     естественном конце элемент СНАЧАЛА ставит paused=true и лишь потом шлёт
 *     'ended' («reaches the end»), а seek паузу не снимает — повтор молча
 *     умирал на ПЕРВОЙ же границе (звука нет, бар при этом «играет»).
 *
 *  2. 'ended'/'timeupdate' СТАРОГО трека, прилетевшие пока добывается
 *     следующий (startAt в полёте — startAt сбрасывал autoAdvancedRef сразу),
 *     принимались за новую границу → второй advance: скип трека через один,
 *     а на конце очереди — стоп поверх живого «хвоста» добычи.
 *
 *  3. Ошибка добычи на АВТО-переходе глушила всю очередь (playing=false на
 *     0:00 следующего трека — ровно скриншот владельца): радио-треки всегда
 *     добываются вживую, и один мёртвый трек останавливал музыку насовсем.
 */
describe("usePlayback: граница трека — повтор и авто-переход", () => {
  it("repeat-one: естественный конец перезапускает звук, а не только seek(0)", async () => {
    const hook = mount();
    await playA(hook);
    act(() => {
      hook.result.current.cycleRepeat(); // off → all
    });
    act(() => {
      hook.result.current.cycleRepeat(); // all → one
    });
    expect(hook.result.current.repeat).toBe("one");
    h.engine.seek.mockClear();

    await act(async () => {
      h.cb.current?.onEnded();
    });

    expect(h.engine.seek).toHaveBeenCalledWith(0);
    // На 'ended' элемент уже стоит на паузе (спека ставит paused до события);
    // без явного resume() повтор — это тишина на 0:00 под «играющим» баром.
    expect(h.engine.resume).toHaveBeenCalledTimes(1);
    expect(h.engine.play).toHaveBeenCalledTimes(1); // на другой трек не уехали
    expect(hook.result.current.track?.id).toBe("a");
    expect(hook.result.current.playing).toBe(true);
    expect(hook.result.current.pos).toBe(0);
  });

  it("авто-переход: мёртвый следующий трек скипается, очередь не встаёт", async () => {
    const S1 = trk("s1");
    const S2 = trk("s2");
    const S3 = trk("s3");
    h.resolvePlayable.mockImplementation(async (id: string) => {
      if (id === "s2") throw new Error("нет живых источников");
      return { url: `${id}.webm`, fromCache: true, provider: "youtube" };
    });
    const hook = mount();
    await act(async () => {
      hook.result.current.playContext([S1, S2, S3], "s1");
    });
    expect(h.engine.play).toHaveBeenLastCalledWith("s1.webm", 1, 0);

    // s1 доиграл сам; s2 не добывается (источник умер на стороне провайдера)
    await act(async () => {
      h.cb.current?.onEnded();
    });

    expect(h.onError).toHaveBeenCalledWith("нет живых источников"); // честный тост остался
    // …но очередь НЕ встала на паузу на 0:00 — мёртвый трек скипнут
    expect(h.engine.play).toHaveBeenLastCalledWith("s3.webm", 1, 0);
    expect(hook.result.current.track?.id).toBe("s3");
    expect(hook.result.current.playing).toBe(true);
  });

  it("авто-скип ограничен: всё мёртвое — честная остановка, не вечный цикл", async () => {
    // Регресс-страховка САМОГО фикса: на старом коде (стоп после первой же
    // ошибки) тест зелёный; он охраняет фикс от бесконечной карусели скипов
    // на маленькой очереди с repeat all, где мертво всё.
    const D1 = trk("d1");
    const D2 = trk("d2");
    const D3 = trk("d3");
    h.resolvePlayable
      .mockResolvedValueOnce({ url: "d1.webm", fromCache: true, provider: "youtube" })
      .mockRejectedValue(new Error("умерло всё"));
    const hook = mount();
    await act(async () => {
      hook.result.current.playContext([D1, D2, D3], "d1");
    });
    act(() => {
      hook.result.current.cycleRepeat(); // off → all: очередь сама не кончится
    });

    await act(async () => {
      h.cb.current?.onEnded();
    });

    expect(hook.result.current.playing).toBe(false); // честная остановка…
    expect(h.engine.play).toHaveBeenCalledTimes(1); // …без единого фальш-старта
    // попыток добычи конечное число: d1 + скипы в пределах капа
    expect(h.resolvePlayable.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("'ended' старого трека во время добычи следующего не двигает очередь второй раз", async () => {
    const hook = mount({ crossfade: true });
    await playA(hook);
    act(() => {
      hook.result.current.toggleShuffle(); // сосед не преднагружается — добыча живая
    });
    const releaseB = deferResolve("b.webm");
    await act(async () => {
      h.cb.current?.onTime(197); // ранний стык: добыча B повисла (yt-dlp — секунды)
    });

    // Кроссфейд не глушит старый трек — тот доигрывает и кончается САМ,
    // пока B ещё добывается. Это не «новая граница»: advance уже в полёте.
    await act(async () => {
      h.cb.current?.onEnded();
    });
    await act(async () => {
      releaseB();
    });

    expect(h.engine.play).toHaveBeenLastCalledWith("b.webm", 1, 4);
    expect(hook.result.current.track?.id).toBe("b");
    expect(hook.result.current.playing).toBe(true);
    expect(hook.result.current.pos).toBe(0);
  });

  it("timeupdate старого трека во время добычи следующего не даёт второй ранний стык", async () => {
    const hook = mount({ crossfade: true });
    await playA(hook);
    act(() => {
      hook.result.current.toggleShuffle();
    });
    const releaseB = deferResolve("b.webm");
    await act(async () => {
      h.cb.current?.onTime(197); // ранний стык → добыча B повисла
    });
    const resolvesAfterTrigger = h.resolvePlayable.mock.calls.length;

    // Старый трек ещё звучит: его timeupdate продолжают тикать в окне кроссфейда
    await act(async () => {
      h.cb.current?.onTime(197.5);
    });

    expect(h.resolvePlayable.mock.calls.length).toBe(resolvesAfterTrigger); // второй добычи НЕТ
    await act(async () => {
      releaseB();
    });
    expect(h.engine.play).toHaveBeenLastCalledWith("b.webm", 1, 4);
    expect(hook.result.current.track?.id).toBe("b");
  });
});
