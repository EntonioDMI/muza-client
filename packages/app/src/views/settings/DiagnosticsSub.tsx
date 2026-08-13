/** ЭКРАН «ДИАГНОСТИКА ЗАГРУЗКИ ТРЕКОВ»: обзор состояния сверху, подробности —
 *  по требованию.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02); 2026-08-13 переписано под обзор.
 *
 *  Зачем экран вообще: предохранители срабатывают МОЛЧА, и жалоба «стало
 *  медленно» была неразбираема — не видно ни того, что подготовка на паузе,
 *  ни того, на какой шаг уходит время.
 *
 *  ⚠️ ЧТО ИЗМЕНИЛОСЬ 13.08 И ПОЧЕМУ. Экран показывал три ленты подряд: события,
 *  сводку по классам, поштучные старты. Всё честно — и всё требовало заранее
 *  знать, что искать. Владелец: «нужен инструмент вроде журнала, но более
 *  сжатый», «при одном взгляде можно сразу понять содержимое». Поэтому теперь:
 *
 *    1. ОБЗОР (DiagnosticsOverview) — вердикт, три числа, два графика, места.
 *    2. ЖУРНАЛ — сжатый: одинаковые события склеены в строку со счётчиком.
 *       Одна авария давала два десятка почти одинаковых записей, и лента из
 *       них читалась как двадцать новостей вместо одной.
 *    3. ПОДРОБНОСТИ — прежние сводка по классам и поштучный список стартов,
 *       СВЁРНУТЫЕ. Ничего не выброшено: это по-прежнему единственное место,
 *       где видно конкретный старт с его отметками. Но открывает их тот, кто
 *       уже знает, что ищет, — а это единицы и не каждый раз.
 *
 *  ⚠️ ПОЛОВИНА КАРТИНЫ ПРИХОДИТ С СЕРВЕРА. Экран мерил только то, что
 *  происходит НА УСТРОЙСТВЕ, и был слеп к тому, отвечают ли вообще места, где
 *  музыка ищется. Ровно там 13.08 и нашлась авария: имя YouTube не
 *  разрешалось на сети владельца, поиск месяцами отдавал остаток, и это
 *  выглядело как решение программы. Спрашиваем /health/sources — умения нет
 *  (старый сервер, чужая сборка) — раздела просто нет, правило розетки.
 *
 *  Тексты событий приходят от площадки уже человеческими и показываются как
 *  есть. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@muza/ui";
import type { SearchSourceHealth } from "@muza/api-client";
import { useT } from "../../i18n";
import type { DiagnosticsPort, EngineHealth, TrackStartRecord } from "../../platform";
import { buildOverview, compressJournal } from "../../lib/engineOverview";
import { DiagnosticsOverview, type SearchProbeState } from "./DiagnosticsOverview";
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

/** Сколько сжатых строк журнала видно до нажатия «показать всё». Шесть — это
 *  примерно один экран без прокрутки: столько человек читает не листая, а
 *  дальше начинается работа, на которую он не подписывался. */
const JOURNAL_PREVIEW = 6;

