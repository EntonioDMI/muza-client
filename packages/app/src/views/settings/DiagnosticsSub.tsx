/** ПОД-ЭКРАН «ДИАГНОСТИКА ЗАГРУЗКИ ТРЕКОВ»: состояние предохранителей
 *  подготовки + журнал последних включений «клик → звук».
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Зачем экран вообще: предохранители срабатывают МОЛЧА, и жалоба «стало
 *  медленно» была неразбираема — не видно ни того, что подготовка на паузе,
 *  ни того, на какой фазе уходит время. Тексты событий приходят от площадки
 *  уже человеческими и показываются как есть. */

import { useEffect, useState } from "react";
import { Button } from "@muza/ui";
import { useT } from "../../i18n";
import type { DiagnosticsPort, EngineHealth, TrackStartRecord } from "../../platform";
import { paneStyle, SettingRow, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

/** Свежий снимок предохранителей. Свежесть важнее экономии: этот снимок и
 *  спрашивают ровно тогда, когда разбираются с «стало медленно».
 *  Нужен и разделу «Система» (короткий статус в ряду), и этому экрану. */
export function useEngineHealth(port: DiagnosticsPort | undefined): [EngineHealth | null, () => void] {
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const reload = () => {
    if (!port) return;
    port
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  };
  useEffect(() => {
    reload();
    // reload читает только port — пересоздавать эффект больше не на что
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port]);
  return [health, reload];
}

export function DiagnosticsSub() {
  const { t, lang } = useT();
  const { platform, closeSub, paneClass } = useSettingsScreen();
  const port = platform.diagnostics;
  const [health, reloadHealth] = useEngineHealth(port);

  // Журнал включений живёт в площадке (кольцо на два десятка записей) —
  // экран лишь подписан на пополнения.
  const [startLog, setStartLog] = useState<TrackStartRecord[]>(() => port?.startLog() ?? []);
  useEffect(() => {
    if (!port) return;
    setStartLog(port.startLog());
    return port.subscribeStartLog(() => setStartLog(port.startLog()));
  }, [port]);

  const fmtEventClock = (ms: number) =>
    new Date(ms).toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  // Строка фаз включения: «источники 12 мс · ссылка 180 мс (поток) · звук 215 мс».
  // Пропущенные фазы не печатаются (файл с устройства не ходит за источниками).
  const startMs = (n: number) => `${n} ${t("settings.system.stage0.starts.ms")}`;
  const formatStartPhases = (r: TrackStartRecord): string => {
    if (r.error === "superseded") return t("settings.system.stage0.starts.superseded");
    if (r.error) return r.error;
    const parts: string[] = [];
    if (r.sourcesMs !== null) parts.push(`${t("settings.system.stage0.starts.sources")} ${startMs(r.sourcesMs)}`);
    if (r.urlMs !== null) {
      const path =
        r.path === "stream"
          ? t("settings.system.stage0.starts.pathStream")
          : r.path === "preloaded"
            ? t("settings.system.stage0.starts.pathPreloaded")
            : t("settings.system.stage0.starts.pathResolve");
      parts.push(`${t("settings.system.stage0.starts.url")} ${startMs(r.urlMs)} (${path})`);
    }
    parts.push(
      r.soundMs !== null
        ? `${t("settings.system.stage0.starts.sound")} ${startMs(r.soundMs)}`
        : t("settings.system.stage0.starts.noSound"),
    );
    return parts.join(" · ");
  };

  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.system.stage0.title")} onBack={closeSub} />
      <SettingRow
        title={
          health?.cooldown_until_ms
            ? t("settings.system.stage0.paused", {
                until: new Date(health.cooldown_until_ms).toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })
            : t("settings.system.stage0.ok")
        }
        hint={health?.cooldown_until_ms ? t("settings.system.stage0.pausedHint") : t("settings.system.stage0.okHint")}
      >
        <Button variant="ghost" icon="refresh-cw" onClick={reloadHealth}>
          {t("settings.system.stage0.refresh")}
        </Button>
      </SettingRow>
      {(health?.events.length ?? 0) === 0 ? (
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
          {t("settings.system.stage0.empty")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          {health?.events.map((e, i) => (
            <div
              key={`${e.at_ms}-${i}`}
              style={{ display: "flex", gap: "var(--sp-4)", fontSize: "var(--fs-caption)", lineHeight: 1.5 }}
            >
              <span style={{ color: "var(--text-3)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                {fmtEventClock(e.at_ms)}
              </span>
              <span style={{ color: "var(--text-2)" }}>{e.text}</span>
            </div>
          ))}
        </div>
      )}
      <SettingRow title={t("settings.system.stage0.starts.title")} hint={t("settings.system.stage0.starts.hint")} />
      {startLog.length === 0 ? (
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
          {t("settings.system.stage0.starts.empty")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          {startLog.map((r, i) => (
            <div
              key={`${r.at}-${i}`}
              style={{ display: "flex", gap: "var(--sp-4)", fontSize: "var(--fs-caption)", lineHeight: 1.5 }}
            >
              <span style={{ color: "var(--text-3)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                {fmtEventClock(r.at)}
              </span>
              <span style={{ color: "var(--text-2)", minWidth: 0 }}>
                <span style={{ color: "var(--text-1)" }}>{r.title}</span>
                {" — "}
                {formatStartPhases(r)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
