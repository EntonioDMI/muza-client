"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialog, Icon, IconButton, Lyrics } from "@muza/ui";
import type { Annotation, Lyrics as LyricsData } from "@muza/api-client";
import { useT } from "@muza/app";
import { usePlatform } from "@muza/app/platform";
import { getApi } from "../api";
import { usePlayer, usePosition } from "../player";
import { usePrefs } from "../prefs";

/** Текст песни для веба: загрузка с сервера (LRCLIB, слайс 4) + активная
 *  строка по позиции + НАСТРОЙКИ раздела «Тексты песен».
 *
 *  Э7 веб-паритета: сам ПОКАЗ текста больше не живёт здесь — панель «Сейчас
 *  играет» рисует общий экран @muza/app/shell/NowPlayingPanel, ровно тот же,
 *  что в приложении. Этому файлу осталась веб-часть: где взять строки и как
 *  посчитать активную. Приложение делает это своим хуком player/useLyrics.
 *
 *  НАСТРОЙКИ ЧИТАЮТСЯ ЗДЕСЬ, А НЕ У ПОТРЕБИТЕЛЕЙ (волна «Тексты песен» в
 *  вебе, 2026-08-02). До неё панель не знала о настройках вообще, и раздела
 *  «Тексты песен» в браузере не было: тумблер, который никуда не приезжает,
 *  хуже отсутствующего. Потребителей текста в вебе двое — правая панель
 *  (components/NowPlayingPanel.tsx) и полный экран телефона
 *  (components/MobileNowPlaying.tsx), — и настройка, разложенная по обоим,
 *  разъехалась бы при первой же правке. Поэтому:
 *   - «Синхронный текст» и «Нотка в конце» меняют САМУ активную строку и
 *     живут в useTrackLyrics — потребителям об этом знать нечего;
 *   - «Строк текста в караоке» и «Режим смысла» целиком внутри LyricsBlock;
 *   - «Автопрокрутка», «Нотка в конце» и «Строк текста в панели» — это пропы
 *     общего экрана, их отдаёт useTrackLyrics.panelPrefs одним объектом.
 *
 *  ЧЕГО В ВЕБЕ НЕТ. «Видео вместо обложки»: видео-дорожку добывает движок
 *  приложения (Rust, engine_resolve_video) — у страницы такого умения нет, и
 *  ряда настройки в браузере нет вовсе (не серого). «Размер караоке-текста»
 *  настройкой этого файла не является: его применяет общий движок темы
 *  (--fs-karaoke, theme/themeVars.ts), профиль уезжает туда целиком.
 *
 *  ⚠️ Активная строка = −1, когда её нет (текст без таймкодов, выключенный
 *  «Синхронный текст» или трек ещё не дошёл до первой строки) — это ТОТ ЖЕ
 *  контракт, что у приложения, и он важен: Lyrics ДС считает `activeIndex >= 0`
 *  признаком синхронного текста. Раньше веб передавал undefined, а у Lyrics
 *  значение по умолчанию 0 — обычный текст без таймкодов получал подсветку
 *  первой строки и караоке-окно на ровном месте. */

/** Строка текста в форме общего экрана; `note` — объяснение смысла (Genius). */
export interface WebLyricLine {
  t?: number;
  text: string;
  note?: string;
}

/** Пропы текста для общего экрана «Сейчас играет» — ровно те, что этот экран
 *  принимает. Отдаются объектом, чтобы новая настройка панели не требовала
 *  правки потребителя: он спредит `panelPrefs` и не перечисляет поля. */
export interface LyricsPanelPrefs {
  lyricsAutoScroll: boolean;
  lyricsEndNote: boolean;
  lyricsPanelLines: number;
}

