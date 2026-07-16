/* Минимальный app-shell service worker (бриф T3-B, 16.07.2026).
 *
 * Зачем: полная installability-подсказка Chrome без предупреждений,
 * мгновенный старт установленного PWA и офлайн-оболочка. Аудио, API и всё
 * кросс-доменное SW сознательно НЕ трогает.
 *
 * Инварианты (не ломать!):
 * - HTML, манифест и все нехэшированные пути — ТОЛЬКО network-first:
 *   деплой-своп /var/www/muza-web не должен залипать в кэше (урок
 *   логотип-дрифта 13.07: cache-first на /icons/* пришпилил бы старый
 *   логотип до смены CACHE_VERSION);
 * - cache-first разрешён ТОЛЬКО для /_next/static/ — Next контент-хэширует
 *   эти имена, содержимое под URL не меняется никогда;
 * - чужие origin'ы (api.muza.lol, стрим-URL) пропускаются мимо SW целиком;
 * - в кэш кладём только status 200 (Cache.put кидает на 206 Range-ответах);
 * - смена CACHE_VERSION инвалидирует всё старое на activate.
 */
const CACHE_VERSION = "muza-web-sw-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(["/"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh.status === 200) cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // офлайн-навигация без точного кэша — отдаём оболочку
    if (request.mode === "navigate") {
      const shell = await cache.match("/");
      if (shell) return shell;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.status === 200) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
