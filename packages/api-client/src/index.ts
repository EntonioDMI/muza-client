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
  EmailChangeStartResult,
  GroupedSearchResult,
  HistoryItem,
  HomeSection,
  ImportReport,
  JamEvent,
  JamSnapshot,
  Lyrics,
  MarketTheme,
  MarketPlugin,
  PlaylistDetail,
  PlaylistMeta,
  RecipeEnvelope,
  RecsSettings,
  RegisterStatus,
  ScrobblingStatus,
  SearchScope,
  Session,
  SessionInfo,
  StatsOverview,
  StatsPeriod,
  TelemetryStats,
  Track,
  TrackSource,
  Wrapped,
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

  /** Смена/привязка почты: пароль + новая почта → письмо-подтверждение
   *  на НОВЫЙ адрес (почта меняется по клику из письма). confirmUrl в
   *  результате — dev-фолбэк сервера (SMTP выключен, письмо не ушло
   *  реально); в production и при реальной отправке — undefined. */
  changeEmail(password: string, newEmail: string): Promise<EmailChangeStartResult>;

  /** Сессии и устройства: активные refresh-сессии (текущая помечена). */
  listSessions(): Promise<SessionInfo[]>;
  /** Разлогинить устройство (текущее — 400: используй logout). */
  revokeSession(id: string): Promise<void>;

  /** Выгрузка всех данных аккаунта одним JSON (без секретов). */
  exportData(): Promise<Record<string, unknown>>;
  /** Удалить аккаунт и все серверные данные; пароль обязателен.
   *  Локальная сессия чистится сразу. */
  deleteAccount(password: string): Promise<void>;

  // Каталог (Stage 2, слайс 3). Требует серверной сессии (аноним — локальный,
  // сервер его не знает → поиск недоступен).
  search(query: string, opts?: { scope?: SearchScope; limit?: number }): Promise<Track[]>;
  /** T41: тот же поиск, но с группировкой ремиксов/версий (T36 сервера,
   *  ?group=1) — оригинал/канон + variants одной карточкой; нераспознанные
   *  декорированные одиночки остаются как kind:"single" в хвосте. offset
   *  на сервере фиксирован в 0 — «ещё» растит limit, как и у search(). */
  searchGrouped(query: string, opts?: { scope?: SearchScope; limit?: number }): Promise<GroupedSearchResult[]>;
  getTrack(id: string): Promise<Track>;
  /** Живые источники трека для клиентской добычи (Stage 3), по убыванию priority.
   *  Stage 4: выбранный пользователем источник приходит первым (isChosen). */
  getTrackSources(id: string): Promise<TrackSource[]>;
  /** Стрим-ссылка серверного резолвера (Stage 8, веб): подписанный URL с TTL —
   *  его можно отдавать прямо в `<audio src>`. Десктоп добывает сам и этим
   *  не пользуется (серверный путь — фолбэк, architecture.md). */
  getStreamUrl(trackId: string): Promise<{ url: string; expiresAt: number }>;

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
  /** icon — id из манифеста @muza/core ("pi-01".."pi-38"); клиент обычно
   *  подбирает случайный сам (T47) и передаёт сюда, но поле опционально. */
  createPlaylist(name: string, icon?: string): Promise<PlaylistMeta>;
  getPlaylist(id: string): Promise<PlaylistDetail>;
  renamePlaylist(id: string, name: string): Promise<void>;
  /** Сменить иконку-обложку (T47, ПКМ → «Сменить иконку»); только владелец. */
  setPlaylistIcon(id: string, icon: string): Promise<void>;
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

  // Маркетплейс тем (Stage 6). Публикация rate-limit 5/час, payload ≤ 16КБ.
  getMarketThemes(): Promise<MarketTheme[]>;
  /** Опубликовать тему; своё имя = обновление записи. */
  publishMarketTheme(name: string, payload: Record<string, unknown>): Promise<MarketTheme>;
  /** Установка: инкремент счётчика + полный payload темы. */
  installMarketTheme(id: string): Promise<MarketTheme>;
  /** Снять с публикации (свою; админ — любую). */
  deleteMarketTheme(id: string): Promise<void>;
  /** Пожаловаться на чужую тему (порог жалоб авто-скрывает её). */
  reportMarketTheme(id: string): Promise<void>;

  // Маркетплейс плагинов (эпик W8, T45a). payload = { manifest, code, css?,
  // strings? }; install ставится через рантайм T44/T44b (клиент сам валидирует
  // манифест и сканирует код/CSS перед записью на диск).
  getMarketPlugins(): Promise<MarketPlugin[]>;
  /** Опубликовать/обновить; свой manifest.id = обновление записи (full-access
   *  снова уходит в pending — код изменился, ревью заново). */
  publishMarketPlugin(
    manifest: Record<string, unknown>,
    code: string,
    css?: string,
    strings?: Record<string, string>,
  ): Promise<MarketPlugin>;
  /** Установка: инкремент счётчика + полный payload плагина. */
  installMarketPlugin(id: string): Promise<MarketPlugin>;
  /** Снять с публикации (свой; админ — любой). */
  deleteMarketPlugin(id: string): Promise<void>;
  /** Пожаловаться на чужой плагин (порог жалоб авто-скрывает его). */
  reportMarketPlugin(id: string): Promise<void>;
  /** Модерация (только админ): скрыть/вернуть плагин в витрину. */
  hideMarketPlugin(id: string, hidden: boolean): Promise<void>;
  /** Премодерация full-access (только админ): одобрить публикацию. */
  approveMarketPlugin(id: string): Promise<void>;

  // Совместные плейлисты (Stage 7): инвайт-код → вход по коду → участник
  // добавляет/убирает треки. Код видит и отзывает только владелец.
  /** Создать (или вернуть существующий) инвайт-код плейлиста. */
  createPlaylistInvite(playlistId: string): Promise<{ code: string }>;
  /** Отозвать код: новые не войдут, вошедшие участники остаются. */
  revokePlaylistInvite(playlistId: string): Promise<void>;
  /** Войти в совместный плейлист по коду (идемпотентно). */
  joinPlaylist(code: string): Promise<PlaylistMeta>;
  /** Убрать участника: владелец — любого; участник — себя (выход). */
  removePlaylistMember(playlistId: string, userId: string): Promise<void>;

  // Jam — слушать вместе (Stage 7). Хост управляет, гости следуют и
  // докидывают треки; каждый добывает аудио сам (клиент-«мускулы»).
  createJam(): Promise<JamSnapshot>;
  getJam(code: string): Promise<JamSnapshot>;
  joinJam(code: string): Promise<JamSnapshot>;
  /** Выход; хост выходит — jam завершается для всех. */
  leaveJam(code: string): Promise<void>;
  /** Пуш состояния (только хост): смена трека/паузы/сика + heartbeat. */
  pushJamState(
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
  ): Promise<void>;
  /** Докинуть трек в очередь хоста (любой участник). */
  addJamTrack(code: string, trackId: string): Promise<void>;
  /** SSE-поток событий jam (первым придёт snapshot). Возвращает отписку;
   *  поток сам переподключается, «ended» — финал. */
  subscribeJamEvents(code: string, onEvent: (event: JamEvent) => void): () => void;

  /** Wrapped «Итоги года» (Stage 7): агрегаты прослушиваний за год. */
  getWrapped(opts?: { year?: number }): Promise<Wrapped>;

  /** Статистика за период (страница «Статистика»): суммы, серия
   *  активности, часы, топы, серии дней. */
  getStatsOverview(period: StatsPeriod): Promise<StatsOverview>;

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
