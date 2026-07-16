import type { MuzaApi } from "./index";
import {
  type AdminContent,
  type AdminDayPoint,
  type AdminErrors,
  type AdminGrowth,
  type AdminHealth,
  type AdminOverview,
  type AdminUsers,
  type MarketTheme,
  type MarketPlugin,
  type Annotation,
  type Annotations,
  type ClientErrorBatch,
  type Credentials,
  type EmailChangeStartResult,
  EmailChangeStartResultSchema,
  type GroupedSearchResult,
  GroupedSearchResultSchema,
  type VariantType,
  type HistoryItem,
  type HomeSection,
  type ImportPreview,
  type ImportReport,
  type JamEvent,
  type JamSnapshot,
  type JamState,
  type Lyrics,
  type PlaylistDetail,
  PlaylistDetailSchema,
  type PlaylistMeta,
  PlaylistMetaSchema,
  type RecipeEnvelope,
  type RecsSettings,
  type RegisterStatus,
  type ScrobblingStatus,
  type SearchScope,
  type Session,
  type SessionInfo,
  SessionSchema,
  type StatsOverview,
  type StatsPeriod,
  type TelemetryStats,
  type Track,
  TrackSchema,
  type TrackSource,
  TrackSourceSchema,
  type Wrapped,
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

/** Проводная форма одного варианта внутри группы (snake_case сервера). */
interface GroupVariantWire {
  track: TrackWire;
  variant_type: VariantType;
}

/** Проводная форма ДВУХ видов элемента grouped-поиска — зеркало
 *  muza-server/src/catalog/dto.ts (GroupResultOut/SingleResultOut). */
interface GroupResultWire {
  kind: "group";
  canonical: TrackWire;
  has_original: boolean;
  canonical_variant_type: VariantType | null;
  variants: GroupVariantWire[];
}
interface SingleResultWire {
  kind: "single";
  track: TrackWire;
}
type GroupedResultWire = GroupResultWire | SingleResultWire;

function groupedResultFromWire(wire: GroupedResultWire): GroupedSearchResult {
  if (wire.kind === "single") {
    return GroupedSearchResultSchema.parse({ kind: "single", track: trackFromWire(wire.track) });
  }
  return GroupedSearchResultSchema.parse({
    kind: "group",
    canonical: trackFromWire(wire.canonical),
    hasOriginal: wire.has_original,
    canonicalVariantType: wire.canonical_variant_type,
    variants: wire.variants.map((v) => ({ track: trackFromWire(v.track), variantType: v.variant_type })),
  });
}

/** Проводной формат плейлиста (Stage 7: роль/владелец/участники; T47: icon). */
interface PlaylistMetaWire {
  id: string;
  name: string;
  track_count: number;
  created_at: string;
  role?: "owner" | "collaborator";
  owner_username?: string;
  collaborators_count?: number;
  icon?: string | null;
  icon_cover_url?: string | null;
}

function playlistMetaFromWire(w: PlaylistMetaWire): PlaylistMeta {
  return PlaylistMetaSchema.parse({
    id: w.id,
    name: w.name,
    trackCount: w.track_count,
    createdAt: w.created_at,
    role: w.role ?? "owner",
    ownerUsername: w.owner_username ?? "",
    collaboratorsCount: w.collaborators_count ?? 0,
    icon: w.icon ?? null,
    iconCoverUrl: w.icon_cover_url ?? null,
  });
}

/** Состояние jam (snake_case сервера) → JamState. */
function jamStateFromWire(w: {
  track_id: string | null;
  title: string;
  artist: string;
  cover_url: string | null;
  duration_sec: number;
  pos_sec: number;
  playing: boolean;
  updated_at: number;
}): JamState {
  return {
    trackId: w.track_id,
    title: w.title,
    artist: w.artist,
    coverUrl: w.cover_url,
    durationSec: w.duration_sec,
    posSec: w.pos_sec,
    playing: w.playing,
    updatedAt: w.updated_at,
  };
}

interface JamSnapshotWire {
  code: string;
  host: { id: string; username: string };
  members: { id: string; username: string }[];
  state: Parameters<typeof jamStateFromWire>[0] | null;
  is_host: boolean;
}

function jamSnapshotFromWire(w: JamSnapshotWire): JamSnapshot {
  return {
    code: w.code,
    host: w.host,
    members: w.members,
    state: w.state ? jamStateFromWire(w.state) : null,
    isHost: w.is_host,
  };
}

/** Кадр SSE → JamEvent; ping и мусор — null. */
function parseJamEvent(data: string): JamEvent | null {
  let wire: Record<string, unknown>;
  try {
    wire = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (wire.type) {
    case "snapshot":
      return { type: "snapshot", snapshot: jamSnapshotFromWire(wire.snapshot as JamSnapshotWire) };
    case "state":
      return { type: "state", state: jamStateFromWire(wire.state as Parameters<typeof jamStateFromWire>[0]) };
    case "members":
      return { type: "members", members: wire.members as { id: string; username: string }[] };
    case "queue_add":
      return { type: "queueAdd", track: trackFromWire(wire.track as TrackWire), by: wire.by as string };
    case "ended":
      return { type: "ended" };
    default:
      return null; // ping и неизвестные типы
  }
}

interface MarketThemeWire {
  id: string;
  name: string;
  author: string;
  installs: number;
  created_at: string;
  payload: Record<string, unknown>;
  is_mine: boolean;
  hidden?: boolean;
}

function marketThemeFromWire(w: MarketThemeWire): MarketTheme {
  return {
    id: w.id,
    name: w.name,
    author: w.author,
    installs: w.installs,
    createdAt: w.created_at,
    payload: w.payload ?? {},
    isMine: w.is_mine,
    hidden: w.hidden ?? false,
  };
}

interface MarketPluginWire {
  id: string;
  plugin_id: string;
  name: string;
  author: string;
  version: string;
  installs: number;
  created_at: string;
  payload: Record<string, unknown>;
  full_access: boolean;
  pending: boolean;
  is_mine: boolean;
  hidden: boolean;
}

function marketPluginFromWire(w: MarketPluginWire): MarketPlugin {
  return {
    id: w.id,
    pluginId: w.plugin_id,
    name: w.name,
    author: w.author,
    version: w.version,
    installs: w.installs,
    createdAt: w.created_at,
    payload: w.payload ?? {},
    fullAccess: w.full_access,
    pending: w.pending,
    isMine: w.is_mine,
    hidden: w.hidden ?? false,
  };
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
      // Сессию стирает только ЯВНЫЙ отказ авторизации (401/403: токен отозван
      // или протух по-настоящему). Всё остальное — временные беды, за которые
      // пользователь не должен платить перелогином: офлайн (status 0), сервер
      // перезапускается/лежит (5xx), троттлинг (429). Раньше любой не-0 статус
      // разлогинивал — рестарт сервера в момент старта клиента ронял вход.
      if (e instanceof ApiError && e.status !== 401 && e.status !== 403) return session;
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

  /** T41: тот же поиск, но с группировкой ремиксов/версий (T36 сервера,
   *  ?group=1&offset=0 — сервер поддерживает group=1 ТОЛЬКО на первой
   *  странице, растущий limit — рекомендованный способ «загрузить ещё»).
   *  Отдельный метод, а не флаг/оверлоад в search(): форма ответа другая
   *  (GroupedSearchResult[], не Track[]) — оверлоад на одном имени размыл бы
   *  типы существующих плоских вызывателей (десктоп) без всякой выгоды. */
  async searchGrouped(
    query: string,
    opts?: { scope?: SearchScope; limit?: number },
  ): Promise<GroupedSearchResult[]> {
    const params = new URLSearchParams({ q: query, group: "1", offset: "0" });
    if (opts?.scope) params.set("scope", opts.scope);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const out = await this.authedRequest<{ query: string; results: GroupedResultWire[] }>(`/search?${params}`);
    return out.results.map(groupedResultFromWire);
  }

  async getTrack(id: string): Promise<Track> {
    return trackFromWire(await this.authedRequest<TrackWire>(`/tracks/${encodeURIComponent(id)}`));
  }

  async getStreamUrl(trackId: string): Promise<{ url: string; expiresAt: number }> {
    const out = await this.authedRequest<{ st: string; expires_at: number }>(
      `/tracks/${encodeURIComponent(trackId)}/stream-url`,
    );
    // URL собирается здесь: baseUrl знает клиент, серверу свой публичный адрес неизвестен
    return {
      url: `${this.baseUrl}/tracks/${encodeURIComponent(trackId)}/stream?st=${encodeURIComponent(out.st)}`,
      expiresAt: out.expires_at,
    };
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

  async previewImport(url: string): Promise<ImportPreview> {
    const params = new URLSearchParams({ url });
    const out = await this.authedRequest<{
      previewable: boolean;
      name: string | null;
      owner: string | null;
      track_count: number;
      may_be_personalized: boolean;
    }>(`/me/playlists/import/preview?${params}`);
    return {
      previewable: out.previewable,
      name: out.name,
      owner: out.owner,
      trackCount: out.track_count,
      mayBePersonalized: out.may_be_personalized,
    };
  }

  async importPlaylist(url: string): Promise<ImportReport> {
    const out = await this.authedRequest<{
      playlist: PlaylistMetaWire;
      total: number;
      matched: number;
      unmatched: { artist: string; title: string }[];
    }>("/me/playlists/import", { method: "POST", body: JSON.stringify({ url }) });
    return {
      playlist: playlistMetaFromWire(out.playlist),
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
    const rows = await this.authedRequest<PlaylistMetaWire[]>("/me/playlists");
    return rows.map(playlistMetaFromWire);
  }

  async createPlaylist(name: string, icon?: string): Promise<PlaylistMeta> {
    const p = await this.authedRequest<PlaylistMetaWire>("/me/playlists", {
      method: "POST",
      body: JSON.stringify(icon !== undefined ? { name, icon } : { name }),
    });
    return playlistMetaFromWire(p);
  }

  /** Сменить иконку-обложку плейлиста (T47): владелец, id из манифеста @muza/core. */
  async setPlaylistIcon(id: string, icon: string): Promise<void> {
    await this.authedRequest(`/me/playlists/${encodeURIComponent(id)}/icon`, {
      method: "PATCH",
      body: JSON.stringify({ icon }),
    });
  }

  async getPlaylist(id: string): Promise<PlaylistDetail> {
    const p = await this.authedRequest<{
      id: string;
      name: string;
      tracks: TrackWire[];
      is_owner?: boolean;
      owner_username?: string;
      invite_code?: string | null;
      collaborators?: { id: string; username: string }[];
      added_by?: Record<string, string>;
      icon?: string | null;
      icon_cover_url?: string | null;
    }>(`/me/playlists/${encodeURIComponent(id)}`);
    return PlaylistDetailSchema.parse({
      id: p.id,
      name: p.name,
      tracks: p.tracks.map(trackFromWire),
      isOwner: p.is_owner ?? true,
      ownerUsername: p.owner_username ?? "",
      inviteCode: p.invite_code ?? null,
      collaborators: p.collaborators ?? [],
      addedBy: p.added_by ?? {},
      icon: p.icon ?? null,
      iconCoverUrl: p.icon_cover_url ?? null,
    });
  }

  // ---------- Совместные плейлисты (Stage 7) ----------

  async createPlaylistInvite(playlistId: string): Promise<{ code: string }> {
    return this.authedRequest<{ code: string }>(
      `/me/playlists/${encodeURIComponent(playlistId)}/invite`,
      { method: "POST" },
    );
  }

  async revokePlaylistInvite(playlistId: string): Promise<void> {
    await this.authedRequest(`/me/playlists/${encodeURIComponent(playlistId)}/invite`, { method: "DELETE" });
  }

  async joinPlaylist(code: string): Promise<PlaylistMeta> {
    const p = await this.authedRequest<PlaylistMetaWire>("/me/playlists/join", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    return playlistMetaFromWire(p);
  }

  async removePlaylistMember(playlistId: string, userId: string): Promise<void> {
    await this.authedRequest(
      `/me/playlists/${encodeURIComponent(playlistId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
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

  /** Полный порядок треков плейлиста (владелец/соавтор). `trackIds` — ВЕСЬ
   *  список в новом порядке, сервер переписывает `position` каждой строки.
   *
   *  Эндпоинт `PUT /me/playlists/:id/tracks` (me.controller.ts:442, ReorderDto,
   *  ArrayMaxSize 5000) существовал с самого начала, а контракт его никогда не
   *  выставлял — поэтому реордера в плейлистах не было вовсе, хотя колонка
   *  `position` в БД и серверная логика были готовы. */
  async reorderPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
    await this.authedRequest(`/me/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: "PUT",
      body: JSON.stringify({ track_ids: trackIds }),
    });
  }

  /** Новый порядок ПЛЕЙЛИСТОВ пользователя (drag-drop в Библиотеке). */
  async reorderPlaylists(playlistIds: string[]): Promise<void> {
    await this.authedRequest("/me/playlists/order", {
      method: "PUT",
      body: JSON.stringify({ playlist_ids: playlistIds }),
    });
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
        | {
            fragment: string;
            body: string;
            votes: number;
            verified: boolean;
            /** нет у записей серверного кэша, снятых до фичи картинок */
            images?: { src: string; alt?: string; width?: number; height?: number; caption?: string }[];
            line_idx?: number | null;
            line_count?: number;
            line_idxs?: number[];
          }[]
        | null;
    }>(`/tracks/${encodeURIComponent(trackId)}/annotations`);
    const annotations: Annotation[] | null =
      out.annotations?.map((a) => ({
        fragment: a.fragment,
        body: a.body,
        votes: a.votes,
        verified: a.verified,
        images: a.images ?? [],
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

  // ---------- Jam: слушать вместе (Stage 7) ----------

  async createJam(): Promise<JamSnapshot> {
    return jamSnapshotFromWire(await this.authedRequest<JamSnapshotWire>("/jam", { method: "POST" }));
  }

  async getJam(code: string): Promise<JamSnapshot> {
    return jamSnapshotFromWire(await this.authedRequest<JamSnapshotWire>(`/jam/${encodeURIComponent(code)}`));
  }

  async joinJam(code: string): Promise<JamSnapshot> {
    return jamSnapshotFromWire(
      await this.authedRequest<JamSnapshotWire>(`/jam/${encodeURIComponent(code)}/join`, { method: "POST" }),
    );
  }

  async leaveJam(code: string): Promise<void> {
    await this.authedRequest(`/jam/${encodeURIComponent(code)}/leave`, { method: "POST" });
  }

  async pushJamState(
    code: string,
    state: {
      trackId: string | null;
      title: string;
      artist: string;
      coverUrl: string | null;
      durationSec: number;
      posSec: number;
      playing: boolean;
    },
  ): Promise<void> {
    await this.authedRequest(`/jam/${encodeURIComponent(code)}/state`, {
      method: "PUT",
      body: JSON.stringify({
        track_id: state.trackId,
        title: state.title,
        artist: state.artist,
        cover_url: state.coverUrl,
        duration_sec: state.durationSec,
        pos_sec: state.posSec,
        playing: state.playing,
      }),
    });
  }

  async addJamTrack(code: string, trackId: string): Promise<void> {
    await this.authedRequest(`/jam/${encodeURIComponent(code)}/queue`, {
      method: "POST",
      body: JSON.stringify({ track_id: trackId }),
    });
  }

  /** SSE-ридер jam-событий: fetch-стрим (EventSource не умеет Authorization),
   *  разбор text/event-stream руками, авто-переподключение через 2с.
   *  404/`ended` — финал (jam завершён), подписчик получает ended один раз. */
  subscribeJamEvents(code: string, onEvent: (event: JamEvent) => void): () => void {
    let stopped = false;
    let controller: AbortController | null = null;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      onEvent({ type: "ended" });
    };

    const run = async () => {
      while (!stopped) {
        try {
          let session = this.load();
          if (!session || session.user.anonymous) return finish();
          controller = new AbortController();
          let res = await fetch(`${this.baseUrl}/jam/${encodeURIComponent(code)}/events`, {
            headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "text/event-stream" },
            signal: controller.signal,
          });
          if (res.status === 401 && session.refreshToken) {
            session = await this.refreshPair(session.refreshToken);
            res = await fetch(`${this.baseUrl}/jam/${encodeURIComponent(code)}/events`, {
              headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "text/event-stream" },
              signal: controller.signal,
            });
          }
          if (res.status === 404) return finish();
          if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let sep: number;
            // событие SSE заканчивается пустой строкой
            while ((sep = buf.indexOf("\n\n")) !== -1) {
              const chunk = buf.slice(0, sep);
              buf = buf.slice(sep + 2);
              const data = chunk
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trim())
                .join("\n");
              if (!data) continue;
              const event = parseJamEvent(data);
              if (!event) continue;
              if (event.type === "ended") return finish();
              if (!stopped) onEvent(event);
            }
          }
          // поток закрылся без ended — сервер перезапустился? переподключаемся
        } catch {
          if (stopped) return;
        }
        if (!stopped) await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void run();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }

  async getWrapped(opts?: { year?: number }): Promise<Wrapped> {
    const params = new URLSearchParams({ tz_offset_min: String(new Date().getTimezoneOffset()) });
    if (opts?.year) params.set("year", String(opts.year));
    const w = await this.authedRequest<{
      year: number;
      total_plays: number;
      total_ms: number;
      unique_tracks: number;
      unique_artists: number;
      active_days: number;
      longest_streak_days: number;
      peak_day: { date: string; ms: number } | null;
      top_hour: number | null;
      favorites_added: number;
      top_tracks: { track: TrackWire; plays: number; played_ms: number }[];
      top_artists: { artist: string; plays: number; played_ms: number }[];
      first_track: TrackWire | null;
      first_play_at: string | null;
    }>(`/me/wrapped?${params}`);
    return {
      year: w.year,
      totalPlays: w.total_plays,
      totalMs: w.total_ms,
      uniqueTracks: w.unique_tracks,
      uniqueArtists: w.unique_artists,
      activeDays: w.active_days,
      longestStreakDays: w.longest_streak_days,
      peakDay: w.peak_day,
      topHour: w.top_hour,
      favoritesAdded: w.favorites_added,
      topTracks: w.top_tracks.map((t) => ({ track: trackFromWire(t.track), plays: t.plays, playedMs: t.played_ms })),
      topArtists: w.top_artists.map((a) => ({ artist: a.artist, plays: a.plays, playedMs: a.played_ms })),
      firstTrack: w.first_track ? trackFromWire(w.first_track) : null,
      firstPlayAt: w.first_play_at,
    };
  }

  async getStatsOverview(period: StatsPeriod): Promise<StatsOverview> {
    const params = new URLSearchParams({ period, tz_offset_min: String(new Date().getTimezoneOffset()) });
    const s = await this.authedRequest<{
      period: StatsPeriod;
      total_plays: number;
      total_ms: number;
      unique_tracks: number;
      unique_artists: number;
      series: { bucket: string; plays: number; ms: number }[];
      hours: number[];
      top_hour: number | null;
      top_tracks: { track: TrackWire; plays: number; played_ms: number }[];
      top_artists: { artist: string; plays: number; played_ms: number }[];
      active_days: number;
      current_streak_days: number;
      longest_streak_days: number;
      favorites_added: number;
    }>(`/me/stats/overview?${params}`);
    return {
      period: s.period,
      totalPlays: s.total_plays,
      totalMs: s.total_ms,
      uniqueTracks: s.unique_tracks,
      uniqueArtists: s.unique_artists,
      series: s.series,
      hours: s.hours,
      topHour: s.top_hour,
      topTracks: s.top_tracks.map((t) => ({ track: trackFromWire(t.track), plays: t.plays, playedMs: t.played_ms })),
      topArtists: s.top_artists.map((a) => ({ artist: a.artist, plays: a.plays, playedMs: a.played_ms })),
      activeDays: s.active_days,
      currentStreakDays: s.current_streak_days,
      longestStreakDays: s.longest_streak_days,
      favoritesAdded: s.favorites_added,
    };
  }

  // ---------- Маркетплейс тем (Stage 6) ----------

  async getMarketThemes(): Promise<MarketTheme[]> {
    const out = await this.authedRequest<{ themes: MarketThemeWire[] }>("/market/themes");
    return out.themes.map(marketThemeFromWire);
  }

  async publishMarketTheme(name: string, payload: Record<string, unknown>): Promise<MarketTheme> {
    return marketThemeFromWire(
      await this.authedRequest<MarketThemeWire>("/market/themes", {
        method: "POST",
        body: JSON.stringify({ name, payload }),
      }),
    );
  }

  async installMarketTheme(id: string): Promise<MarketTheme> {
    return marketThemeFromWire(
      await this.authedRequest<MarketThemeWire>(`/market/themes/${encodeURIComponent(id)}/install`, {
        method: "POST",
      }),
    );
  }

  async deleteMarketTheme(id: string): Promise<void> {
    await this.authedRequest(`/market/themes/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async reportMarketTheme(id: string): Promise<void> {
    await this.authedRequest(`/market/themes/${encodeURIComponent(id)}/report`, { method: "POST" });
  }

  // ---------- Маркетплейс плагинов (эпик W8, T45a) ----------

  async getMarketPlugins(): Promise<MarketPlugin[]> {
    const out = await this.authedRequest<{ plugins: MarketPluginWire[] }>("/market/plugins");
    return out.plugins.map(marketPluginFromWire);
  }

  /** Публикация/обновление; payload — { manifest, code, css?, strings? }
   *  (§6.2 дока). Повторная публикация того же manifest.id ЭТИМ ЖЕ юзером
   *  обновляет запись; full-access снова уходит в pending (код изменился). */
  async publishMarketPlugin(
    manifest: Record<string, unknown>,
    code: string,
    css?: string,
    strings?: Record<string, string>,
  ): Promise<MarketPlugin> {
    return marketPluginFromWire(
      await this.authedRequest<MarketPluginWire>("/market/plugins", {
        method: "POST",
        body: JSON.stringify({ manifest, code, css, strings }),
      }),
    );
  }

  /** Установка: инкремент счётчика + полный payload плагина — рантайм
   *  (apps/desktop/src/plugins/install.ts) сам прогоняет Zod+AST-скан ещё раз
   *  перед записью на диск, сервер это клиенту бесплатно не гарантирует. */
  async installMarketPlugin(id: string): Promise<MarketPlugin> {
    return marketPluginFromWire(
      await this.authedRequest<MarketPluginWire>(`/market/plugins/${encodeURIComponent(id)}/install`, {
        method: "POST",
      }),
    );
  }

  async deleteMarketPlugin(id: string): Promise<void> {
    await this.authedRequest(`/market/plugins/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async reportMarketPlugin(id: string): Promise<void> {
    await this.authedRequest(`/market/plugins/${encodeURIComponent(id)}/report`, { method: "POST" });
  }

  /** Модерация (только админ): скрыть/вернуть плагин. */
  async hideMarketPlugin(id: string, hidden: boolean): Promise<void> {
    await this.authedRequest(`/market/plugins/${encodeURIComponent(id)}/hidden`, {
      method: "POST",
      body: JSON.stringify({ hidden }),
    });
  }

  /** Премодерация full-access (§5.4 дока, только админ): снимает pending. */
  async approveMarketPlugin(id: string): Promise<void> {
    await this.authedRequest(`/market/plugins/${encodeURIComponent(id)}/approve`, { method: "POST" });
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

  async getAdminGrowth(days = 30): Promise<AdminGrowth> {
    const g = await this.authedRequest<{
      days: number;
      registrations: AdminDayPoint[];
      visits: AdminDayPoint[];
      downloads: {
        total: number;
        by_asset: { tag: string; asset: string; count: number }[];
        series: AdminDayPoint[];
      };
    }>(`/admin/growth?days=${days}`);
    return {
      days: g.days,
      registrations: g.registrations,
      visits: g.visits,
      downloads: { total: g.downloads.total, byAsset: g.downloads.by_asset, series: g.downloads.series },
    };
  }

  async getAdminErrors(opts?: { days?: number; kind?: string; appVersion?: string }): Promise<AdminErrors> {
    const params = new URLSearchParams({ days: String(opts?.days ?? 7) });
    if (opts?.kind) params.set("kind", opts.kind);
    if (opts?.appVersion) params.set("app_version", opts.appVersion);
    const e = await this.authedRequest<{
      days: number;
      totals: { count: number; distinct: number };
      series: AdminDayPoint[];
      top: {
        stack_hash: string;
        kind: string;
        message: string;
        count: number;
        last_seen: string;
        app_versions: string[];
      }[];
      by_kind: { kind: string; count: number }[];
      by_app: { app_version: string; count: number }[];
    }>(`/admin/errors?${params.toString()}`);
    return {
      days: e.days,
      totals: e.totals,
      series: e.series,
      top: e.top.map((t) => ({
        stackHash: t.stack_hash,
        kind: t.kind,
        message: t.message,
        count: t.count,
        lastSeen: t.last_seen,
        appVersions: t.app_versions,
      })),
      byKind: e.by_kind,
      byApp: e.by_app.map((a) => ({ appVersion: a.app_version, count: a.count })),
    };
  }

  async clearAdminErrors(opts?: { kind?: string; appVersion?: string }): Promise<{ deleted: number }> {
    const params = new URLSearchParams();
    if (opts?.kind) params.set("kind", opts.kind);
    if (opts?.appVersion) params.set("app_version", opts.appVersion);
    const q = params.toString();
    return this.authedRequest<{ deleted: number }>(`/admin/errors${q ? `?${q}` : ""}`, { method: "DELETE" });
  }

  async deleteAdminErrorGroup(stackHash: string): Promise<{ deleted: number }> {
    return this.authedRequest<{ deleted: number }>(`/admin/errors/${encodeURIComponent(stackHash)}`, {
      method: "DELETE",
    });
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

  /** Visit-пинг (админ-панель): анонимный эндпоинт, дедуп по дню — на клиенте. */
  async sendVisit(input: { appVersion: string; platform?: string }): Promise<void> {
    await this.request("/telemetry/visit", {
      method: "POST",
      body: JSON.stringify({ app_version: input.appVersion, platform: input.platform }),
    });
  }

  /** Ошибки клиента (админ-панель): анонимный эндпоинт — plain request, без
   *  Bearer, чтобы падения до логина тоже доходили. */
  async sendClientErrors(batch: ClientErrorBatch): Promise<void> {
    await this.request("/telemetry/error", {
      method: "POST",
      body: JSON.stringify({
        app_version: batch.appVersion,
        errors: batch.errors.map((e) => ({
          kind: e.kind,
          message: e.message,
          stack_hash: e.stackHash,
          count: e.count,
        })),
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

  async changeEmail(password: string, newEmail: string): Promise<EmailChangeStartResult> {
    const out = await this.authedRequest<{ confirm_url?: string } | undefined>("/auth/email/start", {
      method: "POST",
      body: JSON.stringify({ password, new_email: newEmail }),
    });
    return EmailChangeStartResultSchema.parse({ confirmUrl: out?.confirm_url });
  }

  async listSessions(): Promise<SessionInfo[]> {
    const out = await this.authedRequest<{
      sessions: { id: string; ip: string | null; user_agent: string | null; created_at: string; current: boolean }[];
    }>("/me/sessions");
    return out.sessions.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.user_agent,
      createdAt: s.created_at,
      current: s.current,
    }));
  }

  async revokeSession(id: string): Promise<void> {
    await this.authedRequest(`/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async exportData(): Promise<Record<string, unknown>> {
    return this.authedRequest<Record<string, unknown>>("/me/privacy/export");
  }

  async deleteAccount(password: string): Promise<void> {
    await this.authedRequest("/me/privacy/account", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
    localStorage.removeItem(STORAGE_KEY); // аккаунта больше нет — сессия тоже
  }

  private load(): Session | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = SessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }
}
