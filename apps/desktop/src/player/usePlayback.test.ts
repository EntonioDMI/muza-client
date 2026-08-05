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
import { DEFAULT_PREFS, type AudioOutputRoute, type Prefs } from "../types";
import type { EngineCallbacks } from "./audioEngine";
import type { PlayerTrack } from "./types";
import { invalidateCachedSources } from "./sourcesCache";
import { usePlayback } from "./usePlayback";
import { flushPlayerState, resetPlayerState } from "@muza/app/lib/playerState";

const h = vi.hoisted(() => ({
  resolvePlayable: vi.fn(),
  cacheRemove: vi.fn(),
  engineStreamStart: vi.fn(),
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
    setOutputs: vi.fn(),
    setMicConfig: vi.fn(),
    analyser: vi.fn(),
  },
  /** Живые микрофоны (enumerateDevices) — стенд фолбэка «id → имя». */
  listInputDevices: vi.fn(),
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
  cacheRemove: h.cacheRemove,
  engineStreamStart: h.engineStreamStart,
  engineStreamUrl: (id: string) => `http://muza-stream.localhost/testns/${id}`,
}));

// Пропускаем реальный listOutputDevices/resolveRoutes (require navigator.
// mediaDevices, которого в jsdom нет — ensureDeviceAccess проглотил бы отказ
// и вернул [], а resolveRoutes([], stored) всегда дал бы пусто, что не
// доказало бы прокладку prefs.audioOutputs → engine.setOutputs). Мок —
// детерминированный pass-through: сопоставление deviceId/label — забота
// outputDevices.test.ts, здесь важен только маршрут prefs → движок.
// resolveMicDeviceId НЕ мокается (importActual): это чистая функция, и весь
// смысл теста микрофона — что usePlayback реально ходит за списком устройств и
// применяет её результат, а не подсовывает сохранённый id как есть.
vi.mock("./outputDevices", async () => {
  const actual = await vi.importActual<typeof import("./outputDevices")>("./outputDevices");
  return {
    deviceAccessUnlocked: () => true,
    listOutputDevices: vi.fn(async () => []),
    listInputDevices: h.listInputDevices,
    resolveMicDeviceId: actual.resolveMicDeviceId,
    resolveRoutes: (stored: AudioOutputRoute[]) =>
      stored.map((r) => ({ deviceId: r.deviceId, volume: r.volume, followsMaster: r.followsMaster, mixMic: r.mixMic })),
  };
});

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
    setOutputs = h.engine.setOutputs;
    setMicConfig = h.engine.setMicConfig;
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
  // ⚠️ ПАМЯТЬ ПЛЕЕРА — СОСТОЯНИЕ МОДУЛЯ, а модуль на весь файл один. Без сброса
  // повтор, включённый одним тестом, переезжал в соседние и ломал авто-переход:
  // «следующий трек» оказывался тем же самым. localStorage.clear() тут не
  // помогает — отложенная запись живёт в памяти и воскресала бы при чтении.
  resetPlayerState();
  localStorage.removeItem("muza.player.v1");
  vi.clearAllMocks();
  // Реализации задаём явно: clearAllMocks стирает только вызовы, а reset —
  // и реализации; position без неё вернул бы undefined и remaining стал бы NaN.
  h.engine.play.mockImplementation(async () => {});
  // resume теперь отвечает «звук реально пошёл?» — дефолт стенда: пошёл
  h.engine.resume.mockImplementation(async () => true);
  h.engine.position.mockReturnValue(0);
  h.cacheRemove.mockImplementation(async () => {});
  h.engine.analyser.mockReturnValue(null);
  h.resolvePlayable.mockReset();
  // Фаза 2 по умолчанию выключена в тестах: стрим недоступен = старый путь,
  // существующие сценарии добычи не меняются
  h.engineStreamStart.mockReset();
  h.engineStreamStart.mockResolvedValue(false);
  h.getTrackSources.mockImplementation(async () => []);
  // По умолчанию перечисление ничего не знает — сохранённый микрофон уходит на
  // движок как есть (см. resolveMicDeviceId: пустой список ≠ «устройство ушло»).
  h.listInputDevices.mockImplementation(async () => []);
  h.cb.current = null;
  // sourcesCache — модульный синглтон и переживает тесты: без сброса трек
  // получал источники, закэшированные предыдущим кейсом (поймано 19.07 на
  // тесте передачи источников в стрим).
  invalidateCachedSources("a");
  invalidateCachedSources("b");
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

  it("настроенная длительность кроссфейда (crossfadeSec=8) доезжает до engine.play, а не константа 4", async () => {
    // Сторож всей цепочки prefs → planAutoAdvance → advance → engine.play:
    // и окно раннего триггера, и fadeSec обязаны идти по настройке, не по 4.
    const hook = mount({ crossfade: true, crossfadeSec: 8 });
    await playA(hook);
    act(() => {
      hook.result.current.toggleShuffle(); // сосед не преднагружается — добыча живая
    });
    h.engine.pause.mockClear();

    const releaseB = deferResolve("b.webm");
    await act(async () => {
      // remaining 6с (duration 200): ВНУТРИ настроенного окна 8с, но ВНЕ старого
      // окна 4с — на константе ранний стык бы не запустился.
      h.cb.current?.onTime(194);
    });
    await act(async () => {
      releaseB();
    });
    expect(h.engine.play).toHaveBeenLastCalledWith("b.webm", 1, 8);
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
    expect(hook.result.current.getPos()).toBe(0);
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
    expect(hook.result.current.getPos()).toBe(0);
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

  it("timeupdate старого трека во время добычи не двигает полоску нового", async () => {
    // Жалоба владельца 2026-07-16 (режим прослушивания, стык песен): бар
    // нового трека стоял на чужой минуте, пока шла добыча, и «падал» в 0:00
    // после загрузки. Часики двигал timeupdate ЕЩЁ звучащего старого трека —
    // активный слот движка в окне добычи всё ещё его.
    const hook = mount({ crossfade: true });
    await playA(hook);
    act(() => {
      hook.result.current.toggleShuffle(); // сосед не преднагружается — добыча живая
    });
    const releaseB = deferResolve("b.webm");
    await act(async () => {
      h.cb.current?.onTime(197); // ранний стык → добыча B повисла
    });
    expect(hook.result.current.track?.id).toBe("b"); // UI уже показывает новый трек
    expect(hook.result.current.getPos()).toBe(0);

    // Старый трек продолжает звучать и тикать — полоска нового не шевелится
    await act(async () => {
      h.cb.current?.onTime(198.2);
    });
    expect(hook.result.current.getPos()).toBe(0);

    await act(async () => {
      releaseB();
    });
    expect(hook.result.current.getPos()).toBe(0); // новый честно начинается с нуля
    expect(hook.result.current.track?.id).toBe("b");
  });
});

