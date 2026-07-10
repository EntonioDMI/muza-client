/**
 * @muza/api-client — типизированный контракт API Muza.
 * Stage 1: интерфейс + мок-реализация (сервера ещё нет, появится в Stage 2).
 */

import type {
  Annotations,
  Credentials,
  HistoryItem,
  Lyrics,
  PlaylistDetail,
  PlaylistMeta,
  RecipeEnvelope,
  RegisterStatus,
  SearchScope,
  Session,
  Track,
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

  // Каталог (Stage 2, слайс 3). Требует серверной сессии (аноним — локальный,
  // сервер его не знает → поиск недоступен).
  search(query: string, opts?: { scope?: SearchScope; limit?: number }): Promise<Track[]>;
  getTrack(id: string): Promise<Track>;

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

  /** Горячий рецепт добычи (Stage 2, слайс 6); применяется клиентом в Stage 3. */
  getRecipe(): Promise<RecipeEnvelope>;
}

export { MockMuzaApi } from "./mock";
export { HttpMuzaApi, ApiError } from "./http";
