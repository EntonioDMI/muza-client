/**
 * @muza/api-client — типизированный контракт API Muza.
 * Stage 1: интерфейс + мок-реализация (сервера ещё нет, появится в Stage 2).
 */

import type {
  AdminContent,
  AdminErrors,
  AdminGrowth,
  AdminHealth,
  AdminOverview,
  AdminUsers,
  Annotations,
  ClientErrorBatch,
  Credentials,
  EmailChangeStartResult,
  GroupedSearchResult,
  HistoryItem,
  HomeSection,
  ImportPreview,
  ImportReport,
  JamEvent,
  JamSnapshot,
  Lyrics,
  MarketTheme,
  MarketPlugin,
  AdminPublicPlaylists,
  PlaylistDetail,
  PlaylistMeta,
  PlaylistVisibility,
  PublicPlaylist,
  PublicPlaylistHit,
  SoundcloudPlaylist,
  Genre,
  RecipeEnvelope,
  RecsSettings,
  RegisterStatus,
  ScrobblingStatus,
  SearchScope,
  SearchFilters,
  Session,
  SessionInfo,
  StatsOverview,
  StatsPeriod,
  TasteOptions,
  TasteSeed,
  TelemetryStats,
  Track,
  TrackAlternative,
  TrackSource,
  Wrapped,
} from "./schemas";

export * from "./schemas";

/** Профиль клиента, каким его хранит сервер: непрозрачный объект + отметка
 *  времени последней записи (ISO 8601). Отметка — арбитр «чья версия свежее»
 *  при расхождении устройств. */
export interface PrefsSnapshot {
  data: Record<string, unknown>;
  updatedAt: string;
}

/** Ответ на попытку прочитать профиль — см. `MuzaApi.getPrefs`. */
export type PrefsSyncResult = { supported: false } | { supported: true; prefs: PrefsSnapshot | null };

/** Ответ на попытку прочитать вкус — см. `MuzaApi.getTasteSeed`. */
export type TasteSeedResult = { supported: false } | { supported: true; seed: TasteSeed | null };
export { resolveApiBaseUrl, type ApiBuildMode } from "./api-base-url";

export interface MuzaApi {
  /** Анонимный вход: аккаунт-на-устройстве, без синхронизации между устройствами. */
  loginAnonymous(): Promise<Session>;
  login(credentials: Credentials): Promise<Session>;
  /** Регистрация без почты: аккаунт сразу, восстановление пароля недоступно. */
  register(credentials: Credentials): Promise<Session>;
  logout(): Promise<void>;
  /** Восстановить сессию из локального хранилища (если была). Локально, БЕЗ
   *  сети (2026-07-20): валидность проверяется лениво первым же 401. */
  restoreSession(): Promise<Session | null>;
  /** «Вход отозван по-настоящему» — приложению пора на экран входа.
   *  Парная к локальному restoreSession: без неё окно остаётся
   *  «залогиненным» с падающими запросами до перезапуска. */
  onSessionRevoked(handler: () => void): void;

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
  search(query: string, opts?: { scope?: SearchScope; limit?: number; filters?: SearchFilters }): Promise<Track[]>;
  /** T41: тот же поиск, но с группировкой ремиксов/версий (T36 сервера,
   *  ?group=1) — оригинал/канон + variants одной карточкой; нераспознанные
   *  декорированные одиночки остаются как kind:"single" в хвосте. offset
   *  на сервере фиксирован в 0 — «ещё» растит limit, как и у search(). */
  searchGrouped(
    query: string,
    opts?: { scope?: SearchScope; limit?: number; filters?: SearchFilters },
  ): Promise<GroupedSearchResult[]>;
  /** Жанры, по которым есть что слушать (13.08). Отвечает на «что у меня
   *  вообще есть», а не «найди мне вот это», — поэтому не режим поиска, а своя
   *  ручка. Пустой список — законный ответ: теги проставляются фоном, и у
   *  свежей библиотеки их может не быть вовсе. */
  /** То, чего человек ЕЩЁ НЕ СЛЫШАЛ (13.08).
   *
   *  ⚠️ Не путать с секцией «Для тебя»: у той обратная задача — ротировать
   *  избранное и соседей любимого, то есть показывать ЗНАКОМОЕ. Здесь всё
   *  услышанное вырезано, вплоть до одного прослушивания.
   *
   *  Пустой список — законный ответ: у того, кто послушал весь свой каталог,
   *  нового в нём нет. Экран обязан пережить это молча. */
  discover(limit?: number): Promise<Track[]>;
  genres(): Promise<Genre[]>;
  genreTracks(slug: string, opts?: { limit?: number; offset?: number }): Promise<Track[]>;
  getTrack(id: string): Promise<Track>;
  /** Живые источники трека для клиентской добычи (Stage 3), по убыванию priority.
   *  Stage 4: выбранный пользователем источник приходит первым (isChosen). */
  getTrackSources(id: string): Promise<TrackSource[]>;
  /** Кандидаты на ЗАМЕНУ трека («Заменить версию»): другие загрузки той же
   *  песни отдельными треками, ранжированы серверным скорингом. Медленно
   *  (провайдеры под капотом) и rate-limit'ится как полный поиск. */
  getTrackAlternatives(id: string): Promise<TrackAlternative[]>;
  /** Рантайм-петля DRM: добыча упала с «This video is DRM protected» —
   *  попросить сервер перепроверить SC-источники трека (сервер сверяет признак
   *  сам и хоронит только подтверждённые; ложный вызов ничего не ломает).
   *  marked — сколько источников похоронено. */
  drmRecheck(trackId: string): Promise<{ marked: number }>;
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
  /** Что лежит по ссылке — ДО импорта: название, число позиций и может ли
   *  плейлист подстраиваться под слушателя. Зовётся на вставку ссылки, поэтому
   *  дёшево (Spotify/Apple — одна страница; YouTube не превьюится вовсе).
   *  Нечего сказать → previewable=false, а не ошибка. */
  previewImport(url: string): Promise<ImportPreview>;

