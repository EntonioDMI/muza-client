/**
 * @muza/api-client — типизированный контракт API Muza.
 * Stage 1: интерфейс + мок-реализация (сервера ещё нет, появится в Stage 2).
 */

import type { Credentials, RegisterStatus, SearchScope, Session, Track } from "./schemas";

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

  // Каталог (Stage 2, слайс 3). Требует серверной сессии (аноним — локальный,
  // сервер его не знает → поиск недоступен).
  search(query: string, opts?: { scope?: SearchScope; limit?: number }): Promise<Track[]>;
  getTrack(id: string): Promise<Track>;
}

export { MockMuzaApi } from "./mock";
export { HttpMuzaApi, ApiError } from "./http";
