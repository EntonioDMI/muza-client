"use client";

import { Dialog } from "@muza/ui";
import { PLAYLIST_ICON_IDS, playlistIconUrl } from "@muza/core";

/** Пикер иконки плейлиста (T47): диалог с сеткой всех 38 иконок манифеста
 *  @muza/core. Клик — сразу применяет (без отдельного «Сохранить», как
 *  ColorPicker пресеты). Тач-таргеты ≥44px (см. .icon-swatch), сетка сама
 *  подбирает число колонок под ширину диалога — на мобильном (375px, диалог
 *  ужимается до 100%-48px) без горизонтального скролла. */
interface PlaylistIconPickerProps {
  open: boolean;
  /** текущая иконка плейлиста — подсвечивается в сетке */
  currentIcon?: string | null;
  onClose: () => void;
  onPick: (icon: string) => void;
  /** запрос setPlaylistIcon в процессе — блокирует повторный клик */
  busy?: boolean;
}

export function PlaylistIconPicker({ open, currentIcon, onClose, onPick, busy = false }: PlaylistIconPickerProps) {
  return (
    <Dialog open={open} title="Сменить иконку" onClose={onClose} width={380}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
          gap: "var(--sp-2)",
          maxHeight: "min(60vh, 420px)",
          overflowY: "auto",
          overflowX: "hidden",
          paddingRight: 2,
        }}
      >
        {PLAYLIST_ICON_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={id === currentIcon ? "icon-swatch active" : "icon-swatch"}
            disabled={busy}
            aria-label={`Иконка ${id}`}
            aria-pressed={id === currentIcon}
            onClick={() => onPick(id)}
          >
            <img src={playlistIconUrl(id)} alt="" width={44} height={44} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
          </button>
        ))}
      </div>
    </Dialog>
  );
}
