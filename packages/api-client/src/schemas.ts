import { z } from "zod";

/** Контракт API Muza (Zod). Реализация живёт в приватном muza-server;
 *  здесь — публичные схемы и типы. */

export const UserSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  /** Анонимная сессия: аккаунт привязан к устройству, без синхронизации. */
  anonymous: z.boolean(),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const SessionSchema = z.object({
  user: UserSchema,
  accessToken: z.string(),
  refreshToken: z.string().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

export const CredentialsSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(128),
});
export type Credentials = z.infer<typeof CredentialsSchema>;

/** Email для verify-before-create регистрации (опционален по PII-минимизации). */
export const EmailSchema = z.email();

/** Статус заявки на регистрацию с почтой (поллится экраном «проверь почту»). */
export const RegisterStatusSchema = z.enum(["pending", "verified", "expired", "notfound"]);
export type RegisterStatus = z.infer<typeof RegisterStatusSchema>;

/** Результат POST /auth/email/start (T3). confirmUrl приходит ТОЛЬКО в
 *  dev-фолбэке сервера — SMTP выключен (нет пароля) и NODE_ENV не production,
 *  реальное письмо не ушло, ссылку иначе негде увидеть кроме серверного лога.
 *  В production и при реальной отправке — поле отсутствует. */
export const EmailChangeStartResultSchema = z.object({
  confirmUrl: z.string().optional(),
});
export type EmailChangeStartResult = z.infer<typeof EmailChangeStartResultSchema>;

/** Канонический трек каталога (одна строка на реальную песню; id — строка,
 *  BigInt сервера не влезает в number). */
export const TrackSchema = z.object({
  id: z.string(),
  artist: z.string(),
  title: z.string(),
  durationSec: z.number(),
  coverUrl: z.string().nullable(),
  /** Есть в серверном аудио-кэше (фолбэк-путь). */
  isCached: z.boolean(),
  /** Живые провайдеры-источники, например ["youtube","soundcloud"]. */
  sources: z.array(z.string()),
  /** Integrated loudness (EBU R128, LUFS); null = не измерена. */
  loudness: z.number().nullable(),
  /** Хэш локального источника (Stage 4): трек привязан к файлу на устройстве;
   *  null — обычный стриминговый трек. */
  localHash: z.string().nullable().default(null),
});
export type Track = z.infer<typeof TrackSchema>;

/** Живой источник трека: из него клиент добывает байты на своём IP (Stage 3).
 *  Источники приходят по убыванию priority — пробовать сверху вниз.
 *  Stage 4: id/kind/durationSec/isChosen — для разворота «Версии и источники»
 *  (выбранный пользователем источник сервер кладёт первым). */
export const TrackSourceSchema = z.object({
  /** TrackSource.id сервера — нужен для «выбрать этот источник». */
  id: z.string().default(""),
  provider: z.string(), // youtube | soundcloud | bandcamp | local
  sourceId: z.string(),
  url: z.string(),
  priority: z.number(),
  /** catalog — авто-матч; direct — вставленная ссылка; local — файл на устройстве. */
  kind: z.string().default("catalog"),
  durationSec: z.number().default(0),
  isChosen: z.boolean().default(false),
});
export type TrackSource = z.infer<typeof TrackSourceSchema>;

/** Отчёт импорта плейлиста (Stage 4): что нашли в каталоге, что — нет. */
export interface ImportReport {
  playlist: PlaylistMeta;
  total: number;
  matched: number;
  unmatched: { artist: string; title: string }[];
}

/** full — каталог + внешние провайдеры (медленно, rate-limit);
 *  catalog — мгновенно, только по накопленной базе (живой ввод). */
export type SearchScope = "full" | "catalog";

// ── Группировка ремиксов/версий в поиске (T36 сервера, T41 клиента) ───────
// ?group=1 — форма ответа /search меняется с плоского Track[] на
// GroupedSearchResult[] (два вида: group|single). Точная форма — зеркало
// muza-server/src/catalog/dto.ts (GroupResultOut/SingleResultOut/
// GroupedSearchResponse); snake_case проводной формы разбирается в http.ts.

