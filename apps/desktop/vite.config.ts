import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri ожидает фиксированный порт; strictPort валит запуск при занятом порте,
// чтобы не получить белый экран из-за расхождения с devUrl в tauri.conf.json.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // ⚠️ IPv4 ЯВНО. Без этого Vite 8 на Windows слушает ТОЛЬКО [::1]:1420
    // (проверено netstat 15.08), а `devUrl` в tauri.conf.json — «localhost»,
    // который здесь резолвится в 127.0.0.1. Результат: Vite рапортует «ready»,
    // а tauri dev до бесконечности печатает «Waiting for your frontend dev
    // server to start» и окно не открывается вовсе. Симптом выглядит как
    // зависшая сборка Rust, хотя Rust ни при чём.
    host: "127.0.0.1",
    // Не сторожить Rust-таргеты: cargo пишет туда во время сборки → EBUSY у Vite-вотчера.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_"],
  build: {
    target: "es2022",
  },
});
