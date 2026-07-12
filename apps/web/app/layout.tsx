import type { Metadata } from "next";
import "@muza/ui/styles.css";
import "./globals.css";
import { Providers } from "../src/providers";

export const metadata: Metadata = {
  title: "Muza",
  description: "Muza — веб-плеер: тексты-герой, без цензуры, тотальная кастомизация.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
