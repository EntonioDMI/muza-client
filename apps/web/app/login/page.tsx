"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Tabs } from "@muza/ui";
import { ApiError, CredentialsSchema } from "@muza/api-client";
import { getApi } from "../../src/api";
import { useSession } from "../../src/session";

/** Вход веба: только серверные аккаунты (анонимного режима на вебе нет —
 *  без сервера браузеру нечем играть). Email-регистрация и восстановление
 *  пароля живут в десктопе — веб лёгкий. */

function Field({
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onEnter?.();
      }}
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

export default function LoginPage() {
  const { session, ready, setSession } = useSession();
  const router = useRouter();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace("/home");
  }, [ready, session, router]);

  const submit = async () => {
    setError(null);
    const parsed = CredentialsSchema.safeParse({ username, password });
    if (!parsed.success) {
      setError("Имя — от 3 символов, пароль — от 8.");
      return;
    }
    setBusy(true);
    try {
      const api = getApi();
      const s = mode === "login" ? await api.login(parsed.data) : await api.register(parsed.data);
      setSession(s);
      router.replace("/home");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Что-то пошло не так — попробуй ещё раз");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg-0)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          width: "min(380px, calc(100vw - 32px))",
          margin: "auto",
          padding: "var(--sp-6)",
          borderRadius: "var(--r-lg)",
          background: "var(--surface-1)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", justifyContent: "center", paddingBottom: "var(--sp-2)" }}>
          <img src="/glyph.svg" alt="" style={{ width: 26, height: 30 }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 22, letterSpacing: "var(--ls-display)", color: "var(--text-1)" }}>
            Muza
          </span>
        </div>
        <Tabs
          items={[
            { key: "login", label: "Вход" },
            { key: "register", label: "Регистрация" },
          ]}
          value={mode}
          onChange={setMode}
          stretch
        />
        <Field value={username} onChange={setUsername} placeholder="Имя пользователя" autoFocus />
        <Field value={password} onChange={setPassword} placeholder="Пароль" type="password" onEnter={submit} />
        {error ? (
          <p style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "#e5484d" }}>{error}</p>
        ) : null}
        <Button variant="primary" size="lg" disabled={busy} onClick={() => void submit()}>
          {busy ? "Секунду…" : mode === "login" ? "Войти" : "Создать аккаунт"}
        </Button>
        <p style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", textAlign: "center" }}>
          Почта, восстановление пароля и оффлайн — в приложении для Windows.
        </p>
      </div>
    </div>
  );
}
