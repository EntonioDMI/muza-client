/** Регресс 11.08: повтор трека на нативном движке умирал намертво.
 *
 *  Жалоба владельца: «после репита трек мёртвый — прогресс идёт, но звука нет,
 *  и как ни пролистывай, играть не будет; оживает только если зайти в интерфейс
 *  и нажать на трек».
 *
 *  Причин было две, и обе живут по разные стороны IPC:
 *
 *  1) Rust: поток декодера выходил из цикла по `break` на конце файла, а
 *     перемотка обслуживается В ГОЛОВЕ ТОГО ЖЕ ЦИКЛА — читать запрос становилось
 *     некому. Проверяется на стороне Rust, здесь недосягаемо.
 *
 *  2) Здесь: `endedSent` гасит повторную отправку конца и сбрасывался ТОЛЬКО в
 *     startPolling(), то есть при новом play(). Повтор трека play() не зовёт —
 *     он отматывает на ноль и снимает паузу. Значит второй конец того же трека
 *     не доезжал никогда: повтор срабатывал РОВНО ОДИН РАЗ, а на втором круге
 *     трек домолчал бы до конца и встал.
 *
 *  Плюс порядок проверок в опросе: конец обязан доезжать ДО гварда `playing`.
 *  Иначе стоит `playing` начать значить правду («звук идёт»), и конец трека
 *  перестанет приходить вовсе — на конце звук как раз не идёт. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { HybridAudioEngine } = await import("./nativeEngine");

/** Опрос ходит раз в POLL_MS; в тестах гоняем таймеры вручную. */
const POLL_MS = 250;

interface Status {
  position: number;
  ended: boolean;
  playing: boolean;
}

/** Движок, доведённый до нативного пути: play() с путём файла кэша. */
async function nativeEngine(status: () => Status) {
  const onEnded = vi.fn();
  const onTime = vi.fn();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "native_status") return Promise.resolve(status());
    return Promise.resolve(undefined);
  });
  const engine = new HybridAudioEngine({ onEnded, onTime, onError: vi.fn() } as never);
  await engine.play("http://asset.localhost/C%3A%5Ccache%5C1.mp3", 1);
  return { engine, onEnded, onTime };
}

/** Один такт опроса плюс разбор микрозадач: call() возвращает промис. */
async function tick() {
  await vi.advanceTimersByTimeAsync(POLL_MS);
}

describe("повтор трека на нативном пути", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
  });

  it("второй конец того же трека доезжает после перемотки на ноль", async () => {
    let ended = false;
    const { engine, onEnded } = await nativeEngine(() => ({ position: 0, ended, playing: true }));

    // Первый конец — повтор обязан узнать о нём.
    ended = true;
    await tick();
    expect(onEnded).toHaveBeenCalledTimes(1);

    // Повтор: отматываем на ноль и снимаем паузу — ровно то, что делает
    // usePlayback.advance() при repeat === "one". play() при этом НЕ зовётся.
    engine.seek(0);
    ended = false;
    await tick();

    // Второй круг доигран. До починки здесь была тишина навсегда: endedSent
    // остался бы взведённым с первого раза.
    ended = true;
    await tick();
    expect(onEnded).toHaveBeenCalledTimes(2);

    engine.stop();
  });

  it("конец доезжает, даже когда движок уже не считает себя играющим", async () => {
    // playing:false — состояние «звук кончился». Конец обязан прийти всё равно.
    const { onEnded } = await nativeEngine(() => ({ position: 0, ended: true, playing: false }));

    await tick();

    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
