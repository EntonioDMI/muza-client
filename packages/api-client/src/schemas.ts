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
});
export type Track = z.infer<typeof TrackSchema>;

/** full — каталог + внешние провайдеры (медленно, rate-limit);
 *  catalog — мгновенно, только по накопленной базе (живой ввод). */
export type SearchScope = "full" | "catalog";
