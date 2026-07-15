import type { MetadataRoute } from "next";

// output: "export" (статический экспорт) требует явного force-static для
// файловых route-хендлеров вроде manifest.ts — иначе сборка падает
// ("dynamic/revalidate не настроен для /manifest.webmanifest").
export const dynamic = "force-static";

/** PWA-манифест (T39). Next 16 App Router отдаёт его сам по
 *  `/manifest.webmanifest` + линкует `<link rel="manifest">` в `<head>`
 *  автоматически — руками в layout.tsx ничего добавлять не нужно.
 *  Иконки (вместе с `/icons/apple-touch-icon.png`) растеризованы из
 *  `apps/desktop/src-tauri/app-icon.svg` — того же источника, из которого собран
 *  иконочный набор десктопа; так веб и приложение не разъезжаются, и 512 берётся
 *  из вектора без апскейла. Растеризовать из `packages/ui/src/assets/logo/icon.png`
 *  НЕЛЬЗЯ: этот файл отстал на смене логотипа 13.07 и уже однажды вернул сюда
 *  старую молнию. `theme_color`/`background_color` — тёмный `--bg-0` (совпадает
 *  с фоном самой иконки). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Muza",
    short_name: "Muza",
    description: "Muza — веб-плеер: тексты-герой, без цензуры, тотальная кастомизация.",
    start_url: "/",
    display: "standalone",
    background_color: "#121110",
    theme_color: "#121110",
    lang: "ru",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
