/** Пенёк панели «Сейчас играет»: сама панель переехала в
 *  @muza/app/shell/NowPlayingPanel (Э7 веб-паритета) — веб рисовал свою,
 *  урезанную копию, и они разъезжались.
 *
 *  ПОЧЕМУ ЭТО НЕ ЧИСТЫЙ РЕ-ЭКСПОРТ, как у Visualizer рядом. Панель зовёт ПКМ
 *  по тексту, а контекстное меню — платформенное: его пункты знают про
 *  плейлисты, буфер обмена и нативное меню WebView2 (shell/ContextMenu.tsx →
 *  menuActions.ts), общему пакету это знание тащить нельзя. Поэтому здесь
 *  тонкая обёртка: она берёт меню из провайдера приложения и подставляет
 *  панели готовый обработчик. Пропы, DOM и поведение — прежние до пикселя;
 *  App.tsx о переезде не знает.
 *
 *  Новый код приложения импортирует панель отсюда (ему нужно меню); общий
 *  экран без меню — "@muza/app/shell/NowPlayingPanel". */
import type React from "react";
import type { ComponentProps } from "react";
import { NowPlayingPanel as SharedNowPlayingPanel } from "@muza/app/shell/NowPlayingPanel";
import type { LyricLine, PlayerTrack } from "../player/types";
import { useContextMenu } from "./ContextMenu";

type SharedProps = ComponentProps<typeof SharedNowPlayingPanel>;

/** Пропы прежние: типы трека и строк — десктопные (общий экран описывает свой
 *  структурный минимум, PlayerTrack/LyricLine под него подходят), обработчик
 *  ПКМ приходит не снаружи, а собирается здесь; onExplain у приложения был и
 *  остаётся обязательным. */
export type NowPlayingPanelProps = Omit<SharedProps, "track" | "lyrics" | "onExplain" | "onLineContextMenu"> & {
  track: PlayerTrack | null;
  lyrics: LyricLine[];
  onExplain: (index: number) => void;
  /** «Текст не от этой песни» (14.08): пункт есть, только когда известна
   *  запись источника — её и отвергаем. null — отвергать нечего. */
  onWrongLyrics?: (() => void) | null;
  /** «Вернуть текст»: null — возвращать нечего (ничего не отвергали). */
  onRestoreLyrics?: (() => void) | null;
};

export function NowPlayingPanel(props: NowPlayingPanelProps) {
  const { openMenu } = useContextMenu();
  const { lyrics, onExplain, onWrongLyrics, onRestoreLyrics, ...rest } = props;
  // ПКМ по тексту (2026-07-21): цель "lyrics" — копировать всё/строку, смысл
  const openLyricsMenu = (e: React.MouseEvent, i: number | null) =>
    openMenu(e, {
      kind: "lyrics",
      allText: lyrics.map((l) => l.text).join("\n"),
      // пустая инструментальная строка («•••») — копировать нечего
      lineText: i !== null ? lyrics[i]?.text || null : null,
      lineIndex: i,
      hasNote: i !== null && !!lyrics[i]?.note,
      canReject: !!onWrongLyrics,
      canRestore: !!onRestoreLyrics,
      ctl: { explain: onExplain, reject: onWrongLyrics ?? undefined, restore: onRestoreLyrics ?? undefined },
    });

  // Свои пропы до общей панели не доходят: она про них не знает и знать не
  // должна — меню целиком забота приложения (см. шапку).
  return <SharedNowPlayingPanel {...rest} lyrics={lyrics} onLineContextMenu={openLyricsMenu} />;
}
