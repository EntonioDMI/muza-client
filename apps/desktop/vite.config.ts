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
