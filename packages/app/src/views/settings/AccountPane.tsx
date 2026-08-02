/** РАЗДЕЛ «АККАУНТ»: кто вошёл, почта, пароль, устройства и приватность.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки. Диалоги смены пароля и почты переехали
 *  ВМЕСТЕ с рядами, которые их открывают: раньше они лежали в подвале
 *  четырёхтысячестрочного файла, за полторы тысячи строк от своей кнопки.
 *
 *  Диалоги нарисованы СОСЕДОМ панели, а не внутри неё: панель на время
 *  анимации появления держит transform, а внутри трансформированного предка
 *  `position: fixed` считается от него — модалка уехала бы (замер и подробности
 *  в шапке settingsShell.css).
 *
 *  У анонима (serverSession=false) серверные ряды не исчезают, а честно
 *  говорят «нужен аккаунт» и не кликаются: это не «умение площадки», а
 *  состояние входа — человек может войти прямо сейчас и увидеть их живыми. */

import { useState } from "react";
import { Button, Dialog, Switch } from "@muza/ui";
import { ApiError } from "@muza/api-client";
import { useT } from "../../i18n";
import { GroupTitle, paneStyle, SettingInput, SettingRow } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export function AccountPane() {
  const { t } = useT();
  const { prefs, set, api, serverSession, username, onLogout, onNotify, openSub, paneClass, platform } = useSettingsScreen();
  const openExternal = platform.system?.openExternal;

  // Смена пароля: старый → новый → повтор.
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdCur, setPwdCur] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdRepeat, setPwdRepeat] = useState("");
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);
  const openPwd = () => {
    setPwdCur("");
    setPwdNew("");
    setPwdRepeat("");
    setPwdErr(null);
    setPwdOpen(true);
  };
  const submitPwd = async () => {
    if (pwdNew.length < 8) {
      setPwdErr(t("settings.account.password.errors.tooShort"));
      return;
    }
    if (pwdNew !== pwdRepeat) {
      setPwdErr(t("settings.account.password.errors.mismatch"));
      return;
    }
    setPwdBusy(true);
    setPwdErr(null);
    try {
      await api.changePassword(pwdCur, pwdNew);
      setPwdOpen(false);
      onNotify(t("settings.account.password.changed"), "shield-check");
    } catch (e) {
      setPwdErr(e instanceof ApiError ? e.message : t("settings.account.password.errors.changeFailed"));
    } finally {
      setPwdBusy(false);
    }
  };

  // Смена почты: пароль + новый адрес → письмо на новый адрес.
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailPwd, setEmailPwd] = useState("");
  const [emailNew, setEmailNew] = useState("");
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  // Отправка писем на сервере может быть выключена — тогда сервер отдаёт
  // ссылку подтверждения в ответе, и её больше негде увидеть.
  const [emailConfirmUrl, setEmailConfirmUrl] = useState<string | null>(null);
  const openEmailChange = () => {
    setEmailPwd("");
    setEmailNew("");
    setEmailErr(null);
    setEmailConfirmUrl(null);
    setEmailOpen(true);
  };
  const closeEmailChange = () => {
    setEmailOpen(false);
    setEmailConfirmUrl(null);
  };
  const submitEmailChange = async () => {
    if (!emailNew.includes("@")) {
      setEmailErr(t("settings.account.email.errors.notAnEmail"));
      return;
    }
    setEmailBusy(true);
    setEmailErr(null);
    try {
      const { confirmUrl } = await api.changeEmail(emailPwd, emailNew.trim());
      if (confirmUrl) {
        // Письмо реально не ушло — держим диалог открытым со ссылкой
        setEmailConfirmUrl(confirmUrl);
      } else {
        setEmailOpen(false);
        onNotify(t("settings.account.email.sent"), "mail");
      }
    } catch (e) {
      // Общий текст + деталь от сервера (слишком часто, почта занята и т.п.)
      const detail = e instanceof ApiError ? e.message : null;
      setEmailErr(detail ? t("settings.account.email.errors.sendFailedDetail", { detail }) : t("settings.account.email.errors.sendFailed"));
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <>
      <div className={paneClass} style={paneStyle}>
        <SettingRow title={t("settings.account.profile.title")} hint={username}>
          <Button variant="ghost" icon="log-out" onClick={onLogout}>
            {t("settings.account.profile.signOut")}
          </Button>
        </SettingRow>
        <SettingRow
          title={t("settings.account.email.title")}
          hint={serverSession ? t("settings.account.email.hint") : t("settings.account.needsAccount")}
          onClick={serverSession ? openEmailChange : undefined}
          chevron={serverSession}
        ></SettingRow>
        <SettingRow
          title={t("settings.account.password.title")}
          hint={serverSession ? t("settings.account.password.hint") : t("settings.account.needsAccountPassword")}
          onClick={serverSession ? openPwd : undefined}
          chevron={serverSession}
        ></SettingRow>
        <SettingRow
          title={t("settings.account.sessions.rowTitle")}
          hint={serverSession ? t("settings.account.sessions.rowHint") : t("settings.account.needsAccountShort")}
          onClick={serverSession ? () => openSub("sessions") : undefined}
          chevron={serverSession}
        ></SettingRow>
        <GroupTitle>{t("settings.account.privacyGroup")}</GroupTitle>
        <SettingRow title={t("settings.account.telemetry.title")} hint={t("settings.account.telemetry.hint")}>
          <Switch checked={prefs.telemetry} onChange={(on: boolean) => set({ telemetry: on })} label={t("settings.account.telemetry.title")} />
        </SettingRow>
        <SettingRow
          title={t("settings.account.dataDoc.title")}
          hint={t("settings.account.dataDoc.hint")}
          onClick={() => openSub("data")}
          chevron
        ></SettingRow>
        <SettingRow
          title={t("settings.account.exportOrDelete.title")}
          hint={serverSession ? t("settings.account.exportOrDelete.hint") : t("settings.account.needsAccountServer")}
          onClick={serverSession ? () => openSub("privacy") : undefined}
          danger
          chevron={serverSession}
        ></SettingRow>
      </div>

      {/* Смена пароля: сервер разлогинит остальные устройства */}
      <Dialog
        open={pwdOpen}
        title={t("settings.account.password.dialogTitle")}
        onClose={() => setPwdOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPwdOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="shield-check" disabled={pwdBusy} onClick={() => void submitPwd()}>
              {pwdBusy ? t("settings.account.password.changing") : t("settings.account.password.submit")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <SettingInput type="password" value={pwdCur} onChange={setPwdCur} placeholder={t("settings.account.password.currentPlaceholder")} width={300} />
          <SettingInput type="password" value={pwdNew} onChange={setPwdNew} placeholder={t("settings.account.password.newPlaceholder")} width={300} />
          <SettingInput type="password" value={pwdRepeat} onChange={setPwdRepeat} placeholder={t("settings.account.password.repeatPlaceholder")} width={300} />
          {pwdErr ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{pwdErr}</div>
          ) : (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.account.password.otherDevicesNote")}</div>
          )}
        </div>
      </Dialog>

      {/* Смена почты: пароль + новый адрес → письмо на новый адрес */}
      <Dialog
        open={emailOpen}
        title={t("settings.account.email.dialogTitle")}
        onClose={closeEmailChange}
        actions={
          emailConfirmUrl ? (
            <Button variant="primary" onClick={closeEmailChange}>
              {t("settings.account.email.done")}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={closeEmailChange}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" icon="mail" disabled={emailBusy} onClick={() => void submitEmailChange()}>
                {emailBusy ? t("settings.account.email.sending") : t("settings.account.email.submit")}
              </Button>
            </>
          )
        }
      >
        {emailConfirmUrl ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 320 }}>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.5 }}>{t("settings.account.email.devNote")}</div>
            <Button
              variant="ghost"
              icon="external-link"
              onClick={() => void openExternal?.(emailConfirmUrl)}
              style={{ alignSelf: "flex-start" }}
            >
              {t("settings.account.email.openConfirmLink")}
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
            <SettingInput type="password" value={emailPwd} onChange={setEmailPwd} placeholder={t("settings.account.email.passwordPlaceholder")} width={300} />
            <SettingInput value={emailNew} onChange={setEmailNew} placeholder={t("settings.account.email.newEmailPlaceholder")} width={300} />
            {emailErr ? (
              <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{emailErr}</div>
            ) : (
              <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.account.email.confirmNote")}</div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