  // Личное (Stage 2, слайс 4): избранное, плейлисты, история. Серверная сессия.
  getFavorites(): Promise<Track[]>;
  addFavorite(trackId: string): Promise<void>;
  removeFavorite(trackId: string): Promise<void>;
  /** «Заменить версию» в Любимом: атомарно снять лайк со старого и поставить
   *  новому, сохранив место в списке (createdAt наследуется). */
  replaceFavorite(oldTrackId: string, newTrackId: string): Promise<void>;
  getPlaylists(): Promise<PlaylistMeta[]>;
  /** icon — id из манифеста @muza/core ("pi-01".."pi-38"); клиент обычно
   *  подбирает случайный сам (T47) и передаёт сюда, но поле опционально. */
  createPlaylist(name: string, icon?: string): Promise<PlaylistMeta>;
  getPlaylist(id: string): Promise<PlaylistDetail>;
  renamePlaylist(id: string, name: string): Promise<void>;
  /** Сменить иконку-обложку (T47, ПКМ → «Сменить иконку»); только владелец. */
  setPlaylistIcon(id: string, icon: string): Promise<void>;
  /** Закрепить/открепить сверху списка (2026-07-20); только владелец. */
  setPlaylistPinned(id: string, pinned: boolean): Promise<void>;
  deletePlaylist(id: string): Promise<void>;
  addPlaylistTrack(playlistId: string, trackId: string): Promise<void>;
  removePlaylistTrack(playlistId: string, trackId: string): Promise<void>;
  /** «Заменить версию»: атомарно подменить трек в ЭТОМ плейлисте другим,
   *  сохранив позицию и кто/когда добавил. Локально плейлисту. */
  replacePlaylistTrack(playlistId: string, oldTrackId: string, newTrackId: string): Promise<void>;
  /** Переупорядочить треки: `trackIds` — ВЕСЬ список в новом порядке. */
  reorderPlaylist(playlistId: string, trackIds: string[]): Promise<void>;
  /** Новый порядок плейлистов пользователя (drag-drop в Библиотеке). */
  reorderPlaylists(playlistIds: string[]): Promise<void>;
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
  /** Батч клиентских ошибок (админ-панель): анонимный эндпоинт, БЕЗ Bearer —
   *  падения до логина самые ценные. Best-effort, как sendTelemetry. */
  sendClientErrors(batch: ClientErrorBatch): Promise<void>;
  /** Visit-пинг (админ-панель): анонимный, максимум раз в день (дедуп на
   *  клиенте — useVisitPing). Сервер хранит только дневные счётчики. */
  sendVisit(input: { appVersion: string; platform?: string }): Promise<void>;

