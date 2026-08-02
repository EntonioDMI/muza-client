/** Пенёк полноэкранного режима: сам оверлей переехал в
 *  @muza/app/shell/ListeningMode (Э7 веб-паритета) — караоке, визуализатор и
 *  качание при басах не знают ни одной платформенной вещи.
 *
 *  Обёртка, а не голый ре-экспорт, по той же причине, что у NowPlayingPanel
 *  рядом: ПКМ по тексту берётся из провайдера меню приложения. Пропы и DOM
 *  прежние — App.tsx о переезде не знает, тесты (ListeningMode.test.tsx,
 *  MeaningDialog.test.tsx, LyricsMeaning.test.tsx) ходят через этот файл и
 *  проверяют уже общий оверлей. */
import type { ComponentProps, MouseEvent as ReactMouseEvent } from "react";
import { ListeningMode as SharedListeningMode } from "@muza/app/shell/ListeningMode";
import type { LyricLine, PlayerTrack } from "../player/types";
import { useContextMenu } from "./ContextMenu";

type SharedProps = ComponentProps<typeof SharedListeningMode>;

/** Типы трека и строк — десктопные (общий оверлей описывает структурный
 *  минимум, PlayerTrack/LyricLine под него подходят); onExplain у приложения
 *  был и остаётся обязательным. */
export type ListeningModeProps = Omit<SharedProps, "track" | "lyrics" | "onExplain" | "onLineContextMenu"> & {
  track: PlayerTrack;
  lyrics: LyricLine[];
  onExplain: (index: number) => void;
};

export function ListeningMode(props: ListeningModeProps) {
  const { openMenu } = useContextMenu();
  const { lyrics, onExplain } = props;
  // ПКМ по тексту (2026-07-21): та же цель "lyrics", что в NowPlayingPanel
  const openLyricsMenu = (e: ReactMouseEvent, i: number | null) =>
    openMenu(e, {
      kind: "lyrics",
      allText: lyrics.map((l) => l.text).join("\n"),
      lineText: i !== null ? lyrics[i]?.text || null : null,
      lineIndex: i,
      hasNote: i !== null && !!lyrics[i]?.note,
      ctl: { explain: onExplain },
    });

  return <SharedListeningMode {...props} onLineContextMenu={openLyricsMenu} />;
}
