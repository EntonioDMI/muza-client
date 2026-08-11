import type { Metadata, Viewport } from "next";
import "@muza/ui/styles.css";
import "./globals.css";
import { Providers } from "../src/providers";

/** PWA-минимум (T39): apple-touch-icon + apple-mobile-web-app-* мета — iOS не
 *  читает `manifest.ts` для «Добавить на экран Домой» (Chrome/Android — читает),
 *  нужны отдельные Apple-теги. `manifest: "/manifest.webmanifest"` — линк на
 *  манифест из app/manifest.ts (Next отдаёт файл по этому пути сам). */
export const metadata: Metadata = {
  title: "Muza",
  description: "Muza — веб-плеер: тексты-герой, без цензуры, тотальная кастомизация.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    // Next 16 при capable: true эмитит ТОЛЬКО стандартный
    // <meta name="mobile-web-app-capable"> (проверено по out/ 16.07.2026),
    // а iOS <16.4 понимает лишь легаси-имя apple-mobile-web-app-capable и без
    // него открывает «на экран Домой» с хромом Safari — поэтому легаси-мета
    // добавлена руками через `other` ниже. Современный iOS берёт standalone
    // из display манифеста, ему обе меты не нужны.
    capable: true,
    title: "Muza",
    statusBarStyle: "black-translucent",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

/** `viewportFit: "cover"` явно включает safe-area-inset-* в CSS (уже
 *  используются в globals.css) под чёлкой/home-indicator iPhone.
 *  `themeColor` — тёмный `--bg-0`, красит статус-бар/адресную строку.
 *
 *  ⚠️ ЧИСЛО — КОПИЯ ТОКЕНА --bg-0 (packages/ui/src/tokens/colors.css), и
 *  копией оно быть ОБЯЗАНО: meta-тег читает браузер до всякого CSS, var() тут
 *  не работает. Значит копия молча расходится — и разошлась: токен уехал на
 *  #0a0908, а здесь до 11.08.2026 стояло #121110. Панели браузера красились не
 *  тем цветом, что окно приложения, и стык был виден на телефоне.
 *  Меняешь --bg-0 — меняй и здесь. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0908",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
        {/* app-shell SW — только в production: в dev закэшировал бы
            нехэшированные чанки (инварианты кэша — в public/sw.js) */}
        {process.env.NODE_ENV === "production" && <script src="/sw-register.js" defer />}
      </body>
    </html>
  );
}
