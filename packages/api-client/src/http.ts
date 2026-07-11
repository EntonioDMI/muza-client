import type { MuzaApi } from "./index";
import {
  type AdminContent,
  type AdminHealth,
  type AdminOverview,
  type AdminUsers,
  type Annotation,
  type Annotations,
  type Credentials,
  type HistoryItem,
  type HomeSection,
  type ImportReport,
  type Lyrics,
  type PlaylistDetail,
  type PlaylistMeta,
  type RecipeEnvelope,
  type RecsSettings,
  type RegisterStatus,
  type ScrobblingStatus,
  type SearchScope,
  type Session,
  SessionSchema,
  type TelemetryStats,
  type Track,
  TrackSchema,
  type TrackSource,
  TrackSourceSchema,
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
  local_hash?: string | null;
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
    localHash: wire.local_hash ?? null,
  });
}

interface RecsSettingsWire {
  epsilon: number;
  tau_scale: number;
  epsilon_max: number;
  tau_scale_min: number;
  tau_scale_max: number;
}

function recsSettingsFromWire(wire: RecsSettingsWire): RecsSettings {
  return {
    epsilon: wire.epsilon,
    tauScale: wire.tau_scale,
    epsilonMax: wire.epsilon_max,
    tauScaleMin: wire.tau_scale_min,
    tauScaleMax: wire.tau_scale_max,
  };
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

  async getTrackSources(id: string): Promise<TrackSource[]> {
    const out = await this.authedRequest<{
      sources: {
        id: string;
        provider: string;
        source_id: string;
        url: string;
        priority: number;
        kind: string;
        duration_sec: number;
        is_chosen: boolean;
      }[];
    }>(`/tracks/${encodeURIComponent(id)}/sources`);
    return out.sources.map((s) =>
      TrackSourceSchema.parse({
        id: s.id,
        provider: s.provider,
        sourceId: s.source_id,
        url: s.url,
        priority: s.priority,
        kind: s.kind,
        durationSec: s.duration_sec,
        isChosen: s.is_chosen,
      }),
    );
  }

  // ---------- Источники и версии (Stage 4) ----------

  async chooseTrackSource(trackId: string, sourceId: string): Promise<void> {
    await this.authedRequest(`/me/tracks/${encodeURIComponent(trackId)}/source`, {
      method: "PUT",
      body: JSON.stringify({ source_id: sourceId }),
    });
  }

  async resetTrackSource(trackId: string): Promise<void> {
    await this.authedRequest(`/me/tracks/${encodeURIComponent(trackId)}/source`, { method: "DELETE" });
  }

  async addDirectTrack(url: string): Promise<Track> {
    return trackFromWire(
      await this.authedRequest<TrackWire>("/me/tracks/direct", {
        method: "POST",
        body: JSON.stringify({ url }),
      }),
    );
  }

  async addLocalTrack(input: { artist: string; title: string; durationSec: number; hash: string }): Promise<Track> {
    return trackFromWire(
      await this.authedRequest<TrackWire>("/me/tracks/local", {
        method: "POST",
        body: JSON.stringify({
          artist: input.artist,
          title: input.title,
          duration_sec: input.durationSec,
          hash: input.hash,
        }),
      }),
    );
  }

  async importPlaylist(url: string): Promise<ImportReport> {
    const out = await this.authedRequest<{
      playlist: { id: string; name: string; track_count: number; created_at: string };
      total: number;
      matched: number;
      unmatched: { artist: string; title: string }[];
    }>("/me/playlists/import", { method: "POST", body: JSON.stringify({ url }) });
    return {
      playlist: {
        id: out.playlist.id,
        name: out.playlist.name,
        trackCount: out.playlist.track_count,
        createdAt: out.playlist.created_at,
      },
      total: out.total,
      matched: out.matched,
      unmatched: out.unmatched,
    };
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

  // ---------- Внешний скробблинг (Last.fm / ListenBrainz) ----------

  async getScrobbling(): Promise<ScrobblingStatus> {
    return this.authedRequest<ScrobblingStatus>("/me/scrobbling");
  }

  async lastfmConnectStart(): Promise<{ token: string; authUrl: string }> {
    const out = await this.authedRequest<{ token: string; auth_url: string }>(
      "/me/scrobbling/lastfm/start",
      { method: "POST" },
    );
    return { token: out.token, authUrl: out.auth_url };
  }

  async lastfmConnectComplete(token: string): Promise<{ username: string }> {
    return this.authedRequest<{ username: string }>("/me/scrobbling/lastfm/complete", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  async lastfmDisconnect(): Promise<void> {
    await this.authedRequest("/me/scrobbling/lastfm", { method: "DELETE" });
  }

  async listenbrainzConnect(token: string): Promise<{ username: string }> {
    return this.authedRequest<{ username: string }>("/me/scrobbling/listenbrainz", {
      method: "PUT",
      body: JSON.stringify({ token }),
    });
  }

  async listenbrainzDisconnect(): Promise<void> {
    await this.authedRequest("/me/scrobbling/listenbrainz", { method: "DELETE" });
  }

  // ---------- Тексты и рецепт (Stage 2, слайсы 5–6) ----------

  async getLyrics(trackId: string): Promise<Lyrics> {
    return this.authedRequest<Lyrics>(`/tracks/${encodeURIComponent(trackId)}/lyrics`);
  }

  async getAnnotations(trackId: string): Promise<Annotations> {
    const out = await this.authedRequest<{
      genius_url: string | null;
      annotations:
        | { fragment: string; body: string; votes: number; verified: boolean; line_idx?: number | null; line_count?: number; line_idxs?: number[] }[]
        | null;
    }>(`/tracks/${encodeURIComponent(trackId)}/annotations`);
    const annotations: Annotation[] | null =
      out.annotations?.map((a) => ({
        fragment: a.fragment,
        body: a.body,
        votes: a.votes,
        verified: a.verified,
        lineIdx: a.line_idx ?? null,
        lineCount: a.line_count ?? 0,
        lineIdxs: a.line_idxs ?? [],
      })) ?? null;
    return { geniusUrl: out.genius_url, annotations };
  }

  async getRecipe(): Promise<RecipeEnvelope> {
    return this.authedRequest<RecipeEnvelope>("/recipe");
  }

  // ---------- Рекомендации и лента (Stage 5) ----------

  async getHome(): Promise<HomeSection[]> {
    const out = await this.authedRequest<{ sections: { key: string; title: string; tracks: TrackWire[] }[] }>(
      "/home",
    );
    return out.sections.map((s) => ({ key: s.key, title: s.title, tracks: s.tracks.map(trackFromWire) }));
  }

  async getHomeSection(key: string, opts?: { offset?: number; limit?: number }): Promise<Track[]> {
    const params = new URLSearchParams();
    if (opts?.offset) params.set("offset", String(opts.offset));
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.size > 0 ? `?${params}` : "";
    const out = await this.authedRequest<{ tracks: TrackWire[] }>(
      `/home/section/${encodeURIComponent(key)}${qs}`,
    );
    return out.tracks.map(trackFromWire);
  }

  async getRadio(seedTrackId: string): Promise<Track[]> {
    const out = await this.authedRequest<{ tracks: TrackWire[] }>(
      `/radio?seed=${encodeURIComponent(seedTrackId)}`,
    );
    return out.tracks.map(trackFromWire);
  }

  async getRecsSettings(): Promise<RecsSettings> {
    return recsSettingsFromWire(await this.authedRequest<RecsSettingsWire>("/me/recs-settings"));
  }

  async updateRecsSettings(input: { epsilon?: number | null; tauScale?: number | null }): Promise<RecsSettings> {
    const body: Record<string, number | null> = {};
    if (input.epsilon !== undefined) body.epsilon = input.epsilon;
    if (input.tauScale !== undefined) body.tau_scale = input.tauScale;
    return recsSettingsFromWire(
      await this.authedRequest<RecsSettingsWire>("/me/recs-settings", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    );
  }

  // ---------- Админ-панель (Stage 5) ----------

  async adminPing(): Promise<boolean> {
    try {
      await this.authedRequest<{ ok: true }>("/admin/ping");
      return true;
    } catch {
      return false; // 403 (не админ) и сеть — одинаково «пункт не показываем»
    }
  }

  async getAdminOverview(): Promise<AdminOverview> {
    const o = await this.authedRequest<{
      users: { total: number; with_email: number; admins: number; new_7d: number };
      listeners: { dau: number; wau: number; mau: number };
      plays: { today: number; week: number; total: number; completed_week: number };
      catalog: { tracks: number; sources: number; dead_sources: number; cached: number };
    }>("/admin/overview");
    return {
      users: { total: o.users.total, withEmail: o.users.with_email, admins: o.users.admins, new7d: o.users.new_7d },
      listeners: o.listeners,
      plays: { today: o.plays.today, week: o.plays.week, total: o.plays.total, completedWeek: o.plays.completed_week },
      catalog: {
        tracks: o.catalog.tracks,
        sources: o.catalog.sources,
        deadSources: o.catalog.dead_sources,
        cached: o.catalog.cached,
      },
    };
  }

  async getAdminContent(): Promise<AdminContent> {
    const c = await this.authedRequest<{
      top_tracks: { track: TrackWire; plays: number }[];
      top_artists: { artist: string; plays: number }[];
      recent_tracks: TrackWire[];
      sources_by_provider: { provider: string; kind: string; count: number; dead: number }[];
      coverage: { tracks: number; with_lyrics: number; with_synced: number; with_annotations: number };
    }>("/admin/content");
    return {
      topTracks: c.top_tracks.map((r) => ({ track: trackFromWire(r.track), plays: r.plays })),
      topArtists: c.top_artists,
      recentTracks: c.recent_tracks.map(trackFromWire),
      sourcesByProvider: c.sources_by_provider,
      coverage: {
        tracks: c.coverage.tracks,
        withLyrics: c.coverage.with_lyrics,
        withSynced: c.coverage.with_synced,
        withAnnotations: c.coverage.with_annotations,
      },
    };
  }

  async getAdminHealth(hours = 24): Promise<AdminHealth> {
    const hl = await this.authedRequest<{
      window_hours: number;
      totals: {
        reports: number;
        resolve_ok: number;
        resolve_fail: number;
        attempts: number;
        cache_hits: number;
        fail_403: number;
        fail_bot: number;
        fail_format: number;
        fail_other: number;
        plays: number;
        plays_completed: number;
        success_rate: number | null;
        cache_hit_rate: number | null;
      };
      by_recipe: { recipe_version: number; reports: number; ok: number; fail: number; success_rate: number | null }[];
      by_app: { app_version: string; reports: number; ok: number; fail: number }[];
      recipe: { version: number };
    }>(`/admin/health?hours=${hours}`);
    return {
      windowHours: hl.window_hours,
      totals: {
        reports: hl.totals.reports,
        resolveOk: hl.totals.resolve_ok,
        resolveFail: hl.totals.resolve_fail,
        attempts: hl.totals.attempts,
        cacheHits: hl.totals.cache_hits,
        fail403: hl.totals.fail_403,
        failBot: hl.totals.fail_bot,
        failFormat: hl.totals.fail_format,
        failOther: hl.totals.fail_other,
        plays: hl.totals.plays,
        playsCompleted: hl.totals.plays_completed,
        successRate: hl.totals.success_rate,
        cacheHitRate: hl.totals.cache_hit_rate,
      },
      byRecipe: hl.by_recipe.map((r) => ({
        recipeVersion: r.recipe_version,
        reports: r.reports,
        ok: r.ok,
        fail: r.fail,
        successRate: r.success_rate,
      })),
      byApp: hl.by_app.map((r) => ({ appVersion: r.app_version, reports: r.reports, ok: r.ok, fail: r.fail })),
      recipeVersion: hl.recipe.version,
    };
  }

  async getAdminUsers(opts?: { limit?: number; offset?: number }): Promise<AdminUsers> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const qs = params.size > 0 ? `?${params}` : "";
    const u = await this.authedRequest<{
      total: number;
      users: {
        id: string;
        username: string;
        has_email: boolean;
        is_admin: boolean;
        created_at: string;
        plays_30d: number;
        last_play_at: string | null;
      }[];
    }>(`/admin/users${qs}`);
    return {
      total: u.total,
      users: u.users.map((r) => ({
        id: r.id,
        username: r.username,
        hasEmail: r.has_email,
        isAdmin: r.is_admin,
        createdAt: r.created_at,
        plays30d: r.plays_30d,
        lastPlayAt: r.last_play_at,
      })),
    };
  }

  async sendTelemetry(stats: TelemetryStats): Promise<void> {
    await this.authedRequest("/telemetry", {
      method: "POST",
      body: JSON.stringify({
        app_version: stats.appVersion,
        recipe_version: stats.recipeVersion,
        resolve_ok: stats.resolveOk,
        resolve_fail: stats.resolveFail,
        attempts: stats.attempts,
        cache_hits: stats.cacheHits,
        fail_403: stats.fail403,
        fail_bot: stats.failBot,
        fail_format: stats.failFormat,
        fail_other: stats.failOther,
        plays: stats.plays,
        plays_completed: stats.playsCompleted,
      }),
    });
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

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    // refresh текущего устройства — сервер отзывает все ОСТАЛЬНЫЕ сессии
    const refreshToken = this.load()?.refreshToken ?? null;
    await this.authedRequest("/auth/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
      }),
    });
  }

  private load(): Session | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = SessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }
}
