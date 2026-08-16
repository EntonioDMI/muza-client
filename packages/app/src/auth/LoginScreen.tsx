import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Icon, Tabs } from "@muza/ui";
import { translate, type Lang, type TranslationKey, type TParams } from "../i18n";
import { ApiError, CredentialsSchema, EmailSchema, type MuzaApi, type Session, humanError } from "@muza/api-client";

/** Один экран входа на окно, поэтому id постоянный: связывает поля с текстом
 *  ошибки через aria-describedby. */
const AUTH_ERROR_ID = "auth-error";

/** Поле экрана входа.
 *
 *  ⚠️ Три вещи здесь не косметические, все три чинят вход (аудит 15.08):
 *  1. `name` + `autoComplete` — без них менеджер паролей не предлагает сохранить
 *     пароль и не умеет автозаполнить. Это была самая дорогая поломка экрана.
 *  2. Доступное имя. Плейсхолдер им быть не может: он исчезает при вводе, и
 *     скринридер остаётся без подписи ровно тогда, когда в поле уже что-то есть.
 *  3. Кольца фокуса больше не гасим. Инлайновый `outline: "none"` бил глобальное
 *     `:focus-visible` из tokens/base.css (инлайн сильнее авторского правила), и
 *     у полей входа не было видимого фокуса вообще. `SearchInput` делает так же,
 *     но его спасает обёртка `.muza-field:focus-within` — здесь её нет. */
function Field({
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
  name,
  autoComplete,
  invalid,
  describedBy,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  autoFocus?: boolean;
  name?: string;
  autoComplete?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      name={name}
      autoComplete={autoComplete}
      aria-label={placeholder}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? describedBy : undefined}
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
        width: "100%",
        boxSizing: "border-box",
      }}
    />
  );
}

/** Экран «проверь почту»: dead ≠ null — заявка умерла (expired/notfound),
 *  поллинг остановлен, остаётся только «Начать заново». */
type Confirm = { pendingId: string; email: string; dead: string | null };

export interface LoginScreenProps {
  api: MuzaApi;
  onSession: (s: Session) => void;
  lang: Lang;
  /** Выбор «отправлять анонимную статистику» при СОЗДАНИИ аккаунта. Не передан
   *  — строки согласия нет вовсе: она обещала бы выбор, которого у клиента нет
   *  (у веба статистики не существует, обещать её выключение было бы враньём). */
  onTelemetry?: (enabled: boolean) => void;
  /** Адрес логотипа: десктоп отдаёт файл, собранный Vite, веб — из public/.
   *  Пропом, а не импортом внутри пакета: `import glyph from "…svg"` каждый
   *  сборщик превращает во что-то своё (Vite — в строку, Next — в объект
   *  StaticImageData), и общий файл сломался бы на одном из клиентов. */
  glyphSrc: string;
  /** Почтовые возможности: вкладка «Восстановление» и необязательный email при
   *  регистрации (подтверждение письмом). Выключено — их просто нет, без серых
   *  заглушек: в вебе почта и восстановление пароля живут в приложении. */
  showEmailFeatures?: boolean;
  /** Кнопка «Продолжить анонимно» — аккаунт-на-устройстве. Вебу не подходит:
   *  его сессия анонимной не бывает (apps/web/src/session.tsx выбрасывает
   *  такую при восстановлении), кнопка водила бы по кругу login → home → login. */
  showAnonymous?: boolean;
  /** Заменяет подсказку под кнопкой (в вебе — строка про приложение для
   *  Windows): подсказки режимов рассказывают про почту, которой там нет. */
  footerNote?: string;
  /** Узкие экраны и вырезы: карточка ужимается по ширине окна, отступы обходят
   *  чёлку. Для десктопа выключено — окно уже 1024px не бывает (tauri.conf.json
   *  minWidth), вырезов у него нет, и раскладка обязана остаться прежней. */
  mobileSafe?: boolean;
}

