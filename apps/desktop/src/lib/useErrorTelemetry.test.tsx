import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import { createErrorReporter, type ErrorReporter } from "./errorReporter";
import { useErrorTelemetry } from "./useErrorTelemetry";

// Батчер ошибок: тот же 10-минутный ритм и то же согласие prefs.telemetry,
// что у useTelemetry. Реакт-падения (крашскрин) уходят немедленно — юзер
// сейчас закроет приложение, следующего окна не будет.

function Probe({ api, enabled, reporter }: { api: MuzaApi; enabled: boolean; reporter: ErrorReporter }) {
  useErrorTelemetry(api, enabled, reporter);
  return null;
}

function makeApi() {
  return { sendClientErrors: vi.fn().mockResolvedValue(undefined) } as unknown as MuzaApi & {
    sendClientErrors: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useErrorTelemetry", () => {
  it("по тику шлёт накопленный батч и очищает буфер", async () => {
    const api = makeApi();
    const rep = createErrorReporter();
    rep.capture("error", "boom", "at x.ts:1");
    render(<Probe api={api} enabled reporter={rep} />);

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(api.sendClientErrors).toHaveBeenCalledTimes(1);
    const batch = api.sendClientErrors.mock.calls[0][0];
    expect(batch.errors).toHaveLength(1);
    expect(batch.errors[0]).toMatchObject({ kind: "error", message: "boom", count: 1 });
    expect(typeof batch.appVersion).toBe("string");
    expect(rep.size()).toBe(0);
  });

  it("пустое окно — не шумим", async () => {
    const api = makeApi();
    render(<Probe api={api} enabled reporter={createErrorReporter()} />);

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(api.sendClientErrors).not.toHaveBeenCalled();
  });

  it("телеметрия выключена — не шлём и выбрасываем буфер", async () => {
    const api = makeApi();
    const rep = createErrorReporter();
    rep.capture("error", "secret");
    render(<Probe api={api} enabled={false} reporter={rep} />);

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(api.sendClientErrors).not.toHaveBeenCalled();
    expect(rep.size()).toBe(0);
  });

  it("react-падение уходит немедленно, не дожидаясь тика", async () => {
    const api = makeApi();
    const rep = createErrorReporter();
    render(<Probe api={api} enabled reporter={rep} />);

    rep.reportReactError(new Error("крашскрин"));
    await vi.advanceTimersByTimeAsync(5); // микротаски флаша

    expect(api.sendClientErrors).toHaveBeenCalledTimes(1);
    expect(api.sendClientErrors.mock.calls[0][0].errors[0].kind).toBe("react");
  });

  it("сеть упала — окно потеряно, но приложение живо (best-effort)", async () => {
    const api = makeApi();
    api.sendClientErrors.mockRejectedValue(new Error("offline"));
    const rep = createErrorReporter();
    rep.capture("error", "boom");
    render(<Probe api={api} enabled reporter={rep} />);

    await expect(vi.advanceTimersByTimeAsync(10 * 60_000)).resolves.not.toThrow();
  });

  it("размонтирование снимает интервал и urgent-колбэк", async () => {
    const api = makeApi();
    const rep = createErrorReporter();
    const { unmount } = render(<Probe api={api} enabled reporter={rep} />);
    unmount();

    rep.capture("error", "после смерти");
    rep.reportReactError(new Error("после смерти 2"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(api.sendClientErrors).not.toHaveBeenCalled();
  });
});
