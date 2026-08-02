/** Веб-плеер (player.tsx) — поведение двух слотов.
 *
 *  Волна 6 переписала плеер на два `<audio>` (кроссфейд, переход без паузы,
 *  выравнивание громкости, продолжение с места, радио, прогрев очереди) и не
 *  оставила ни одного теста. Здесь закрывается этот долг.
 *
 *  ЧЕМ ПОДМЕНЁН МИР И ПОЧЕМУ ИМЕННО ЭТИМ:
 *   - `Audio` → FakeAudio. jsdom не умеет воспроизведение вовсе: play() у него
 *     «not implemented» и не возвращает промиса, duration всегда NaN,
 *     currentTime не пишется. Без подмены нельзя проверить ни одного стыка.
 *   - `./api` → три шпиона. Управляемая задержка адреса (hold/release) — стенд
 *     вместо живого cache-miss: резолв реального трека идёт секундами, и всё
 *     окно между кликом и play() как раз и есть предмет проверки № 1.
 *   - `fetch` → шпион: прогрев очереди ходит в сеть напрямую.
 *  Настройки НЕ подменяются — работает настоящий PrefsProvider поверх
 *  localStorage, тесты кладут профиль так же, как его кладёт экран настроек.
 *
 *  Проверяется НАБЛЮДАЕМОЕ: что играет, какой слот звучит, с какой громкостью,
 *  что ушло в сеть и в хранилище. Внутренние флаги плеера тесты не читают —
 *  иначе они ломались бы от любой перестановки строк и ничего не доказывали. */

import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@muza/api-client";
import type { Prefs } from "@muza/app/prefs/types";
import { savePrefs } from "@muza/app/prefs/load";
import { DEFAULT_WEB_PREFS, PrefsProvider, usePrefs } from "./prefs";
import { PlayerProvider, usePlayer, usePosition } from "./player";

/** Ключ «продолжить с места» — ПЕРСИСТЕНТНЫЙ контракт, общий с приложением
 *  (apps/desktop/src/lib/resumeStore.ts). Задан здесь строкой намеренно:
 *  переименование ключа обязано валить тест, а не молча терять позиции людей. */
const RESUME_KEY = "muza.resume.v1";
/** Шаг наблюдения за концом трека в плеере. */
const TICK_MS = 40;

// ── Подменённый элемент воспроизведения ──────────────────────────────
class FakeAudio extends EventTarget {
  static created: FakeAudio[] = [];
  src = "";
  preload = "";
  crossOrigin: string | null = null;
  preservesPitch = false;
  playbackRate = 1;
  volume = 1;
  paused = true;
  currentTime = 0;
  duration = Number.NaN;
  /** Пока промис не разрешён, play() «в полёте» — так эмулируется реальность,
   *  где обещание воспроизведения приезжает позже конца текущего трека. */
  playGate: Promise<void> | null = null;

  constructor() {
    super();
    FakeAudio.created.push(this);
  }

  load(): void {
    // как настоящий элемент: новая загрузка обнуляет позицию и длительность
    this.currentTime = 0;
    this.duration = Number.NaN;
  }

  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }

  play(): Promise<void> {
    const started = () => {
      this.paused = false;
      this.dispatchEvent(new Event("play"));
      this.dispatchEvent(new Event("playing"));
    };
    if (!this.playGate) {
      started();
      return Promise.resolve();
    }
    return this.playGate.then(started);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  // ── стенд ──
  /** Приехали метаданные (без них браузер не принимает currentTime). */
  meta(durationSec: number): void {
    this.duration = durationSec;
    this.dispatchEvent(new Event("loadedmetadata"));
  }
  /** Трек доиграл до конца. */
  end(): void {
    this.dispatchEvent(new Event("ended"));
  }
  /** Позиция сдвинулась (события элемента, а не таймер плеера). */
  at(sec: number): void {
    this.currentTime = sec;
    this.dispatchEvent(new Event("timeupdate"));
  }
}

