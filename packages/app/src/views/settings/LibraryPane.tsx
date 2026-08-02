/** РАЗДЕЛ «МЕДИАТЕКА»: файлы с устройства, место под подготовленное,
 *  прослушивание без сети, перенос плейлистов и вход в «Статистику».
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Ряды про место на диске держатся на порте storedMedia: у страницы браузера
 *  нет ни своей папки, ни очистки — и рядов там нет вовсе, а не серых. Цифры
 *  перезапрашиваются при входе в раздел: «сколько занято» протухает от любого
 *  прослушивания, а не от действий на этом экране. */

import { useEffect, useState } from "react";
import { Button } from "@muza/ui";
import { useT } from "../../i18n";
import type { StoredMediaStats } from "../../platform";
import { LiveSlider, paneStyle, RowValue, SettingRow } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export function LibraryPane() {
  const { t } = useT();
  const { prefs, set, caps, platform, openSub, paneClass } = useSettingsScreen();
  const storedMedia = platform.storedMedia;

  const [stats, setStats] = useState<StoredMediaStats | null>(null);
  const reload = () => {
    if (!storedMedia) return;
    storedMedia
      .stats()
      .then(setStats)
      .catch(() => undefined);
  };
  useEffect(() => {
    reload();
    // reload читает только storedMedia — пересоздавать эффект больше не на что
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedMedia]);

  const fmtGb = (bytes: number) =>
    bytes >= 1024 * 1024 * 1024
      ? t("settings.library.units.gb", { n: (bytes / (1024 * 1024 * 1024)).toFixed(1) })
      : t("settings.library.units.mb", { n: Math.round(bytes / (1024 * 1024)) });

  return (
    <div className={paneClass} style={paneStyle}>
      {caps.has("localFiles") ? (
        <SettingRow title={t("settings.library.localFiles.title")} hint={t("settings.library.localFiles.hint")}>
          <RowValue>{t("settings.library.localFiles.value")}</RowValue>
        </SettingRow>
      ) : null}
      {caps.has("offlineCache") ? (
        <>
          <SettingRow
            title={t("settings.library.cache.title")}
            hint={stats ? t("settings.library.cache.hintFilled", { size: fmtGb(stats.bytes), files: stats.files }) : t("settings.library.cache.hintEmpty")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
              <LiveSlider
                value={prefs.cacheLimitGb - 1}
                max={15}
                label={t("settings.library.cache.limitLabel")}
                suffix={t("settings.library.units.gb", { n: prefs.cacheLimitGb })}
                onChange={(v) => set({ cacheLimitGb: 1 + Math.round(v) })}
              />
              <Button
                variant="ghost"
                icon="trash-2"
                onClick={() => {
                  void storedMedia?.clear().then(reload);
                }}
              >
                {t("settings.library.cache.clear")}
              </Button>
            </div>
          </SettingRow>
          <SettingRow title={t("settings.library.offline.title")} hint={t("settings.library.offline.hint")}>
            <RowValue>
              {stats ? t("settings.library.offline.value", { n: stats.pinnedFiles, size: fmtGb(stats.pinnedBytes) }) : t("settings.library.offline.empty")}
            </RowValue>
          </SettingRow>
        </>
      ) : null}
      <SettingRow title={t("settings.library.importPlaylists.title")} hint={t("settings.library.importPlaylists.hint")}>
        <RowValue>{t("settings.library.importPlaylists.value")}</RowValue>
      </SettingRow>
      <SettingRow title={t("settings.library.stats.title")} hint={t("settings.library.stats.hint")} onClick={() => openSub("stats")} chevron></SettingRow>
    </div>
  );
}
