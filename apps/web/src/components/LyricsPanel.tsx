"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lyrics } from "@muza/ui";
import type { Lyrics as LyricsData } from "@muza/api-client";
import { useT } from "@muza/app";
import { getApi } from "../api";
import { usePlayer, usePosition } from "../player";

/** Текст песни для веба: загрузка с сервера (LRCLIB, слайс 4) + активная
 *  строка по позиции.
 *
 *  Э7 веб-паритета: сам ПОКАЗ текста больше не живёт здесь — панель «Сейчас
 *  играет» рисует общий экран @muza/app/shell/NowPlayingPanel, ровно тот же,
 *  что в приложении. Этому файлу осталась веб-часть: где взять строки и как
 *  посчитать активную. Приложение делает это своим хуком player/useLyrics
 *  (он умеет ещё и аннотации «смысла» — их в вебе пока нет).
 *
 *  ⚠️ Активная строка = −1, когда её нет (текст без таймкодов или трек ещё не
 *  дошёл до первой строки) — это ТОТ ЖЕ контракт, что у приложения, и он
 *  важен: Lyrics ДС считает `activeIndex >= 0` признаком синхронного текста.
 *  Раньше веб передавал undefined, а у Lyrics значение по умолчанию 0 —
 *  обычный текст без таймкодов получал подсветку первой строки и караоке-окно
 *  на ровном месте. */

export interface TrackLyrics {
  /** Строки в форме общего экрана: `t` есть только у синхронного текста. */
  lines: { t?: number; text: string }[];
  /** Индекс активной строки; −1 — активной нет. */
  activeLine: number;
  /** Строки ещё едут — «Ищем текст…» вместо «Текст не найден». */
  loading: boolean;
  /** Клик по строке — перемотка на её начало (у plain-текста ничего не делает). */
  seekLine: (i: number) => void;
  /** Есть ли вообще текущий трек (для пустого состояния мобильного экрана). */
  hasTrack: boolean;
}

export function useTrackLyrics(): TrackLyrics {
  const { current, seek } = usePlayer();
  const { position } = usePosition();
  const [data, setData] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setData(null);
    if (!current) return;
    let cancelled = false;
    setLoading(true);
    getApi()
      .getLyrics(current.id)
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

  const lines = useMemo(() => {
    if (data?.synced?.length) return data.synced.map((l) => ({ t: l.t, text: l.line }));
    if (data?.plain) return data.plain.split("\n").map((text) => ({ text }));
    return [];
  }, [data]);

  const activeLine = useMemo(() => {
    if (!data?.synced?.length) return -1;
    let idx = -1;
    for (let i = 0; i < data.synced.length; i++) {
      if (data.synced[i].t <= position) idx = i;
      else break;
    }
    return idx;
  }, [data, position]);

  const seekLine = useCallback(
    (i: number) => {
      const line = data?.synced?.[i];
      if (line) seek(line.t);
    },
    [data, seek],
  );

  return { lines, activeLine, loading, seekLine, hasTrack: Boolean(current) };
}

/** Блок текста для мобильного полноэкранного now-playing: то же полотно, что в
 *  приложении, в караоке-режиме (окно вокруг активной строки) — полный экран
 *  телефона это и есть караоке-сцена приложения.
 *
 *  Размер окна (`windowLines`) и «нотку в конце» задаёт приложение настройками
 *  (prefs.karaokeLines / prefs.lyricsEndNote); в вебе таких настроек ещё нет —
 *  значения по умолчанию совпадают с заводскими приложения (5 строк, нотка
 *  включена), поэтому вид одинаковый. */
export function LyricsBlock({ karaoke = false, windowLines = 5 }: { karaoke?: boolean; windowLines?: number }) {
  const { t } = useT();
  const { lines, activeLine, loading, seekLine, hasTrack } = useTrackLyrics();

  if (lines.length === 0) {
    return (
      <p style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--text-3)", padding: "var(--sp-2)" }}>
        {!hasTrack ? t("web.lyrics.emptyNoTrack") : loading ? t("player.lyricsSearching") : t("player.lyricsNotFound")}
      </p>
    );
  }

  return (
    <Lyrics
      lines={lines}
      activeIndex={activeLine}
      mode={karaoke ? "karaoke" : "panel"}
      endNote
      windowLines={windowLines}
      onSeek={seekLine}
      style={{ height: "100%" }}
    />
  );
}