// ── Подменённая сеть ─────────────────────────────────────────────────
const net = vi.hoisted(() => ({
  getStreamUrl: vi.fn(),
  recordPlay: vi.fn(),
  getRadio: vi.fn(),
}));
vi.mock("./api", () => ({ getApi: () => net, API_URL: "http://api.test/api" }));

const urlOf = (id: string) => `https://stream.test/${id}.mp3`;

/** Задержанные адреса: hold(id) держит ответ сервера, release(id) отпускает. */
const gates = new Map<string, { promise: Promise<void>; open: () => void }>();
function hold(id: string): void {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  gates.set(id, { promise, open });
}
function release(id: string): void {
  gates.get(id)?.open();
  gates.delete(id);
}

let fetchSpy: ReturnType<typeof vi.fn>;

// ── Стенд вокруг провайдера ──────────────────────────────────────────
let ctl!: {
  player: ReturnType<typeof usePlayer>;
  position: ReturnType<typeof usePosition>;
  prefs: Prefs;
  set: (patch: Partial<Prefs>) => void;
};
/** История номера текущего трека: ею ловится «прыжок через трек». */
const indexLog: number[] = [];

function Probe() {
  const player = usePlayer();
  const position = usePosition();
  const { prefs, set } = usePrefs();
  ctl = { player, position, prefs, set };
  useEffect(() => {
    indexLog.push(player.index);
  }, [player.index]);
  return null;
}

const track = (id: string, over: Partial<Track> = {}): Track => ({
  id,
  artist: "Артист",
  title: `Песня ${id}`,
  durationSec: 200,
  coverUrl: null,
  isCached: true,
  sources: ["youtube"],
  loudness: null,
  localHash: null,
  ...over,
});

/** Смонтировать плеер с нужным профилем настроек (как его кладёт экран
 *  настроек — в тот же localStorage, через ту же savePrefs). */
async function mount(over: Partial<Prefs> = {}): Promise<void> {
  savePrefs({ ...DEFAULT_WEB_PREFS, ...over });
  await act(async () => {
    render(
      <PrefsProvider>
        <PlayerProvider>
          <Probe />
        </PlayerProvider>
      </PrefsProvider>,
    );
  });
}

const slot = (n: 0 | 1): FakeAudio => FakeAudio.created[n];
const sounding = (): FakeAudio[] => FakeAudio.created.filter((el) => !el.paused);

/** Клик по треку в подборке. */
async function play(tracks: Track[], at = 0): Promise<void> {
  await act(async () => {
    ctl.player.playContext(tracks, at);
  });
  await settle();
}

/** Дать промисам доехать, не двигая часы. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Музыка доиграла до секунды `sec` — один шаг наблюдателя плеера. */
async function tickTo(el: FakeAudio, sec: number): Promise<void> {
  await act(async () => {
    el.currentTime = sec;
    await vi.advanceTimersByTimeAsync(TICK_MS);
  });
}

/** Прокрутить часы (фейды, интервалы прогрева). */
async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function deferred(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  FakeAudio.created = [];
  gates.clear();
  indexLog.length = 0;
  vi.stubGlobal("Audio", FakeAudio);
  fetchSpy = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchSpy);
  net.getStreamUrl.mockReset();
  net.getStreamUrl.mockImplementation(async (id: string) => {
    const gate = gates.get(id);
    if (gate) await gate.promise;
    return { url: urlOf(id), expiresAt: Date.now() / 1000 + 3600 };
  });
  net.recordPlay.mockReset();
  net.recordPlay.mockResolvedValue(undefined);
  net.getRadio.mockReset();
  net.getRadio.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Названия треков, ушедших в сеть за адресом (кроме заданных). */
const asked = (except: string[] = []): string[] =>
  net.getStreamUrl.mock.calls.map(([id]) => id as string).filter((id) => !except.includes(id));

