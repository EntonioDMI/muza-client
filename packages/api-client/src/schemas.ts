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
