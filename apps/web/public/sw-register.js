/* Регистрация app-shell SW (см. public/sw.js — там инварианты кэширования).
 * Подключается из app/layout.tsx только в production-сборке: в dev SW
 * закэшировал бы нехэшированные чанки next dev и отравил горячую перезагрузку. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
