import { useState } from "react";
import { Button, Dialog, SearchInput } from "@muza/ui";
import type { MuzaApi, PlaylistMeta } from "@muza/api-client";
import { useT } from "../i18n";

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
  const { t } = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setError(t("dialogs.codeTooShort"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const playlist = await api.joinPlaylist(trimmed);
      setCode("");
      onJoined(playlist);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("dialogs.joinPlaylist.joinFailed"));
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
      title={t("dialogs.joinPlaylist.title")}
      onClose={close}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon="users" disabled={busy} onClick={() => void join()}>
            {busy ? t("dialogs.joinPlaylist.joining") : t("dialogs.joinPlaylist.join")}
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
          {t("dialogs.joinPlaylist.hint")}
        </div>
        <SearchInput
          value={code}
          onChange={(v: string) => {
            setCode(v.toUpperCase());
            setError(null);
          }}
          placeholder={t("dialogs.joinPlaylist.codePlaceholder")}
          icon="users"
          autoFocus
        />
        {error ? <div style={{ color: "var(--danger)", fontSize: "var(--fs-caption)" }}>{error}</div> : null}
      </div>
    </Dialog>
  );
}
