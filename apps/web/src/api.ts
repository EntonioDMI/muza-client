import { HttpMuzaApi } from "@muza/api-client";

/** Единый API-клиент веба. Реюз HttpMuzaApi десктопа как есть: localStorage
 *  в браузере работает так же, origin другой (tauri://localhost ≠ веб-домен),
 *  так что сессии десктопа и веба не пересекаются. */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

let api: HttpMuzaApi | null = null;

export function getApi(): HttpMuzaApi {
  if (!api) api = new HttpMuzaApi(API_URL);
  return api;
}
