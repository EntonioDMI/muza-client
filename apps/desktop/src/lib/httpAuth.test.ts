/** Авторизация HttpMuzaApi после разбора вылетов из аккаунта (2026-07-20).
 *
 *  Контракт: сессия бесконечная, разлогин — только осознанный. Отсюда три
 *  инварианта, которые эти тесты стерегут:
 *  1) refresh — single-flight: параллельные 401 ждут ОДИН POST /auth/refresh
 *     (N одновременных обновлений одним токеном раньше гонялись насмерть);
 *  2) restoreSession — локальное чтение БЕЗ сети (каждый старт гонял
 *     ротацию — каждый запуск был шансом вылететь);
 *  3) сессию стирает ТОЛЬКО явный 401/403 от самого /auth/refresh — сеть,
 *     5xx, не-JSON тело (каптив-портал) переживаются без разлогина. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, HttpMuzaApi } from "@muza/api-client";

const SESSION_KEY = "muza.session.v1";
const DEVICE_KEY = "muza.device.v1";

const storedSession = {
  user: { id: "7", username: "qa", anonymous: false, createdAt: "2026-01-01T00:00:00.000Z" },
  accessToken: "at-old",
  refreshToken: "rt-1",
};

const wirePair = {
  access_token: "at-new",
  refresh_token: "rt-1",
  token_type: "bearer",
  user_id: "7",
  username: "qa",
};

const seedSession = () => localStorage.setItem(SESSION_KEY, JSON.stringify(storedSession));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("refresh — single-flight", () => {
  it("два параллельных 401 → ровно один POST /auth/refresh", async () => {
    seedSession();
    let refreshCalls = 0;
    let refreshed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith("/auth/refresh")) {
          refreshCalls += 1;
          // окно, в котором второй 401 успевает попроситься на обновление
          await new Promise((r) => setTimeout(r, 20));
          refreshed = true;
          return json(wirePair);
        }
        return refreshed ? json({}) : json({ message: "Unauthorized" }, 401);
      }),
    );
    const api = new HttpMuzaApi("http://x/api");

    await Promise.all([api.exportData(), api.exportData()]);

    expect(refreshCalls).toBe(1);
  });
});

describe("restoreSession — локально, без сети", () => {
  it("возвращает сохранённую сессию и НЕ делает ни одного запроса", async () => {
    seedSession();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const api = new HttpMuzaApi("http://x/api");

    const s = await api.restoreSession();

    expect(s?.user.username).toBe("qa");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("битый JSON в localStorage — null (экран входа), а не исключение (чёрный экран)", async () => {
    localStorage.setItem(SESSION_KEY, "{оборванная запись");
    vi.stubGlobal("fetch", vi.fn());
    const api = new HttpMuzaApi("http://x/api");

    await expect(api.restoreSession()).resolves.toBeNull();
  });
});

describe("стирание сессии — только явный отказ авторизации от /auth/refresh", () => {
  it("refresh упал сетью — запрос падает, но сессия ЖИВА", async () => {
    seedSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith("/auth/refresh")) throw new TypeError("fetch failed");
        return json({ message: "Unauthorized" }, 401);
      }),
    );
    const api = new HttpMuzaApi("http://x/api");

    await expect(api.exportData()).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it("refresh ответил 500 — сессия жива", async () => {
    seedSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith("/auth/refresh")) return json({ message: "internal" }, 500);
        return json({ message: "Unauthorized" }, 401);
      }),
    );
    const api = new HttpMuzaApi("http://x/api");

    await expect(api.exportData()).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it("200 с HTML вместо JSON (каптив-портал) — ApiError, не SyntaxError; сессия жива", async () => {
    seedSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith("/auth/refresh"))
          return new Response("<html>Войдите в сеть кафе</html>", { status: 200 });
        return json({ message: "Unauthorized" }, 401);
      }),
    );
    const api = new HttpMuzaApi("http://x/api");

    await expect(api.exportData()).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it("явный 401 от /auth/refresh — сессия стёрта (токен отозван по-настоящему)", async () => {
    seedSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith("/auth/refresh")) return json({ message: "Refresh-токен отозван" }, 401);
        return json({ message: "Unauthorized" }, 401);
      }),
    );
    const api = new HttpMuzaApi("http://x/api");

    await expect(api.exportData()).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe("отзыв сессии на ходу — приложение обязано узнать", () => {
  // Найдено живым запуском 20.07: refresh вернул 401, сессия стёрлась из
  // хранилища — а окно продолжало показывать вход и молча ломалось
  // («сервер недоступен» на каждом запросе) до перезапуска. Раньше это
  // ловил сетевой restoreSession на старте; теперь старт локальный, и
  // единственная точка правды — этот сигнал.
  it("явный 401 от refresh зовёт обработчик ровно один раз", async () => {
    seedSession();
    const revoked = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith("/auth/refresh")) return json({ message: "Refresh-токен отозван" }, 401);
        return json({ message: "Unauthorized" }, 401);
      }),
    );
    const api = new HttpMuzaApi("http://x/api");
    api.onSessionRevoked(revoked);

    await Promise.all([api.exportData().catch(() => undefined), api.exportData().catch(() => undefined)]);

    expect(revoked).toHaveBeenCalledTimes(1);
  });

  it("временная беда (500) обработчик НЕ зовёт — сессия жива", async () => {
    seedSession();
    const revoked = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith("/auth/refresh")) return json({ message: "internal" }, 500);
        return json({ message: "Unauthorized" }, 401);
      }),
    );
    const api = new HttpMuzaApi("http://x/api");
    api.onSessionRevoked(revoked);

    await expect(api.exportData()).rejects.toBeInstanceOf(ApiError);
    expect(revoked).not.toHaveBeenCalled();
  });

  it("свой выход обработчик не дёргает (приложение и так знает)", async () => {
    seedSession();
    const revoked = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => json(undefined, 204)));
    const api = new HttpMuzaApi("http://x/api");
    api.onSessionRevoked(revoked);

    await api.logout();

    expect(revoked).not.toHaveBeenCalled();
  });
});

describe("deviceId — стабильный id установки (сессия = устройство)", () => {
  it("login шлёт device_id, генерирует один раз и переиспользует", async () => {
    const bodies: { device_id?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as { device_id?: string });
        return json(wirePair);
      }),
    );
    const api = new HttpMuzaApi("http://x/api");

    await api.login({ username: "qa", password: "12345678" });
    await api.login({ username: "qa", password: "12345678" });

    expect(bodies[0].device_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/); // формат серверного DTO
    expect(localStorage.getItem(DEVICE_KEY)).toBe(bodies[0].device_id);
    expect(bodies[1].device_id).toBe(bodies[0].device_id);
  });

  it("refresh шлёт device_id (бэкфилл старых сессий на серверe)", async () => {
    seedSession();
    localStorage.setItem(DEVICE_KEY, "dev-fixed-1234");
    const refreshBodies: { device_id?: string }[] = [];
    let refreshed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).endsWith("/auth/refresh")) {
          refreshBodies.push(JSON.parse(String(init?.body)) as { device_id?: string });
          refreshed = true;
          return json(wirePair);
        }
        return refreshed ? json({}) : json({ message: "Unauthorized" }, 401);
      }),
    );
    const api = new HttpMuzaApi("http://x/api");

    await api.exportData();

    expect(refreshBodies[0]?.device_id).toBe("dev-fixed-1234");
  });
});
