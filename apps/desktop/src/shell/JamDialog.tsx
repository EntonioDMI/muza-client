import { useState } from "react";
import { Button, Dialog, Icon, SearchInput, Tooltip, IconButton } from "@muza/ui";
import type { JamUi } from "../player/useJam";
import { useT } from "../i18n";

/** Jam — «слушать вместе» (Stage 7). Вне jam: создать или войти по коду.
 *  В jam: код, участники, у гостя — подпись «управляет хост». */
export function JamDialog({
  jam,
  open,
  canUse,
  apiHost,
  onClose,
  onNotify,
}: {
  jam: JamUi;
  open: boolean;
  /** false у анонима — jam требует серверного аккаунта. */
  canUse: boolean;
  /** Хост API в дев-сборке (в проде null) — jam живёт в Redis конкретного
   *  сервера, код с чужого бэкенда не подойдёт. См. lib/devApiHost.ts. */
  apiHost: string | null;
  onClose: () => void;
  onNotify: (text: string, icon?: string) => void;
}) {
  const { t, lang } = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    if (code.trim().length < 4) {
      setError(t("dialogs.codeTooShort"));
      return;
    }
    setError(null);
    try {
      await jam.join(code);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("dialogs.jam.joinFailed"));
    }
  };

  const copyCode = async () => {
    if (!jam.code) return;
    try {
      await navigator.clipboard.writeText(jam.code);
      onNotify(t("dialogs.jam.codeCopied"), "copy");
    } catch {
      onNotify(t("dialogs.copyFailed"), "x");
    }
  };

  const caps: React.CSSProperties = {
    fontSize: "var(--fs-caption)",
    fontWeight: 600,
    letterSpacing: "var(--ls-caps)",
    textTransform: "uppercase",
    color: "var(--text-3)",
  };

  return (
    <Dialog
      open={open}
      title={t("dialogs.jam.title")}
      onClose={onClose}
      actions={
        jam.active ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("listeningMode.minimize")}
            </Button>
            <Button variant="secondary" icon={jam.isHost ? "square" : "log-out"} onClick={() => void jam.leave().then(onClose)}>
              {jam.isHost ? t("dialogs.jam.endJam") : t("dialogs.jam.leaveJam")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t("dialogs.close")}
          </Button>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", minWidth: 340, maxWidth: 420 }}>
        {!canUse ? (
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
            {t("dialogs.jam.needsAccount")}
          </div>
        ) : jam.active ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              <span style={caps}>{t("dialogs.jam.codeLabel")}</span>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <code
                  style={{
                    flex: 1,
                    fontSize: 26,
                    fontWeight: 700,
                    letterSpacing: "0.22em",
                    color: "var(--text-1)",
                    background: "var(--surface-3)",
                    borderRadius: "var(--r-sm)",
                    padding: "var(--sp-3) var(--sp-4)",
                    textAlign: "center",
                  }}
                >
                  {jam.code}
                </code>
                <Tooltip label={t("dialogs.copyCode")}>
                  <IconButton icon="copy" label={t("dialogs.copyCode")} onClick={() => void copyCode()} />
                </Tooltip>
              </div>
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
                {jam.isHost
                  ? t("dialogs.jam.hostDescription")
                  : t("dialogs.jam.guestDescription", { host: jam.hostName })}
              </span>
              {jam.unavailable && !jam.isHost ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-2)",
                    fontSize: "var(--fs-caption)",
                    color: "var(--text-2)",
                    background: "var(--surface-2)",
                    borderRadius: "var(--r-sm)",
                    padding: "var(--sp-2) var(--sp-3)",
                  }}
                >
                  <Icon name="cloud-off" size={14} color="var(--text-3)" />
                  {t("dialogs.jam.hostUnavailable", {
                    track: jam.hostState
                      ? lang === "ru"
                        ? `«${jam.hostState.title}»`
                        : `"${jam.hostState.title}"`
                      : t("dialogs.jam.genericTrack"),
                  })}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              <span style={caps}>{t("dialogs.jam.listening", { count: jam.members.length })}</span>
              {jam.members.map((m) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minHeight: 32 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "var(--accent-soft)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                    }}
                  >
                    <Icon name={m.username === jam.hostName ? "crown" : "headphones"} size={14} color="var(--accent-text)" />
                  </span>
                  <span style={{ fontSize: "var(--fs-body)", color: "var(--text-1)" }}>{m.username}</span>
                  {m.username === jam.hostName ? (
                    <span style={{ marginLeft: "auto", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("dialogs.jam.hostBadge")}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
              {t("dialogs.jam.intro")}
            </div>
            <Button variant="primary" icon="radio-tower" disabled={jam.busy} onClick={() => void jam.create()}>
              {t("dialogs.jam.create")}
            </Button>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <div style={{ flex: 1, height: 1, background: "var(--surface-3)" }} />
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("dialogs.jam.orJoinByCode")}</span>
              <div style={{ flex: 1, height: 1, background: "var(--surface-3)" }} />
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void join();
              }}
            >
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <div style={{ flex: 1 }}>
                  <SearchInput
                    value={code}
                    onChange={(v: string) => {
                      setCode(v.toUpperCase());
                      setError(null);
                    }}
                    placeholder={t("dialogs.jam.codePlaceholder")}
                    icon="radio-tower"
                  />
                </div>
                <Button variant="secondary" icon="log-in" disabled={jam.busy} onClick={() => void join()}>
                  {t("dialogs.jam.join")}
                </Button>
              </div>
              {error ? <div style={{ color: "var(--danger)", fontSize: "var(--fs-caption)" }}>{error}</div> : null}
              {apiHost ? (
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
                  <Icon name="server" size={13} color="var(--text-3)" />
                  {t("dialogs.devBackend", { host: apiHost })}
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
