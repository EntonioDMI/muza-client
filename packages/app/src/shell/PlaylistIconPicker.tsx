import { useState } from "react";
import { Dialog } from "@muza/ui";
import { PLAYLIST_ICON_IDS, playlistIconUrl } from "@muza/core";
import { useT } from "../i18n";

/** Пикер иконки плейлиста (T47): диалог с сеткой всех 38 иконок манифеста
 *  @muza/core. Клик применяет сразу, без отдельного «Сохранить» (как пресеты
 *  ColorPicker); вызывающий код сам зовёт api.setPlaylistIcon и закрывает
 *  диалог. Текущая иконка подсвечена рамкой.
 *
 *  Э0 веб-паритета: сведён из ДВУХ копий, которые успели разъехаться —
 *  apps/desktop/src/shell/PlaylistIconPicker.tsx (инлайн-стили + useT, 90
 *  строк) и apps/web/src/components/PlaylistIconPicker.tsx (CSS-класс
 *  .icon-swatch + захардкоженный русский, 51 строка). Взято лучшее из обеих:
 *  - i18n через useT() (у веба перевода не было вообще — строка «Сменить
 *    иконку» стояла в JSX; теперь словарь общий);
 *  - инлайн-стили, а не className: пакет не должен зависеть от того, что в
 *    приложении-потребителе объявлен класс .icon-swatch (у десктопа его нет);
 *  - тач-таргеты ≥44px и auto-fill-сетка из веб-копии: на 375px диалог
 *    ужимается до 100%-48px и колонки подбираются без горизонтального скролла.
 *
 *  Директивы "use client" тут НЕТ намеренно (была в веб-копии): пакет их не
 *  содержит вообще, клиентскую границу держат приложения — веб входит сюда из
 *  уже клиентских page.tsx. Директива внутри пакета ломала бы сборку Vite
 *  («Module level directives cause errors when bundled»). */
interface PlaylistIconPickerProps {
  open: boolean;
  /** текущая иконка плейлиста — подсвечивается в сетке */
  currentIcon?: string | null;
  onClose: () => void;
  onPick: (icon: string) => void;
  /** запрос setPlaylistIcon в процессе — блокирует повторный клик */
  busy?: boolean;
}

function IconSwatch({ id, active, busy, onClick }: { id: string; active: boolean; busy: boolean; onClick: () => void }) {
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
        // ≥44px — минимальный тач-таргет: диалог живёт и на телефоне (веб)
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
          // Без этого сетка — единственный скролл в приложении с системным
          // «толстым» скроллбаром. thin — тот же паттерн, что у выпадающей
          // панели Select (@muza/ui); остальные скроллы ДС прячут полосу
          // совсем ("none"), но у сетки в диалоге полоса — единственный
          // намёк, что иконок больше, чем видно.
          scrollbarWidth: "thin",
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
