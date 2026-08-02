/** РАЗДЕЛ «СИСТЕМА»: запуск вместе с системой, значок у часов, обновление,
 *  маленькое окно плеера, диагностика и «О программе».
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Самый «площадочный» раздел: почти каждый ряд держится на своём умении. У
 *  вкладки браузера нет ни автозапуска, ни значка у часов, ни обновления
 *  изнутри — и рядов там НЕТ ВОВСЕ, а не «серых, только в приложении». Серый
 *  ряд обещает функцию, которой в этой программе не будет никогда; отсутствие
 *  ряда не обещает ничего. */

import { Button, Switch, Tabs } from "@muza/ui";
import { useT } from "../../i18n";
import { GroupTitle, paneStyle, RowValue, SettingRow } from "./primitives";
import { useEngineHealth } from "./DiagnosticsSub";
import { useSettingsScreen } from "./settingsContext";

export function SystemPane() {
  const { t } = useT();
  const { prefs, set, caps, platform, updates, appVersion, openSub, paneClass } = useSettingsScreen();
  const openExternal = platform.system?.openExternal;
  const [health] = useEngineHealth(platform.diagnostics);

  return (
    <div className={paneClass} style={paneStyle}>
      {caps.has("autostart") ? (
        <SettingRow title={t("settings.system.autostart.title")} hint={t("settings.system.autostart.hint")}>
          <Switch checked={prefs.autostart} onChange={(autostart: boolean) => set({ autostart })} label={t("settings.system.autostart.title")} />
        </SettingRow>
      ) : null}
      {caps.has("tray") ? (
        <>
          <SettingRow title={t("settings.system.tray.title")} hint={t("settings.system.tray.hint")}>
            <Switch checked={prefs.tray} onChange={(tray: boolean) => set({ tray })} label={t("settings.system.tray.title")} />
          </SettingRow>
          <SettingRow
            title={t("settings.system.closeAction.title")}
            hint={prefs.tray ? t("settings.system.closeAction.hintTray") : t("settings.system.closeAction.hintNoTray")}
          >
            {/* Без значка у часов «свернуть вместо закрытия» некуда сворачивать —
                выбор гаснет с честной подсказкой, но остаётся виден. */}
            <div style={prefs.tray ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
              <Tabs
                items={[
                  { key: "tray", label: t("settings.system.closeAction.minimize") },
                  { key: "exit", label: t("settings.system.closeAction.exit") },
                ]}
                value={prefs.closeToTray ? "tray" : "exit"}
                onChange={(k: string) => set({ closeToTray: k === "tray" })}
              />
            </div>
          </SettingRow>
        </>
      ) : null}
      {caps.has("updates") ? (
        <SettingRow title={t("settings.system.update.title")} hint={t("settings.system.update.hint")}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
            <RowValue>
              {updates.state === "checking"
                ? t("settings.system.update.checking")
                : updates.state === "none"
                  ? t("settings.system.update.upToDate")
                  : updates.state === "found"
                    ? t("settings.system.update.available", { version: updates.found?.version ?? "" })
                    : updates.state === "installing"
                      ? updates.pct >= 0
                        ? t("settings.system.update.downloadingPct", { pct: updates.pct })
                        : t("settings.system.update.downloading")
                      : updates.state === "error"
                        ? t("settings.system.update.checkFailed")
                        : t("settings.system.update.stableChannel")}
            </RowValue>
            {updates.state === "found" || updates.state === "installing" ? (
              <Button variant="primary" icon="download" disabled={updates.state === "installing"} onClick={() => void updates.install()}>
                {updates.state === "installing" ? t("settings.market.installing") : t("common.install")}
              </Button>
            ) : (
              <Button variant="ghost" icon="refresh-cw" disabled={updates.state === "checking"} onClick={() => void updates.check()}>
                {t("settings.system.update.check")}
              </Button>
            )}
          </div>
        </SettingRow>
      ) : null}
      {caps.has("miniPlayer") ? (
        <SettingRow title={t("settings.system.miniPlayer.title")} hint={t("settings.system.miniPlayer.hint")}>
          <Switch checked={prefs.miniPlayer} onChange={(miniPlayer: boolean) => set({ miniPlayer })} label={t("settings.system.miniPlayer.title")} />
        </SettingRow>
      ) : null}
      {caps.has("diagnostics") ? (
        <SettingRow
          title={t("settings.system.stage0.rowTitle")}
          hint={t("settings.system.stage0.rowHint")}
          onClick={() => openSub("stage0")}
          chevron
        >
          <RowValue>{health?.cooldown_until_ms ? t("settings.system.stage0.statusPaused") : t("settings.system.stage0.statusOk")}</RowValue>
        </SettingRow>
      ) : null}
      <GroupTitle>{t("settings.system.aboutGroup")}</GroupTitle>
      <SettingRow title={t("settings.system.version.title")} hint={t("settings.system.version.hint")}>
        {/* Версия у площадки спрашивается один раз на весь экран (провайдер).
            Нет площадочной версии — честное «только в программе», а не
            выдуманное число: так этот ряд однажды уже соврал хардкодом. */}
        <RowValue>{appVersion ?? (platform.appInfo ? "…" : t("settings.system.appOnly"))}</RowValue>
      </SettingRow>
      <SettingRow title={t("settings.system.licenses.rowTitle")} hint={t("settings.system.licenses.rowHint")} onClick={() => openSub("licenses")} chevron></SettingRow>
      <SettingRow title={t("settings.system.website.title")} hint={t("settings.system.website.hint")} onClick={() => void openExternal?.("https://muza.lol")} chevron></SettingRow>
      <SettingRow
        title={t("settings.system.sourceCode.title")}
        hint={t("settings.system.sourceCode.hint")}
        onClick={() => void openExternal?.("https://github.com/EntonioDMI/muza-client")}
        chevron
      ></SettingRow>
    </div>
  );
}