// ═════════════════════════════════════════════════════════════════════
describe("Сверка номера старта", () => {
  it("клик: ответ на старый запрос не подменяет уже выбранную песню", async () => {
    await mount();
    hold("a");
    hold("b");
    await play([track("a"), track("b")], 0);
    // человек не дождался и щёлкнул следующую
    await act(async () => {
      ctl.player.next();
    });

    // сервер отвечает В ОБРАТНОМ порядке: сначала на второй клик, потом на первый
    release("b");
    await settle();
    release("a");
    await settle();

    expect(ctl.player.current?.id).toBe("b");
    expect(sounding().map((el) => el.src)).toEqual([urlOf("b")]);
    expect(FakeAudio.created.some((el) => el.src === urlOf("a"))).toBe(false);
  });

  it("авто-переход: адрес следующего приехал позже клика — играет выбранное кликом", async () => {
    await mount({ crossfade: true, crossfadeSec: 4, warmAhead: 0, preloadAheadSec: 0 });
    const list = [track("a"), track("b"), track("c")];
    await play(list, 0);

    hold("b"); // адрес следующего застрял в сети
    await tickTo(slot(0), 197); // остаток 3 с ≤ длины кроссфейда → старт перехода
    expect(asked(["a"])).toEqual(["b"]);

    // пока переход в полёте, человек выбрал третью песню
    await play(list, 2);
    release("b");
    await settle();

    expect(ctl.player.current?.id).toBe("c");
    expect(sounding().map((el) => el.src)).toEqual([urlOf("c")]);
    expect(FakeAudio.created.some((el) => el.src === urlOf("b"))).toBe(false);
  });
});

describe("Окно между кликом и ответом сервера", () => {
  // Пока адрес новой песни едет, СТАРАЯ ещё звучит: loadTrack до первого await
  // не трогает ни src, ни play(). Наблюдатель конца трека всё это время тикает
  // — и обязан понимать, что элемент и «текущий трек» разошлись.

  it("позиция звучащей песни не приписывается только что выбранной", async () => {
    await mount({ resumePosition: true, warmAhead: 0, preloadAheadSec: 0, crossfade: false, gapless: false });
    await play([track("a"), track("b")], 0);
    await tickTo(slot(0), 150); // первую слушали 2:30

    hold("b"); // адрес второй едет медленно — первая всё это время играет
    await act(async () => {
      ctl.player.next();
    });
    await wait(400); // десяток тиков наблюдателя, пока адрес в пути

    release("b");
    await settle();
    await act(async () => {
      slot(0).meta(200);
    });

    expect(slot(0).currentTime).toBe(0); // вторая песня — с начала, а не с 2:30
    await act(async () => {
      window.dispatchEvent(new Event("pagehide")); // дописать хранилище
    });
    const stored = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as Record<string, number>;
    expect(stored.b).toBeUndefined(); // и в хранилище чужой позиции нет
    expect(stored.a).toBe(150); // своя — на месте
  });

  it("клик в последние секунды играет выбранное, а не следующее за ним", async () => {
    await mount({ crossfade: true, crossfadeSec: 4, warmAhead: 0, preloadAheadSec: 0 });
    const list = [track("a"), track("b"), track("c")];
    await play(list, 0);
    await tickTo(slot(0), 195); // остаток 5 с — до окна кроссфейда ещё далеко

    hold("b"); // выбрали вторую песню, её адрес в пути
    await play(list, 1);
    await tickTo(slot(0), 197); // первая тем временем дошла до окна кроссфейда

    release("b");
    await settle();

    expect(ctl.player.current?.id).toBe("b");
    expect(sounding().map((el) => el.src)).toEqual([urlOf("b")]);
    expect(asked(["a", "b"])).toEqual([]); // за третьей песней никто не ходил
  });
});

