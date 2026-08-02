/** ПОД-ЭКРАН «НАВИГАЦИЯ»: состав, порядок и свои названия вкладок сайдбара.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  «Главная» не выключается — программе нужен дом, и переключатель у неё
 *  всегда серый с честной подсказкой почему. Вкладки от расширений живут в
 *  том же списке под ключами `plugin:<id>:<tab>`. */

import { Button, IconButton, Switch } from "@muza/ui";
import { useT } from "../../i18n";
import { NAV_ITEM_META, navItemLabel, normalizeNavItems } from "../../lib/navItems";
import { isPluginKey, parsePluginKey, pluginSlotKey } from "../../lib/pluginSlots";
import { DEFAULT_PREFS, type NavItemKey } from "../../prefs/types";
import { paneStyle, SettingInput, SettingRow, SubHeader } from "./primitives";
import { enabledLevel1Plugins, useSettingsScreen } from "./settingsContext";

export function NavSub() {
  const { t, lang } = useT();
  const { prefs, set, plugins, closeSub, paneClass } = useSettingsScreen();

  const level1 = enabledLevel1Plugins(plugins.installed);
  const pluginKeys = level1.flatMap((p) => (p.manifest.contributes?.navItems ?? []).map((n) => pluginSlotKey(p.id, n.id)));
  const items = normalizeNavItems(prefs.navItems, pluginKeys);

  const meta = (key: string): { label: string; icon: string } => {
    if (isPluginKey(key)) {
      const pk = parsePluginKey(key);
      const pl = plugins.installed.find((p) => p.id === pk?.pluginId);
      const item = pl?.manifest.contributes?.navItems?.find((n) => n.id === pk?.slotId);
      return { label: item?.title ?? t("settings.appearance.plugin.genericLabel"), icon: item?.icon ?? "puzzle" };
    }
    return { label: navItemLabel(key as NavItemKey, lang), icon: NAV_ITEM_META[key as NavItemKey].icon };
  };

  const toggle = (key: string, on: boolean) => set({ navItems: items.map((n) => (n.key === key ? { ...n, on } : n)) });
  const rename = (key: string, label: string) => set({ navItems: items.map((n) => (n.key === key ? { ...n, label: label || undefined } : n)) });
  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    set({ navItems: next });
  };

  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.nav.title")} onBack={closeSub} />
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.nav.hint")}</div>
      {items.map((n, i) => (
        <SettingRow key={n.key} title={meta(n.key).label} hint={n.key === "home" ? t("settings.nav.homeCannotDisable") : undefined}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <SettingInput
              value={n.label ?? ""}
              placeholder={meta(n.key).label}
              width={140}
              onChange={(v) => rename(n.key, v.trim().slice(0, 24))}
            />
            <span style={{ opacity: i === 0 ? 0.3 : 1 }}>
              <IconButton icon="chevron-up" size="sm" label={t("settings.bar.moveUp", { name: meta(n.key).label })} onClick={() => move(i, -1)} />
            </span>
            <span style={{ opacity: i === items.length - 1 ? 0.3 : 1 }}>
              <IconButton icon="chevron-down" size="sm" label={t("settings.bar.moveDown", { name: meta(n.key).label })} onClick={() => move(i, 1)} />
            </span>
            <Switch checked={n.on} disabled={n.key === "home"} onChange={(on: boolean) => toggle(n.key, on)} label={meta(n.key).label} />
          </div>
        </SettingRow>
      ))}
      <div>
        <Button variant="ghost" icon="rotate-ccw" onClick={() => set({ navItems: DEFAULT_PREFS.navItems })}>
          {t("settings.nav.reset")}
        </Button>
      </div>
    </div>
  );
}
