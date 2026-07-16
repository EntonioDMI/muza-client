import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import { detectPlatform, useVisitPing, VISIT_DAY_KEY } from "./useVisitPing";

// Visit-пинг (кусок B, решение владельца): «уникальные за день» делаются на
// КЛИЕНТЕ — максимум один пинг в календарный день (localStorage), серверу
// идентификаторы не нужны. Та же галочка prefs.telemetry, что и у остального.

function Probe({ api, enabled }: { api: MuzaApi; enabled: boolean }) {
  useVisitPing(api, enabled);
  return null;
}

function makeApi() {
  return { sendVisit: vi.fn().mockResolvedValue(undefined) } as unknown as MuzaApi & {
    sendVisit: ReturnType<typeof vi.fn>;
  };
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("detectPlatform", () => {
  it("узнаёт ОС по userAgent", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macos");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectPlatform("что-то неведомое")).toBe("unknown");
  });
});

describe("useVisitPing", () => {
  it("шлёт один пинг вскоре после старта и записывает день", async () => {
    const api = makeApi();
    render(<Probe api={api} enabled />);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(api.sendVisit).toHaveBeenCalledTimes(1);
    const arg = api.sendVisit.mock.calls[0][0];
    expect(typeof arg.appVersion).toBe("string");
    expect(typeof arg.platform).toBe("string");
    expect(localStorage.getItem(VISIT_DAY_KEY)).toBe(localToday());
  });

  it("сегодня уже пинговали — молчим", async () => {
    localStorage.setItem(VISIT_DAY_KEY, localToday());
    const api = makeApi();
    render(<Probe api={api} enabled />);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(api.sendVisit).not.toHaveBeenCalled();
  });

  it("телеметрия выключена — ни пинга, ни записи дня", async () => {
    const api = makeApi();
    render(<Probe api={api} enabled={false} />);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(api.sendVisit).not.toHaveBeenCalled();
    expect(localStorage.getItem(VISIT_DAY_KEY)).toBeNull();
  });

  it("сеть упала — день НЕ записан, следующий запуск попробует снова", async () => {
    const api = makeApi();
    api.sendVisit.mockRejectedValue(new Error("offline"));
    render(<Probe api={api} enabled />);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(api.sendVisit).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(VISIT_DAY_KEY)).toBeNull();
  });

  it("размонтирование до таймера — пинг не уходит", async () => {
    const api = makeApi();
    const { unmount } = render(<Probe api={api} enabled />);
    unmount();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(api.sendVisit).not.toHaveBeenCalled();
  });
});
