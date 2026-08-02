/** ПОД-ЭКРАН «СЕССИИ И УСТРОЙСТВА»: где ещё открыт этот аккаунт и как оттуда
 *  выйти.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки. */

import { useEffect, useState } from "react";
import { Button } from "@muza/ui";
import { ApiError, type SessionInfo } from "@muza/api-client";
import { useT, type TranslationKey, type TParams } from "../../i18n";
import { paneStyle, RowValue, SettingRow, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

/** Человеческое имя устройства из строки, которой представился клиент.
 *  Эвристика грубая нарочно: точное имя устройства нам никто не сообщает, а
 *  «Windows · Muza» отвечает на вопрос «это я или не я» ничуть не хуже. */
function deviceLabel(ua: string | null, t: (key: TranslationKey, params?: TParams) => string): string {
  if (!ua) return t("settings.account.sessions.unknownDevice");
  const low = ua.toLowerCase();
  const os = low.includes("windows")
    ? "Windows"
    : low.includes("android")
      ? "Android"
      : low.includes("iphone") || low.includes("ipad")
        ? "iOS"
        : low.includes("mac")
          ? "macOS"
          : low.includes("linux")
            ? "Linux"
            : t("settings.account.sessions.genericDevice");
  const app = low.includes("muza") || low.includes("tauri") ? "Muza" : t("settings.account.sessions.browser");
  return `${os} · ${app}`;
}

export function SessionsSub() {
  const { t, lang } = useT();
  const { api, serverSession, onNotify, closeSub, paneClass } = useSettingsScreen();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);

  useEffect(() => {
    if (!serverSession) return;
    let alive = true;
    api
      .listSessions()
      .then((s) => {
        if (alive) setSessions(s);
      })
      .catch(() => {
        if (alive) setSessions([]);
      });
    return () => {
      alive = false;
    };
  }, [serverSession, api]);

  const revoke = async (id: string) => {
    try {
      await api.revokeSession(id);
      setSessions((list) => list?.filter((s) => s.id !== id) ?? list);
      onNotify(t("settings.account.sessions.revoked"), "shield-check");
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : t("settings.account.sessions.errors.revokeFailed"), "x");
    }
  };

  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.account.sessions.title")} onBack={closeSub} />
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.account.sessions.hint")}</div>
      {sessions === null ? (
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("common.loading")}</div>
      ) : sessions.length === 0 ? (
        <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.account.sessions.loadFailed")}</div>
      ) : (
        sessions.map((s) => (
          <SettingRow
            key={s.id}
            title={`${deviceLabel(s.userAgent, t)}${s.current ? ` · ${t("settings.account.sessions.currentSuffix")}` : ""}`}
            hint={`${s.ip ?? t("settings.account.sessions.unknownIp")} · ${new Date(s.createdAt).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
          >
            {s.current ? (
              <RowValue>{t("settings.account.sessions.thisDevice")}</RowValue>
            ) : (
              <Button variant="ghost" icon="log-out" onClick={() => void revoke(s.id)}>
                {t("settings.account.sessions.signOut")}
              </Button>
            )}
          </SettingRow>
        ))
      )}
    </div>
  );
}
