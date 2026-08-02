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
};

export function NowPlayingPanel(props: NowPlayingPanelProps) {
  const { openMenu } = useContextMenu();
  const { lyrics, onExplain } = props;
  // ПКМ по тексту (2026-07-21): цель "lyrics" — копировать всё/строку, смысл
  const openLyricsMenu = (e: React.MouseEvent, i: number | null) =>
    openMenu(e, {
      kind: "lyrics",
      allText: lyrics.map((l) => l.text).join("\n"),
      // пустая инструментальная строка («•••») — копировать нечего
      lineText: i !== null ? lyrics[i]?.text || null : null,
      lineIndex: i,
      hasNote: i !== null && !!lyrics[i]?.note,
      ctl: { explain: onExplain },
    });

  return <SharedNowPlayingPanel {...props} onLineContextMenu={openLyricsMenu} />;
}
