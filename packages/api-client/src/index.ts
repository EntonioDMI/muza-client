/**
 * @muza/api-client — типизированный контракт API Muza.
 * Stage 1: интерфейс + мок-реализация (сервера ещё нет, появится в Stage 2).
 */

import type { Credentials, Session } from "./schemas";

export * from "./schemas";

export interface MuzaApi {
  /** Анонимный вход: аккаунт-на-устройстве, без синхронизации между устройствами. */
  loginAnonymous(): Promise<Session>;
  login(credentials: Credentials): Promise<Session>;
  register(credentials: Credentials): Promise<Session>;
  logout(): Promise<void>;
  /** Восстановить сессию из локального хранилища (если была). */
  restoreSession(): Promise<Session | null>;
}

export { MockMuzaApi } from "./mock";
