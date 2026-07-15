import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ isTauri: vi.fn(() => true), check: vi.fn(), relaunch: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: tauri.isTauri }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: tauri.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: tauri.relaunch }));

import { autoCheckForUpdate, UPDATE_CHECK_INTERVAL_MS } from "./updater";

// Тот же ключ, что и в модуле: тест сторожит формат метки, а не только логику.
const LAST_CHECK_KEY = "muza.updater.lastCheck.v1";

/** Метка «проверяли N мс назад». */
const markAgo = (ms: number) => localStorage.setItem(LAST_CHECK_KEY, String(Date.now() - ms));

beforeEach(() => {
  localStorage.clear();
  tauri.check.mockReset();
  tauri.isTauri.mockReturnValue(true);
});

describe("autoCheckForUpdate: троттл между перезапусками", () => {
  it("интервал — 2 часа (App.tsx вешает на него setInterval)", () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(2 * 3600 * 1000);
  });

  it("свежая метка — проверка не идёт", async () => {
    markAgo(60_000);

    await expect(autoCheckForUpdate()).resolves.toBeNull();
    expect(tauri.check).not.toHaveBeenCalled();
  });

  it("метка старше интервала — проверка идёт", async () => {
    markAgo(UPDATE_CHECK_INTERVAL_MS + 1);
    tauri.check.mockResolvedValueOnce(null);

    await autoCheckForUpdate();

    expect(tauri.check).toHaveBeenCalledTimes(1);
  });

  it("вне Tauri (браузер) — проверки нет", async () => {
    tauri.isTauri.mockReturnValue(false);

    await expect(autoCheckForUpdate()).resolves.toBeNull();
    expect(tauri.check).not.toHaveBeenCalled();
  });
});

describe("autoCheckForUpdate: метка пишется только при успехе", () => {
  // Регресс: метка писалась ДО try, и упавшая проверка сжигала окно целиком —
  // ноутбук без сети при старте не узнавал об обновлении ещё 2 часа.
  it("упавшая проверка НЕ пишет метку и не съедает окно", async () => {
    tauri.check.mockRejectedValueOnce(new Error("нет сети"));

    await expect(autoCheckForUpdate()).resolves.toBeNull();
    expect(localStorage.getItem(LAST_CHECK_KEY)).toBeNull();

    // следующая попытка идёт сразу, а не через 2 часа
    tauri.check.mockResolvedValueOnce(null);
    await autoCheckForUpdate();
    expect(tauri.check).toHaveBeenCalledTimes(2);
  });

  it("успех без обновлений (null) — метка пишется: сервер ответил", async () => {
    tauri.check.mockResolvedValueOnce(null);

    await expect(autoCheckForUpdate()).resolves.toBeNull();
    expect(Number(localStorage.getItem(LAST_CHECK_KEY))).toBeGreaterThan(0);

    // метка свежая → следующий вызов заглушён троттлом
    await autoCheckForUpdate();
    expect(tauri.check).toHaveBeenCalledTimes(1);
  });

  it("успех с найденным обновлением — метка пишется, наружу идёт FoundUpdate", async () => {
    tauri.check.mockResolvedValueOnce({ version: "0.1.2", body: "заметки релиза", downloadAndInstall: vi.fn() });

    const found = await autoCheckForUpdate();

    expect(found?.version).toBe("0.1.2");
    expect(found?.notes).toBe("заметки релиза");
    expect(Number(localStorage.getItem(LAST_CHECK_KEY))).toBeGreaterThan(0);
  });
});
