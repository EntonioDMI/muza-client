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
  const { platform, closeSub, paneClass, onNotify } = useSettingsScreen();
  const port = platform.diagnostics;
  const [health, reloadHealth] = useEngineHealth(port);

  // Журнал включений живёт в площадке (кольцо на две сотни записей, у
  // приложения — переживающее перезапуск) — экран лишь подписан на пополнения.
  const [startLog, setStartLog] = useState<TrackStartRecord[]>(() => port?.startLog() ?? []);
  useEffect(() => {
    if (!port) return;
    setStartLog(port.startLog());
    return port.subscribeStartLog(() => setStartLog(port.startLog()));
  }, [port]);

  // Сводка считается площадкой заново на каждую отрисовку — намеренно, без
  // мемоизации: отрисовка случается ровно тогда, когда журнал пополнился, а
  // двести записей складываются за доли миллисекунды. Кэш здесь стоил бы
  // больше внимания, чем экономил.
  const summary = port?.startSummary?.() ?? [];

  /** Всё содержимое экрана одним куском: журнал причин, сводка по фазам и
   *  таблица стартов.
   *
   *  ⚠️ ПОЧЕМУ ОДНА КНОПКА, А НЕ ТРИ. Раньше копировалась только таблица
   *  стартов, и разбор упирался в это каждый раз: в таблице видно, ЧТО было
   *  медленно, а в журнале — ПОЧЕМУ, и без второй половины первая читается
   *  как загадка. Человек копировал по кускам и всё равно привозил не то.
   *  Отдельные кнопки на каждую часть заставляли бы его знать, какая часть
   *  нужна, — а он этого знать не обязан.
   *
   *  Таблица идёт ПОСЛЕДНЕЙ и остаётся сплошным TSV: так её по-прежнему можно
   *  выделить и вставить в Excel/Sheets, чтобы считать медианы там. Разделы
   *  подписаны, чтобы человек (и тот, кому он это пришлёт) видел границы. */
  // Разделители вынесены именами: в этом файле их правил генератор, и
  // буквальный перенос строки внутри литерала уже один раз ломал сборку.
  const NL = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);

  const copyAll = async () => {
    const tsv = port?.startLogTsv?.();
    if (!tsv) return;
    const events = health?.events ?? [];
    const parts: string[] = [];
    if (events.length > 0) {
      parts.push(
        `${t("settings.system.stage0.title")}:`,
        ...events.map((e) => `${fmtEventClock(e.at_ms)}${TAB}${e.text}`),
        "",
      );
    }
    if (summary.length > 0) {
      parts.push(`${t("settings.system.stage0.starts.summary")}:`, ...summary.map(summaryLine), "");
    }
    parts.push(`${t("settings.system.stage0.starts.title")}:`, tsv);
    try {
      await navigator.clipboard.writeText(parts.join(NL));
      onNotify(t("settings.system.stage0.starts.copied"), "copy");
    } catch {
      onNotify(t("settings.system.stage0.starts.copyFailed"), "x");
    }
  };

  /** Строка сводки текстом — то же, что видно на экране. Отдельной функцией,
   *  а не вторым выражением: разойдись они, скопированное перестало бы
   *  совпадать с показанным, и разбор пошёл бы по несуществующим числам. */
  const summaryLine = (s: (typeof summary)[number]): string => {
    const phases = PHASES.filter((p) => s.phases[p])
      .map((p) => {
        const stat = s.phases[p];
        return stat ? `${phaseLabel[p]} ${stat.median} / ${stat.p90} ${t("settings.system.stage0.starts.ms")}` : "";
      })
      .filter(Boolean);
    return [`${s.cls} ×${s.count}`, ...phases].join(" · ");
  };

  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const fmtEventClock = (ms: number) =>
    new Date(ms).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  /** Журнал включений ПЕРЕЖИВАЕТ перезапуск, поэтому в нём попадаются вчерашние
   *  старты — одно время без даты в такой ленте врёт (замер вчерашнего вечера
   *  выглядел бы как сегодняшний). Дату дописываем только тогда, когда она не
   *  сегодняшняя: у обычного разбора «что было только что» лишних цифр нет. */
  const fmtStartClock = (ms: number) => {
    const d = new Date(ms);
    if (d.toDateString() === new Date().toDateString()) return fmtEventClock(ms);
    return `${d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })} ${fmtEventClock(ms)}`;
  };

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
    // Окно тишины — от глушения старого трека до звука нового. Считается от
    // ЯВНОЙ отметки, а не «примерно от начала»: сегодня она стоит рядом с
    // началом, но метрика не должна зависеть от этого совпадения.
    if (r.soundMs !== null && r.silenceMs !== null && r.silenceMs !== undefined) {
      parts.push(`${t("settings.system.stage0.starts.silence")} ${startMs(r.soundMs - r.silenceMs)}`);
    }
    return parts.join(" · ");
  };

  // Отметки изнутри добычи (sc_api_v2, first_chunk_wait, …) печатаются как
  // есть: их ставит добыча, и перевод здесь означал бы вторую копию перечня
  // меток, которую некому держать в согласии с первой.
  const formatTimings = (r: TrackStartRecord): string =>
    (r.timings ?? []).map(([label, ms]) => `${label} ${startMs(ms)}`).join(" · ");

  const PHASES = ["sources", "url", "engine", "bytes", "silence", "total"] as const;
  const phaseLabel: Record<(typeof PHASES)[number], string> = {
    sources: t("settings.system.stage0.starts.sources"),
    url: t("settings.system.stage0.starts.url"),
    engine: t("settings.system.stage0.starts.phaseStart"),
    bytes: t("settings.system.stage0.starts.phaseFirstSound"),
    silence: t("settings.system.stage0.starts.silence"),
    total: t("settings.system.stage0.starts.total"),
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
        {/* Нет умения выгрузить журнал — нет и кнопки (правило розетки). */}
        {port?.startLogTsv ? (
          <Button variant="ghost" icon="copy" onClick={() => void copyAll()}>
            {t("settings.system.stage0.starts.copy")}
          </Button>
        ) : null}
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
      {/* СВОДКА выше списка намеренно: список отвечает «что было только что»,
          а вопрос владельца — «сколько это стоит вообще». Сырые числа на этот
          вопрос не отвечают, поэтому первым идёт разбор по классам. */}
      {summary.length > 0 ? (
        <>
          <SettingRow
            title={t("settings.system.stage0.starts.summary")}
            hint={t("settings.system.stage0.starts.summaryHint")}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {summary.map((s) => (
              <div key={s.cls} style={{ fontSize: "var(--fs-caption)", lineHeight: 1.5 }}>
                <span style={{ color: "var(--text-1)" }}>{s.cls}</span>
                <span style={{ color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{` ×${s.count}`}</span>
                <span style={{ color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>
                  {PHASES.filter((p) => s.phases[p]).map((p) => {
                    const stat = s.phases[p];
                    return stat ? ` · ${phaseLabel[p]} ${stat.median} / ${stat.p90} ${t("settings.system.stage0.starts.ms")}` : null;
                  })}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
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
                {fmtStartClock(r.at)}
              </span>
              <span style={{ color: "var(--text-2)", minWidth: 0 }}>
                <span style={{ color: "var(--text-1)" }}>{r.title}</span>
                {/* Первый старт после запуска отмечен прямо в строке: именно
                    он и есть жалоба владельца, и его надо видеть, не сверяясь
                    со временем запуска программы. */}
                {r.cold ? (
                  <span style={{ color: "var(--text-3)" }}>{` (${t("settings.system.stage0.starts.cold")})`}</span>
                ) : null}
                {" — "}
                {formatStartPhases(r)}
                {r.timings?.length ? (
                  <span style={{ color: "var(--text-3)" }}>{` · ${formatTimings(r)}`}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
