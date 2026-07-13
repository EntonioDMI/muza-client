/** Мини-плеер: контент окна "mini" (380×148, без рамки, поверх всех).
 *  Данные приходят событиями из main (lib/miniBridge) — тут ни движка, ни
 *  API; только обложка, строки и транспорт. Тема/акцент читаются из общих
 *  prefs (localStorage один на origin у обоих окон). */

import { useEffect, useState } from "react";
import { IconButton } from "@muza/ui";
import { DEFAULT_PREFS, type Prefs } from "../types";
import { fmtTime } from "../lib/format";
import { miniCommand, miniHello, miniOnState, type MiniState } from "../lib/miniBridge";

function loadThemePrefs(): Pick<Prefs, "theme" | "accent" | "customAccent"> {
  try {
    const raw = localStorage.getItem("muza.prefs.v1");
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function MiniPlayer() {
  const [state, setState] = useState<MiniState | null>(null);
  const [prefs] = useState(loadThemePrefs);

  useEffect(() => {
    let un: (() => void) | undefined;
    void miniOnState(setState).then((u) => {
      un = u;
      void miniHello(); // main ответит свежим снапшотом
    });
    return () => un?.();
  }, []);

  const accentAttr = prefs.accent === "blue" || prefs.accent === "custom" ? undefined : prefs.accent;
  return (
    <div
      data-theme={prefs.theme}
      data-accent={accentAttr}
      data-tauri-drag-region
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-3) var(--sp-4)",
        background: "var(--bg-1)",
        fontFamily: "var(--font-ui)",
        overflow: "hidden",
        // свой акцент не переносим (нужен весь вывод accent.ts) — дефолт темы
        ...(prefs.customAccent && prefs.accent === "custom" ? { "--accent": prefs.customAccent } : {}),
      }}
    >
      {state?.cover ? (
        <img
          src={state.cover}
          alt=""
          data-tauri-drag-region
          style={{ width: 96, height: 96, borderRadius: "var(--r-sm)", objectFit: "cover", flex: "none", pointerEvents: "none" }}
        />
      ) : (
        <div style={{ width: 96, height: 96, borderRadius: "var(--r-sm)", background: "var(--surface-3)", flex: "none" }} />
      )}
      <div data-tauri-drag-region style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        <div data-tauri-drag-region style={{ minWidth: 0 }}>
          <div
            data-tauri-drag-region
            style={{
              fontSize: "var(--fs-body)",
              fontWeight: 600,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {state?.title ?? "Muza"}
          </div>
          <div
            data-tauri-drag-region
            style={{
              fontSize: "var(--fs-caption)",
              color: "var(--text-2)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {state ? `${state.artist} · ${fmtTime(state.pos)} / ${fmtTime(state.duration)}` : "ждём музыку из главного окна"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
          <IconButton icon="skip-back" size="sm" label="Предыдущий" onClick={() => void miniCommand("prev")} />
          <IconButton
            icon={state?.playing ? "pause" : "play"}
            variant="accent"
            size="sm"
            label={state?.playing ? "Пауза" : "Слушать"}
            onClick={() => void miniCommand("toggle")}
          />
          <IconButton icon="skip-forward" size="sm" label="Следующий" onClick={() => void miniCommand("next")} />
          <IconButton
            icon="heart"
            size="sm"
            active={state?.liked ?? false}
            filled={state?.liked ?? false}
            label="Нравится"
            onClick={() => void miniCommand("like")}
          />
          <span style={{ marginLeft: "auto" }}>
            <IconButton icon="x" size="sm" label="Закрыть мини-плеер" onClick={() => void miniCommand("close")} />
          </span>
        </div>
      </div>
    </div>
  );
}