/** Категория версии/ремикса (parseVariant сервера): словарь из 12 типов,
 *  декорации тайтла ru+en. "8d" — единственный не-slug-подобный литерал,
 *  зеркалит серверный VariantType буквально. */
export const VariantTypeSchema = z.enum([
  "remix",
  "sped_up",
  "slowed",
  "mashup",
  "cover",
  "live",
  "acoustic",
  "instrumental",
  "karaoke",
  "8d",
  "bass_boosted",
  "tiktok",
]);
export type VariantType = z.infer<typeof VariantTypeSchema>;

/** Один вариант внутри карточки-группы: сам трек + его категория. */
export const GroupVariantSchema = z.object({
  track: TrackSchema,
  variantType: VariantTypeSchema,
});
export type GroupVariant = z.infer<typeof GroupVariantSchema>;

/** Карточка-группа: оригинал/канон + его версии одной строкой выдачи.
 *  hasOriginal=false — трека БЕЗ variantType в выдаче не нашлось, canonical
 *  тогда — заглушка (лучший из вариантов), canonicalVariantType объясняет
 *  её собственную категорию (иначе null). */
export const GroupSearchResultSchema = z.object({
  kind: z.literal("group"),
  canonical: TrackSchema,
  hasOriginal: z.boolean(),
  canonicalVariantType: VariantTypeSchema.nullable(),
  variants: z.array(GroupVariantSchema),
});
export type GroupSearchResult = z.infer<typeof GroupSearchResultSchema>;

/** Нераспознанная строка — трек без пары, идёт в выдаче как обычно (хвост —
 *  только для декорированных одиночек, см. дизайн-док). */
export const SingleSearchResultSchema = z.object({
  kind: z.literal("single"),
  track: TrackSchema,
});
export type SingleSearchResult = z.infer<typeof SingleSearchResultSchema>;

/** Элемент ответа группированного поиска — ДВУХ видов (дискриминатор kind). */
export const GroupedSearchResultSchema = z.discriminatedUnion("kind", [
  GroupSearchResultSchema,
  SingleSearchResultSchema,
]);
export type GroupedSearchResult = z.infer<typeof GroupedSearchResultSchema>;

/** Плейлист в списке (без треков). Stage 7: свои + совместные
 *  (role=collaborator — вошёл по инвайт-коду). */
export const PlaylistMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  trackCount: z.number(),
  createdAt: z.string(),
  role: z.enum(["owner", "collaborator"]).default("owner"),
  ownerUsername: z.string().default(""),
  collaboratorsCount: z.number().default(0),
  /** T47: id иконки-обложки из манифеста @muza/core ("pi-01".."pi-38");
   *  null — без иконки (клиент рисует фолбэк). */
  icon: z.string().nullable().default(null),
});
export type PlaylistMeta = z.infer<typeof PlaylistMetaSchema>;

export const PlaylistDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  tracks: z.array(TrackSchema),
  // Stage 7: совместный доступ
  isOwner: z.boolean().default(true),
  ownerUsername: z.string().default(""),
  /** Инвайт-код приходит только владельцу; null = кода нет / не владелец. */
  inviteCode: z.string().nullable().default(null),
  collaborators: z.array(z.object({ id: z.string(), username: z.string() })).default([]),
  /** Кто добавил трек (совместным видно): trackId → username. */
  addedBy: z.record(z.string(), z.string()).default({}),
  /** T47: id иконки-обложки из манифеста @muza/core ("pi-01".."pi-38");
   *  null — без иконки (клиент рисует фолбэк). */
  icon: z.string().nullable().default(null),
});
export type PlaylistDetail = z.infer<typeof PlaylistDetailSchema>;

