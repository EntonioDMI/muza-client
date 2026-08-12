import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@muza/app/lib/queryClient";
import { App } from "./App";
import { MiniPlayer } from "./mini/MiniPlayer";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { errorReporter } from "./lib/errorReporter";
import { initDurableState } from "./lib/durableState";
import "./app.css";

// Слушатели ошибок — ДО первого рендера: падение на старте тоже попадает в
// буфер и уйдёт с телеметрией, когда App поднимет useErrorTelemetry (кусок A).
errorReporter.install(window);

// Окно "mini" грузит тот же index.html — режим выбирается по метке окна
// (надёжнее URL-параметров: dev и prod грузят одинаковый адрес)
const isMini = isTauri() && getCurrentWebviewWindow().label === "mini";

// Сессия/prefs — из долговечного файла-зеркала, ДО рендера: App читает prefs
// при монтировании, а api-client — сессию. Иначе после «завершить задачу»
// LevelDB WebView2 отдаёт устаревшее (durableState.ts — почему это важно).
// Клиент запросов ОДИН на окно и создаётся ВНЕ рендера: созданный внутри, он
// пересоздавался бы на каждой перерисовке корня и терял бы весь кэш — то есть
// не делал бы ровно того, ради чего заведён (см. lib/queryClient.ts).
const queryClient = createQueryClient();

void initDurableState().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>{isMini ? <MiniPlayer /> : <App />}</ErrorBoundary>
      </QueryClientProvider>
    </React.StrictMode>,
  );
});

