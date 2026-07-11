import { useState } from "react";
import { Button, Dialog, Icon, SearchInput, Tooltip, IconButton } from "@muza/ui";
import type { JamUi } from "../player/useJam";

/** Jam — «слушать вместе» (Stage 7). Вне jam: создать или войти по коду.
 *  В jam: код, участники, у гостя — подпись «управляет хост». */
export function JamDialog({
  jam,
  open,
  canUse,
  onClose,
  onNotify,
}: {
  jam: JamUi;
  open: boolean;
  /** false у анонима — jam требует серверного аккаунта. */
  canUse: boolean;
  onClose: () => void;
  onNotify: (text: string, icon?: string) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    if (code.trim().length < 4) {
      setError("Код короче 4 символов — проверь его");
      return;
    }
    setError(null);
    try {
      await jam.join(code);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти");
    }
  };

  const copyCode = async () => {
    if (!jam.code) return;
    try {
      await navigator.clipboard.writeText(jam.code);
      onNotify("Код скопирован — зови друзей", "copy");
    } catch {
      onNotify("Не удалось скопировать", "x");
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
      title="Jam — слушать вместе"
      onClose={onClose}
      actions={
        jam.active ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Свернуть
            </Button>
            <Button variant="secondary" icon={jam.isHost ? "square" : "log-out"} onClick={() => void jam.leave().then(onClose)}>
              {jam.isHost ? "Завершить jam" : "Выйти из jam"}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", minWidth: 340, maxWidth: 420 }}>
        {!canUse ? (
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
            Jam живёт на сервере — нужен вход с аккаунтом (аноним слушает один).
          </div>
        ) : jam.active ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              <span style={caps}>Код jam</span>
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
                <Tooltip label="Скопировать код">
                  <IconButton icon="copy" label="Скопировать код" onClick={() => void copyCode()} />
                </Tooltip>
              </div>
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
                {jam.isHost
                  ? "Ты управляешь воспроизведением. Друзья входят по коду и слушают то же самое — каждый со своего аккаунта."
                  : `Управляет ${jam.hostName}. Ты можешь докидывать треки: «⋯ → В jam» у любого трека.`}
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
                  Хост слушает {jam.hostState ? `«${jam.hostState.title}»` : "трек"} — он недоступен для стриминга (демо/локальный файл). Ждём следующий.
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              <span style={caps}>Слушают · {jam.members.length}</span>
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
                    <span style={{ marginLeft: "auto", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>хост</span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
              Слушайте музыку синхронно: хост управляет, остальные слышат то же самое.
              Каждый — со своего устройства и аккаунта.
            </div>
            <Button variant="primary" icon="radio-tower" disabled={jam.busy} onClick={() => void jam.create()}>
              Создать jam
            </Button>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <div style={{ flex: 1, height: 1, background: "var(--surface-3)" }} />
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>или войти по коду</span>
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
                    placeholder="Код, например M7QK2W"
                    icon="radio-tower"
                  />
                </div>
                <Button variant="secondary" icon="log-in" disabled={jam.busy} onClick={() => void join()}>
                  Войти
                </Button>
              </div>
              {error ? <div style={{ color: "var(--danger)", fontSize: "var(--fs-caption)" }}>{error}</div> : null}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
