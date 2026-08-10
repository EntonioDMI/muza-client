import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ isTauri: vi.fn(() => true), check: vi.fn(), relaunch: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: tauri.isTauri }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: tauri.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: tauri.relaunch }));

import { autoCheckForUpdate, checkForUpdate, UPDATE_CHECK_INTERVAL_MS } from "./updater";

beforeEach(() => {
  localStorage.clear();
  tauri.check.mockReset();
  tauri.relaunch.mockReset();
  tauri.isTauri.mockReturnValue(true);
});

describe("автопроверка обновлений", () => {
  // Раньше здесь стояли два часа плюс метка «последней проверки» в
  // localStorage. Метка глушила проверку при запуске: перезапустил приложение
  // через десять минут — проверки нет вовсе. Владелец ждёт обратного: проверку
  // каждый старт (решение 10.08), поэтому троттла больше нет.
  it("интервал — полчаса (App.tsx вешает на него setInterval)", () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(30 * 60 * 1000);
  });

  it("проверяет при КАЖДОМ вызове: подряд идущие запуски не глушатся", async () => {
    tauri.check.mockResolvedValue(null);

    await autoCheckForUpdate();
    await autoCheckForUpdate();

    expect(tauri.check).toHaveBeenCalledTimes(2);
  });

  it("упавшая проверка не мешает следующей", async () => {
    tauri.check.mockRejectedValueOnce(new Error("нет сети"));

    await expect(autoCheckForUpdate()).resolves.toBeNull();

    tauri.check.mockResolvedValueOnce(null);
    await autoCheckForUpdate();
    expect(tauri.check).toHaveBeenCalledTimes(2);
  });

  it("вне Tauri (браузер) — проверки нет", async () => {
    tauri.isTauri.mockReturnValue(false);

    await expect(autoCheckForUpdate()).resolves.toBeNull();
    expect(tauri.check).not.toHaveBeenCalled();
  });
});

describe("загрузка и установка разделены", () => {
  /** Найденное обновление с подставными download/install. */
  const foundUpdate = () => {
    const update = { version: "0.2.1", body: "заметки релиза", download: vi.fn(), install: vi.fn() };
    tauri.check.mockResolvedValueOnce(update);
    return update;
  };

  it("наружу идёт версия и заметки", async () => {
    foundUpdate();

    const found = await autoCheckForUpdate();

    expect(found?.version).toBe("0.2.1");
    expect(found?.notes).toBe("заметки релиза");
  });

  // Главный смысл разделения: кнопка в сайдбаре включается только после того,
  // как установщик уже на диске. Если бы download тянул за собой установку,
  // приложение закрывалось бы само, без нажатия.
  it("download НЕ ставит обновление и не перезапускает приложение", async () => {
    const update = foundUpdate();

    const found = await checkForUpdate();
    await found?.download(() => undefined);

    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).not.toHaveBeenCalled();
    expect(tauri.relaunch).not.toHaveBeenCalled();
  });

  it("install ставит уже скачанное и перезапускает", async () => {
    const update = foundUpdate();

    const found = await checkForUpdate();
    await found?.install();

    expect(update.install).toHaveBeenCalledTimes(1);
    expect(tauri.relaunch).toHaveBeenCalledTimes(1);
    // Повторно качать нечего — установщик уже лежит на диске.
    expect(update.download).not.toHaveBeenCalled();
  });

  it("прогресс загрузки доходит наружу в процентах", async () => {
    const update = foundUpdate();
    update.download.mockImplementation(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 200 } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
      onEvent({ event: "Finished" });
    });

    const seen: number[] = [];
    const found = await checkForUpdate();
    await found?.download((pct) => seen.push(pct));

    expect(seen).toEqual([0, 50, 100]);
  });

  it("сервер не прислал размер — отдаём -1 вместо вранья про проценты", async () => {
    const update = foundUpdate();
    update.download.mockImplementation(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: null } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
    });

    const seen: number[] = [];
    const found = await checkForUpdate();
    await found?.download((pct) => seen.push(pct));

    expect(seen).toEqual([-1]);
  });
});