  // Рекомендации и лента (Stage 5). Персональные секции пусты у аккаунта
  // без истории — клиент показывает фолбэк.
  getHome(): Promise<HomeSection[]>;
  /** Догрузка секции offset/limit; меньше limit в ответе = секция исчерпана. */
  getHomeSection(key: string, opts?: { offset?: number; limit?: number }): Promise<Track[]>;
  /** Бесконечное радио: продолжение очереди от сид-трека. */
  getRadio(seedTrackId: string): Promise<Track[]>;
  /** Профиль клиента с сервера — общий для всех устройств аккаунта.
   *
   *  ⚠️ ТРИ РАЗНЫХ ОТВЕТА, И ПУТАТЬ ИХ НЕЛЬЗЯ:
   *   - `{ supported: true, prefs: {...} }` — профиль есть, применяем;
   *   - `{ supported: true, prefs: null }` — ручка есть, профиля ещё нет:
   *     заливаем наверх свой;
   *   - `{ supported: false }` — ручки нет вовсе (сервер старее клиента: на
   *     проде это штатно, выкладка сервера отстаёт от выкладки веба).
   *     Синхронизации нет, локальные настройки не трогаем и наверх не шлём.
   *  Схлопнуть второе и третье в один `null` значило бы залить дефолты нового
   *  устройства в аккаунт при первом же заходе на старый сервер. */
  getPrefs(): Promise<PrefsSyncResult>;
  /** Сохранить профиль целиком. `false` — ручки нет (старый сервер): это не
   *  ошибка, звать снова незачем. */
  putPrefs(data: Record<string, unknown>): Promise<PrefsSnapshot | false>;
  getRecsSettings(): Promise<RecsSettings>;
  /** null в поле = сбросить на серверный дефолт; отсутствие поля = не трогать. */
  updateRecsSettings(input: { epsilon?: number | null; tauScale?: number | null }): Promise<RecsSettings>;

  // Вкус, названный на входе (холодный старт, H7). Рекомендации Музы растут из
  // прослушиваний, а у нового человека их нет — экран выбора даёт им начало.
  /** Что человек отметил.
   *
   *  ⚠️ ТРИ РАЗНЫХ ОТВЕТА, как и у getPrefs, и путать их нельзя:
   *   - `{ supported: true, seed: {...} }` — выбор есть;
   *   - `{ supported: true, seed: null }` — ручка есть, экрана ещё не было:
   *     вот его и показываем;
   *   - `{ supported: false }` — ручки нет вовсе (сервер старее клиента; на
   *     проде это штатно). Экран не показываем совсем: сохранять выбор было бы
   *     некуда, а «выбери артистов, мы это потеряем» — худшее из первых
   *     впечатлений. */
  getTasteSeed(): Promise<TasteSeedResult>;
  /** Сохранить выбор целиком (замена, не слияние: на экране виден весь набор).
   *  `false` — ручки нет (старый сервер), звать снова незачем. */
  putTasteSeed(input: { artists: string[]; tags: string[]; skipped?: boolean }): Promise<TasteSeed | false>;
  /** Что показать на экране: жанры и артисты из каталога Музы.
   *  `tags` — уже отмеченные жанры (сетка артистов сужается под них),
   *  `query` — поиск по каталогу, `limit` — сколько плиток вернуть. */
  getTasteOptions(opts?: { tags?: string[]; query?: string; limit?: number }): Promise<TasteOptions>;

  // Маркетплейс тем (Stage 6). Публикация rate-limit 5/час, payload ≤ 16КБ.
  /** `limit` — сколько тем отдать (сервер клампит 1..100, дефолт 50). Без
   *  параметра поведение прежнее; витрина упирается в потолок молча, поэтому
   *  просить больше — единственный способ показать больше 50 тем. */
  getMarketThemes(opts?: { limit?: number }): Promise<MarketTheme[]>;
  /** Опубликовать тему; своё имя = обновление записи. */
  publishMarketTheme(name: string, payload: Record<string, unknown>): Promise<MarketTheme>;
  /** Установка: инкремент счётчика + полный payload темы. */
  installMarketTheme(id: string): Promise<MarketTheme>;
  /** Снять с публикации (свою; админ — любую). */
  deleteMarketTheme(id: string): Promise<void>;
  /** Пожаловаться на чужую тему (порог жалоб авто-скрывает её). */
  reportMarketTheme(id: string): Promise<void>;
  /** Модерация витрины (админ): hidden=false возвращает скрытую тему. */
  setMarketThemeHidden(id: string, hidden: boolean): Promise<void>;

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

