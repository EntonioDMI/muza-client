import type { MuzaApi } from "./index";
import {
  type Annotations,
  type Credentials,
  type HistoryItem,
  type Lyrics,
  type PlaylistDetail,
  type PlaylistMeta,
  type RecipeEnvelope,
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

  async recoveryStart(): Promise<void> {
    // мок: письма нет — как и сервер, делаем вид, что отправили
  }

  async search(_query: string, _opts?: { scope?: SearchScope; limit?: number }): Promise<Track[]> {
    return []; // мок: каталога нет
  }

  async getTrack(id: string): Promise<Track> {
    throw new Error(`Мок: трек ${id} не найден`);
  }

  // Личное: in-memory плейлисты, чтобы UI жил без сервера
  private playlists = new Map<string, PlaylistMeta>();

  async getFavorites(): Promise<Track[]> {
    return [];
  }

  async addFavorite(): Promise<void> {}

  async removeFavorite(): Promise<void> {}

  async getPlaylists(): Promise<PlaylistMeta[]> {
    return [...this.playlists.values()];
  }

  async createPlaylist(name: string): Promise<PlaylistMeta> {
    const p: PlaylistMeta = { id: crypto.randomUUID(), name, trackCount: 0, createdAt: new Date().toISOString() };
    this.playlists.set(p.id, p);
    return p;
  }

  async getPlaylist(id: string): Promise<PlaylistDetail> {
    const p = this.playlists.get(id);
    if (!p) throw new Error("Плейлист не найден");
    return { id: p.id, name: p.name, tracks: [] };
  }

  async renamePlaylist(id: string, name: string): Promise<void> {
    const p = this.playlists.get(id);
    if (p) this.playlists.set(id, { ...p, name });
  }

  async deletePlaylist(id: string): Promise<void> {
    this.playlists.delete(id);
  }

  async addPlaylistTrack(): Promise<void> {}

  async removePlaylistTrack(): Promise<void> {}

  async recordPlay(): Promise<void> {}

  async getHistory(): Promise<HistoryItem[]> {
    return [];
  }

  async getLyrics(): Promise<Lyrics> {
    return { synced: null, plain: null, source: null };
  }

  async getAnnotations(): Promise<Annotations> {
    return { geniusUrl: null, annotations: null };
  }

  async getRecipe(): Promise<RecipeEnvelope> {
    throw new Error("Мок: рецепта нет");
  }
}