export interface TrackLyrics {
  /** Строки в форме общего экрана: `t` есть только у синхронного текста. */
  lines: WebLyricLine[];
  /** Индекс активной строки; −1 — активной нет. */
  activeLine: number;
  /** Строки ещё едут — «Ищем текст…» вместо «Текст не найден». */
  loading: boolean;
  /** Клик по строке — перемотка на её начало (у plain-текста ничего не делает). */
  seekLine: (i: number) => void;
  /** Есть ли вообще текущий трек (для пустого состояния мобильного экрана). */
  hasTrack: boolean;
  /** Настройки текста для общего экрана «Сейчас играет». */
  panelPrefs: LyricsPanelPrefs;
  /** Открыть карточку смысла строки. undefined — «Режим смысла» выключен либо
   *  объяснений у трека нет: Lyrics ДС без этого пропа не рисует ни звёздочку,
   *  ни акцентный цвет, то есть обещания, которое некому выполнить. */
  explainLine?: (i: number) => void;
  /** Сама карточка смысла — её рендерит тот, кто показывает текст. */
  meaningDialog: ReactNode;
}

/** ОБЩИЙ КЭШ ЗАПРОСОВ ТЕКСТА НА ВКЛАДКУ.
 *
 *  Экранов, показывающих текст, в вебе стало трое: панель «Сейчас играет»,
 *  полноэкранное караоке (ListeningModeHost) и полный экран телефона. Каждый
 *  зовёт useTrackLyrics СВОИМ экземпляром — иначе позиция плеера тикала бы
 *  через общего родителя и перерисовывала бы весь шелл несколько раз в
 *  секунду. Плата за это — одинаковые запросы: без кэша один и тот же трек
 *  спрашивался бы у сервера столько раз, сколько таких экранов сейчас в DOM
 *  (до подключения караоке их было двое, и вторая копия уже ездила зря).
 *
 *  Кэшируется ОБЕЩАНИЕ, а не ответ: экраны монтируются одновременно, и
 *  склеивать надо в том числе запросы, которые ещё летят. Ключ — id трека:
 *  текст песни в пределах сессии не меняется. Провал не запоминаем — следующий
 *  экран вправе спросить снова. Это не хранилище, а склейка: держим последние
 *  CACHE_MAX треков, чтобы переключение «вперёд-назад» не било по сети. */
const CACHE_MAX = 8;
type AnnotationsResult = Awaited<ReturnType<ReturnType<typeof getApi>["getAnnotations"]>>;
const lyricsCache = new Map<string, Promise<LyricsData>>();
const annotationsCache = new Map<string, Promise<AnnotationsResult>>();

function cachedRequest<T>(store: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit) return hit;
  const started = load();
  store.set(key, started);
  void started.catch(() => store.delete(key));
  // Map хранит ключи в порядке вставки — первый и есть самый старый.
  while (store.size > CACHE_MAX) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  return started;
}

/** Индекс synced-строки → аннотация. Сервер уже привязал фрагменты Genius к
 *  LRC-строкам (line_idxs), здесь только раскладка: у одной строки может быть
 *  несколько объяснений — берём первое, как в приложении. */
function buildNotes(annotations: Annotation[] | null): Map<number, Annotation> {
  const notes = new Map<number, Annotation>();
  for (const a of annotations ?? []) {
    const idxs = a.lineIdxs.length > 0 ? a.lineIdxs : a.lineIdx !== null ? [a.lineIdx] : [];
    for (const i of idxs) if (!notes.has(i)) notes.set(i, a);
  }
  return notes;
}

