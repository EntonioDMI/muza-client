import { useState } from "react";
import { Button, Dialog, SearchInput } from "@muza/ui";
import type { MuzaApi, Track } from "@muza/api-client";

/** «Добавить по ссылке» (Stage 4): YT/YTM/SoundCloud/Bandcamp — как есть,
 *  Spotify/Apple Music — сервер сопоставит через Odesli. Добавленная ссылка
 *  становится выбранным источником трека (матчинг её не перебивает). */
export function AddLinkDialog({
  api,
  open,
  onClose,
  onAdded,
  onNotify,
}: {
  api: MuzaApi;
  open: boolean;
  onClose: () => void;
  /** Трек добавлен: App решает, что дальше (тост + «в плейлист»). */
  onAdded: (t: Track) => void;
  onNotify: (text: string, icon?: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = url.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const track = await api.addDirectTrack(value);
      setUrl("");
      onClose();
      onAdded(track);
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Не удалось добавить по ссылке", "x");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Добавить по ссылке"
      onClose={() => {
        if (!busy) onClose();
      }}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button variant="primary" icon="link" disabled={busy || !url.trim()} onClick={() => void submit()}>
            {busy ? "Добавляем…" : "Добавить"}
          </Button>
        </>
      }
    >
      <div
        style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 380 }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
      >
        <SearchInput value={url} onChange={setUrl} placeholder="https://…" icon="link" autoFocus />
        <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", lineHeight: 1.5 }}>
          YouTube, YouTube Music, SoundCloud, Bandcamp — добавятся как есть.
          Spotify и Apple Music — подберём играбельный источник автоматически.
        </div>
        {busy ? (
          <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
            Читаем метаданные — до полуминуты…
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
