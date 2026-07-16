import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { App } from "./App";
import { MiniPlayer } from "./mini/MiniPlayer";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { errorReporter } from "./lib/errorReporter";
import "./app.css";

// Слушатели ошибок — ДО первого рендера: падение на старте тоже попадает в
// буфер и уйдёт с телеметрией, когда App поднимет useErrorTelemetry (кусок A).
errorReporter.install(window);

// Окно "mini" грузит тот же index.html — режим выбирается по метке окна
// (надёжнее URL-параметров: dev и prod грузят одинаковый адрес)
const isMini = isTauri() && getCurrentWebviewWindow().label === "mini";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>{isMini ? <MiniPlayer /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
