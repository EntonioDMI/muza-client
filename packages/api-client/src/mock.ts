import type { MuzaApi } from "./index";
import {
  type Credentials,
  type RegisterStatus,
  type SearchScope,
  type Session,
  SessionSchema,
  type Track,
} from "./schemas";

const STORAGE_KEY = "muza.session.v1";

function makeSession(username: string | null, anonymous: boolean): Session {
  return {
    user: {
      id: crypto.randomUUID(),
      username,
      anonymous,
      createdAt: new Date().toISOString(),
    },
    accessToken: `mock-${crypto.randomUUID()}`,
    refreshToken: anonymous ? null : `mock-refresh-${crypto.randomUUID()}`,
  };
}

/** Мок-реализация на localStorage. Заменяется на HTTP-клиент в Stage 2;
 *  UI зависит только от интерфейса MuzaApi. */
export class MockMuzaApi implements MuzaApi {
  /** Заявки email-регистрации: «письмо» подтверждается само через 3 секунды. */
  private pending = new Map<string, { username: string; verifiedAt: number }>();

  async loginAnonymous(): Promise<Session> {
    const session = makeSession(null, true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  async login(credentials: Credentials): Promise<Session> {
    const session = makeSession(credentials.username, false);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  async register(credentials: Credentials): Promise<Session> {
    return this.login(credentials);
  }

  async logout(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
  }

  async restoreSession(): Promise<Session | null> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = SessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  async registerStart(input: Credentials & { email: string }): Promise<{ pendingId: string; email: string }> {
    const pendingId = crypto.randomUUID();
    this.pending.set(pendingId, { username: input.username, verifiedAt: Date.now() + 3000 });
    return { pendingId, email: input.email };
  }

  async registerStatus(pendingId: string): Promise<RegisterStatus> {
    const p = this.pending.get(pendingId);
    if (!p) return "notfound";
    return Date.now() >= p.verifiedAt ? "verified" : "pending";
  }

  async registerComplete(pendingId: string): Promise<Session> {
    const p = this.pending.get(pendingId);
    if (!p) throw new Error("Заявка не найдена");
    this.pending.delete(pendingId);
    const session = makeSession(p.username, false);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  async registerResend(): Promise<void> {
    // мок: письма нет, слать нечего
  }

  async search(_query: string, _opts?: { scope?: SearchScope; limit?: number }): Promise<Track[]> {
    return []; // мок: каталога нет
  }

  async getTrack(id: string): Promise<Track> {
    throw new Error(`Мок: трек ${id} не найден`);
  }
}