export function useTrackLyrics(): TrackLyrics {
  const { current, seek } = usePlayer();
  const { position } = usePosition();
  const { prefs } = usePrefs();
  const { t } = useT();
  const platform = usePlatform();
  const [data, setData] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<Map<number, Annotation>>(() => new Map());
  const [geniusUrl, setGeniusUrl] = useState<string | null>(null);
  const [meaningLine, setMeaningLine] = useState<number | null>(null);

  useEffect(() => {
    setData(null);
    if (!current) return;
    let cancelled = false;
    setLoading(true);
    cachedRequest(lyricsCache, current.id, () => getApi().getLyrics(current.id))
      .then((l) => {
        if (!cancelled) setData(l);
      })
      .catch(() => {
        if (!cancelled) setData({ synced: null, plain: null, source: null });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // «Режим смысла»: объяснения Genius для строк текущего трека. Спрашиваем
  // только при включённом тумблере и только когда есть к чему привязывать —
  // индексы аннотаций считаны от synced-строк, plain-текст не размечаем.
  // Провал молча даёт «объяснений нет»: это не ошибка экрана, а отсутствие
  // данных у трека, и говорить о нём человеку нечего.
  const hasSynced = Boolean(data?.synced?.length);
  const trackId = current?.id ?? null;
  useEffect(() => {
    setNotes(new Map());
    setGeniusUrl(null);
    if (!prefs.meaningMode || !hasSynced || !trackId) return;
    let cancelled = false;
    cachedRequest(annotationsCache, trackId, () => getApi().getAnnotations(trackId))
      .then(({ annotations, geniusUrl: url }) => {
        if (cancelled) return;
        setNotes(buildNotes(annotations));
        setGeniusUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [trackId, hasSynced, prefs.meaningMode]);

  // Карточка смысла принадлежит СТРОКЕ, а не треку: закрываем её на смене
  // трека и на выключении тумблера, иначе поверх нового текста висело бы
  // объяснение из прошлой песни.
  useEffect(() => setMeaningLine(null), [trackId, prefs.meaningMode]);

  const lines = useMemo<WebLyricLine[]>(() => {
    if (data?.synced?.length) {
      return data.synced.map((l, i) => {
        const note = notes.get(i)?.body;
        return note ? { t: l.t, text: l.line, note } : { t: l.t, text: l.line };
      });
    }
    if (data?.plain) return data.plain.split("\n").map((text) => ({ text }));
    return [];
  }, [data, notes]);

  const activeLine = useMemo(() => {
    // Выключенный «Синхронный текст» превращает synced в обычный список: −1 —
    // это и есть «подсветки нет» (тот же приём, что в приложении).
    if (!data?.synced?.length || !prefs.syncedLyrics) return -1;
    const synced = data.synced;
    let idx = -1;
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].t <= position) idx = i;
      else break;
    }
    // Нотка-финал: после последней строки активная «переезжает» на нотку
    // (виртуальный индекс lines.length) — «текст кончился, доигрывает
    // музыка». Последнюю строку держим примерно столько же, сколько типичную
    // (зазор до предпоследней), в рамках 2..8с — иначе нотка загоралась бы
    // акцентом ещё пока последняя строка поётся. Числа и правило — из
    // приложения (apps/desktop/src/App.tsx, activeLine).
    if (prefs.lyricsEndNote && idx === synced.length - 1) {
      const last = synced[idx].t;
      const prev = synced.length > 1 ? synced[idx - 1].t : last - 4;
      const hold = Math.min(8, Math.max(2, last - prev));
      if (position - last >= hold) idx = synced.length;
    }
    return idx;
  }, [data, position, prefs.syncedLyrics, prefs.lyricsEndNote]);

  const seekLine = useCallback(
    (i: number) => {
      const line = data?.synced?.[i];
      if (line) seek(line.t);
    },
    [data, seek],
  );

  const explainLine = notes.size > 0 ? setMeaningLine : undefined;
  const meaningNote = meaningLine !== null ? lines[meaningLine] : undefined;
  const meaningAnnotation = meaningLine !== null ? notes.get(meaningLine) : undefined;

  const meaningDialog = (
    <Dialog
      open={meaningNote !== undefined && Boolean(meaningNote.note)}
      title={t("dialogs.meaning.title")}
      width={560}
      onClose={() => setMeaningLine(null)}
      headerAction={<IconButton icon="x" size="sm" label={t("dialogs.close")} onClick={() => setMeaningLine(null)} />}
    >
      {meaningNote ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <div
            style={{
              display: "flex",
              gap: "var(--sp-3)",
              padding: "var(--sp-4)",
              borderRadius: "var(--r-md)",
              background: "var(--accent-soft)",
              color: "var(--accent-text)",
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          >
            <Icon name="sparkles" size={18} color="currentColor" style={{ flex: "none", marginTop: 2 }} />
            <span>«{meaningNote.text}»</span>
          </div>
          {/* overflowWrap обязателен: длинная ссылка внутри объяснения иначе
              распирает карточку и добавляет горизонтальную прокрутку
              (overflowY:auto включает overflowX тоже). */}
          <div
            style={{
              color: "var(--text-2)",
              lineHeight: 1.65,
              maxHeight: "42vh",
              overflowY: "auto",
              overflowX: "hidden",
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-3)",
            }}
          >
            <span>{meaningNote.note}</span>
            {meaningAnnotation?.images.map((img) => (
              <figure key={img.src} style={{ margin: 0, display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                {/* width/height из Genius резервируют место до загрузки —
                    карточка не прыгает; сама картинка остаётся резиновой. */}
                <img
                  src={img.src}
                  alt={img.alt ?? ""}
                  loading="lazy"
                  width={img.width}
                  height={img.height}
                  style={{ maxWidth: "100%", height: "auto", borderRadius: "var(--r-sm)", background: "var(--surface-2)", display: "block" }}
                />
                {img.caption ? (
                  <figcaption style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", lineHeight: 1.4 }}>{img.caption}</figcaption>
                ) : null}
              </figure>
            ))}
          </div>
          {meaningAnnotation ? (
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--sp-2)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
              <span>
                Genius
                {meaningAnnotation.verified ? t("dialogs.meaning.verifiedSuffix") : ""}
                {meaningAnnotation.votes > 0 ? t("dialogs.meaning.votesSuffix", { votes: meaningAnnotation.votes }) : ""}
              </span>
              {geniusUrl ? (
                <button
                  type="button"
                  onClick={() => void platform.system?.openExternal(geniusUrl)}
                  style={{ border: "none", background: "none", padding: 0, color: "var(--accent-text)", font: "inherit", cursor: "pointer" }}
                >
                  {t("dialogs.meaning.openOnGenius")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );

  return {
    lines,
    activeLine,
    loading,
    seekLine,
    hasTrack: Boolean(current),
    panelPrefs: {
      lyricsAutoScroll: prefs.lyricsAutoScroll,
      lyricsEndNote: prefs.lyricsEndNote,
      lyricsPanelLines: prefs.lyricsPanelLines,
    },
    explainLine,
    meaningDialog,
  };
}

/** Блок текста для мобильного полноэкранного now-playing: то же полотно, что в
 *  приложении, в караоке-режиме (окно вокруг активной строки) — полный экран
 *  телефона это и есть караоке-сцена приложения.
 *
 *  Все настройки текста блок берёт сам (см. шапку файла): «Строк текста в
 *  караоке» — размер окна, «Автопрокрутка» — следует ли текст за песней,
 *  «Нотка в конце» — знак под последней строкой, «Режим смысла» — звёздочка и
 *  карточка объяснения. Пропы для них не заведены нарочно: единственный
 *  потребитель — MobileNowPlaying, и лишний слой перекладывания настроек
 *  только даёт им шанс разъехаться. */
export function LyricsBlock({ karaoke = false }: { karaoke?: boolean }) {
  const { t } = useT();
  const { prefs } = usePrefs();
  const { lines, activeLine, loading, seekLine, hasTrack, panelPrefs, explainLine, meaningDialog } = useTrackLyrics();

  if (lines.length === 0) {
    return (
      <p style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--text-3)", padding: "var(--sp-2)" }}>
        {!hasTrack ? t("web.lyrics.emptyNoTrack") : loading ? t("player.lyricsSearching") : t("player.lyricsNotFound")}
      </p>
    );
  }

  return (
    <>
      <Lyrics
        lines={lines}
        activeIndex={activeLine}
        mode={karaoke ? "karaoke" : "panel"}
        autoScroll={panelPrefs.lyricsAutoScroll}
        endNote={panelPrefs.lyricsEndNote}
        windowLines={prefs.karaokeLines}
        panelLines={karaoke ? 0 : panelPrefs.lyricsPanelLines}
        onSeek={seekLine}
        onExplain={explainLine}
        style={{ height: "100%" }}
      />
      {meaningDialog}
    </>
  );
}