export function DiagnosticsSub() {
  const { t, lang } = useT();
  const { platform, closeSub, paneClass, onNotify, api } = useSettingsScreen();
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

  // ── Половина картины с сервера: кто из мест поиска сейчас отвечает ──
  // Умения нет → "off", и раздела на экране не появляется вовсе. Отказ сети
  // отличается от пустого ответа: «не смогли спросить» и «спросили, там пусто»
  // — разные новости, и валить их в одну пустую рамку значит повторять ровно
  // ту ошибку, из-за которой экран и переписывался.
  const askSources = api.searchSourceHealth;
  const [searchSources, setSearchSources] = useState<SearchSourceHealth[] | null>(null);
  const [searchProbe, setSearchProbe] = useState<SearchProbeState>(askSources ? "loading" : "off");
  const reloadSources = useCallback(() => {
    if (!askSources) return;
    setSearchProbe("loading");
    askSources
      .call(api)
      .then((list) => {
        setSearchSources(list);
        setSearchProbe("ready");
      })
      .catch(() => {
        setSearchSources(null);
        setSearchProbe("error");
      });
  }, [askSources, api]);
  useEffect(() => {
    reloadSources();
  }, [reloadSources]);

  const overview = useMemo(
    () => buildOverview({ starts: startLog, health, searchSources }),
    [startLog, health, searchSources],
  );

  // Сводка считается площадкой заново на каждую отрисовку — намеренно, без
  // мемоизации: отрисовка случается ровно тогда, когда журнал пополнился, а
  // двести записей складываются за доли миллисекунды. Кэш здесь стоил бы
  // больше внимания, чем экономил.
  const summary = port?.startSummary?.() ?? [];
  const journal = useMemo(() => compressJournal(health?.events ?? []), [health]);

  const [journalAll, setJournalAll] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  /** Всё содержимое экрана одним куском: короткая сводка, журнал причин,
   *  разбор по видам треков и таблица стартов.
   *
   *  ⚠️ ПОЧЕМУ ОДНА КНОПКА, А НЕ ТРИ. Раньше копировалась только таблица
   *  стартов, и разбор упирался в это каждый раз: в таблице видно, ЧТО было
   *  медленно, а в журнале — ПОЧЕМУ, и без второй половины первая читается
   *  как загадка. Человек копировал по кускам и всё равно привозил не то.
   *  Отдельные кнопки на каждую часть заставляли бы его знать, какая часть
   *  нужна, — а он этого знать не обязан.
   *
   *  ⚠️ СВОДКА ИДЁТ ПЕРВОЙ и повторяет то, что человек видит наверху экрана.
   *  Раньше выгрузка начиналась сразу с сырых событий, и тот, кому её
   *  присылали, начинал разбор с нуля — хотя ответ («не отвечает YouTube»)
   *  уже был на экране у отправителя.
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

    parts.push(`${t("settings.system.stage0.overview.recentTitle")}:`, ...overviewLines(), "");
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

  /** Сводка обзора текстом. Считается ИЗ ТОЙ ЖЕ модели, что рисует экран, —
   *  иначе присланное и увиденное разошлись бы, и спорить пришлось бы о том,
   *  какая из двух цифр настоящая. */
  const overviewLines = (): string[] => {
    const ms = (v: number | null) => (v === null ? "—" : `${v} ${t("settings.system.stage0.starts.ms")}`);
    const out = [
      `${t("settings.system.stage0.overview.typical")}: ${ms(overview.typicalMs)} (${t("settings.system.stage0.overview.typicalSlow", { value: ms(overview.slowMs) })})`,
      `${t("settings.system.stage0.overview.didNotPlay")}: ${t("settings.system.stage0.overview.didNotPlayValue", { failed: overview.failed, total: overview.total })}`,
      `${t("settings.system.stage0.overview.cold")}: ${ms(overview.coldMs)}`,
    ];
    for (const p of overview.places) out.push(`${p.key}${TAB}${p.count}`);
    for (const s of overview.searchPlaces) {
      out.push(`${s.source}${TAB}${s.downNow ? "нет ответа" : "ok"}${TAB}${s.failed}/${s.attempts}${TAB}${s.lastFailure ?? ""}`);
    }
    return out;
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

  // Строка шагов включения: «источники 12 мс · ссылка 180 мс (напрямую) · звук 215 мс».
  // Пропущенные шаги не печатаются (файл с устройства не ходит за источниками).
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

  const journalShown = journalAll ? journal : journal.slice(0, JOURNAL_PREVIEW);

  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.system.stage0.title")} onBack={closeSub} />

      {/* Кнопки живут в ряду-плашке над обзором: у них ровно одна работа —
          «перечитать» и «унести с собой», и обе относятся ко ВСЕМУ экрану,
          а не к какому-то одному его блоку. Строка «Быстрый путь на паузе»
          из этого ряда ушла: она теперь строка вердикта, там ей и место. */}
      <SettingRow title={t("settings.system.stage0.rowTitle")} hint={t("settings.system.stage0.rowHint")}>
        <Button
          variant="ghost"
          icon="refresh-cw"
          onClick={() => {
            reloadHealth();
            reloadSources();
          }}
        >
          {t("settings.system.stage0.refresh")}
        </Button>
        {/* Нет умения выгрузить журнал — нет и кнопки (правило розетки). */}
        {port?.startLogTsv ? (
          <Button variant="ghost" icon="copy" onClick={() => void copyAll()}>
            {t("settings.system.stage0.starts.copy")}
          </Button>
        ) : null}
      </SettingRow>

      <DiagnosticsOverview overview={overview} searchProbe={searchProbe} />

      {/* ЖУРНАЛ. Сжатый: одинаковые события — одной строкой со счётчиком.
          Хвост показывается у самого свежего события группы — он и есть та
          зацепка, ради которой журнал открывают. */}
      <div>
        <SettingRow title={t("settings.system.stage0.overview.journalTitle")} />
        {journal.length === 0 ? (
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
            {t("settings.system.stage0.empty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {journalShown.map((e) => (
              <div
                key={e.head}
                style={{ display: "flex", gap: "var(--sp-4)", fontSize: "var(--fs-caption)", lineHeight: 1.5 }}
              >
                <span style={{ color: "var(--text-3)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {fmtEventClock(e.lastAt)}
                </span>
                <span style={{ color: "var(--text-2)", minWidth: 0 }}>
                  <span style={{ color: "var(--text-1)" }}>{e.head}</span>
                  {e.count > 1 ? (
                    <span style={{ color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                      {` ${t("settings.system.stage0.overview.journalRepeat", { count: e.count })}`}
                    </span>
                  ) : null}
                  {e.detail ? <span style={{ color: "var(--text-3)" }}>{` — ${e.detail}`}</span> : null}
                </span>
              </div>
            ))}
            {journal.length > JOURNAL_PREVIEW ? (
              <div>
                <Button
                  variant="ghost"
                  icon={journalAll ? "chevron-up" : "chevron-down"}
                  onClick={() => setJournalAll((v) => !v)}
                >
                  {journalAll
                    ? t("settings.system.stage0.overview.journalLess")
                    : t("settings.system.stage0.overview.journalMore")}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ПОДРОБНОСТИ. Ничего не выброшено — только убрано с глаз: разбор по
          видам треков и поштучный список стартов открывает тот, кто уже знает,
          что ищет. Именно они и делали экран простынёй. */}
      <div>
        <Button
          variant="ghost"
          icon={detailsOpen ? "chevron-up" : "chevron-down"}
          onClick={() => setDetailsOpen((v) => !v)}
        >
          {detailsOpen
            ? t("settings.system.stage0.overview.startsLess")
            : t("settings.system.stage0.overview.startsMore")}
        </Button>
      </div>

      {detailsOpen ? (
        <>
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
                        return stat
                          ? ` · ${phaseLabel[p]} ${stat.median} / ${stat.p90} ${t("settings.system.stage0.starts.ms")}`
                          : null;
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
        </>
      ) : null}
    </div>
  );
}
