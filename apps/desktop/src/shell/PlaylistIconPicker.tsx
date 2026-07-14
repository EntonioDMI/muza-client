import { useState } from "react";
import { Dialog } from "@muza/ui";
import { PLAYLIST_ICON_IDS, playlistIconUrl } from "@muza/core";
import { useT } from "../i18n";

/** Пикер иконки плейлиста (T47b): диалог с сеткой всех 38 иконок манифеста
 *  @muza/core. Клик — сразу применяет (без отдельного «Сохранить»); вызывающий
 *  код (App.tsx) зовёт api.setPlaylistIcon и закрывает диалог сам. Текущая
 *  иконка подсвечена рамкой (как AccentSwatch в SettingsView). Своя копия в
 *  apps/desktop — не импортирует apps/web/src/components/PlaylistIconPicker.tsx
 *  (десктоп и веб держат независимые UI-компоненты поверх общего манифеста). */
interface PlaylistIconPickerProps {
  open: boolean;
  /** текущая иконка плейлиста — подсвечивается в сетке */
  currentIcon?: string | null;
  onClose: () => void;
  onPick: (icon: string) => void;
  /** запрос setPlaylistIcon в процессе — блокирует повторный клик */
  busy?: boolean;
}

function IconSwatch({
  id,
  active,
  busy,
  onClick,
}: {
  id: string;
  active: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={t("dialogs.iconPicker.iconAria", { id })}
      aria-pressed={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%",
        aspectRatio: "1",
        minWidth: 44,
        minHeight: 44,
        padding: 2,
        border: active ? "2px solid var(--text-1)" : "2px solid transparent",
        borderRadius: "var(--r-xs)",
        background: hover ? "var(--surface-3)" : "var(--surface-2)",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
        transition: "border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)",
      }}
    >
      <img
        src={playlistIconUrl(id)}
        alt=""
        width={44}
        height={44}
        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" }}
      />
    </button>
  );
}

export function PlaylistIconPicker({ open, currentIcon, onClose, onPick, busy = false }: PlaylistIconPickerProps) {
  const { t } = useT();
  return (
    <Dialog open={open} title={t("dialogs.iconPicker.title")} onClose={onClose} width={380}>
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
          <IconSwatch key={id} id={id} active={id === currentIcon} busy={busy} onClick={() => onPick(id)} />
        ))}
      </div>
    </Dialog>
  );
}