describe("Два слота и эстафета", () => {
  it("следующий греется во втором слоте, пока первый звучит, и принимает эстафету", async () => {
    await mount({ crossfade: true, crossfadeSec: 4, preloadAheadSec: 20, warmAhead: 3 });
    await play([track("a"), track("b")], 0);

    await tickTo(slot(0), 5); // прогрев очереди узнал адрес следующего
    await tickTo(slot(0), 175); // остаток 25 с — заводить рано
    expect(slot(1).src).toBe("");

    await tickTo(slot(0), 185); // остаток 15 с ≤ «за сколько готовить»
    expect(slot(1).src).toBe(urlOf("b"));
    expect(slot(1).paused).toBe(true); // приготовлен, но молчит
    expect(slot(0).paused).toBe(false); // текущий всё ещё звучит

    await tickTo(slot(0), 197); // остаток 3 с — эстафета
    expect(sounding()).toHaveLength(2); // на стыке звучат оба

    await wait(4000); // фейд доиграл
    expect(ctl.player.current?.id).toBe("b");
    expect(sounding().map((el) => el.src)).toEqual([urlOf("b")]);
    expect(slot(0).src).toBe(""); // уходящий слот освобождён
    expect(slot(1).volume).toBeCloseTo(0.9, 3);
    expect(indexLog).toEqual([-1, 0, 1]); // очередь шагнула ровно один раз
  });

  it("трек кончился, пока переход был в полёте, — очередь шагает один раз, музыка не встаёт", async () => {
    await mount({ gapless: true, warmAhead: 0, preloadAheadSec: 0 });
    await play([track("a"), track("b"), track("c")], 0);

    // у перехода без паузы окно 0,15 с — play() второго слота вполне может
    // приехать уже после конца текущего трека
    const gate = deferred();
    slot(1).playGate = gate.promise;
    await tickTo(slot(0), 199.9);
    await act(async () => {
      slot(0).end();
    });
    expect(ctl.player.current?.id).toBe("a"); // очередь ещё не двигали
    expect(ctl.player.playing).toBe(true); // и музыку не останавливали

    await act(async () => {
      gate.open();
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(ctl.player.current?.id).toBe("b");
    expect(indexLog).toEqual([-1, 0, 1]); // ни одного прыжка через трек
    expect(ctl.player.playing).toBe(true);
    expect(sounding().map((el) => el.src)).toEqual([urlOf("b")]);
  });
});

describe("Кроссфейд", () => {
  it("на середине слоты звучат по равной мощности, длина берётся из настроек", async () => {
    await mount({ crossfade: true, crossfadeSec: 6, warmAhead: 0, preloadAheadSec: 0 });
    await play([track("a"), track("b")], 0);

    await tickTo(slot(0), 195); // остаток 5 с ≤ 6 с
    await wait(3000); // середина шестисекундного фейда

    const going = slot(0).volume;
    const coming = slot(1).volume;
    expect(coming).toBeCloseTo(0.9 * Math.SQRT1_2, 2);
    expect(going).toBeCloseTo(0.9 * Math.SQRT1_2, 2);
    // равная мощность: на линейных кривых стык просел бы на 3 дБ
    expect((coming * coming + going * going) / (0.9 * 0.9)).toBeCloseTo(1, 2);
    expect(slot(0).paused).toBe(false); // шесть секунд ещё не вышли

    await wait(3000);
    expect(slot(0).paused).toBe(true);
    expect(slot(1).volume).toBeCloseTo(0.9, 3);
  });

  it("нулевая длительность (фейды выключены) — смена мгновенная, второй слот не нужен", async () => {
    await mount({ crossfade: false, gapless: false, warmAhead: 0, preloadAheadSec: 0 });
    await play([track("a"), track("b")], 0);

    await tickTo(slot(0), 199.9);
    expect(slot(1).src).toBe(""); // заранее никого не заводили
    expect(asked(["a"])).toEqual([]);

    await act(async () => {
      slot(0).end();
    });
    await settle();

    expect(ctl.player.current?.id).toBe("b");
    expect(slot(0).src).toBe(urlOf("b")); // тот же слот, без эстафеты
    expect(slot(0).volume).toBeCloseTo(0.9, 3); // сразу на полном уровне
    expect(slot(1).paused).toBe(true);
  });
});

describe("Переход без паузы", () => {
  it("срабатывает у самого стыка и не превращается в тихий кроссфейд", async () => {
    await mount({ gapless: true, crossfade: false, warmAhead: 0, preloadAheadSec: 0 });
    await play([track("a"), track("b")], 0);

    await tickTo(slot(0), 199); // остаток 1 с — для окна 0,15 с ещё рано
    expect(asked(["a"])).toEqual([]);

    await tickTo(slot(0), 199.9); // остаток 0,1 с — окно
    expect(sounding()).toHaveLength(2);

    await wait(100); // фейд в доли секунды: 0,1 с хватает с запасом
    expect(slot(0).paused).toBe(true);
    expect(slot(1).volume).toBeCloseTo(0.9, 3);
    expect(ctl.player.current?.id).toBe("b");
  });

  it("включены оба — работает кроссфейд, а не переход без паузы", async () => {
    await mount({ gapless: true, crossfade: true, crossfadeSec: 5, warmAhead: 0, preloadAheadSec: 0 });
    await play([track("a"), track("b")], 0);

    await tickTo(slot(0), 196); // остаток 4 с: окно кроссфейда, но не gapless
    expect(sounding()).toHaveLength(2);

    await wait(100);
    expect(slot(0).paused).toBe(false); // пятисекундный фейд ещё идёт
    await wait(5000);
    expect(slot(0).paused).toBe(true);
  });
});

describe("Выравнивание громкости", () => {
  it("множитель трека умножает уровень слота", async () => {
    await mount({ normalize: true });
    await play([track("a", { loudness: -5 })], 0); // громче цели на 9 дБ

    expect(slot(0).volume).toBeCloseTo(0.9 * 0.3548, 3);
  });

  it("выключили на ходу — уровень возвращается к громкости плеера", async () => {
    await mount({ normalize: true });
    await play([track("a", { loudness: -5 })], 0);

    await act(async () => {
      ctl.set({ normalize: false });
    });
    expect(slot(0).volume).toBeCloseTo(0.9, 3);
  });

  it("громкость не измерена — уровень ровно тот, что у плеера", async () => {
    await mount({ normalize: true });
    await play([track("a", { loudness: null })], 0);

    expect(slot(0).volume).toBeCloseTo(0.9, 3);
  });
});

describe("Продолжить с места остановки", () => {
  it("заводит с сохранённой секунды, когда приедут метаданные", async () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ a: 60 }));
    await mount({ resumePosition: true });
    await play([track("a")], 0);

    expect(slot(0).currentTime).toBe(0); // до метаданных браузер точку не примет
    await act(async () => {
      slot(0).meta(200);
    });
    expect(slot(0).currentTime).toBe(60);
    expect(ctl.position.position).toBe(60);
  });

  it("настройка выключена — всегда с начала", async () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ a: 60 }));
    await mount({ resumePosition: false });
    await play([track("a")], 0);

    await act(async () => {
      slot(0).meta(200);
    });
    expect(slot(0).currentTime).toBe(0);
  });

  it("дослушанное и едва начатое не предлагает продолжить", async () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ a: 195, b: 3 }));
    await mount({ resumePosition: true });

    await play([track("a")], 0); // 195 из 200 — это «дослушал», а не «продолжить»
    await act(async () => {
      slot(0).meta(200);
    });
    expect(slot(0).currentTime).toBe(0);

    await play([track("b")], 0); // 3 секунды — начинать заново дешевле
    await act(async () => {
      slot(0).meta(200);
    });
    expect(slot(0).currentTime).toBe(0);
  });

  it("позицию пишут в хранилище не чаще своего порога", async () => {
    await mount({ resumePosition: true, warmAhead: 0, preloadAheadSec: 0 });
    const writes = vi.spyOn(Storage.prototype, "setItem");
    await play([track("a")], 0);
    const saves = () => writes.mock.calls.filter(([key]) => key === RESUME_KEY).length;

    for (let sec = 10; sec < 30; sec++) await tickTo(slot(0), sec); // 20 тиков за 0,8 с
    expect(saves()).toBe(1);

    await wait(4000); // порог 4 с прошёл — ровно одна дозапись
    expect(saves()).toBe(2);

    const stored = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as Record<string, number>;
    expect(stored.a).toBeGreaterThanOrEqual(29);
    writes.mockRestore();
  });

  it("дослушанный трек забывает свою позицию", async () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ a: 60 }));
    await mount({ resumePosition: true, warmAhead: 0, preloadAheadSec: 0 });
    await play([track("a")], 0);

    await act(async () => {
      slot(0).end();
    });
    await settle();

    const stored = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as Record<string, number>;
    expect(stored.a).toBeUndefined();
  });
});

