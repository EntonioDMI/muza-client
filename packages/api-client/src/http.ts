import type { MuzaApi } from "./index";
import { type Credentials, type Session, SessionSchema } from "./schemas";

const STORAGE_KEY = "muza.session.v1";

/** Ошибка API с человекочитаемым сообщением сервера (409 «Имя занято» и т.п.). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
  user_id: string;
  username: string;
}

function sessionFromTokens(pair: TokenPair): Session {
  return {
    user: {
      id: pair.user_id,
      username: pair.username,
      anonymous: false,
      createdAt: new Date().toISOString(),
    },
    accessToken: pair.access_token,
    refreshToken: pair.refresh_token,
  };
}

/** HTTP-реализация MuzaApi против muza-server (Stage 2).
 *  Анонимный вход НЕ серверный: аккаунт-на-устройстве живёт локально
 *  (localStorage), синхронизации нет — ровно как обещает модалка. */
export class HttpMuzaApi implements MuzaApi {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
      });
    } catch {
      throw new ApiError(0, "Сервер недоступен. Проверь, что muza-server запущен.");
    }
    if (!res.ok) {
      let message = `Ошибка ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string | string[] };
        if (body.message) message = Array.isArray(body.message) ? body.message[0] : body.message;
      } catch {
        /* тело не JSON — оставляем статус */
      }
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private persist(session: Session): Session {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  async loginAnonymous(): Promise<Session> {
    return this.persist({
      user: {
        id: crypto.randomUUID(),
        username: null,
        anonymous: true,
        createdAt: new Date().toISOString(),
      },
      accessToken: `anon-${crypto.randomUUID()}`,
      refreshToken: null,
    });
  }

  async login(credentials: Credentials): Promise<Session> {
    const pair = await this.request<TokenPair>("/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    return this.persist(sessionFromTokens(pair));
  }

  /** Регистрация без почты (email-путь с verify — отдельными методами ниже). */
  async register(credentials: Credentials): Promise<Session> {
    const pair = await this.request<TokenPair>("/auth/register", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    return this.persist(sessionFromTokens(pair));
  }

  async logout(): Promise<void> {
    const session = this.load();
    localStorage.removeItem(STORAGE_KEY);
    if (session?.refreshToken) {
      // best-effort: сервер недоступен — локальный выход всё равно состоялся
      await this.request("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      }).catch(() => undefined);
    }
  }

  async restoreSession(): Promise<Session | null> {
    const session = this.load();
    if (!session) return null;
    if (session.user.anonymous) return session;
    // access мог протухнуть — обновляем пару через refresh-ротацию
    if (!session.refreshToken) return null;
    try {
      const pair = await this.request<TokenPair>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      });
      return this.persist(sessionFromTokens(pair));
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) return session; // офлайн — не разлогиниваем
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  // ---------- Регистрация с почтой (verify-before-create), UI подключится позже ----------

  async registerStart(input: Credentials & { email: string }): Promise<{ pending_id: string; email: string }> {
    return this.request("/auth/register/start", { method: "POST", body: JSON.stringify(input) });
  }

  async registerStatus(pendingId: string): Promise<"pending" | "verified" | "expired" | "notfound"> {
    const out = await this.request<{ status: "pending" | "verified" | "expired" | "notfound" }>(
      `/auth/register/status?pending_id=${encodeURIComponent(pendingId)}`,
    );
    return out.status;
  }

  async registerComplete(pendingId: string): Promise<Session> {
    const pair = await this.request<TokenPair>("/auth/register/complete", {
      method: "POST",
      body: JSON.stringify({ pending_id: pendingId }),
    });
    return this.persist(sessionFromTokens(pair));
  }

  async registerResend(pendingId: string): Promise<void> {
    await this.request("/auth/register/resend", {
      method: "POST",
      body: JSON.stringify({ pending_id: pendingId }),
    });
  }

  private load(): Session | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = SessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }
}