  // Публичные плейлисты (2026-07-17): лесенка видимости private→code→public,
  // код PL_… для друзей, публикация в поиск, живая read-only подписка.
  // Треки чужого — обычным getPlaylist(id): сервер пускает ролью viewer.
  /** Сменить видимость (владелец). Код рождается при первом подъёме из private. */
  setPlaylistVisibility(
    playlistId: string,
    visibility: PlaylistVisibility,
  ): Promise<{ visibility: PlaylistVisibility; publicCode: string | null }>;
  /** Плейлист по коду PL_… из строки поиска (rate-limit на сервере). */
  getPublicPlaylistByCode(code: string): Promise<PublicPlaylist>;
  /** @Адрес (2026-07-17): задать/сменить (только public; null — отказ);
   *  занят → 409 «Адрес занят»; лимит смен 5/час. */
  setPlaylistHandle(playlistId: string, handle: string | null): Promise<{ handle: string | null }>;
  /** Плейлист по @адресу из строки поиска (только public; заморожен = 404). */
  getPublicPlaylistByHandle(handle: string): Promise<PublicPlaylist>;
  /** Подписаться — живая «ссылка» в библиотеке (идемпотентно). */
  followPlaylist(playlistId: string): Promise<PlaylistMeta>;
  unfollowPlaylist(playlistId: string): Promise<void>;
  /** Поиск публичных: топ-10 по скору (название сильнее артистов внутри);
   *  2026-07-20 — в хвосте выдачи плейлисты SoundCloud (source различает). */
  searchPublicPlaylists(q: string): Promise<PublicPlaylistHit[]>;
  /** Состав плейлиста SoundCloud (2026-07-20): треки уже в каталоге, играют
   *  как обычные; id — с префиксом sc: из выдачи или голый числовой. */
  getSoundcloudPlaylist(id: string): Promise<SoundcloudPlaylist>;
  /** Админ-рубильник: обзор публичных + снятие с публикации (ban — навсегда).
   *  ⚠️ Возврат сменился с голого массива на страницу (05.08): без `total`
   *  подпись «показаны N из M» была невозможна. Вызов БЕЗ opts сервер трактует
   *  как «отдай всё» (до 500) — старое поведение; страницу включает limit или
   *  offset. Сервер клампит limit в 1..100. */
  getAdminPublicPlaylists(opts?: { limit?: number; offset?: number }): Promise<AdminPublicPlaylists>;
  unpublishAdminPlaylist(playlistId: string, ban?: boolean): Promise<void>;

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
  /** `days` — окно топов (дефолт 14), `limit` — длина каждого из трёх списков
   *  (дефолт 20). Без opts — ровно прежнее поведение. */
  getAdminContent(opts?: { days?: number; limit?: number }): Promise<AdminContent>;
  getAdminHealth(hours?: number): Promise<AdminHealth>;
  getAdminUsers(opts?: { limit?: number; offset?: number; q?: string }): Promise<AdminUsers>;
  /** Выдать/снять админку (2026-07-21, разворот решения 11.07): рубеж — сервер. */
  setAdminUser(id: string, isAdmin: boolean): Promise<void>;
  /** Кусок C: метрики роста (регистрации/посещения/скачивания по дням). */
  getAdminGrowth(days?: number): Promise<AdminGrowth>;
  /** Кусок C: ошибки клиентов — серия, топ по stackHash, фильтры kind/версия.
   *  `limit` — длина топа (дефолт 20, сервер клампит 1..100). */
  getAdminErrors(opts?: {
    days?: number;
    kind?: string;
    appVersion?: string;
    limit?: number;
    /** Показать сборки разработки (версия с суффиксом `-dev`). По умолчанию их
     *  нет: клиент помечает dev-сборку сам, а вкладка про неё не знает, пока не
     *  попросят. Разбор — docs/notes/2026-08-11-разбор-ошибок-на-проде.md. */
    includeDev?: boolean;
  }): Promise<AdminErrors>;
  /** Очистка ошибок под текущими фильтрами (без фильтров = все). Возврат — сколько удалено.
   *  `includeDev` обязан совпадать с тем, что показывает вкладка: кнопка чистит
   *  ровно видимое, а не заодно и скрытое. */
  clearAdminErrors(opts?: { kind?: string; appVersion?: string; includeDev?: boolean }): Promise<{ deleted: number }>;
  /** Удаление одной группы ошибок по stackHash. */
  deleteAdminErrorGroup(stackHash: string): Promise<{ deleted: number }>;
}

// Мока api-клиента здесь СОЗНАТЕЛЬНО нет: MockMuzaApi реализовывал весь
// интерфейс MuzaApi и подключался одной строкой — при этом отдавал выдуманные
// «Mock Artist»/«Mock Song». В проде он не инстанцировался ни разу (мёртвый
// код), но оставался миной на релизной кодовой базе. Тесты мокают api точечно,
// каждый под свой сценарий (см. views/PlaylistView.test.tsx).
export { HttpMuzaApi, ApiError, humanError } from "./http";
