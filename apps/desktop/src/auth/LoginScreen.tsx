import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Icon, Tabs } from "@muza/ui";
import { translate, type Lang, type TranslationKey, type TParams } from "../i18n";
import glyph from "@muza/ui/assets/logo/glyph.svg";
import { ApiError, CredentialsSchema, EmailSchema, type MuzaApi, type Session } from "@muza/api-client";

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

/** Экран «проверь почту»: dead ≠ null — заявка умерла (expired/notfound),
 *  поллинг остановлен, остаётся только «Начать заново». */
type Confirm = { pendingId: string; email: string; dead: string | null };

/** Экран входа: вход/регистрация (email опционален — с ним verify-before-create),
 *  аноним = аккаунт-на-устройстве, честная модалка «синхронизации не будет» (№32).
 *  onTelemetry — выбор «отправлять анонимную статистику» при СОЗДАНИИ аккаунта
 *  (обычном или анонимном): раньше телеметрия включалась молча (жалоба
 *  2026-07-16 «хочу честнее»); вход в существующий аккаунт выбор не трогает —
 *  там уже действует галочка из настроек этого устройства. */
export function LoginScreen({
  api,
  onSession,
  lang,
  onTelemetry,
}: {
  api: MuzaApi;
  onSession: (s: Session) => void;
  lang: Lang;
  onTelemetry?: (enabled: boolean) => void;
}) {
  // LoginScreen живёт ВНЕ <LanguageProvider> (показывается до сессии/Player), поэтому
  // язык приходит пропом (App.loadPrefs().language) и переводим через translate напрямую.
  const t = (key: TranslationKey, params?: TParams) => translate(lang, key, params);
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  // нейтральное сообщение (не ошибка) — например, статус восстановления
  const [notice, setNotice] = useState<string | null>(null);
  const [anonDialog, setAnonDialog] = useState(false);
  // Согласие на анонимную статистику — видимой галочкой при создании аккаунта
  // (снять можно; по умолчанию включено). telemetryInfo — диалог «что уходит».
  const [telemetryOk, setTelemetryOk] = useState(true);
  const [telemetryInfo, setTelemetryInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const completingRef = useRef(false);

  // тик кулдауна повторной отправки письма
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // поллинг статуса заявки, пока открыт экран «проверь почту»
  useEffect(() => {
    if (!confirm || confirm.dead) return;
    let cancelled = false;
    const tick = async () => {
      if (completingRef.current) return;
      let status;
      try {
        status = await api.registerStatus(confirm.pendingId);
      } catch {
        return; // сервер недоступен — попробуем в следующий тик
      }
      if (cancelled) return;
      if (status === "verified") {
        completingRef.current = true;
        try {
          const session = await api.registerComplete(confirm.pendingId);
          if (!cancelled) {
            onTelemetry?.(telemetryOk); // выбор сделан на форме регистрации
            onSession(session);
          }
        } catch (e) {
          if (!cancelled) {
            const msg = e instanceof Error ? e.message : t("auth.errors.completeFailed");
            setConfirm((c) => (c ? { ...c, dead: msg } : c));
          }
        } finally {
          completingRef.current = false;
        }
      } else if (status === "expired") {
        setConfirm((c) => (c ? { ...c, dead: t("auth.errors.expired") } : c));
      } else if (status === "notfound") {
        setConfirm((c) => (c ? { ...c, dead: t("auth.errors.notFound") } : c));
      }
    };
    tick();
    const iv = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [api, confirm, onSession]);

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (mode === "recover") {
      if (!EmailSchema.safeParse(email.trim()).success) {
        setError(t("auth.errors.notEmail"));
        return;
      }
      setBusy(true);
      try {
        await api.recoveryStart(email.trim());
        // сервер всегда 204: формулировка не выдаёт, есть ли такая почта
        setNotice(t("auth.recoverySent"));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("auth.errors.somethingWrong"));
      } finally {
        setBusy(false);
      }
      return;
    }
    const parsed = CredentialsSchema.safeParse({ username, password });
    if (!parsed.success) {
      setError(t("auth.errors.credsTooShort"));
      return;
    }
    const trimmedEmail = email.trim();
    const wantEmail = mode === "register" && trimmedEmail.length > 0;
    if (wantEmail && !EmailSchema.safeParse(trimmedEmail).success) {
      setError(t("auth.errors.notEmail"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        onSession(await api.login(parsed.data));
      } else if (wantEmail) {
        const started = await api.registerStart({ ...parsed.data, email: trimmedEmail });
        setResendNote(null);
        setCooldown(30); // письмо только что ушло
        setConfirm({ pendingId: started.pendingId, email: started.email, dead: null });
      } else {
        const session = await api.register(parsed.data);
        onTelemetry?.(telemetryOk);
        onSession(session);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.errors.somethingWrong"));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!confirm) return;
    setResendNote(null);
    try {
      await api.registerResend(confirm.pendingId);
      setCooldown(60);
      setResendNote(t("auth.check.resent"));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
        setConfirm((c) => (c ? { ...c, dead: e.message } : c));
      } else {
        setResendNote(e instanceof Error ? e.message : t("auth.errors.resendFailed"));
      }
    }
  };

  const backToForm = () => {
    setConfirm(null);
    setResendNote(null);
    setError(null);
  };

  const goAnonymous = async () => {
    setAnonDialog(false);
    setBusy(true);
    try {
      const session = await api.loginAnonymous();
      onTelemetry?.(telemetryOk); // аноним — тоже создание аккаунта, выбор честный
      onSession(session);
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
        justifyContent: "center",
        overflowY: "auto", // низкое окно: карточка прокручивается, а не режется
      }}
    >
      <div
        className="muza-view"
        style={{
          width: 380,
          margin: "auto", // safe-центрирование: при нехватке высоты прижимается, не обрезаясь
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-5)",
          padding: "var(--sp-7)",
          borderRadius: "var(--r-lg)",
          background: "var(--surface-1)",
          flex: "none",
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

        {confirm ? (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--sp-4)",
                textAlign: "center",
              }}
            >
              <Icon
                name={confirm.dead ? "mail-x" : "mail-check"}
                size={40}
                color={confirm.dead ? "var(--danger)" : "var(--accent)"}
              />
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, color: "var(--text-1)" }}>
                {t("auth.check.title")}
              </div>
              <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
                {t("auth.check.sentToPrefix")}
                <span style={{ color: "var(--text-1)" }}>{confirm.email}</span>
                {t("auth.check.sentToSuffix")}
              </div>
              <div
                style={{
                  color: confirm.dead ? "var(--danger)" : "var(--text-3)",
                  fontSize: "var(--fs-caption)",
                  fontFamily: "var(--font-ui)",
                }}
              >
                {confirm.dead ?? t("auth.check.waiting")}
              </div>
              {resendNote ? (
                <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", fontFamily: "var(--font-ui)" }}>
                  {resendNote}
                </div>
              ) : null}
            </div>
            {confirm.dead ? (
              <Button variant="primary" size="lg" onClick={backToForm} style={{ width: "100%" }}>
                {t("auth.check.startOver")}
              </Button>
            ) : (
              <>
                <Button variant="ghost" disabled={cooldown > 0} onClick={resend} style={{ width: "100%" }}>
                  {cooldown > 0 ? t("auth.check.resendIn", { count: cooldown }) : t("auth.check.resend")}
                </Button>
                <Button variant="ghost" onClick={backToForm} style={{ width: "100%" }}>
                  {t("auth.check.back")}
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            <Tabs
              stretch
              items={[
                { key: "login", label: t("auth.tabs.login") },
                { key: "register", label: t("auth.tabs.register") },
                { key: "recover", label: t("auth.tabs.recover") },
              ]}
              value={mode}
              onChange={(m: string) => {
                setMode(m);
                setError(null);
                setNotice(null);
              }}
            />
            {/* Enter = главная кнопка, как в вебе и как в любой нативной форме.
                <form> тут не годится: Button из ДС хардкодит type="button" и не
                может стать submit-кнопкой. Обёртка ловит Enter из ЛЮБОГО поля
                (native-семантика формы), а не только из последнего. */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || busy) return;
                e.preventDefault();
                void submit();
              }}
            >
              {mode !== "recover" ? (
                <Field value={username} onChange={setUsername} placeholder={t("auth.fields.username")} autoFocus />
              ) : null}
              {mode !== "login" ? (
                <Field
                  value={email}
                  onChange={setEmail}
                  placeholder={mode === "recover" ? t("auth.fields.emailAccount") : t("auth.fields.emailOptional")}
                  type="email"
                  autoFocus={mode === "recover"}
                />
              ) : null}
              {mode !== "recover" ? (
                <Field value={password} onChange={setPassword} placeholder={t("auth.fields.password")} type="password" />
              ) : null}
              {error ? (
                <div style={{ color: "var(--danger)", fontSize: "var(--fs-caption)", fontFamily: "var(--font-ui)" }}>
                  {error}
                </div>
              ) : null}
              {notice ? (
                <div style={{ color: "var(--text-2)", fontSize: "var(--fs-caption)", fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
                  {notice}
                </div>
              ) : null}
              {/* Согласие на анонимную статистику — только там, где аккаунт
                  СОЗДАЁТСЯ: раньше галочка включалась молча (жалоба 2026-07-16).
                  marginTop добивает зазор полей (sp-3) до зазора карточки (sp-5):
                  сверху и снизу строки одинаково — она пауза между формой и
                  кнопкой, а не прилипший к полям хвост (правка 2026-07-16). */}
              {mode === "register" ? (
                <div style={{ marginTop: "var(--sp-2)" }}>
                  <ConsentRow t={t} checked={telemetryOk} onToggle={() => setTelemetryOk((v) => !v)} onMore={() => setTelemetryInfo(true)} />
                </div>
              ) : null}
            </div>
            <Button variant="primary" size="lg" disabled={busy} onClick={submit} style={{ width: "100%" }}>
              {mode === "login" ? t("auth.submit.login") : mode === "register" ? t("auth.submit.register") : t("auth.submit.recover")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setAnonDialog(true)} style={{ width: "100%" }}>
              {t("auth.continueAnon")}
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
              {mode === "login"
                ? t("auth.hint.login")
                : mode === "register"
                  ? t("auth.hint.register")
                  : t("auth.hint.recover")}
            </div>
          </>
        )}
      </div>

      <Dialog
        open={anonDialog}
        title={t("auth.anon.title")}
        onClose={() => setAnonDialog(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setAnonDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="user" onClick={goAnonymous}>
              {t("auth.anon.continue")}
            </Button>
          </>
        }
      >
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
          {t("auth.anon.body")}
        </div>
        {/* аноним — тоже создание аккаунта: тот же честный выбор */}
        <div style={{ marginTop: "var(--sp-4)" }}>
          <ConsentRow t={t} checked={telemetryOk} onToggle={() => setTelemetryOk((v) => !v)} onMore={() => setTelemetryInfo(true)} />
        </div>
      </Dialog>

      {/* «Подробнее»: что именно уходит в анонимную статистику — честный список */}
      <Dialog open={telemetryInfo} title={t("auth.telemetry.title")} onClose={() => setTelemetryInfo(false)} width={440}>
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", fontFamily: "var(--font-ui)", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <div>{t("auth.telemetry.intro")}</div>
          <ul style={{ margin: 0, paddingLeft: "1.2em", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <li>{t("auth.telemetry.item1")}</li>
            <li>{t("auth.telemetry.item2")}</li>
            <li>{t("auth.telemetry.item3")}</li>
          </ul>
          <div style={{ color: "var(--text-1)" }}>{t("auth.telemetry.never")}</div>
          <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>{t("auth.telemetry.settingsNote")}</div>
        </div>
      </Dialog>
    </div>
  );
}

/** Строка согласия: квадратный чекбокс + подпись + «Подробнее». Свой чекбокс,
 *  а не Switch ДС: согласие в форме привычнее галочкой, тумблер здесь читался
 *  бы как настройка приложения, а не как выбор при создании аккаунта. */
function ConsentRow({
  t,
  checked,
  onToggle,
  onMore,
}: {
  t: (key: TranslationKey, params?: TParams) => string;
  checked: boolean;
  onToggle: () => void;
  onMore: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontFamily: "var(--font-ui)" }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={t("auth.telemetry.label")}
        onClick={onToggle}
        style={{
          flex: "none",
          width: 20,
          height: 20,
          display: "grid",
          placeItems: "center",
          padding: 0,
          border: checked ? "none" : "2px solid var(--text-3)",
          borderRadius: "var(--r-xs)",
          background: checked ? "var(--accent)" : "transparent",
          cursor: "pointer",
          transition: "background var(--dur-fast) var(--ease-out)",
        }}
      >
        {checked ? <Icon name="check" size={14} color="var(--text-on-accent, #fff)" strokeWidth={3} /> : null}
      </button>
      <span onClick={onToggle} style={{ color: "var(--text-2)", fontSize: "var(--fs-caption)", cursor: "pointer", lineHeight: 1.4 }}>
        {t("auth.telemetry.label")}
      </span>
      <button
        type="button"
        onClick={onMore}
        style={{
          flex: "none",
          marginLeft: "auto",
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--accent-text)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-caption)",
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        {t("auth.telemetry.more")}
      </button>
    </div>
  );
}
