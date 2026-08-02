/** ПОД-ЭКРАН «КНОПКИ ПЛЕЕРА»: состав и порядок кнопок в полосе плеера.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Порядок массива prefs.barButtons = порядок кнопок в баре; стрелки ↑/↓ и
 *  переключатель — весь редактор. Кнопки, добавленные расширениями, живут в
 *  том же списке под ключами `plugin:<id>:<slot>` и подписываются из манифеста
 *  расширения, а не из словаря: их названия придумали не мы. */

import { Button, IconButton, Switch } from "@muza/ui";
import { useT } from "../../i18n";
import { barButtonLabel, normalizeBarButtons, type BarButtonKey } from "../../lib/barButtons";
import { isPluginKey, parsePluginKey, pluginSlotKey } from "../../lib/pluginSlots";
import { DEFAULT_PREFS } from "../../prefs/types";
import { paneStyle, SettingRow, SubHeader } from "./primitives";
import { enabledLevel1Plugins, useSettingsScreen } from "./settingsContext";

export function BarSub() {
  const { t, lang } = useT();
  const { prefs, set, plugins, closeSub, paneClass } = useSettingsScreen();

  const level1 = enabledLevel1Plugins(plugins.installed);
  const pluginKeys = level1.flatMap((p) => (p.manifest.contributes?.barButtons ?? []).map((b) => pluginSlotKey(p.id, b.id)));
  const buttons = normalizeBarButtons(prefs.barButtons, pluginKeys);

  /** Подпись строки: родной ключ — из словаря, плагинный — из манифеста. */
  const meta = (key: string): { label: string; hint: string } => {
    if (isPluginKey(key)) {
      const pk = parsePluginKey(key);
      const pl = plugins.installed.find((p) => p.id === pk?.pluginId);
      const item = pl?.manifest.contributes?.barButtons?.find((b) => b.id === pk?.slotId);
      return {
        label: item?.title ?? t("settings.appearance.plugin.genericLabel"),
        hint: pl ? t("settings.appearance.plugin.hint", { name: pl.manifest.name }) : t("settings.appearance.plugin.genericLabel"),
      };
    }
    return barButtonLabel(key as BarButtonKey, lang);
  };

  const toggle = (key: string, on: boolean) => set({ barButtons: buttons.map((b) => (b.key === key ? { ...b, on } : b)) });
  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= buttons.length) return;
    const next = [...buttons];
    [next[i], next[j]] = [next[j], next[i]];
    set({ barButtons: next });
  };

  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.bar.title")} onBack={closeSub} />
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.bar.hint")}</div>
      {buttons.map((b, i) => (
        <SettingRow key={b.key} title={meta(b.key).label} hint={meta(b.key).hint}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <span style={{ opacity: i === 0 ? 0.3 : 1 }}>
              <IconButton icon="chevron-up" size="sm" label={t("settings.bar.moveUp", { name: meta(b.key).label })} onClick={() => move(i, -1)} />
            </span>
            <span style={{ opacity: i === buttons.length - 1 ? 0.3 : 1 }}>
              <IconButton icon="chevron-down" size="sm" label={t("settings.bar.moveDown", { name: meta(b.key).label })} onClick={() => move(i, 1)} />
            </span>
            <Switch checked={b.on} onChange={(on: boolean) => toggle(b.key, on)} label={meta(b.key).label} />
          </div>
        </SettingRow>
      ))}
      <div>
        <Button variant="ghost" icon="rotate-ccw" onClick={() => set({ barButtons: DEFAULT_PREFS.barButtons })}>
          {t("settings.bar.reset")}
        </Button>
      </div>
    </div>
  );
}