/** Самолечение мёртвого звука (аудит 2026-07-17: «повтор трека/плейлиста
 *  больше никогда не останавливается сам»). Фиксы границы 2026-07-16 живут
 *  на событиях 'ended'/'timeupdate' — но есть двери, через которые звук
 *  умирает БЕЗ новой границы ('ended' уже никогда не придёт, машинерия
 *  advance бессильна): отказ resume() на рестарте repeat-one (файл выпал из
 *  LRU-кэша — Windows не держит asset-файл открытым), ошибка медиа посреди
 *  трека, тихо замершая позиция (уснувший ноут, пропавшее аудио-устройство).
 *  Лечение всегда одно — полный перезапуск текущего трека через добычу
 *  (файл кэша под подозрением — выбивается, Rust докачает заново), с
 *  кулдауном: битый насмерть трек делает конечное число попыток и честно
 *  встаёт на паузу, а не крутит вечную карусель рестартов. */
describe("usePlayback: самолечение мёртвого звука", () => {
  it("repeat-one: рестарт не завёлся (resume=false) → полный перезапуск через добычу", async () => {
    const R = trk("heal-r1");
    h.resolvePlayable.mockResolvedValueOnce({ url: "r1.webm", fromCache: true, provider: "youtube" });
    const hook = mount();
    await act(async () => {
      hook.result.current.playContext([R], "heal-r1");
    });
    act(() => {
      hook.result.current.cycleRepeat(); // off → all
    });
    act(() => {
      hook.result.current.cycleRepeat(); // all → one
    });
    expect(hook.result.current.repeat).toBe("one");

    // Файл выпал из LRU-кэша, пока трек играл: el.play() на рестарте отказал
    h.engine.resume.mockResolvedValueOnce(false);
    h.resolvePlayable.mockResolvedValueOnce({ url: "r1-заново.webm", fromCache: false, provider: "youtube" });
    await act(async () => {
      h.cb.current?.onEnded();
    });

    // Повтор пережил отказ: кэш под подозрением выбит, трек добыт и заведён заново
    expect(h.cacheRemove).toHaveBeenCalledWith("heal-r1");
    expect(h.engine.play).toHaveBeenLastCalledWith("r1-заново.webm", 1, 0);
    expect(hook.result.current.track?.id).toBe("heal-r1");
    expect(hook.result.current.playing).toBe(true);
  });

  it("ошибка медиа посреди трека: одна попытка лечения; повторная смерть сразу — честная остановка", async () => {
    const M = trk("heal-m1");
    h.resolvePlayable.mockResolvedValueOnce({ url: "m1.webm", fromCache: true, provider: "youtube" });
    const hook = mount();
    await act(async () => {
      hook.result.current.playContext([M], "heal-m1");
    });

    h.resolvePlayable.mockResolvedValueOnce({ url: "m1-заново.webm", fromCache: false, provider: "youtube" });
    await act(async () => {
      h.cb.current?.onError("декодер умер");
    });

    expect(h.onError).toHaveBeenCalledWith("декодер умер"); // честный тост остался
    expect(h.engine.play).toHaveBeenLastCalledWith("m1-заново.webm", 1, 0); // …и лечение прошло
    expect(hook.result.current.playing).toBe(true);

    // Трек битый насмерть: умирает снова сразу после лечения — в кулдауне
    // честная остановка вместо вечной карусели рестартов с нуля.
    await act(async () => {
      h.cb.current?.onError("декодер умер снова");
    });
    expect(hook.result.current.playing).toBe(false);
  });

  it("ошибка медиа во время добычи нового трека лечение НЕ запускает — стартом владеет startAt", async () => {
    const S = trk("heal-s1");
    h.resolvePlayable.mockResolvedValueOnce({ url: "s1.webm", fromCache: true, provider: "youtube" });
    const hook = mount();
    await act(async () => {
      hook.result.current.playContext([S, B], "heal-s1");
    });

    const release = deferResolve("b.webm");
    await act(async () => {
      hook.result.current.playContext([S, B], "b"); // добыча B повисла
    });
    const playsBefore = h.engine.play.mock.calls.length;
    await act(async () => {
      h.cb.current?.onError("старый элемент икнул"); // ошибка в окне добычи
    });

    expect(h.engine.play.mock.calls.length).toBe(playsBefore); // второго старта нет
    await act(async () => {
      release();
    });
    expect(h.engine.play).toHaveBeenLastCalledWith("b.webm", 1, 0); // добыча довела своё
    expect(hook.result.current.track?.id).toBe("b");
  });

  it("play после паузы: слот не завёлся (resume=false) → полноценный перезапуск клика", async () => {
    const T = trk("heal-t1");
    h.resolvePlayable.mockResolvedValueOnce({ url: "t1.webm", fromCache: true, provider: "youtube" });
    const hook = mount();
    await act(async () => {
      hook.result.current.playContext([T], "heal-t1");
    });
    await act(async () => {
      hook.result.current.toggle(); // пауза
    });
    expect(hook.result.current.playing).toBe(false);

    // За время паузы файл выпал из кэша: resume больше не заводит элемент
    h.engine.resume.mockResolvedValueOnce(false);
    h.resolvePlayable.mockResolvedValueOnce({ url: "t1-заново.webm", fromCache: true, provider: "youtube" });
    await act(async () => {
      hook.result.current.toggle(); // play
    });

    expect(h.engine.play).toHaveBeenLastCalledWith("t1-заново.webm", 1, 0);
    expect(hook.result.current.playing).toBe(true);
  });

  it("сторож: позиция замерла при «играем» → толчок resume, не помогло → перезапуск через добычу", async () => {
    // now: реальное время — кулдаун лечения сверяется с Date.now(), и стартовое
    // «0» фейковых часов ложно попадало бы в окно кулдауна.
    vi.useFakeTimers({ now: Date.now() });
    try {
      const W = trk("heal-w1");
      h.resolvePlayable.mockResolvedValueOnce({ url: "w1.webm", fromCache: true, provider: "youtube" });
      const hook = mount();
      await act(async () => {
        hook.result.current.playContext([W], "heal-w1");
      });
      h.engine.position.mockReturnValue(42); // звук «замер»: позиция не движется
      h.engine.resume.mockResolvedValue(false); // …и мягкий толчок не помогает

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(h.engine.resume).toHaveBeenCalled(); // мягкий толчок был (без потери позиции)

      h.resolvePlayable.mockResolvedValueOnce({ url: "w1-заново.webm", fromCache: false, provider: "youtube" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(h.engine.play).toHaveBeenLastCalledWith("w1-заново.webm", 1, 0);
      expect(hook.result.current.playing).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("сторож молчит, пока позиция движется", async () => {
    vi.useFakeTimers({ now: Date.now() });
    try {
      const V = trk("heal-v1");
      h.resolvePlayable.mockResolvedValueOnce({ url: "v1.webm", fromCache: true, provider: "youtube" });
      const hook = mount();
      await act(async () => {
        hook.result.current.playContext([V], "heal-v1");
      });
      let pos = 0;
      h.engine.position.mockImplementation(() => (pos += 5)); // живой звук: позиция растёт

      const playsBefore = h.engine.play.mock.calls.length;
      h.engine.resume.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(h.engine.resume).not.toHaveBeenCalled();
      expect(h.engine.play.mock.calls.length).toBe(playsBefore);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("стрим с первых килобайт (Фаза 2, muza-stream)", () => {
  it("прогретый некэшированный трек играет стримом, резолв не зовётся", async () => {
    // Rust подтвердил: warm-запись есть, закачка началась, первые байты пришли
    h.engineStreamStart.mockResolvedValueOnce(true);
    const hook = mount();
    await act(async () => {
      hook.result.current.playContext([A, B], "a");
    });
    expect(h.engineStreamStart).toHaveBeenCalledWith("a", expect.anything(), expect.anything());
    expect(h.engine.play).toHaveBeenCalledWith(
      expect.stringContaining("muza-stream"),
      expect.anything(),
      expect.anything(),
    );
    expect(h.resolvePlayable).not.toHaveBeenCalled();
  });

  it("стрим недоступен (не прогрет/уже в кэше) — обычная добыча, как раньше", async () => {
    h.engineStreamStart.mockResolvedValueOnce(false);
    h.resolvePlayable.mockResolvedValueOnce({ url: "a.webm", fromCache: false, provider: "youtube" });
    const hook = mount();
    await act(async () => {
      hook.result.current.playContext([A, B], "a");
    });
    expect(h.engine.play).toHaveBeenCalledWith("a.webm", expect.anything(), expect.anything());
  });

  /** Регрессия 2026-07-19 («ускорения не чувствуется»): стрим брал ТОЛЬКО
   *  прогретые треки, а обычный клик по холодному шёл мимо него и ждал
   *  ПОЛНУЮ закачку (резолв 0.75с + байты 0.9–1.4с). Метаданные холодному
   *  треку теперь добывает ступень 0 внутри Rust, поэтому стриму нужны
   *  ИСТОЧНИКИ — без них он не может её позвать. */
  it("холодному треку источники передаются в стрим — ступени 0 есть с чем работать", async () => {
    const ytSource = [{ provider: "youtube", sourceId: "dQw4w9WgXcQ", priority: 100 }];
    h.getTrackSources.mockImplementation(async () => ytSource);
    h.engineStreamStart.mockResolvedValueOnce(true);
    const hook = mount();
    await act(async () => {
      hook.result.current.playContext([A, B], "a");
    });
    expect(h.engineStreamStart).toHaveBeenCalledWith(
      "a",
      expect.arrayContaining([expect.objectContaining({ sourceId: "dQw4w9WgXcQ" })]),
      expect.anything(),
    );
  });
});

/** Трек БЕЗ длительности (аудит 2026-08-03). duration=0 приезжает из импорта
 *  локального файла, у которого не разобрались метаданные. Вся арифметика
 *  «сколько осталось» считает duration − position, то есть у такого трека она
 *  всегда отрицательна — и три места вели себя так, будто трек вечно «в самом
 *  конце»: точный gapless-опрос вырождался в таймер 50 Гц на всю длительность
 *  трека, преднагрузка соседа дёргалась на каждом тике, а скробблер засчитывал
 *  трек как ПОЛНОСТЬЮ прослушанный после первой же секунды. */
describe("usePlayback: трек без длительности", () => {
  const noDur = (id: string): PlayerTrack => ({ ...trk(id), duration: 0 });

  it("не превращает точный опрос стыка в таймер 50 Гц", async () => {
    vi.useFakeTimers({ now: Date.now() });
    try {
      const Z = noDur("nd-poll");
      h.resolvePlayable.mockResolvedValueOnce({ url: "nd.webm", fromCache: true, provider: "youtube" });
      const hook = mount({ gapless: true }); // условие входа в pollGapless
      await act(async () => {
        hook.result.current.playContext([Z, B], "nd-poll");
      });
      h.engine.position.mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      // На старом коде здесь ~100 пробуждений (шаг 20мс), каждое с обращением
      // к движку и пересчётом следующего индекса. Порог 2 — запас на тик
      // сторожа замершего звука, он тут ни при чём.
      expect(h.engine.position.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("…но у нормального трека точный опрос по-прежнему работает", async () => {
    vi.useFakeTimers({ now: Date.now() });
    try {
      h.resolvePlayable.mockResolvedValueOnce({ url: "a.webm", fromCache: true, provider: "youtube" });
      const hook = mount({ gapless: true });
      // 199 из 200: до конца 1с — это ВНУТРИ окна тесного опроса (2с), но ещё
      // не триггер стыка (0.1с). Из начала трека опрос спит одним дальним
      // прыжком и в двухсекундном окне теста не проснулся бы вовсе.
      h.engine.position.mockReturnValue(199);
      await act(async () => {
        hook.result.current.playContext([A, B], "a");
      });
      h.engine.position.mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      // Сторож фикса: экономия не должна была убить сам механизм — у трека с
      // длительностью опрос обязан жить (дальний прыжок + тесное окно).
      expect(h.engine.position.mock.calls.length).toBeGreaterThan(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("не дёргает преднагрузку соседа на каждом тике", async () => {
    const Z = noDur("nd-pre");
    // Резолв отвечает ВСЕГДА (не Once): иначе преднагрузка на старом коде
    // падала бы на пустом моке, и тест зеленел бы не по существу.
    h.resolvePlayable.mockResolvedValue({ url: "nd.webm", fromCache: true, provider: "youtube" });
    const hook = mount();
    await act(async () => {
      hook.result.current.playContext([Z, B], "nd-pre");
    });
    h.engine.preload.mockClear();

    for (const sec of [1, 2, 3]) {
      await act(async () => {
        h.cb.current?.onTime(sec);
      });
    }

    expect(h.engine.preload).not.toHaveBeenCalled();
  });

  it("не засчитывается как «дослушан» после первой же секунды", async () => {
    const onPlayEnd = vi.fn();
    const Z = noDur("nd-scrobble");
    h.resolvePlayable.mockResolvedValue({ url: "nd.webm", fromCache: true, provider: "youtube" });
    const { result } = renderHook(() =>
      usePlayback({ api, initialQueue: [Z, B], prefs: { ...DEFAULT_PREFS }, onError: h.onError, onPlayEnd }),
    );
    await act(async () => {
      result.current.playContext([Z, B], "nd-scrobble");
    });
    // Одна реально прослушанная секунда — порог «есть что скробблить», но
    // никак не «дослушал до конца».
    for (const sec of [1, 2]) {
      await act(async () => {
        h.cb.current?.onTime(sec);
      });
    }

    await act(async () => {
      result.current.playContext([Z, B], "b"); // ручное переключение — flushPlayEnd
    });

    expect(onPlayEnd).toHaveBeenCalledWith(expect.objectContaining({ track: expect.objectContaining({ id: "nd-scrobble" }), completed: false }));
  });
});

/** Спиннер добычи и перебитый старт (аудит 2026-08-03 подозревал утечку
 *  «Добываем трек…» под уже играющей музыкой). Инвариант, который тут
 *  охраняется: сброс признака в finally стоит под сверкой номера старта не по
 *  недосмотру — иначе устаревший старт гасил бы спиннер СВЕЖЕГО, начавшегося
 *  за время его добычи. Гасит спиннер всегда самый новый старт, каким бы путём
 *  он ни пошёл, включая мгновенный преднагруженный. */
describe("usePlayback: спиннер добычи при перебитом старте", () => {
  it("перебили холодную добычу преднагруженным треком — спиннер гаснет", async () => {
    const C = trk("spin-c");
    const hook = mount();
    h.resolvePlayable.mockResolvedValueOnce({ url: "a.webm", fromCache: true, provider: "youtube" });
    await act(async () => {
      hook.result.current.playContext([A, B, C], "a");
    });
    // прогреваем преднагрузку соседа B (remaining 15с ≤ preloadAheadSec)
    h.resolvePlayable.mockResolvedValueOnce({ url: "b.webm", fromCache: true, provider: "youtube" });
    await act(async () => {
      h.cb.current?.onTime(185);
    });
    expect(h.engine.preload).toHaveBeenCalledWith("b.webm");

    // холодный клик по третьему треку: добыча висит, спиннер горит
    const releaseC = deferResolve("spin-c.webm");
    await act(async () => {
      hook.result.current.playContext([A, B, C], "spin-c");
    });
    expect(hook.result.current.buffering).toBe(true);

    // …человек передумал и кликнул преднагруженный трек — ждать больше нечего
    await act(async () => {
      hook.result.current.playContext([A, B, C], "b");
    });
    expect(hook.result.current.buffering).toBe(false);

    // и устаревшая добыча, дойдя, спиннер не воскрешает
    await act(async () => {
      releaseC();
    });
    expect(hook.result.current.buffering).toBe(false);
    expect(hook.result.current.track?.id).toBe("b");
  });
});

/** Вывод на устройства (2026-07-22) + голос (v2): моки setOutputs/setMicConfig
 *  существовали в h.engine с самого начала файла, но были "captured, без
 *  единого expect" (аудит 22.07) — обе прокладки prefs → движок стояли без
 *  сторожа. Оба пути ленивы (engineRef.current создаётся только startAt'ом),
 *  поэтому каждый тест сначала заводит движок playContext'ом, и только потом
 *  проверяет реакцию на смену prefs. */
describe("usePlayback: вывод на устройства и голос → движок", () => {
  const flushEffects = async () => {
    // applyOutputRoutes асинхронна (await listOutputDevices()) — даём эффекту
    // после rerender долиться до engineRef.setOutputs без гонки на микрозадачах.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("смена prefs.audioOutputs доезжает до движка через setOutputs", async () => {
    h.resolvePlayable.mockResolvedValueOnce({ url: "a.webm", fromCache: true, provider: "youtube" });
    const { result, rerender } = renderHook(
      (p: Partial<Prefs>) =>
        usePlayback({ api, initialQueue: [A, B], prefs: { ...DEFAULT_PREFS, ...p }, onError: h.onError }),
      { initialProps: {} as Partial<Prefs> },
    );
    await act(async () => {
      result.current.playContext([A, B], "a"); // движок создаётся только тут (ленивая фабрика engine())
    });
    h.engine.setOutputs.mockClear();

    const outputs: AudioOutputRoute[] = [{ deviceId: "dev1", label: "Наушники", volume: 70, followsMaster: true }];
    await act(async () => {
      rerender({ audioOutputs: outputs });
      await flushEffects();
    });

    expect(h.engine.setOutputs).toHaveBeenCalledWith([
      { deviceId: "dev1", volume: 70, followsMaster: true, mixMic: undefined },
    ]);
  });

  it("префы audioOutputs очищены (пусто) — движок возвращается к системному выходу", async () => {
    h.resolvePlayable.mockResolvedValueOnce({ url: "a.webm", fromCache: true, provider: "youtube" });
    const outputs: AudioOutputRoute[] = [{ deviceId: "dev1", label: "Наушники", volume: 70 }];
    const { result, rerender } = renderHook(
      (p: Partial<Prefs>) =>
        usePlayback({ api, initialQueue: [A, B], prefs: { ...DEFAULT_PREFS, ...p }, onError: h.onError }),
      { initialProps: { audioOutputs: outputs } as Partial<Prefs> },
    );
    await act(async () => {
      result.current.playContext([A, B], "a");
      await flushEffects();
    });
    h.engine.setOutputs.mockClear();

    await act(async () => {
      rerender({ audioOutputs: [] });
      await flushEffects();
    });

    expect(h.engine.setOutputs).toHaveBeenCalledWith([]);
  });

  it("смена prefs.micDeviceId/micGain доезжает до движка через setMicConfig", async () => {
    h.resolvePlayable.mockResolvedValueOnce({ url: "a.webm", fromCache: true, provider: "youtube" });
    const { result, rerender } = renderHook(
      (p: Partial<Prefs>) =>
        usePlayback({ api, initialQueue: [A, B], prefs: { ...DEFAULT_PREFS, ...p }, onError: h.onError }),
      { initialProps: {} as Partial<Prefs> },
    );
    await act(async () => {
      result.current.playContext([A, B], "a"); // движок создан — дальше эффект реально доедет до него
    });
    h.engine.setMicConfig.mockClear();

    await act(async () => {
      rerender({ micDeviceId: "mic-1", micGain: 42 });
      await flushEffects(); // сопоставление микрофона асинхронно (enumerateDevices)
    });

    expect(h.engine.setMicConfig).toHaveBeenCalledWith({ deviceId: "mic-1", gain: 42 });
  });

  it("id микрофона сменился после переподключения — захват уходит на устройство с тем же именем", async () => {
    // Прод-сценарий: микрофон выдернули и воткнули обратно, Chromium выдал ему
    // НОВЫЙ deviceId. Сохранённый id мёртв — без сопоставления по имени
    // getUserMedia({deviceId:{exact}}) отказывает, и движок молча падает на
    // системный микрофон: голос идёт не с того устройства.
    h.listInputDevices.mockImplementation(async () => [
      { deviceId: "mic-новый", label: "Микрофон Yeti" },
      { deviceId: "mic-камера", label: "Веб-камера" },
    ]);
    h.resolvePlayable.mockResolvedValueOnce({ url: "a.webm", fromCache: true, provider: "youtube" });
    const { result } = renderHook(() =>
      usePlayback({
        api,
        initialQueue: [A, B],
        prefs: { ...DEFAULT_PREFS, micDeviceId: "mic-старый", micDeviceLabel: "Микрофон Yeti", micGain: 70 },
        onError: h.onError,
      }),
    );
    await act(async () => {
      await flushEffects(); // сопоставление успевает до создания движка
    });
    await act(async () => {
      result.current.playContext([A, B], "a"); // ленивая фабрика — движок рождается тут
    });

    // И ленивая фабрика, и эффект обязаны нести ЖИВОЙ id, а не сохранённый
    expect(h.engine.setMicConfig).toHaveBeenCalledWith({ deviceId: "mic-новый", gain: 70 });
    expect(h.engine.setMicConfig).not.toHaveBeenCalledWith(expect.objectContaining({ deviceId: "mic-старый" }));
  });

  it("микрофон не выбран — за списком устройств не ходим", async () => {
    h.resolvePlayable.mockResolvedValueOnce({ url: "a.webm", fromCache: true, provider: "youtube" });
    const { result } = renderHook(() =>
      usePlayback({ api, initialQueue: [A, B], prefs: { ...DEFAULT_PREFS }, onError: h.onError }),
    );
    await act(async () => {
      result.current.playContext([A, B], "a");
      await flushEffects();
    });

    // Перечисление разблокирует устройства через getUserMedia — дёргать его на
    // старте у всех, кто голос вообще не настраивал, незачем.
    expect(h.listInputDevices).not.toHaveBeenCalled();
    expect(h.engine.setMicConfig).toHaveBeenCalledWith({ deviceId: null, gain: DEFAULT_PREFS.micGain });
  });
});

/** ПОЗИЦИЯ БОЛЬШЕ НЕ СОСТОЯНИЕ REACT (03.08, перенос в positionStore).
 *
 *  Сторожим ровно две половины сделки, потому что дёшево сломать любую:
 *  1) тик timeupdate НЕ вызывает рендер — раньше каждый из ~4 тиков в секунду
 *     перерисовывал весь App (сайдбар, экран со всеми строками, обе копии
 *     текста песни). Тест краснеет на старом коде: там setPos — useState.
 *  2) при этом значение остаётся ТОЧНЫМ на каждый тик, а не округлённым до
 *     секунды. Это второй запрет: на неточной позиции гость «Слушаем вместе»
 *     ловит слышимый seek, часы мини-плеера отстают, Discord врёт чужим
 *     людям (подробности — в шапке positionStore.ts). */
describe("тик позиции: значение точное, рендера нет", () => {
  it("четыре timeupdate подряд не дают ни одного рендера", async () => {
    let renders = 0;
    const hook = renderHook(() => {
      renders++;
      return usePlayback({ api, initialQueue: [A, B], prefs: { ...DEFAULT_PREFS }, onError: h.onError });
    });
    await playA(hook);

    const before = renders;
    for (const sec of [12.25, 12.5, 12.75, 13]) {
      await act(async () => {
        h.cb.current?.onTime(sec);
      });
    }

    expect(renders).toBe(before);
  });

  it("значение точное на каждом тике — не округляется до целой секунды", async () => {
    const hook = mount();
    await playA(hook);

    for (const sec of [12.25, 12.5, 12.75]) {
      await act(async () => {
        h.cb.current?.onTime(sec);
      });
      expect(hook.result.current.getPos()).toBe(sec);
    }
  });

  it("подписчик получает каждый тик, а «секундный» — только смену целой секунды", async () => {
    const hook = mount();
    await playA(hook);
    await act(async () => {
      h.cb.current?.onTime(12); // встаём ровно на 12-й секунде, до подписки
    });
    const ticks = vi.fn();
    const seconds = vi.fn();
    const offTicks = hook.result.current.posStore.subscribe(ticks);
    const offSeconds = hook.result.current.posStore.subscribeSecond(seconds);

    for (const sec of [12.25, 12.5, 12.75, 13.0, 13.25]) {
      await act(async () => {
        h.cb.current?.onTime(sec);
      });
    }
    offTicks();
    offSeconds();

    expect(ticks).toHaveBeenCalledTimes(5);
    expect(seconds).toHaveBeenCalledTimes(1); // 12 → 13, и только она
  });
});

describe("память плеера между запусками", () => {
  /** Прямая регрессия на жалобу владельца (05.08): «при перезаходе в приложение
   *  не сохраняются настройки громкости и некоторые другие элементы».
   *
   *  ⚠️ Проверять надо ИМЕННО СКВОЗЬ ХРАНИЛИЩЕ, а не «модуль умеет писать»:
   *  до 05.08 хранилище существовало, тесты на него были зелёные, а плеер его
   *  не читал вовсе — жалоба оставалась в силе при полностью зелёном прогоне.
   *  Поэтому «перезапуск» здесь настоящий: размонтировали и подняли заново. */
  it("громкость, скорость, повтор и перемешивание переживают перезапуск", () => {
    const first = mount();
    act(() => {
      first.result.current.setVol(31);
      first.result.current.setRate(1.5);
      first.result.current.cycleRepeat(); // off → all
      first.result.current.toggleShuffle();
    });
    first.unmount();

    // Отложенную запись сбрасываем руками: окно склейки 250мс, а «закрыл окно»
    // в бою доводит её обработчик pagehide.
    flushPlayerState();

    const again = mount();
    expect(again.result.current.vol).toBe(31);
    expect(again.result.current.speed).toBe(1.5);
    expect(again.result.current.repeat).toBe("all");
    expect(again.result.current.shuffle).toBe(true);
  });

  it("восстановленная громкость доезжает до движка, а не остаётся числом на экране", async () => {
    const first = mount();
    act(() => first.result.current.setVol(17));
    first.unmount();
    flushPlayerState();

    h.engine.setVolume.mockClear();
    const again = mount();
    await playA(again);
    // Движок создаётся лениво первым же треком и догоняет значения из состояния.
    expect(h.engine.setVolume).toHaveBeenCalledWith(17);
  });
});
