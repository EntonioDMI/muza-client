/**
 * @muza/api-client — типизированный контракт API Muza.
 * Stage 1: интерфейс + мок-реализация (сервера ещё нет, появится в Stage 2).
 */

import type {
  AdminContent,
  AdminHealth,
  AdminOverview,
  AdminUsers,
  Annotations,
  Credentials,
  HistoryItem,
  HomeSection,
  ImportReport,
  Lyrics,
  PlaylistDetail,
  PlaylistMeta,
  RecipeEnvelope,
  RecsSettings,
  RegisterStatus,
  ScrobblingStatus,
  SearchScope,
  Session,
  TelemetryStats,
  Track,
  TrackSource,
} from "./schemas";

export * from "./schemas";

export interface MuzaApi {
  /** Анонимный вход: аккаунт-на-устройстве, без синхронизации между устройствами. */
  loginAnonymous(): Promise<Session>;
  login(credentials: Credentials): Promise<Session>;
  /** Регистрация без почты: аккаунт сразу, восстановление пароля недоступно. */
  register(credentials: Credentials): Promise<Session>;
  logout(): Promise<void>;
  /** Восстановить сессию из локального хранилища (если была). */
  restoreSession(): Promise<Session | null>;

  // Регистрация с почтой (verify-before-create):
  // start → письмо → поллинг status → verified → complete → сессия.
  registerStart(input: Credentials & { email: string }): Promise<{ pendingId: string; email: string }>;
  registerStatus(pendingId: string): Promise<RegisterStatus>;
  registerComplete(pendingId: string): Promise<Session>;
  registerResend(pendingId: string): Promise<void>;

  /** Восстановление пароля: письмо со ссылкой на форму сброса.
   *  Сервер всегда отвечает 204 — существование почты не палится. */
  recoveryStart(email: string): Promise<void>;

  /** Смена пароля из приложения (настройки → Аккаунт): старый → новый.
   *  Остальные устройства разлогиниваются, текущая сессия живёт. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;

  // Каталог (Stage 2, слайс 3). Требует серверной сессии (аноним — локальный,
  // сервер его не знает → поиск недоступен).
  search(query: string, opts?: { scope?: SearchScope; limit?: number }): Promise<Track[]>;
  getTrack(id: string): Promise<Track>;
  /** Живые источники трека для клиентской добычи (Stage 3), по убыванию priority.
   *  Stage 4: выбранный пользователем источник приходит первым (isChosen). */
  getTrackSources(id: string): Promise<TrackSource[]>;

  // Источники и версии (Stage 4).
  /** Запомнить явный выбор источника трека (per-user; матчинг не перебивает). */
  chooseTrackSource(trackId: string, sourceId: string): Promise<void>;
  /** Сбросить выбор: снова играет лучший источник по приоритету. */
  resetTrackSource(trackId: string): Promise<void>;
  /** Прямая ссылка (YT/YTM/SC/Bandcamp; Spotify/Apple — через Odesli):
   *  трек добавляется как есть, источник — kind=direct + выбор пользователя. */
  addDirectTrack(url: string): Promise<Track>;
  /** Локальный файл (device-bound): регистрирует трек с источником kind=local
   *  по хэшу файла; сам файл остаётся на устройстве. */
  addLocalTrack(input: { artist: string; title: string; durationSec: number; hash: string }): Promise<Track>;
  /** Импорт плейлиста по ссылке (Spotify/YT/Apple) через матчинг в каталог. */
  importPlaylist(url: string): Promise<ImportReport>;

  // Личное (Stage 2, слайс 4): избранное, плейлисты, история. Серверная сессия.
  getFavorites(): Promise<Track[]>;
  addFavorite(trackId: string): Promise<void>;
  removeFavorite(trackId: string): Promise<void>;
  getPlaylists(): Promise<PlaylistMeta[]>;
  createPlaylist(name: string): Promise<PlaylistMeta>;
  getPlaylist(id: string): Promise<PlaylistDetail>;
  renamePlaylist(id: string, name: string): Promise<void>;
  deletePlaylist(id: string): Promise<void>;
  addPlaylistTrack(playlistId: string, trackId: string): Promise<void>;
  removePlaylistTrack(playlistId: string, trackId: string): Promise<void>;
  /** Скроббл (клиент шлёт с реальным движком — Stage 3; сервер уже готов). */
  recordPlay(input: { trackId: string; playedMs: number; durationMs: number; completed: boolean }): Promise<void>;
  getHistory(limit?: number): Promise<HistoryItem[]>;

  // Тексты и смысл (Stage 2, слайс 5): LRCLIB-синхротекст + Genius-аннотации.
  getLyrics(trackId: string): Promise<Lyrics>;
  getAnnotations(trackId: string): Promise<Annotations>;

  // Внешний скробблинг (Last.fm / ListenBrainz). Секреты и подпись — на
  // сервере; сам скроббл сервер шлёт автоматически на recordPlay.
  getScrobbling(): Promise<ScrobblingStatus>;
  /** Шаг 1 Last.fm: одноразовый токен + ссылка «Разрешить» для браузера. */
  lastfmConnectStart(): Promise<{ token: string; authUrl: string }>;
  /** Шаг 2: поллится после открытия браузера; 409 = ещё не подтверждено. */
  lastfmConnectComplete(token: string): Promise<{ username: string }>;
  lastfmDisconnect(): Promise<void>;
  /** ListenBrainz: user token со страницы listenbrainz.org/settings. */
  listenbrainzConnect(token: string): Promise<{ username: string }>;
  listenbrainzDisconnect(): Promise<void>;

  /** Горячий рецепт добычи (Stage 2, слайс 6); применяется клиентом в Stage 3. */
  getRecipe(): Promise<RecipeEnvelope>;

  /** Анонимный агрегат телеметрии (Stage 3): без идентификаторов, best-effort. */
  sendTelemetry(stats: TelemetryStats): Promise<void>;

  // Рекомендации и лента (Stage 5). Персональные секции пусты у аккаунта
  // без истории — клиент показывает фолбэк.
  getHome(): Promise<HomeSection[]>;
  /** Догрузка секции offset/limit; меньше limit в ответе = секция исчерпана. */
  getHomeSection(key: string, opts?: { offset?: number; limit?: number }): Promise<Track[]>;
  /** Бесконечное радио: продолжение очереди от сид-трека. */
  getRadio(seedTrackId: string): Promise<Track[]>;
  getRecsSettings(): Promise<RecsSettings>;
  /** null в поле = сбросить на серверный дефолт; отсутствие поля = не трогать. */
  updateRecsSettings(input: { epsilon?: number | null; tauScale?: number | null }): Promise<RecsSettings>;

  // Админ-панель (Stage 5). Доступ по users.is_admin (выдаётся вручную).
  /** true — текущий пользователь админ (по нему клиент показывает «Админку»). */
  adminPing(): Promise<boolean>;
  getAdminOverview(): Promise<AdminOverview>;
  getAdminContent(): Promise<AdminContent>;
  getAdminHealth(hours?: number): Promise<AdminHealth>;
  getAdminUsers(opts?: { limit?: number; offset?: number }): Promise<AdminUsers>;
}

export { MockMuzaApi } from "./mock";
export { HttpMuzaApi, ApiError } from "./http";
