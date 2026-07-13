import type { MuzaApi } from "./index";
import {
  type AdminContent,
  type AdminHealth,
  type AdminOverview,
  type AdminUsers,
  type Annotations,
  type Credentials,
  type EmailChangeStartResult,
  type GroupedSearchResult,
  type HistoryItem,
  type HomeSection,
  type ImportReport,
  type JamEvent,
  type JamSnapshot,
  type Lyrics,
  type MarketTheme,
  type PlaylistDetail,
  type PlaylistMeta,
  type RecipeEnvelope,
  type RecsSettings,
  type RegisterStatus,
  type SearchScope,
  type Session,
  type SessionInfo,
  SessionSchema,
  type StatsOverview,
  type Track,
  type TrackSource,
  type Wrapped,
} from "./schemas";

const STORAGE_KEY = "muza.session.v1";

/** T41: фикстур-трек для grouped-мока (каталога в моке нет — search() отдаёт
 *  [], но searchGrouped() должен показать саму ФОРМУ ответа сборщикам UI). */
function mockTrack(id: string, artist: string, title: string): Track {
  return {
    id,
    artist,
    title,
    durationSec: 210,
    coverUrl: null,
    isCached: false,
    sources: ["youtube"],
    loudness: null,
    localHash: null,
  };
}

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

  async changePassword(): Promise<void> {
    // мок: пароля нет — делаем вид, что сменили
  }

  async changeEmail(): Promise<EmailChangeStartResult> {
    // мок: почты нет, ссылки подтверждения тоже
    return {};
  }

  async listSessions(): Promise<SessionInfo[]> {
    return [];
  }

  async revokeSession(): Promise<void> {}

  async exportData(): Promise<Record<string, unknown>> {
    return { exported_at: new Date().toISOString(), note: "мок: данных на сервере нет" };
  }

  async deleteAccount(): Promise<void> {
    // мок: серверного аккаунта нет
  }

  // Скробблинг в моке недоступен: сервера с ключами нет
  async getScrobbling() {
    return {
      lastfm: { available: false, connected: false, username: null },
      listenbrainz: { connected: false, username: null },
    };
  }

  async lastfmConnectStart(): Promise<{ token: string; authUrl: string }> {
    throw new Error("Мок: Last.fm недоступен");
  }

  async lastfmConnectComplete(): Promise<{ username: string }> {
    throw new Error("Мок: Last.fm недоступен");
  }

  async lastfmDisconnect(): Promise<void> {}

  async listenbrainzConnect(): Promise<{ username: string }> {
    throw new Error("Мок: ListenBrainz недоступен");
  }

  async listenbrainzDisconnect(): Promise<void> {}

  async search(_query: string, _opts?: { scope?: SearchScope; limit?: number }): Promise<Track[]> {
    return []; // мок: каталога нет
  }

  /** T41: демонстрирует форму grouped-ответа (1 группа с 2 версиями + 1
   *  нераспознанный single в хвосте) — независимо от query/opts, как и
   *  плоский search() выше; настоящий каталог/группировка живут на сервере. */
  async searchGrouped(_query: string, _opts?: { scope?: SearchScope; limit?: number }): Promise<GroupedSearchResult[]> {
    return [
      {
        kind: "group",
        canonical: mockTrack("mock-canon-1", "Mock Artist", "Mock Song"),
        hasOriginal: true,
        canonicalVariantType: null,
        variants: [
          { track: mockTrack("mock-remix-1", "Mock Artist", "Mock Song (Remix)"), variantType: "remix" },
          { track: mockTrack("mock-spedup-1", "Mock Artist", "Mock Song (Sped Up)"), variantType: "sped_up" },
        ],
      },
      { kind: "single", track: mockTrack("mock-single-1", "Other Artist", "Unrelated Track (Edit)") },
    ];
  }

  async getTrack(id: string): Promise<Track> {
    throw new Error(`Мок: трек ${id} не найден`);
  }

  async getTrackSources(): Promise<TrackSource[]> {
    return []; // мок: источников нет
  }

  async getStreamUrl(): Promise<{ url: string; expiresAt: number }> {
    throw new Error("Мок: серверный стриминг недоступен");
  }

  async chooseTrackSource(): Promise<void> {}

  async resetTrackSource(): Promise<void> {}

  async addDirectTrack(): Promise<Track> {
    throw new Error("Мок: прямые ссылки живут на сервере");
  }

  async addLocalTrack(): Promise<Track> {
    throw new Error("Мок: локальные треки живут на сервере");
  }

  async importPlaylist(): Promise<ImportReport> {
    throw new Error("Мок: импорт живёт на сервере");
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

  async createPlaylist(name: string, icon?: string): Promise<PlaylistMeta> {
    const p: PlaylistMeta = {
      id: crypto.randomUUID(),
      name,
      trackCount: 0,
      createdAt: new Date().toISOString(),
      role: "owner",
      ownerUsername: "",
      collaboratorsCount: 0,
      icon: icon ?? null,
    };
    this.playlists.set(p.id, p);
    return p;
  }

  /** Мок: эхо-запись иконки в in-memory плейлист (сервера нет — просто echo). */
  async setPlaylistIcon(id: string, icon: string): Promise<void> {
    const p = this.playlists.get(id);
    if (p) this.playlists.set(id, { ...p, icon });
  }

  async getPlaylist(id: string): Promise<PlaylistDetail> {
    const p = this.playlists.get(id);
    if (!p) throw new Error("Плейлист не найден");
    return {
      id: p.id,
      name: p.name,
      tracks: [],
      isOwner: true,
      ownerUsername: "",
      inviteCode: null,
      collaborators: [],
      addedBy: {},
      icon: p.icon,
    };
  }

  // Совместные плейлисты и Jam живут на сервере (Stage 7)
  async createPlaylistInvite(): Promise<{ code: string }> {
    throw new Error("Мок: совместный доступ живёт на сервере");
  }

  async revokePlaylistInvite(): Promise<void> {}

  async joinPlaylist(): Promise<PlaylistMeta> {
    throw new Error("Мок: совместный доступ живёт на сервере");
  }

  async removePlaylistMember(): Promise<void> {}

  async createJam(): Promise<JamSnapshot> {
    throw new Error("Мок: Jam живёт на сервере");
  }

  async getJam(): Promise<JamSnapshot> {
    throw new Error("Мок: Jam живёт на сервере");
  }

  async joinJam(): Promise<JamSnapshot> {
    throw new Error("Мок: Jam живёт на сервере");
  }

  async leaveJam(): Promise<void> {}

  async pushJamState(): Promise<void> {}

  async addJamTrack(): Promise<void> {}

  subscribeJamEvents(_code: string, onEvent: (event: JamEvent) => void): () => void {
    // мок: событий нет — сразу честный финал
    onEvent({ type: "ended" });
    return () => undefined;
  }

  async getWrapped(): Promise<Wrapped> {
    throw new Error("Мок: итоги живут на сервере");
  }

  async getStatsOverview(): Promise<StatsOverview> {
    throw new Error("Мок: статистика живёт на сервере");
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

  async sendTelemetry(): Promise<void> {
    // мок: агрегат некуда слать
  }

  // Рекомендации (Stage 5): без сервера ленты нет — UI показывает фолбэк
  async getHome(): Promise<HomeSection[]> {
    return [];
  }

  async getHomeSection(): Promise<Track[]> {
    return [];
  }

  async getRadio(): Promise<Track[]> {
    return [];
  }

  async getRecsSettings(): Promise<RecsSettings> {
    return { epsilon: 0.1, tauScale: 1, epsilonMax: 0.3, tauScaleMin: 0.25, tauScaleMax: 4 };
  }

  async updateRecsSettings(): Promise<RecsSettings> {
    return this.getRecsSettings();
  }

  // Маркетплейс тем в моке недоступен (нужен сервер)
  async getMarketThemes(): Promise<MarketTheme[]> {
    return [];
  }

  async publishMarketTheme(): Promise<MarketTheme> {
    throw new Error("Мок: маркетплейс живёт на сервере");
  }

  async installMarketTheme(): Promise<MarketTheme> {
    throw new Error("Мок: маркетплейс живёт на сервере");
  }

  async deleteMarketTheme(): Promise<void> {}

  async reportMarketTheme(): Promise<void> {}

  // Админка в моке недоступна
  async adminPing(): Promise<boolean> {
    return false;
  }

  async getAdminOverview(): Promise<AdminOverview> {
    throw new Error("Мок: админка живёт на сервере");
  }

  async getAdminContent(): Promise<AdminContent> {
    throw new Error("Мок: админка живёт на сервере");
  }

  async getAdminHealth(): Promise<AdminHealth> {
    throw new Error("Мок: админка живёт на сервере");
  }

  async getAdminUsers(): Promise<AdminUsers> {
    throw new Error("Мок: админка живёт на сервере");
  }
}
