import { useState } from "react";
import { Button, Dialog, Tabs } from "@muza/ui";
import glyph from "@muza/ui/assets/logo/glyph.svg";
import { CredentialsSchema, type MuzaApi, type Session } from "@muza/api-client";

function Field({
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        height: 48,
        padding: "0 var(--sp-4)",
        border: "none",
        borderRadius: "var(--r-md)",
        background: "var(--surface-3)",
        color: "var(--text-1)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body)",
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
      }}
    />
  );
}

/** Экран входа Stage 1 (мок-API). Аноним = аккаунт-на-устройстве, честная модалка
 *  «синхронизации не будет» — решение из каталога фич (№32). */
export function LoginScreen({ api, onSession }: { api: MuzaApi; onSession: (s: Session) => void }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [anonDialog, setAnonDialog] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const parsed = CredentialsSchema.safeParse({ username, password });
    if (!parsed.success) {
      setError("Имя — от 3 символов, пароль — от 8.");
      return;
    }
    setBusy(true);
    try {
      const session = mode === "login" ? await api.login(parsed.data) : await api.register(parsed.data);
      onSession(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Что-то пошло не так");
    } finally {
      setBusy(false);
    }
  };

  const goAnonymous = async () => {
    setAnonDialog(false);
    setBusy(true);
    try {
      onSession(await api.loginAnonymous());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--bg-0)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="muza-view"
        style={{
          width: 380,
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-5)",
          padding: "var(--sp-7)",
          borderRadius: "var(--r-lg)",
          background: "var(--surface-1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", justifyContent: "center" }}>
          <img src={glyph} alt="" style={{ width: 30, height: 34 }} />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 24,
              letterSpacing: "var(--ls-display)",
              color: "var(--text-1)",
            }}
          >
            Muza
          </span>
        </div>
        <Tabs
          items={[
            { key: "login", label: "Вход" },
            { key: "register", label: "Регистрация" },
          ]}
          value={mode}
          onChange={(m: string) => {
            setMode(m);
            setError(null);
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <Field value={username} onChange={setUsername} placeholder="Имя пользователя" autoFocus />
          <Field value={password} onChange={setPassword} placeholder="Пароль" type="password" />
          {error ? (
            <div style={{ color: "var(--danger)", fontSize: "var(--fs-caption)", fontFamily: "var(--font-ui)" }}>{error}</div>
          ) : null}
        </div>
        <Button variant="primary" size="lg" disabled={busy} onClick={submit} style={{ width: "100%" }}>
          {mode === "login" ? "Войти" : "Создать аккаунт"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setAnonDialog(true)} style={{ width: "100%" }}>
          Продолжить анонимно
        </Button>
        <div
          style={{
            fontSize: "var(--fs-caption)",
            color: "var(--text-3)",
            fontFamily: "var(--font-ui)",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Email не нужен. Никакой персональной истории прослушиваний.
        </div>
      </div>

      <Dialog
        open={anonDialog}
        title="Без синхронизации"
        onClose={() => setAnonDialog(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setAnonDialog(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="user" onClick={goAnonymous}>
              Продолжить
            </Button>
          </>
        }
      >
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
          Анонимный аккаунт живёт только на этом устройстве: плейлисты и лайки не будут синхронизироваться и не
          восстановятся при переустановке. Позже можно создать полноценный аккаунт в настройках.
        </div>
      </Dialog>
    </div>
  );
}