export const HistoryItemSchema = z.object({
  track: TrackSchema,
  playedAt: z.string(),
  completed: z.boolean(),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

/** Синхронизированная строка текста (LRC). */
export const SyncedLineSchema = z.object({ t: z.number(), line: z.string() });
export type SyncedLineOut = z.infer<typeof SyncedLineSchema>;

export const LyricsSchema = z.object({
  synced: z.array(SyncedLineSchema).nullable(),
  plain: z.string().nullable(),
  source: z.string().nullable(),
});
export type Lyrics = z.infer<typeof LyricsSchema>;

/** Картинка внутри аннотации Genius. Сервер вынимает её из dom-версии тела и
 *  вычищает URL из текста; клиент рисует картинку под объяснением.
 *  `src` — абсолютный https на CDN Genius, `caption` — подпись из <small>. */
export const AnnotationImageSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  caption: z.string().optional(),
});
export type AnnotationImage = z.infer<typeof AnnotationImageSchema>;

/** Аннотация Genius: lineIdx привязывает объяснение к строке synced-текста. */
export const AnnotationSchema = z.object({
  fragment: z.string(),
  body: z.string(),
  votes: z.number(),
  verified: z.boolean(),
  /** Пусто у аннотаций без картинок И у записей серверного кэша, снятых до
   *  этой фичи (в их payload поля нет — `default([])` держит контракт). Кэш
   *  аннотаций версии не имеет, поэтому обе формы обязаны жить одновременно. */
  images: z.array(AnnotationImageSchema).default([]),
  lineIdx: z.number().nullable(),
  lineCount: z.number(),
  lineIdxs: z.array(z.number()),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export interface Annotations {
  geniusUrl: string | null;
  annotations: Annotation[] | null;
}

/** Анонимный агрегат телеметрии (Stage 3): счётчики добычи (KPI SABR/403)
 *  и прослушиваний за окно отправки. Без каких-либо идентификаторов. */
export interface TelemetryStats {
  appVersion: string;
  recipeVersion: number;
  resolveOk: number;
  resolveFail: number;
  attempts: number;
  cacheHits: number;
  fail403: number;
  failBot: number;
  failFormat: number;
  failOther: number;
  plays: number;
  playsCompleted: number;
}

/** Батч клиентских ошибок (админ-панель, кусок A) — POST /telemetry/error.
 *  Та же анонимность, что TelemetryStats: без идентификаторов; стек не уходит
 *  с клиента вовсе — только его хэш для группировки. */
export interface ClientErrorBatch {
  appVersion: string;
  errors: {
    kind: "error" | "unhandledrejection" | "react";
    message: string;
    stackHash: string;
    count: number;
  }[];
}

/** Конверт горячего рецепта: recipe + Ed25519-подпись. Клиент (Stage 3)
 *  верифицирует вшитым pubkey и без валидной подписи не применяет. */
export interface RecipeEnvelope {
  recipe: Record<string, unknown> & { recipe_version: number };
  sig: string;
}

/** Статус внешнего скробблинга (настройки → Интеграции).
 *  available=false у Last.fm — на сервере не вписаны API-ключи. */
export interface ScrobblingStatus {
  lastfm: { available: boolean; connected: boolean; username: string | null };
  listenbrainz: { connected: boolean; username: string | null };
}

// ── Рекомендации и лента (Stage 5) ─────────────────────────────────

/** Секция главной: for_you, because_N («Потому что вы любите X»),
 *  trending, new. Треки уже дедуплицированы сервером между секциями. */
export interface HomeSection {
  key: string;
  title: string;
  tracks: Track[];
}

/** Эффективные ручки рекомендаций + границы слайдеров.
 *  epsilon — доля исследования (ε-greedy, «новизна»); tauScale — множитель
 *  τ свежести («как часто возвращать любимое»: меньше = чаще). */
export interface RecsSettings {
  epsilon: number;
  tauScale: number;
  epsilonMax: number;
  tauScaleMin: number;
  tauScaleMax: number;
}

// ── Маркетплейс тем (Stage 6) ──────────────────────────────────────

/** Опубликованная тема оформления. payload — токены клиента (THEME_KEYS
 *  + customCss); клиент фильтрует чужие поля при установке. */
export interface MarketTheme {
  id: string;
  name: string;
  author: string;
  installs: number;
  createdAt: string;
  payload: Record<string, unknown>;
  /** Опубликована текущим пользователем — можно снять с публикации. */
  isMine: boolean;
  /** Скрыта модерацией/жалобами (в списке видна только автору). */
  hidden: boolean;
}

// ── Маркетплейс плагинов (эпик W8, T45a) ───────────────────────────

/** Опубликованный плагин. payload = { manifest, code, css?, strings? } —
 *  install ставит целиком через рантайм T44/T44b (@muza/core parsePluginManifest
 *  + scanPluginScript/scanPluginCss на клиенте, сервер это не гарантирует
 *  бесплатно — см. muza-server/src/market/market-plugin.controller.ts). */
export interface MarketPlugin {
  id: string;
  /** manifest.id плагина — путь установки на клиенте, глобально уникален. */
  pluginId: string;
  name: string;
  author: string;
  version: string;
  installs: number;
  createdAt: string;
  payload: Record<string, unknown>;
  /** app:full-access в манифесте — бейдж «Полный доступ» в витрине. */
  fullAccess: boolean;
  /** На премодерации (только full-access); видно всем, кроме автора — false. */
  pending: boolean;
  /** Опубликован текущим пользователем — можно снять с публикации. */
  isMine: boolean;
  /** Скрыт модерацией/жалобами (в списке видна только автору). */
  hidden: boolean;
}

// ── Сессии и устройства (настройки → Аккаунт) ─────────────────────

/** Активная сессия (refresh-строка); createdAt = последняя активность
 *  устройства (ротация создаёт свежую строку на каждый refresh). */
export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  /** Сессия, которой сделан этот запрос. */
  current: boolean;
}

// ── Jam: слушать вместе (Stage 7) ──────────────────────────────────

export interface JamMember {
  id: string;
  username: string;
}

/** Состояние воспроизведения хоста. trackId=null — хост слушает трек,
 *  недоступный гостям (демо/локальный): гость на паузе с подписью. */
export interface JamState {
  trackId: string | null;
  title: string;
  artist: string;
  coverUrl: string | null;
  durationSec: number;
  posSec: number;
  playing: boolean;
  /** epoch ms сервера — гость экстраполирует позицию от этой отметки. */
  updatedAt: number;
}

export interface JamSnapshot {
  code: string;
  host: JamMember;
  members: JamMember[];
  state: JamState | null;
  isHost: boolean;
}

/** События SSE-потока jam. Первым всегда приходит snapshot. */
export type JamEvent =
  | { type: "snapshot"; snapshot: JamSnapshot }
  | { type: "state"; state: JamState }
  | { type: "members"; members: JamMember[] }
  | { type: "queueAdd"; track: Track; by: string }
  | { type: "ended" };

// ── Wrapped «Итоги года» (Stage 7) ─────────────────────────────────

export interface Wrapped {
  year: number;
  totalPlays: number;
  totalMs: number;
  uniqueTracks: number;
  uniqueArtists: number;
  activeDays: number;
  longestStreakDays: number;
  peakDay: { date: string; ms: number } | null;
  /** Час суток (0–23, в поясе пользователя) с максимумом прослушиваний. */
  topHour: number | null;
  favoritesAdded: number;
  topTracks: { track: Track; plays: number; playedMs: number }[];
  topArtists: { artist: string; plays: number; playedMs: number }[];
  /** Первый completed-трек года — «год начался с…». */
  firstTrack: Track | null;
  firstPlayAt: string | null;
}

// ── Статистика: страница «Статистика» ─────────────────────────────

export type StatsPeriod = "week" | "month" | "year" | "all";

export interface StatsOverview {
  period: StatsPeriod;
  totalPlays: number;
  totalMs: number;
  uniqueTracks: number;
  uniqueArtists: number;
  /** Серия активности: вёдра-дни (week/month, YYYY-MM-DD) или месяцы
   *  (year/all, YYYY-MM), пустые — нулями. */
  series: { bucket: string; plays: number; ms: number }[];
  /** Прослушивания по часам суток (24 значения, пояс пользователя). */
  hours: number[];
  topHour: number | null;
  topTracks: { track: Track; plays: number; playedMs: number }[];
  topArtists: { artist: string; plays: number; playedMs: number }[];
  activeDays: number;
  /** Текущая серия дней — по всей истории, не зависит от периода. */
  currentStreakDays: number;
  longestStreakDays: number;
  favoritesAdded: number;
}

// ── Админ-панель (Stage 5) ─────────────────────────────────────────

export interface AdminOverview {
  users: { total: number; withEmail: number; admins: number; new7d: number };
  listeners: { dau: number; wau: number; mau: number };
  plays: { today: number; week: number; total: number; completedWeek: number };
  catalog: { tracks: number; sources: number; deadSources: number; cached: number };
}

export interface AdminContent {
  topTracks: { track: Track; plays: number }[];
  topArtists: { artist: string; plays: number }[];
  recentTracks: Track[];
  sourcesByProvider: { provider: string; kind: string; count: number; dead: number }[];
  coverage: { tracks: number; withLyrics: number; withSynced: number; withAnnotations: number };
}

/** Здоровье добычи: агрегаты анонимной телеметрии (KPI SABR/403). */
export interface AdminHealth {
  windowHours: number;
  totals: {
    reports: number;
    resolveOk: number;
    resolveFail: number;
    attempts: number;
    cacheHits: number;
    fail403: number;
    failBot: number;
    failFormat: number;
    failOther: number;
    plays: number;
    playsCompleted: number;
    /** null — резолвов в окне не было. */
    successRate: number | null;
    cacheHitRate: number | null;
  };
  byRecipe: { recipeVersion: number; reports: number; ok: number; fail: number; successRate: number | null }[];
  byApp: { appVersion: string; reports: number; ok: number; fail: number }[];
  /** Текущая версия горячего рецепта на сервере (view-only). */
  recipeVersion: number;
}

/** Минимум PII: email не приходит вовсе — только факт его наличия. */
export interface AdminUsers {
  total: number;
  users: {
    id: string;
    username: string;
    hasEmail: boolean;
    isAdmin: boolean;
    createdAt: string;
    plays30d: number;
    lastPlayAt: string | null;
  }[];
}

/** Точка дневной серии админ-метрик (кусок C): bucket — YYYY-MM-DD (UTC). */
export interface AdminDayPoint {
  bucket: string;
  count: number;
}

/** Метрики роста (кусок C): GET /admin/growth. Скачивания — снапшоты
 *  download_count из GitHub Releases, серия — дневной прирост. */
export interface AdminGrowth {
  days: number;
  registrations: AdminDayPoint[];
  visits: AdminDayPoint[];
  downloads: {
    total: number;
    byAsset: { tag: string; asset: string; count: number }[];
    series: AdminDayPoint[];
  };
}

/** Ошибки клиентов (кусок C): GET /admin/errors. Серия и топ — под фильтрами;
 *  byKind/byApp — всегда за всё окно (источник значений для фильтров UI).
 *  message уже проскраблен сервером; стеков нет — только хэш группировки. */
export interface AdminErrors {
  days: number;
  totals: { count: number; distinct: number };
  series: AdminDayPoint[];
  top: {
    stackHash: string;
    kind: string;
    message: string;
    count: number;
    lastSeen: string;
    appVersions: string[];
  }[];
  byKind: { kind: string; count: number }[];
  byApp: { appVersion: string; count: number }[];
}
