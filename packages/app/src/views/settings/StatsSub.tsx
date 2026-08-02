/** ПОД-ЭКРАН «СТАТИСТИКА»: какие блоки показывать на странице итогов, в каком
 *  порядке и за какой период.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Порядок массива prefs.statsBlocks = порядок блоков на странице: список
 *  здесь и есть настройка, отдельного поля «порядок» нет и не нужно. */

import { IconButton, Switch, Tabs } from "@muza/ui";
import { useT } from "../../i18n";
import type { Prefs, StatsBlockKey } from "../../prefs/types";
import { normalizeStatsBlocks, statsBlockLabel } from "../../lib/statsBlocks";
import { GroupTitle, paneStyle, SettingRow, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export function StatsSub() {
  const { t, lang } = useT();
  const { prefs, set, closeSub, paneClass } = useSettingsScreen();
  const blocks = normalizeStatsBlocks(prefs.statsBlocks);
  const toggle = (key: StatsBlockKey, on: boolean) => set({ statsBlocks: blocks.map((b) => (b.key === key ? { ...b, on } : b)) });
  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    set({ statsBlocks: next });
  };
  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.stats.title")} onBack={closeSub} />

      <GroupTitle>{t("settings.stats.blocksGroup")}</GroupTitle>
      {blocks.map((b, i) => (
        <SettingRow key={b.key} title={statsBlockLabel(b.key, lang).label} hint={statsBlockLabel(b.key, lang).hint}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <span style={{ opacity: i === 0 ? 0.3 : 1 }}>
              <IconButton
                icon="chevron-up"
                size="sm"
                label={t("settings.bar.moveUp", { name: statsBlockLabel(b.key, lang).label })}
                onClick={() => move(i, -1)}
              />
            </span>
            <span style={{ opacity: i === blocks.length - 1 ? 0.3 : 1 }}>
              <IconButton
                icon="chevron-down"
                size="sm"
                label={t("settings.bar.moveDown", { name: statsBlockLabel(b.key, lang).label })}
                onClick={() => move(i, 1)}
              />
            </span>
            <Switch checked={b.on} onChange={(on: boolean) => toggle(b.key, on)} label={statsBlockLabel(b.key, lang).label} />
          </div>
        </SettingRow>
      ))}

      <GroupTitle>{t("settings.stats.periodGroup")}</GroupTitle>
      <SettingRow title={t("settings.stats.period.title")} hint={t("settings.stats.period.hint")}>
        <Tabs
          items={[
            { key: "week", label: t("settings.stats.period.week") },
            { key: "month", label: t("settings.stats.period.month") },
            { key: "year", label: t("settings.stats.period.year") },
            { key: "all", label: t("settings.stats.period.allTime") },
          ]}
          value={prefs.statsPeriod}
          onChange={(k: string) => set({ statsPeriod: k as Prefs["statsPeriod"] })}
        />
      </SettingRow>
    </div>
  );
}
