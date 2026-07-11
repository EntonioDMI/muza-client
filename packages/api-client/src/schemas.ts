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

/** Плейлист в списке (без треков). */
export const PlaylistMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  trackCount: z.number(),
  createdAt: z.string(),
});
export type PlaylistMeta = z.infer<typeof PlaylistMetaSchema>;

export const PlaylistDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  tracks: z.array(TrackSchema),
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

/** Аннотация Genius: lineIdx привязывает объяснение к строке synced-текста. */
export const AnnotationSchema = z.object({
  fragment: z.string(),
  body: z.string(),
  votes: z.number(),
  verified: z.boolean(),
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
