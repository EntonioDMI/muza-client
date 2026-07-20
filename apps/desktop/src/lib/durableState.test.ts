/** Зеркало критичного localStorage: направление восстановления решает НОМЕР
 *  ВЕРСИИ, не слепое «файл всегда прав» — иначе потерянная файл-запись
 *  подсовывает api-client ротированный токен (репро 2026-07-16: «восстановил»
 *  старую пару → сервер счёл кражей). Каждая ветка гонки — отдельный тест. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: h.invoke,
  isTauri: h.isTauri,
}));

const KEY = "muza.session.v1";
const SEQ = `muza.mirror.seq:${KEY}`;

/** Модуль перезагружается на каждый тест: патч Storage.prototype и флаг
 *  patched — модульное состояние, между тестами его надо начинать заново. */
let initDurableState: () => Promise<void>;
const origSet = Storage.prototype.setItem;
const origDel = Storage.prototype.removeItem;

/** Диск отвечает конвертом {seq, value} для KEY, null для остальных.
 *  value: null — могильный камень (ключ удалён в этой версии). */
function diskHas(env: { seq: number; value: string | null } | null) {
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "state_get") return args?.key === KEY && env ? JSON.stringify(env) : null;
    return undefined;
  });
}

const diskWrites = () =>
  h.invoke.mock.calls
    .filter(([cmd, a]) => cmd === "state_set" && (a as { key: string }).key === KEY)
    .map(([, a]) => JSON.parse((a as { value: string }).value) as { seq: number; value: string | null });

beforeEach(async () => {
  Storage.prototype.setItem = origSet;
  Storage.prototype.removeItem = origDel;
  localStorage.clear();
  h.invoke.mockReset();
  h.invoke.mockResolvedValue(undefined);
  h.isTauri.mockReturnValue(true);
  vi.resetModules();
  ({ initDurableState } = await import("./durableState"));
});

afterEach(() => {
  Storage.prototype.setItem = origSet;
  Storage.prototype.removeItem = origDel;
  localStorage.clear();
});

describe("initDurableState: кто новее, тот и прав", () => {
  it("файл новее (kill потерял хвост LevelDB) — память догоняет файл", async () => {
    localStorage.setItem(KEY, "stale-pair");
    localStorage.setItem(SEQ, "3");
    diskHas({ seq: 7, value: "fresh-pair" });

    await initDurableState();

    expect(localStorage.getItem(KEY)).toBe("fresh-pair");
    expect(localStorage.getItem(SEQ)).toBe("7");
  });

  it("память новее (файл-запись потерялась при перезагрузке) — файл догоняет память, НЕ наоборот", async () => {
    localStorage.setItem(KEY, "fresh-pair");
    localStorage.setItem(SEQ, "9");
    diskHas({ seq: 4, value: "stale-pair" });

    await initDurableState();

    expect(localStorage.getItem(KEY)).toBe("fresh-pair"); // ротированный токен не «восстановлен»
    expect(diskWrites().at(-1)).toEqual({ seq: 9, value: "fresh-pair" });
  });

  it("первый запуск после обновления: файла нет — сеем из localStorage", async () => {
    localStorage.setItem(KEY, "legacy-pair");
    diskHas(null);

    await initDurableState();

    expect(diskWrites().at(-1)).toEqual({ seq: 0, value: "legacy-pair" });
  });

  it("легаси-файл без конверта (сырой JSON сессии) не роняет разбор", async () => {
    diskHas(null);
    h.invoke.mockImplementation(async (cmd: string) => (cmd === "state_get" ? "raw-legacy-value" : undefined));

    await initDurableState();

    // сырое содержимое = версия 0: пустая память проигрывает только не-null значению
    expect(localStorage.getItem(KEY)).toBe("raw-legacy-value");
  });

  it("диск с могильным камнем новее памяти — ключ удаляется, сессия НЕ воскресает", async () => {
    // Сценарий: на этой машине вышли из аккаунта, kill убил хвост LevelDB —
    // память откатилась к живой сессии, но диск помнит удаление (камень новее)
    localStorage.setItem(KEY, "revoked-pair");
    localStorage.setItem(SEQ, "3");
    diskHas({ seq: 8, value: null });

    await initDurableState();

    expect(localStorage.getItem(KEY)).toBe(null);
    expect(localStorage.getItem(SEQ)).toBe("8");
  });

  it("память «удалено» (счётчик есть, ключа нет), диск со старым живым значением — не воскресает, диск получает камень", async () => {
    // Сценарий: вышли из аккаунта, камень на диск не доехал (kill сразу после
    // выхода). Счётчик в LevelDB старше файла — файл обязан проиграть.
    localStorage.setItem(SEQ, "9");
    diskHas({ seq: 4, value: "revoked-pair" });

    await initDurableState();

    expect(localStorage.getItem(KEY)).toBe(null);
    expect(diskWrites().at(-1)).toEqual({ seq: 9, value: null });
  });

  it("вне Tauri — ничего не трогаем", async () => {
    h.isTauri.mockReturnValue(false);
    localStorage.setItem(KEY, "web-value");

    await initDurableState();

    expect(h.invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe("web-value");
  });
});

describe("зеркалирование записей после init", () => {
  it("setItem зеркалится в файл с растущим номером", async () => {
    diskHas(null);
    await initDurableState();
    h.invoke.mockClear();
    h.invoke.mockResolvedValue(undefined);

    localStorage.setItem(KEY, "pair-1");
    localStorage.setItem(KEY, "pair-2");

    const writes = diskWrites();
    expect(writes.map((w) => w.seq)).toEqual([1, 2]);
    expect(writes.at(-1)?.value).toBe("pair-2");
  });

  /** Удаление — тоже ВЕРСИЯ состояния, а не сброс счётчика: раньше seq
   *  умирал вместе с ключом, state_del летел fire-and-forget, и убитый сразу
   *  после выхода процесс оставлял на диске файл со старшим seq — следующий
   *  старт ВОСКРЕШАЛ уже отозванную сессию. */
  it("removeItem поднимает счётчик и пишет на диск могильный камень, а не state_del", async () => {
    diskHas(null);
    await initDurableState();
    localStorage.setItem(KEY, "pair-1");
    h.invoke.mockClear();
    h.invoke.mockResolvedValue(undefined);

    localStorage.removeItem(KEY);

    expect(localStorage.getItem(KEY)).toBe(null);
    expect(localStorage.getItem(SEQ)).toBe("2"); // счётчик пережил удаление
    expect(diskWrites().at(-1)).toEqual({ seq: 2, value: null });
    expect(h.invoke).not.toHaveBeenCalledWith("state_del", { key: KEY });
  });

  it("чужие ключи не зеркалятся", async () => {
    diskHas(null);
    await initDurableState();
    h.invoke.mockClear();

    localStorage.setItem("muza.something.else", "x");

    expect(h.invoke).not.toHaveBeenCalled();
  });
});