/** Экран входа: вход/регистрация (email опционален — с ним verify-before-create),
 *  аноним = аккаунт-на-устройстве, честная модалка «синхронизации не будет» (№32).
 *  onTelemetry — выбор «отправлять анонимную статистику» при СОЗДАНИИ аккаунта
 *  (обычном или анонимном): раньше телеметрия включалась молча (жалоба
 *  2026-07-16 «хочу честнее»); вход в существующий аккаунт выбор не трогает —
 *  там уже действует галочка из настроек этого устройства.
 *
 *  Э2 веб-паритета: переехал из apps/desktop/src/auth/LoginScreen.tsx — веб
 *  писал свою форму по памяти (152 строки против 508), и первое, что видит
 *  человек, было «отдалённо похоже». Всё, что зависело от окружения десктопа
 *  (api, обработчик сессии, логотип, телеметрия), вынесено в пропсы; набор
 *  доступных возможностей — тоже пропсами, а не проверкой платформы внутри:
 *  пакет не должен знать, кто его рендерит. */
export function LoginScreen({
  api,
  onSession,
  lang,
  onTelemetry,
  glyphSrc,
  showEmailFeatures = true,
  showAnonymous = true,
  footerNote,
  mobileSafe = false,
}: LoginScreenProps) {
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
  /** Запрос письма в полёте. Кулдаун от повторных кликов не спасает: он
   *  выставляется ПОСЛЕ успешного ответа, а до него равен нулю. */
  const [resending, setResending] = useState(false);
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
            const msg = humanError(e, t("auth.errors.completeFailed"));
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
        setError(humanError(e, t("auth.errors.somethingWrong")));
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
    const wantEmail = showEmailFeatures && mode === "register" && trimmedEmail.length > 0;
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
      setError(humanError(e, t("auth.errors.somethingWrong")));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    // Занятость проверяем здесь: кнопка заперта только кулдауном, а он во время
    // самого запроса ещё нулевой — быстрые повторные клики слали повторные письма.
    if (!confirm || resending) return;
    setResending(true);
    setResendNote(null);
    try {
      await api.registerResend(confirm.pendingId);
      setCooldown(60);
      setResendNote(t("auth.check.resent"));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
        setConfirm((c) => (c ? { ...c, dead: e.message } : c));
      } else {
        setResendNote(humanError(e, t("auth.errors.resendFailed")));
      }
    } finally {
      setResending(false);
    }
  };

  const backToForm = () => {
    setConfirm(null);
    setResendNote(null);
    setError(null);
  };

  const goAnonymous = async () => {
    if (busy) return;
    setAnonDialog(false);
    setBusy(true);
    setError(null);
    try {
      const session = await api.loginAnonymous();
      onTelemetry?.(telemetryOk); // аноним — тоже создание аккаунта, выбор честный
      onSession(session);
    } catch (e) {
      // ⚠️ Здесь был try/finally БЕЗ catch: бросок (квота localStorage, приватный
      // режим Safari) уходил в никуда, диалог к тому моменту уже закрыт, занятость
      // снималась — и не происходило ровно ничего. Человек жал кнопку, и экран
      // молчал.
      setError(humanError(e, t("auth.errors.somethingWrong")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        // fixed вместо absolute только на вебе: там страница живёт в обычном
        // документе и absolute уехал бы вместе со скроллом, а в десктопе корень
        // и так размером с окно — менять позиционирование незачем.
        position: mobileSafe ? "fixed" : "absolute",
        inset: 0,
        background: "var(--bg-0)",
        display: "flex",
        justifyContent: "center",
        overflowY: "auto", // низкое окно: карточка прокручивается, а не режется
        ...(mobileSafe
          ? {
              // Безопасные зоны: в standalone на iPhone экран отдаётся целиком,
              // включая чёлку. Карточка обычно отцентрована и её не задевает, но
              // при overflowY:auto (маленький экран, крупный шрифт, ландшафт)
              // верх уехал бы под Dynamic Island.
              padding: "var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)",
              boxSizing: "border-box" as const,
            }
          : null),
      }}
    >
      <div
        className="muza-view"
        style={{
          // border-box только вместе с зажимом ширины: на десктопе ширина 380
          // считается ПО СОДЕРЖИМОМУ (content-box), и переключение модели
          // сжало бы карточку на два padding'а — то есть на пиксели.
          width: mobileSafe ? "min(380px, calc(100vw - 32px))" : 380,
          ...(mobileSafe ? { boxSizing: "border-box" as const } : null),
          margin: "auto", // safe-центрирование: при нехватке высоты прижимается, не обрезаясь
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-5)",
          padding: "var(--sp-7)",
          borderRadius: "var(--r-lg)",
          // Карточка входа лежит прямо на --bg-0, а не внутри зоны, поэтому ей
          // нужен МАТЕРИАЛ, а не плёнка элевации: плёнка на голом фоне почти не
          // видна (шкала плёнок нарочно тонкая, см. tokens/glass.css).
          background: "var(--glass-zone)",
          flex: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", justifyContent: "center" }}>
          <img src={glyphSrc} alt="" style={{ width: 30, height: 34 }} />
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
                <Button variant="ghost" disabled={cooldown > 0 || resending} onClick={resend} style={{ width: "100%" }}>
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
                ...(showEmailFeatures ? [{ key: "recover", label: t("auth.tabs.recover") }] : []),
              ]}
              value={mode}
              onChange={(m: string) => {
                setMode(m);
                setError(null);
                setNotice(null);
              }}
            />
            {/* Настоящая <form> (15.08). Раньше здесь был <div onKeyDown>, потому
                что Button из ДС зашивал type="button"; теперь у него есть проп
                type, и форма стала возможной. Это не косметика: без формы и без
                name/autoComplete у полей браузер не предлагал сохранить пароль и
                плохо автозаполнял вход. Enter по-прежнему работает из любого
                поля — теперь родной семантикой, а не перехватом. */}
            <form
              /* Зазор формы = зазор карточки (sp-5), поля внутри держат свой
                 sp-3. Так кнопка отправки попала ВНУТРЬ формы (без этого
                 type="submit" ничего не отправляет), а расстояния на экране
                 остались ровно прежними. */
              style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}
              onSubmit={(e) => {
                e.preventDefault();
                if (busy) return;
                void submit();
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {mode !== "recover" ? (
                <Field
                  value={username}
                  onChange={setUsername}
                  placeholder={t("auth.fields.username")}
                  autoFocus
                  name="username"
                  autoComplete="username"
                  invalid={!!error}
                  describedBy={AUTH_ERROR_ID}
                />
              ) : null}
              {showEmailFeatures && mode !== "login" ? (
                <Field
                  value={email}
                  onChange={setEmail}
                  placeholder={mode === "recover" ? t("auth.fields.emailAccount") : t("auth.fields.emailOptional")}
                  type="email"
                  autoFocus={mode === "recover"}
                  name="email"
                  autoComplete="email"
                  invalid={!!error}
                  describedBy={AUTH_ERROR_ID}
                />
              ) : null}
              {mode !== "recover" ? (
                <Field
                  value={password}
                  onChange={setPassword}
                  placeholder={t("auth.fields.password")}
                  type="password"
                  name="password"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  invalid={!!error}
                  describedBy={AUTH_ERROR_ID}
                />
              ) : null}
              {/* role="alert" — отказ входа обязан прозвучать. Без него человек
                  со скринридером отправлял форму и не узнавал, что не вышло. */}
              {error ? (
                <div
                  id={AUTH_ERROR_ID}
                  role="alert"
                  style={{ color: "var(--danger)", fontSize: "var(--fs-caption)", fontFamily: "var(--font-ui)" }}
                >
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
              {mode === "register" && onTelemetry ? (
                <div style={{ marginTop: "var(--sp-2)" }}>
                  <ConsentRow t={t} checked={telemetryOk} onToggle={() => setTelemetryOk((v) => !v)} onMore={() => setTelemetryInfo(true)} />
                </div>
              ) : null}
              </div>
              <Button variant="primary" size="lg" type="submit" disabled={busy} style={{ width: "100%" }}>
                {mode === "login" ? t("auth.submit.login") : mode === "register" ? t("auth.submit.register") : t("auth.submit.recover")}
              </Button>
            </form>
            {showAnonymous ? (
              <Button variant="ghost" disabled={busy} onClick={() => setAnonDialog(true)} style={{ width: "100%" }}>
                {t("auth.continueAnon")}
              </Button>
            ) : null}
            <div
              style={{
                fontSize: "var(--fs-caption)",
                color: "var(--text-3)",
                fontFamily: "var(--font-ui)",
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              {footerNote ??
                (mode === "login"
                  ? t("auth.hint.login")
                  : mode === "register"
                    ? t("auth.hint.register")
                    : t("auth.hint.recover"))}
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
        {onTelemetry ? (
          <div style={{ marginTop: "var(--sp-4)" }}>
            <ConsentRow t={t} checked={telemetryOk} onToggle={() => setTelemetryOk((v) => !v)} onMore={() => setTelemetryInfo(true)} />
          </div>
        ) : null}
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
          transition: "background var(--dur-state) var(--ease-standard)",
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
