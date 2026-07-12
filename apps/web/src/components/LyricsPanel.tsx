"use client";

import { useEffect, useMemo, useState } from "react";
import { Lyrics } from "@muza/ui";
import type { Lyrics as LyricsData } from "@muza/api-client";
import { getApi } from "../api";
import { usePlayer, usePosition } from "../player";

/** Блок текста (LRCLIB с сервера): synced — активная строка по позиции и сик
 *  кликом, plain — без подсветки. Встраивается в панель «Сейчас играет»
 *  (десктоп) и полноэкранный now-playing (мобила). Тексты-герой — есть даже
 *  в лёгком клиенте; аннотации «смысла» — беклог веба. */
export function LyricsBlock({ karaoke = false }: { karaoke?: boolean }) {
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

  const activeIndex = useMemo(() => {
    if (!data?.synced?.length) return undefined;
    let idx = -1;
    for (let i = 0; i < data.synced.length; i++) {
      if (data.synced[i].t <= position) idx = i;
      else break;
    }
    return idx >= 0 ? idx : undefined;
  }, [data, position]);

  if (lines.length === 0) {
    return (
      <p style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--text-3)", padding: "var(--sp-2)" }}>
        {!current ? "Включи трек — текст появится здесь." : loading ? "Ищем текст…" : "Текст не найден."}
      </p>
    );
  }

  return (
    <Lyrics
      lines={lines}
      activeIndex={activeIndex}
      mode={karaoke ? "karaoke" : "panel"}
      onSeek={data?.synced ? (i) => seek(data.synced![i].t) : undefined}
      style={{ height: "100%" }}
    />
  );
}
