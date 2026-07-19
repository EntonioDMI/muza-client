import { Component, type ErrorInfo, type ReactNode } from "react";
import { errorReporter } from "../lib/errorReporter";
// Рукописный плоский SVG (solid-заливки, без обводок — ДС): не генерация,
// Recraft упорно рисовал line-art, запрещённый ДС (жалоба 2026-07-17).
import crashVinyl from "../assets/crash-vinyl.svg";

/** Крашскрин вместо белого экрана (админ-панель, кусок A; редизайн 2026-07-17 —
 *  жалоба владельца: «выглядит как страница начинающего разработчика»).
 *
 *  ЖЕЛЕЗНОЕ ПРАВИЛО ФАЙЛА: не зависеть ни от чего, что могло упасть само.
 *  Никакого useT (i18n — кандидат в причины краша), никаких компонентов ДС —
 *  только инлайн-стили с fallback'ами токенов, локальный <style> и статичный
 *  ассет (webp превращается в URL на сборке, в рантайме это просто строка).
 *  Язык — прямым чтением prefs из localStorage под try/catch. Репорт уходит
 *  немедленно через urgent-путь useErrorTelemetry — если согласие включено. */

interface Props {
  children: ReactNode;
  /** Тестовый шов; по умолчанию — синглтон errorReporter. */
  onError?: (error: unknown) => void;
}

/** Язык крашскрина: prefs напрямую, битые/недоступные prefs — русский. */
function crashLang(): "ru" | "en" {
  try {
    const raw = window.localStorage.getItem("muza.prefs.v1");
    if (raw && (JSON.parse(raw) as { language?: string }).language === "en") return "en";
  } catch {
    /* localStorage/JSON подвели — не наша забота на крашскрине */
  }
  return "ru";
}

const COPY = {
  ru: {
    title: "Муза сломалась",
    hint: "Что-то пошло не так внутри плеера. Перезапусти окно — обычно этого хватает.",
    button: "Перезапустить",
  },
  en: {
    title: "Muza crashed",
    hint: "Something went wrong inside the player. Reload the window — that usually helps.",
    button: "Reload",
  },
} as const;

export class ErrorBoundary extends Component<Props, { broken: boolean; message: string | null }> {
  state = { broken: false, message: null };

  static getDerivedStateFromError(error: unknown): { broken: boolean; message: string | null } {
    const raw = error instanceof Error ? error.message : String(error);
    // короткая техническая строка внизу экрана: хватает, чтобы заскринить в багрепорт
    return { broken: true, message: raw ? raw.slice(0, 140) : null };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    (this.props.onError ?? errorReporter.reportReactError)(error);
  }

  render(): ReactNode {
    if (!this.state.broken) return this.props.children;
    const copy = COPY[crashLang()];
    return (
      <div
        role="alert"
        style={{
          position: "relative",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--sp-3, 12px)",
          padding: "var(--sp-6, 24px)",
          background: "var(--surface-0, #171614)",
          color: "var(--text-1, #f4f3f1)",
          fontFamily: "var(--font-ui, 'Golos Text', sans-serif)",
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        <style>{`
          @keyframes muzaCrashFloat {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            50% { transform: translateY(-12px) rotate(-2deg); }
          }
          .muza-crash__art { animation: muzaCrashFloat 7s ease-in-out infinite; }
          .muza-crash__btn { transition: filter 120ms ease-out, transform 120ms ease-out; }
          .muza-crash__btn:hover { filter: brightness(1.1); }
          .muza-crash__btn:active { transform: scale(0.98); }
          @media (prefers-reduced-motion: reduce) {
            .muza-crash__art { animation: none; }
          }
        `}</style>
        {/* Фирменные блобы лендинга — глубина без градиентных плашек: два мягких
            пятна брендовых цветов, размытые до состояния света. */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            width: "44vmax",
            height: "44vmax",
            top: "-14vmax",
            left: "-10vmax",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(247, 105, 103, 0.14) 0%, transparent 68%)",
            filter: "blur(24px)",
            pointerEvents: "none",
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            width: "50vmax",
            height: "50vmax",
            bottom: "-18vmax",
            right: "-12vmax",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(59, 130, 246, 0.13) 0%, transparent 68%)",
            filter: "blur(24px)",
            pointerEvents: "none",
          }}
        />
        <img
          className="muza-crash__art"
          src={crashVinyl}
          alt=""
          draggable={false}
          style={{ width: "min(280px, 38vh)", height: "min(280px, 38vh)", userSelect: "none" }}
        />
        <div
          style={{
            fontFamily: "var(--font-display, 'Unbounded', sans-serif)",
            fontSize: "clamp(24px, 4vw, 34px)",
            fontWeight: 600,
            letterSpacing: "var(--ls-display, -0.02em)",
            lineHeight: 1.15,
          }}
        >
          {copy.title}
        </div>
        <div
          style={{
            fontSize: "var(--fs-body, 14px)",
            lineHeight: 1.6,
            color: "var(--text-2, #b9b7b2)",
            maxWidth: 400,
          }}
        >
          {copy.hint}
        </div>
        <button
          className="muza-crash__btn"
          onClick={() => window.location.reload()}
          style={{
            marginTop: "var(--sp-3, 12px)",
            padding: "12px 32px",
            borderRadius: "var(--r-pill, 999px)",
            border: "none",
            background: "var(--accent, #3b82f6)",
            color: "var(--accent-contrast, #fff)",
            fontFamily: "inherit",
            fontSize: "var(--fs-body, 14px)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {copy.button}
        </button>
        {this.state.message ? (
          // строка для багрепорта: что именно упало — глазами, без DevTools
          <code
            style={{
              position: "absolute",
              bottom: "var(--sp-5, 20px)",
              left: "50%",
              transform: "translateX(-50%)",
              maxWidth: "min(560px, 86vw)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              color: "var(--text-3, #7d7b76)",
            }}
          >
            {this.state.message}
          </code>
        ) : null}
      </div>
    );
  }
}