describe("Повторный клик по тому, что уже играет", () => {
  it("та же подборка и тот же трек — пауза с сохранением позиции", async () => {
    await mount({ warmAhead: 0, preloadAheadSec: 0 });
    const list = [track("a"), track("b")];
    await play(list, 0);
    await act(async () => {
      slot(0).at(42);
    });

    await play(list, 0); // повторный клик по той же плитке
    expect(slot(0).paused).toBe(true);
    expect(slot(0).currentTime).toBe(42); // не «сначала», а именно пауза
    expect(ctl.player.playing).toBe(false);

    await play(list, 0); // и ещё раз — играем дальше с того же места
    expect(slot(0).paused).toBe(false);
    expect(slot(0).currentTime).toBe(42);
    expect(ctl.player.playing).toBe(true);
  });

  it("та же песня из ДРУГОЙ подборки — заводится заново", async () => {
    await mount({ warmAhead: 0, preloadAheadSec: 0 });
    await play([track("a"), track("b")], 0);
    await act(async () => {
      slot(0).at(42);
    });

    await play([track("a"), track("c")], 0); // другой контекст, первая песня та же
    expect(slot(0).paused).toBe(false);
    expect(slot(0).currentTime).toBe(0);
    expect(ctl.player.queue.map((tr) => tr.id)).toEqual(["a", "c"]);
  });
});

