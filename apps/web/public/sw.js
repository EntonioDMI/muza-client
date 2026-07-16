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
 *
 * Почему app-shell дотягивается явно (syncShellAssets), а не копится сам:
 * Chrome отдаёт повторные сабресурсы (JS-чанки) из memory cache МИМО
 * fetch-события SW — «прозрачно» кэш не наполнится никогда (проверено
 * Playwright-прогоном 16.07: шрифты в кэше, чанки — нет). Поэтому после
 * каждой успешной online-навигации SW сам выкачивает недостающие
 * /_next/static-ссылки из свежего HTML; хэшированные имена делают это
 * дёшево (после деплоя — одна волна, дальше всё уже в кэше). Старые хэши
 * копятся до смены CACHE_VERSION — сознательно: чистка по списку одной
 * страницы снесла бы чанки других страниц экспорта.
 */
const CACHE_VERSION = "muza-web-sw-v1";

/** Boot-маршруты оболочки. "/login" обязателен: неавторизованное приложение
 *  сразу редиректит "/" → "/login", и без него офлайн-старт зацикливается
 *  (фолбэк отдаёт "/", тот снова редиректит — воспроизведено Playwright 16.07).
 *  Если маршрут переедет — install его тихо пропустит (catch ниже). */
const SHELL_ROUTES = ["/", "/login"];

/** Дотянуть в кэш ассеты оболочки, которых ещё нет (по ссылкам из HTML). */
async function syncShellAssets(cache, html) {
  const refs = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]);
  const missing = [];
  for (const url of new Set(refs)) {
    if (!(await cache.match(url))) missing.push(url);
  }
  if (missing.length) await cache.addAll(missing);
}

async function precacheShellRoute(cache, route) {
  const shell = await fetch(route);
  if (shell.status !== 200) return;
  await cache.put(route, shell.clone());
  await syncShellAssets(cache, await shell.text());
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.all(
          // офлайн-бонус не должен ронять установку SW
          SHELL_ROUTES.map((route) => precacheShellRoute(cache, route).catch(() => undefined)),
        ),
      )
      .catch(() => undefined)
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
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request).then((response) => {
        // online-навигация — момент досинхронизировать оболочку под свежий
        // деплой (см. шапку файла: сам по себе кэш чанков не наполнится)
        if (response.status === 200) {
          const copy = response.clone();
          event.waitUntil(
            copy
              .text()
              .then((html) => caches.open(CACHE_VERSION).then((cache) => syncShellAssets(cache, html)))
              .catch(() => undefined),
          );
        }
        return response;
      }),
    );
    return;
  }
  event.respondWith(networkFirst(request));
});
