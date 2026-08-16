import { useRef, useState } from "react";
import { Button, Dialog, Icon, SearchInput } from "@muza/ui";
import type { MuzaApi, PlaylistMeta } from "@muza/api-client";
import { useT } from "../i18n";
import { humanError } from "@muza/api-client";

/** Вход в совместный плейлист по инвайт-коду (Stage 7). Код выдаёт
 *  владелец: страница плейлиста → «Совместный доступ».
 *
 *  ⚠️ ПЕРЕЕХАЛО из apps/desktop/src/shell/JoinPlaylistDialog.tsx (волна
 *  экранов веб-паритета, 2026-08-02) — парный диалог к «Совместному доступу».
 *  Касаний площадки внутри нет: адрес дев-сервера приезжает пропом apiHost
 *  (у веба его нет — строки-подсказки тоже нет). */
export function JoinPlaylistDialog({
  api,
  open,
  apiHost,
  onClose,
  onJoined,
}: {
  api: MuzaApi;
  open: boolean;
  /** Хост API в дев-сборке (в проде null) — код живёт в базе конкретного
   *  сервера и с чужого бэкенда не подойдёт. См. lib/devApiHost.ts. */
  apiHost: string | null;
  onClose: () => void;
  /** Успешный вход: перечитать сайдбар и открыть плейлист. */
  onJoined: (playlist: PlaylistMeta) => void;
}) {
  const { t } = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Отмена во время запроса. Ответ всё равно приедет — сервер уже принял
   *  вступление, — но уводить человека в плейлист, который он только что
   *  передумал открывать, нельзя. Флаг живёт в ref: `close()` меняет его
   *  синхронно, а `join()` читает уже после await. */
  const cancelled = useRef(false);

  const join = async () => {
    // Проверка ВНУТРИ, а не только у кнопки: Enter в диалоге идёт мимо disabled.
    if (busy) return;
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setError(t("dialogs.codeTooShort"));
      return;
    }
    cancelled.current = false;
    setBusy(true);
    setError(null);
    try {
      const playlist = await api.joinPlaylist(trimmed);
      if (cancelled.current) return;
      setCode("");
      onJoined(playlist);
    } catch (e) {
      if (!cancelled.current) setError(humanError(e, t("dialogs.joinPlaylist.joinFailed")));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    cancelled.current = true;
    setError(null);
    setCode("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={t("dialogs.joinPlaylist.title")}
      icon="key-round"
      closeLabel={t("dialogs.close")}
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
        {apiHost ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
            <Icon name="server" size={13} color="var(--text-3)" />
            {t("dialogs.devBackend", { host: apiHost })}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