describe("Прогрев очереди", () => {
  it("греет по одному треку и не чаще своего интервала", async () => {
    await mount({ warmAhead: 3, preloadAheadSec: 0, crossfade: false, gapless: false });
    await play([track("a"), track("b"), track("c"), track("d")], 0);

    for (let sec = 3; sec < 20; sec++) await tickTo(slot(0), sec); // 17 тиков за 0,7 с
    expect(asked(["a"])).toEqual(["b"]); // за секунду — ровно один трек
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(urlOf("b"));
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-1"); // байты не качаем

    await wait(1000);
    expect(asked(["a"])).toEqual(["b", "c"]);
  });

  it("«треков наготове» = 0 — в сеть заранее не ходим вовсе", async () => {
    await mount({ warmAhead: 0, preloadAheadSec: 0, crossfade: false, gapless: false });
    await play([track("a"), track("b"), track("c")], 0);

    for (let sec = 3; sec < 20; sec++) await tickTo(slot(0), sec);
    await wait(5000);
    expect(asked(["a"])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Бесконечное радио", () => {
  it("очередь кончилась — продолжает похожими, один заход", async () => {
    net.getRadio.mockResolvedValue([track("r1"), track("r2")]);
    await mount({ radioEndless: true, warmAhead: 0, preloadAheadSec: 0 });
    await play([track("a")], 0);

    await act(async () => {
      slot(0).end();
    });
    await settle();

    expect(net.getRadio).toHaveBeenCalledTimes(1);
    expect(net.getRadio).toHaveBeenCalledWith("a");
    expect(ctl.player.queue.map((tr) => tr.id)).toEqual(["a", "r1", "r2"]);
    expect(ctl.player.current?.id).toBe("r1");
    expect(ctl.player.playing).toBe(true);
  });

  it("похожего не нашлось — плеер честно останавливается", async () => {
    net.getRadio.mockResolvedValue([]);
    await mount({ radioEndless: true, warmAhead: 0, preloadAheadSec: 0 });
    await play([track("a")], 0);

    await act(async () => {
      slot(0).end();
    });
    await settle();

    expect(ctl.player.playing).toBe(false);
    expect(ctl.player.loading).toBe(false);
  });

  it("радио выключено — в сеть за похожими не ходим", async () => {
    await mount({ radioEndless: false, warmAhead: 0, preloadAheadSec: 0 });
    await play([track("a")], 0);

    await act(async () => {
      slot(0).end();
    });
    await settle();

    expect(net.getRadio).not.toHaveBeenCalled();
    expect(ctl.player.playing).toBe(false);
  });
});
