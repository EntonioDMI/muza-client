/** ПОД-ЭКРАН «ЛИЦЕНЗИИ»: открытый код внутри программы.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Список собран руками и это осознанно: машинная выжимка сотен вложенных
 *  пакетов формально полнее, но не помогает никому — здесь то, из чего
 *  программа действительно сделана, четырнадцатью строками. */

import { useT } from "../../i18n";
import { paneStyle, RowValue, SettingRow, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

/** id — стабильный ключ словаря `settings.system.licenses.items.*`, человеку
 *  он не показывается и потому не переводится. */
type LicenseId =
  | "react"
  | "tauri"
  | "vite"
  | "typescript"
  | "hugeicons"
  | "golosText"
  | "unbounded"
  | "zod"
  | "ytdlp"
  | "deno"
  | "serde"
  | "ed25519Dalek"
  | "lofty"
  | "vitest";

const OSS_LICENSES: { id: LicenseId; license: string; url: string }[] = [
  { id: "react", license: "MIT", url: "https://react.dev" },
  { id: "tauri", license: "MIT / Apache-2.0", url: "https://tauri.app" },
  { id: "vite", license: "MIT", url: "https://vite.dev" },
  { id: "typescript", license: "Apache-2.0", url: "https://www.typescriptlang.org" },
  { id: "hugeicons", license: "MIT", url: "https://hugeicons.com" },
  { id: "golosText", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Golos+Text" },
  { id: "unbounded", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Unbounded" },
  { id: "zod", license: "MIT", url: "https://zod.dev" },
  { id: "ytdlp", license: "Unlicense", url: "https://github.com/yt-dlp/yt-dlp" },
  { id: "deno", license: "MIT", url: "https://deno.com" },
  { id: "serde", license: "MIT / Apache-2.0", url: "https://serde.rs" },
  { id: "ed25519Dalek", license: "BSD-3-Clause", url: "https://github.com/dalek-cryptography/curve25519-dalek" },
  { id: "lofty", license: "MIT / Apache-2.0", url: "https://github.com/Serial-ATA/lofty-rs" },
  { id: "vitest", license: "MIT", url: "https://vitest.dev" },
];

export function LicensesSub() {
  const { t } = useT();
  const { platform, closeSub, paneClass } = useSettingsScreen();
  const openExternal = platform.system?.openExternal;
  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.system.licenses.title")} onBack={closeSub} />
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.system.licenses.hint")}</div>
      {OSS_LICENSES.map((d) => (
        <SettingRow
          key={d.id}
          title={t(`settings.system.licenses.items.${d.id}`)}
          hint={d.url.replace("https://", "")}
          onClick={() => void openExternal?.(d.url)}
          chevron
        >
          <RowValue>{d.license}</RowValue>
        </SettingRow>
      ))}
    </div>
  );
}
