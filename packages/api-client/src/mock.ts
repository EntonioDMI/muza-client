import type { MuzaApi } from "./index";
import { type Credentials, type Session, SessionSchema } from "./schemas";

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
}
