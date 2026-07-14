import type { MetadataRoute } from "next";

// output: "export" (статический экспорт) требует явного force-static для
// файловых route-хендлеров вроде manifest.ts — иначе сборка падает
// ("dynamic/revalidate не настроен для /manifest.webmanifest").
export const dynamic = "force-static";

/** PWA-манифест (T39). Next 16 App Router отдаёт его сам по
 *  `/manifest.webmanifest` + линкует `<link rel="manifest">` в `<head>`
 *  автоматически — руками в layout.tsx ничего добавлять не нужно.
 *  Иконки — растеризованы из `packages/ui/src/assets/logo/icon.png`
 *  (256×256, уже с тёмным фоном и скруглением) скриптом на PIL, т.к. `sharp`
 *  отключён для веба (`pnpm-workspace.yaml`) и в системе нет ImageMagick —
 *  512 неизбежно апскейл ×2 (LANCZOS), не идеальная резкость, но приемлемо
 *  для PWA-иконки. `theme_color`/`background_color` — тёмный `--bg-0` (совпадает
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
