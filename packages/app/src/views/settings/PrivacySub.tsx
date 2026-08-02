/** ПОД-ЭКРАН «ВЫГРУЗИТЬ ИЛИ УДАЛИТЬ ДАННЫЕ».
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Выгрузка — единственное место экрана, где отсутствие порта НЕ убирает ряд:
 *  порт saveDataFile нужен, чтобы человек выбрал МЕСТО на диске; без него файл
 *  просто уезжает обычной загрузкой. Кнопка одинаково выполняет обещание на
 *  обеих площадках, поэтому прятать её не за что.
 *
 *  Удаление аккаунта двухшаговое (кнопка → пароль) и это не формальность:
 *  шаг назад есть у всего, кроме этого. */

import { useState } from "react";
import { Button, Dialog } from "@muza/ui";
import { ApiError } from "@muza/api-client";
import { useT } from "../../i18n";
import { paneStyle, SettingInput, SettingRow, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export function PrivacySub() {
  const { t } = useT();
  const { api, platform, onNotify, onLogout, closeSub, paneClass } = useSettingsScreen();
  const openExternal = platform.system?.openExternal;
  const saveDataFile = platform.saveDataFile;

  const [exportBusy, setExportBusy] = useState(false);
  const doExport = async () => {
    setExportBusy(true);
    try {
      const data = await api.exportData();
      const json = JSON.stringify(data, null, 2);
      const name = `muza-export-${new Date().toISOString().slice(0, 10)}.json`;
      if (saveDataFile) {
        // Площадка умеет спросить «куда сохранить» — тост только если выбрали
        if (await saveDataFile.saveJson(name, json)) onNotify(t("settings.privacy.exported"), "download");
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : t("settings.privacy.errors.exportFailed"), "x");
    } finally {
      setExportBusy(false);
    }
  };

  const [delOpen, setDelOpen] = useState(false);
  const [delPwd, setDelPwd] = useState("");
  const [delErr, setDelErr] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const submitDelete = async () => {
    setDelBusy(true);
    setDelErr(null);
    try {
      await api.deleteAccount(delPwd);
      setDelOpen(false);
      onNotify(t("settings.privacy.accountDeleted"), "trash-2");
      onLogout();
    } catch (e) {
      setDelErr(e instanceof ApiError ? e.message : t("settings.privacy.errors.deleteFailed"));
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <>
      <div className={paneClass} style={paneStyle}>
        <SubHeader title={t("settings.privacy.title")} onBack={closeSub} />
        <SettingRow title={t("settings.privacy.export.title")} hint={t("settings.privacy.export.hint")}>
          <Button variant="secondary" icon="download" disabled={exportBusy} onClick={() => void doExport()}>
            {exportBusy ? t("settings.privacy.export.busy") : t("settings.privacy.export.button")}
          </Button>
        </SettingRow>
        <SettingRow title={t("settings.privacy.deleteAccount.title")} hint={t("settings.privacy.deleteAccount.hint")} danger>
          <Button
            variant="ghost"
            icon="trash-2"
            onClick={() => {
              setDelPwd("");
              setDelErr(null);
              setDelOpen(true);
            }}
          >
            {t("settings.privacy.deleteAccount.button")}
          </Button>
        </SettingRow>
        <SettingRow
          title={t("settings.privacy.privacyDoc.title")}
          hint={t("settings.privacy.privacyDoc.hint")}
          onClick={() => void openExternal?.("https://muza.lol/privacy")}
          chevron
        ></SettingRow>
      </div>

      {/* Удаление аккаунта: второй шаг — пароль */}
      <Dialog
        open={delOpen}
        title={t("settings.privacy.deleteDialog.title")}
        onClose={() => setDelOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDelOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="trash-2" disabled={delBusy || delPwd.length < 8} onClick={() => void submitDelete()}>
              {delBusy ? t("settings.privacy.deleteDialog.deleting") : t("settings.privacy.deleteDialog.confirm")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.5 }}>{t("settings.privacy.deleteDialog.body")}</div>
          <SettingInput type="password" value={delPwd} onChange={setDelPwd} placeholder={t("settings.privacy.deleteDialog.passwordPlaceholder")} width={300} />
          {delErr ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{delErr}</div> : null}
        </div>
      </Dialog>
    </>
  );
}
