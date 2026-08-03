/** РАЗДЕЛ «ВНЕШНИЙ ВИД» — то, что человек меняет чаще всего: язык, три
 *  готовых облика, тема, акцент, углы, стекло, фон, масштаб. Всё тонкое
 *  живёт за строкой «Кастомизация» отдельным под-экраном: держать сто
 *  ползунков на первом же экране настроек — это ровно та простыня, за
 *  которую настройки уже критиковали.
 *
 *  Приехало как есть из apps/desktop/src/views/SettingsView.tsx (волна
 *  «настройки», 2026-08-02): разметка, стили и порядок рядов не тронуты —
 *  приложение после переезда обязано выглядеть ровно как до него. */

import { useEffect, useRef } from "react";
import { Switch, Tabs } from "@muza/ui";
import { useT } from "../../i18n";
import type { Prefs } from "../../prefs/types";
import { AccentSwatch, CustomAccentSwatch, GLASS_MIN, LiveSlider, paneStyle, PresetTile, RowValue, ScaleSlider, SettingRow } from "./primitives";
import { appearancePresets } from "./appearancePresets";
import { useSettingsScreen } from "./settingsContext";

export function AppearancePane() {
  const { t } = useT();
  const { prefs, set, paneClass, openSub } = useSettingsScreen();
  const presets = appearancePresets(t);
  // ТУМБЛЕР ФОНА = «фон включён», а не «фон из обложки». Раньше он стоял
  // checked={bgType === "cover"} и писал "cover"/"none": человек собирал в
  // «Кастомизации» градиент или анимированный фон, возвращался сюда — тумблер
  // выключен, а ряд рядом честно пишет «Свой», — один клик, и настройка фона
  // молча заменялась обложкой; обратный клик давал "none", а не прежний тип.
  // Прошлый тип помним здесь, чтобы возврат вернул ЕГО, а не обложку. Поле
  // настроек ради этого не заводим: память нужна только на время, пока человек
  // щёлкает тумблером, — после перезахода вернётся "cover", как и раньше.
  const lastBgType = useRef<Exclude<Prefs["bgType"], "none">>("cover");
  useEffect(() => {
    if (prefs.bgType !== "none") lastBgType.current = prefs.bgType;
  }, [prefs.bgType]);
  return (
    <div className={paneClass} style={paneStyle}>
      {/* Переключатель языка — первый элемент вкладки по требованию владельца.
          Живой, без перезагрузки: меняет prefs.language, и все места,
          спрашивающие перевод, перерисовываются сами. */}
      <SettingRow title={t("settings.appearance.language.title")} hint={t("settings.appearance.language.hint")}>
        <Tabs
          items={[
            { key: "en", label: t("settings.appearance.language.optionEn") },
            { key: "ru", label: t("settings.appearance.language.optionRu") },
          ]}
          value={prefs.language}
          onChange={(k: string) => set({ language: k as Prefs["language"] })}
        />
      </SettingRow>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--sp-3)" }}>
        {presets.map((p) => (
          <PresetTile
            key={p.key}
            name={p.name}
            hint={p.hint}
            accentColor={p.accentColor}
            radius={p.radius}
            selected={prefs.accent === p.accent && prefs.radius === p.radius}
            onClick={() => set({ accent: p.accent, radius: p.radius })}
          />
        ))}
      </div>
      <SettingRow title={t("settings.appearance.theme.title")} hint={t("settings.appearance.theme.hint")}>
        <Tabs
          items={[
            { key: "dark", label: t("settings.appearance.theme.dark") },
            { key: "light", label: t("settings.appearance.theme.light") },
          ]}
          value={prefs.theme}
          onChange={(k: string) => set({ theme: k as Prefs["theme"] })}
        />
      </SettingRow>
      <SettingRow title={t("settings.appearance.accent.title")} hint={t("settings.appearance.accent.hint")}>
        <div style={{ display: "flex", gap: "var(--sp-3)" }}>
          <AccentSwatch color="#3b82f6" label={t("settings.appearance.accent.blue")} selected={prefs.accent === "blue"} onClick={() => set({ accent: "blue" })} />
          <AccentSwatch color="#f76967" label={t("settings.appearance.accent.red")} selected={prefs.accent === "red"} onClick={() => set({ accent: "red" })} />
          <AccentSwatch color="#327ad9" label={t("settings.appearance.accent.bolt")} selected={prefs.accent === "bolt"} onClick={() => set({ accent: "bolt" })} />
          <CustomAccentSwatch
            color={prefs.customAccent}
            selected={prefs.accent === "custom"}
            onPick={(customAccent) => set({ accent: "custom", customAccent })}
          />
        </div>
      </SettingRow>
      <SettingRow title={t("settings.appearance.radius.title")} hint={t("settings.appearance.radius.hint")}>
        <Tabs
          items={[
            { key: "mild", label: t("settings.appearance.radius.mild") },
            { key: "soft", label: t("settings.appearance.radius.soft") },
            { key: "round", label: t("settings.appearance.radius.round") },
          ]}
          value={prefs.radius}
          onChange={(radius: string) => set({ radius: radius as Prefs["radius"] })}
        />
      </SettingRow>
      <SettingRow title={t("settings.appearance.glass.title")} hint={t("settings.appearance.glass.hint")}>
        <LiveSlider
          value={prefs.glassOpacity - GLASS_MIN}
          max={100 - GLASS_MIN}
          label={t("settings.appearance.glass.title")}
          suffix={`${prefs.glassOpacity} %`}
          onChange={(v) => set({ glassOpacity: GLASS_MIN + Math.round(v) })}
        />
      </SettingRow>
      <SettingRow title={t("settings.appearance.background.title")} hint={t("settings.appearance.background.hint")}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
          <RowValue>
            {prefs.bgType === "cover"
              ? t("settings.appearance.background.fromCover")
              : prefs.bgType === "none"
                ? t("common.off")
                : t("settings.appearance.background.custom")}
          </RowValue>
          <Switch
            checked={prefs.bgType !== "none"}
            onChange={(on: boolean) => set({ bgType: on ? lastBgType.current : "none" })}
            label={t("settings.appearance.background.ariaLabel")}
          />
        </div>
      </SettingRow>
      <SettingRow title={t("settings.appearance.scale.title")} hint={t("settings.appearance.scale.hint")}>
        <ScaleSlider value={prefs.uiScale} label={t("settings.appearance.scale.title")} onCommit={(uiScale) => set({ uiScale })} />
      </SettingRow>
      <SettingRow
        title={t("settings.appearance.customize.title")}
        hint={t("settings.appearance.customize.hint")}
        onClick={() => openSub("customize")}
        chevron
      ></SettingRow>
    </div>
  );
}
