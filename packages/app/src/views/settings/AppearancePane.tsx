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
import { Kbd, Switch, Tabs } from "@muza/ui";
import { useT } from "../../i18n";
import type { Prefs } from "../../prefs/types";
import { AccentSwatch, CustomAccentSwatch, GLASS_MIN, LiveSlider, paneStyle, PresetTile, RowValue, ScaleSlider, SettingRow } from "./primitives";
import { appearancePresets, currentWindowLayout, WINDOW_LAYOUTS, type WindowLayout } from "./appearancePresets";
import { useSettingsScreen } from "./settingsContext";

/** Ключ псевдо-сегмента «Своя» в ряду раскладок. Не WindowLayout: применить
 *  его нечего — он описывает состояние, а не задаёт его. */
const CUSTOM = "custom";

export function AppearancePane() {
  const { t } = useT();
  const { prefs, set, paneClass, openSub } = useSettingsScreen();
  const presets = appearancePresets(t);
  const layout = currentWindowLayout(prefs);
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
            // «Классика» отличается от «Музы» не цветом и не углами, а
            // геометрией, поэтому по паре accent+radius её не отличить —
            // сверяем и остальные ключи облика, если пресет их несёт.
            selected={
              prefs.accent === p.accent &&
              prefs.radius === p.radius &&
              (!p.extra || (Object.keys(p.extra) as (keyof Prefs)[]).every((k) => prefs[k] === p.extra?.[k]))
            }
            onClick={() => set({ accent: p.accent, radius: p.radius, ...p.extra })}
          />
        ))}
      </div>
      {/* РАСКЛАДКА ОКНА — отдельная ось от обликов (решение владельца 04.08
          ночью: «не стоило добавлять воздух и классику в тему, это совсем не
          подходит»). Облик — цвет и углы; раскладка — геометрия. Каждый пункт
          задаёт ось ЦЕЛИКОМ (WINDOW_LAYOUTS): полумеры вроде «Классика +
          плоский тумблер» давали кентавра — плавающий плеер при прижатых
          зонах. Воздушная — дефолт (выбор сооснователя), плоскую включает,
          кому нравится (владелец), классика — вид до редизайна 04.08. */}
      <SettingRow title={t("settings.appearance.layout.title")} hint={t("settings.appearance.layout.hint")}>
        <Tabs
          items={[
            { key: "air", label: t("settings.appearance.layout.air") },
            { key: "flat", label: t("settings.appearance.layout.flat") },
            { key: "classic", label: t("settings.appearance.layout.classic") },
            // ЧЕТВЁРТЫЙ СЕГМЕНТ «Своя» появляется ТОЛЬКО когда он и выбран, и
            // нажать его нельзя (клик ниже игнорируется) — это не выбор, а
            // ответ на вопрос «а что стоит сейчас?».
            // Просто «ничего не выбрано» тут не годится: пилюля переползла бы
            // на первый сегмент или исчезла вовсе, и получилась бы та же немота,
            // с которой всё и началось, — вкладки уверенно показывали
            // «Воздушная», пока окно стояло не в ней.
            ...(layout === null ? [{ key: CUSTOM, label: t("settings.appearance.layout.custom") }] : []),
          ]}
          value={layout ?? CUSTOM}
          onChange={(k: string) => {
            if (k !== CUSTOM) set(WINDOW_LAYOUTS[k as WindowLayout]);
          }}
        />
      </SettingRow>
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
      {/* РЕЖИМ ПРАВКИ ВИДА — тут его и ищут. Владелец 04.08: «Как менять
          пропорции? Мы же закладывали фундамент, но я так и не понял, как это
          делать». Сочетание клавиш без единого упоминания в интерфейсе — это
          возможность, которой нет: узнать о ней неоткуда. Ряд ничего не
          переключает, он объясняет и показывает клавиши. */}
      <SettingRow title={t("settings.appearance.lookEdit.title")} hint={t("settings.appearance.lookEdit.hint")}>
        <span style={{ display: "flex", gap: 4 }}>
          <Kbd>Ctrl</Kbd>
          <Kbd>E</Kbd>
        </span>
      </SettingRow>
    </div>
  );
}
