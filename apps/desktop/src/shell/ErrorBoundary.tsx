import { Component, type ErrorInfo, type ReactNode } from "react";
import { errorReporter } from "../lib/errorReporter";

/** Крашскрин вместо белого экрана (админ-панель, кусок A). Класс — функционных
 *  ErrorBoundary у React нет. Текст двуязычный и БЕЗ useT: i18n сам мог быть
 *  причиной падения, крашскрин не должен зависеть ни от чего. Репорт уходит
 *  немедленно через urgent-путь useErrorTelemetry — если согласие включено. */

interface Props {
  children: ReactNode;
  /** Тестовый шов; по умолчанию — синглтон errorReporter. */
  onError?: (error: unknown) => void;
}

export class ErrorBoundary extends Component<Props, { broken: boolean }> {
  state = { broken: false };

  static getDerivedStateFromError(): { broken: boolean } {
    return { broken: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    (this.props.onError ?? errorReporter.reportReactError)(error);
  }

  render(): ReactNode {
    if (!this.state.broken) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--sp-4, 16px)",
          padding: "var(--sp-6, 24px)",
          background: "var(--surface-0, #0f0f13)",
          color: "var(--text-1, #f2f2f5)",
          fontFamily: "var(--font-body, sans-serif)",
          textAlign: "center",
        }}
      >
        <div aria-hidden style={{ fontSize: 42 }}>💥</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Муза сломалась · Muza crashed</div>
        <div style={{ fontSize: 14, color: "var(--text-3, #9a9aa5)", maxWidth: 440 }}>
          Попробуй перезапустить окно — обычно этого хватает.
          <br />
          Try reloading the window — that usually helps.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 22px",
            borderRadius: "var(--r-md, 10px)",
            border: "none",
            background: "var(--accent, #7c5cff)",
            color: "var(--accent-contrast, #fff)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Перезапустить · Reload
        </button>
      </div>
    );
  }
}
