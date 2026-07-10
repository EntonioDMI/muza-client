import type { MuzaApi } from "./index";
import {
  type Credentials,
  type HistoryItem,
  type PlaylistDetail,
  type PlaylistMeta,
  type RegisterStatus,
  type SearchScope,
  type Session,
  SessionSchema,
  type Track,
  TrackSchema,
} from "./schemas";

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

/** Проводной формат трека (snake_case сервера) → Track (camelCase). */
interface TrackWire {
  id: string;
  artist: string;
  title: string;
  duration_sec: number;
  cover_url: string | null;
  is_cached: boolean;
  sources: string[];
  loudness: number | null;
}

function trackFromWire(wire: TrackWire): Track {
  return TrackSchema.parse({
    id: wire.id,
    artist: wire.artist,
    title: wire.title,
    durationSec: wire.duration_sec,
    coverUrl: wire.cover_url,
    isCached: wire.is_cached,
    sources: wire.sources,
    loudness: wire.loudness,
  });
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
      return await this.refreshPair(session.refreshToken);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) return session; // офлайн — не разлогиниваем
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  /** Обновить пару токенов по refresh (ротация) и сохранить сессию. */
  private async refreshPair(refreshToken: string): Promise<Session> {
    const pair = await this.request<TokenPair>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return this.persist(sessionFromTokens(pair));
  }

  /** Запрос с Bearer текущей сессии; на 401 — одна refresh-ротация и повтор
   *  (access короткоживущий, протухает между действиями пользователя). */
  private async authedRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const session = this.load();
    if (!session || session.user.anonymous) {
      throw new ApiError(401, "Нужен вход с аккаунтом");
    }
    const withAuth = (token: string): RequestInit => ({
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
    try {
      return await this.request<T>(path, withAuth(session.accessToken));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401 || !session.refreshToken) throw e;
      const refreshed = await this.refreshPair(session.refreshToken);
      return this.request<T>(path, withAuth(refreshed.accessToken));
    }
  }

  // ---------- Каталог (Stage 2, слайс 3) ----------

  async search(query: string, opts?: { scope?: SearchScope; limit?: number }): Promise<Track[]> {
    const params = new URLSearchParams({ q: query });
    if (opts?.scope) params.set("scope", opts.scope);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const out = await this.authedRequest<{ query: string; results: TrackWire[] }>(`/search?${params}`);
    return out.results.map(trackFromWire);
  }

  async getTrack(id: string): Promise<Track> {
    return trackFromWire(await this.authedRequest<TrackWire>(`/tracks/${encodeURIComponent(id)}`));
  }

  // ---------- Личное (Stage 2, слайс 4) ----------

  async getFavorites(): Promise<Track[]> {
    const rows = await this.authedRequest<TrackWire[]>("/me/favorites");
    return rows.map(trackFromWire);
  }

  async addFavorite(trackId: string): Promise<void> {
    await this.authedRequest(`/me/favorites/${encodeURIComponent(trackId)}`, { method: "PUT" });
  }

  async removeFavorite(trackId: string): Promise<void> {
    await this.authedRequest(`/me/favorites/${encodeURIComponent(trackId)}`, { method: "DELETE" });
  }

  async getPlaylists(): Promise<PlaylistMeta[]> {
    const rows = await this.authedRequest<{ id: string; name: string; track_count: number; created_at: string }[]>(
      "/me/playlists",
    );
    return rows.map((p) => ({ id: p.id, name: p.name, trackCount: p.track_count, createdAt: p.created_at }));
  }

  async createPlaylist(name: string): Promise<PlaylistMeta> {
    const p = await this.authedRequest<{ id: string; name: string; track_count: number; created_at: string }>(
      "/me/playlists",
      { method: "POST", body: JSON.stringify({ name }) },
    );
    return { id: p.id, name: p.name, trackCount: p.track_count, createdAt: p.created_at };
  }

  async getPlaylist(id: string): Promise<PlaylistDetail> {
    const p = await this.authedRequest<{ id: string; name: string; tracks: TrackWire[] }>(
      `/me/playlists/${encodeURIComponent(id)}`,
    );
    return { id: p.id, name: p.name, tracks: p.tracks.map(trackFromWire) };
  }

  async renamePlaylist(id: string, name: string): Promise<void> {
    await this.authedRequest(`/me/playlists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.authedRequest(`/me/playlists/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async addPlaylistTrack(playlistId: string, trackId: string): Promise<void> {
    await this.authedRequest(
      `/me/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`,
      { method: "PUT" },
    );
  }

  async removePlaylistTrack(playlistId: string, trackId: string): Promise<void> {
    await this.authedRequest(
      `/me/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`,
      { method: "DELETE" },
    );
  }

  async recordPlay(input: { trackId: string; playedMs: number; durationMs: number; completed: boolean }): Promise<void> {
    await this.authedRequest("/me/plays", {
      method: "POST",
      body: JSON.stringify({
        track_id: input.trackId,
        played_ms: input.playedMs,
        duration_ms: input.durationMs,
        completed: input.completed,
      }),
    });
  }

  async getHistory(limit = 50): Promise<HistoryItem[]> {
    const rows = await this.authedRequest<{ track: TrackWire; played_at: string; completed: boolean }[]>(
      `/me/history?limit=${limit}`,
    );
    return rows.map((r) => ({ track: trackFromWire(r.track), playedAt: r.played_at, completed: r.completed }));
  }

  // ---------- Регистрация с почтой (verify-before-create) ----------

  async registerStart(input: Credentials & { email: string }): Promise<{ pendingId: string; email: string }> {
    const out = await this.request<{ pending_id: string; email: string }>("/auth/register/start", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { pendingId: out.pending_id, email: out.email };
  }

  async registerStatus(pendingId: string): Promise<RegisterStatus> {
    const out = await this.request<{ status: RegisterStatus }>(
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

  async recoveryStart(email: string): Promise<void> {
    await this.request("/auth/recovery/start", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  private load(): Session | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = SessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }
}
