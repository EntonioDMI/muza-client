import { useState } from "react";
import { Button, Dialog, SearchInput } from "@muza/ui";
import type { MuzaApi, PlaylistMeta } from "@muza/api-client";

/** Вход в совместный плейлист по инвайт-коду (Stage 7). Код выдаёт
 *  владелец: страница плейлиста → «Совместный доступ». */
export function JoinPlaylistDialog({
  api,
  open,
  onClose,
  onJoined,
}: {
  api: MuzaApi;
  open: boolean;
  onClose: () => void;
  /** Успешный вход: перечитать сайдбар и открыть плейлист. */
  onJoined: (playlist: PlaylistMeta) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setError("Код короче 4 символов — проверь его");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const playlist = await api.joinPlaylist(trimmed);
      setCode("");
      onJoined(playlist);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти по коду");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setError(null);
    setCode("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      title="Совместный плейлист по коду"
      onClose={close}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            Отмена
          </Button>
          <Button variant="primary" icon="users" disabled={busy} onClick={() => void join()}>
            {busy ? "Входим…" : "Войти"}
          </Button>
        </>
      }
    >
      <div
        style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 320 }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void join();
        }}
      >
        <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
          Введи код, который прислал владелец плейлиста, — и добавляйте треки вместе.
        </div>
        <SearchInput
          value={code}
          onChange={(v: string) => {
            setCode(v.toUpperCase());
            setError(null);
          }}
          placeholder="Например: 7WQK2M9T"
          icon="users"
          autoFocus
        />
        {error ? <div style={{ color: "var(--danger)", fontSize: "var(--fs-caption)" }}>{error}</div> : null}
      </div>
    </Dialog>
  );
}
