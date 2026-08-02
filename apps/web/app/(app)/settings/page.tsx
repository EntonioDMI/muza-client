"use client";

import { Button, ChipGroup, Fader, Switch, Tabs } from "@muza/ui";
import { LANGS, useT, type Lang } from "@muza/app";
import { SettingsScreen } from "@muza/app/views/settings/SettingsScreen";
import {
  AccentSwatch,
  CustomAccentSwatch,
  GLASS_MIN,
  GroupTitle,
  LiveSlider,
  PresetTile,
  RowValue,
  SettingRow,
} from "@muza/app/views/settings/primitives";
import type { SettingsCapability } from "@muza/app/lib/settingsIndex";
import { EQ_PRESETS } from "../../../src/audioFx";
import { usePrefs, type WebPrefs } from "../../../src/prefs";
import { useSession } from "../../../src/session";
import { useRouter } from "next/navigation";

/** Настройки веба (волна веб-паритета «настройки», 2026-08-02).
 *
 *  Каркас, рельс разделов, ряды-плашки и поиск по настройкам — ОБЩИЕ с
 *  приложением (@muza/app/views/settings): до этой волны у веба был свой
 *  экран со своим Row, своим списком категорий и без поиска — он уже
 *  разъехался с приложением (другие отступы, другой порядок разделов, свои
 *  ползунки). Теперь одна и та же настройка выглядит одинаково в обеих
 *  программах, потому что рисует её один и тот же код.
 *
 *  ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Разделы и ряды, которых во вкладке браузера не
 *  бывает, ОТСУТСТВУЮТ — не серые, не «только в приложении»: значок у часов,
 *  запуск вместе с системой, обновление программы, журнал «почему включалось
 *  долго», расширения, музыка с диска. Их нет ни в рельсе, ни в результатах
 *  поиска (список умений `WEB_CAPS` ниже — им же фильтруется индекс поиска).
 *
 *  ⚠️ Ряд появляется здесь только тогда, когда он РАБОТАЕТ. Переключатель,
 *  который никуда не приезжает, хуже отсутствующего: человек считает, что
 *  настроил. Поэтому «Тексты песен» ждут, пока панель текста в вебе научится
 *  слушать настройки, а масштаб и простор — пока их научится применять общий
 *  движок темы (@muza/app theme/themeVars.ts, сейчас в нём 8 ключей). */

/** Что умеет вкладка браузера. Пусто — значит НЕ умеет ничего из списка
 *  SettingsCapability: ни трея, ни автозапуска, ни обновлений, ни плагинов,
 *  ни файлов с диска. Появится умение — появится и ключ, и ряды с ним. */
const WEB_CAPS: readonly SettingsCapability[] = [];

/** Пресеты оформления — те же три, что на первом экране «Внешнего вида» в
 *  приложении (пара «акцент + углы» одним нажатием). */
const APPEARANCE_PRESETS = [
  { key: "muza", accent: "blue", accentColor: "#3b82f6", radius: "soft" },
  { key: "flame", accent: "red", accentColor: "#f76967", radius: "round" },
  { key: "graphite", accent: "bolt", accentColor: "#327ad9", radius: "mild" },
] as const;

/** Границы ползунков оформления — те же числа, что в приложении: одна тема
 *  обязана настраиваться одинаково на обеих площадках. */
const BLUR_MAX = 64;
const TEXT_DIM_MIN = 40;
const TEXT_DIM_MAX = 80;

/** Golos/Unbounded — имена шрифтов, не переводятся ни в одном языке;
 *  «Системный» — единственная переводимая подпись этого выбора. */
const FONT_KEYS = ["golos", "unbounded", "system"] as const;

const EQ_LABELS = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];

export default function SettingsPage() {
  const { prefs, set } = usePrefs();
  const { session, logout } = useSession();
  const router = useRouter();
  const { t, lang } = useT();

  const applyEqPreset = (name: string) => {
    const bands = EQ_PRESETS[name];
    set(bands ? { eqPreset: name, eqBands: bands } : { eqPreset: name });
  };

  const setBand = (i: number, v: number) => {
    const bands = [...prefs.eqBands];
    bands[i] = Math.round(v);
    // Значение — персистентный ключ prefs.eqPreset (см. EQ_PRESETS в audioFx.ts),
    // сознательно не переведён, как и в приложении.
    set({ eqBands: bands, eqPreset: "Свой" });
  };

  const accountPane = (
    <>
      <SettingRow title={t("settings.account.profile.title")} hint={session?.user.username ?? ""}>
        <Button
          variant="ghost"
          icon="log-out"
          onClick={() => {
            void logout().then(() => router.replace("/login"));
          }}
        >
          {t("settings.account.profile.signOut")}
        </Button>
      </SettingRow>
    </>
  );

  const appearancePane = (
    <>
      {/* Язык — первым, как в приложении: живой, без перезагрузки страницы. */}
      <SettingRow title={t("settings.appearance.language.title")} hint={t("settings.appearance.language.hint")}>
        <Tabs
          items={LANGS.map((l) => ({
            key: l,
            label: l === "ru" ? t("settings.appearance.language.optionRu") : t("settings.appearance.language.optionEn"),
          }))}
          value={lang}
          onChange={(k: string) => set({ language: k as Lang })}
        />
      </SettingRow>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--sp-3)" }}>
        {APPEARANCE_PRESETS.map((p) => (
          <PresetTile
            key={p.key}
            name={t(`settings.appearance.presets.${p.key}.name`)}
            hint={t(`settings.appearance.presets.${p.key}.hint`)}
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
          onChange={(k: string) => set({ theme: k as WebPrefs["theme"] })}
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
          onChange={(radius: string) => set({ radius: radius as WebPrefs["radius"] })}
        />
      </SettingRow>
      <SettingRow title={t("settings.customize.typography.fontUi.title")} hint={t("settings.customize.typography.fontUi.hint")}>
        <Tabs
          items={FONT_KEYS.map((k) => ({
            key: k,
            // Имена шрифтов не переводятся; переводится только «Системный».
            label: k === "system" ? t("web.settings.fontSystem") : k === "golos" ? "Golos" : "Unbounded",
          }))}
          value={prefs.fontUi}
          onChange={(k: string) => set({ fontUi: k as WebPrefs["fontUi"] })}
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
      <SettingRow title={t("settings.customize.glass.panelBlur.title")} hint={t("settings.customize.glass.panelBlur.hint")}>
        <LiveSlider
          value={prefs.blur}
          max={BLUR_MAX}
          label={t("settings.customize.glass.panelBlur.title")}
          suffix={`${prefs.blur} px`}
          onChange={(v) => set({ blur: Math.round(v) })}
        />
      </SettingRow>
      <SettingRow title={t("settings.customize.colors.textDim.title")} hint={t("settings.customize.colors.textDim.hint")}>
        <LiveSlider
          value={prefs.textDim - TEXT_DIM_MIN}
          max={TEXT_DIM_MAX - TEXT_DIM_MIN}
          label={t("settings.customize.colors.textDim.title")}
          suffix={`${prefs.textDim} %`}
          onChange={(v) => set({ textDim: TEXT_DIM_MIN + Math.round(v) })}
        />
      </SettingRow>
      <SettingRow title={t("settings.appearance.background.title")} hint={t("settings.appearance.background.hint")}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
          {/* Общая модель хранит вид фона перечислением (bgType), а вкладка
              умеет ровно один — «из обложки». Тумблер переключает между ним
              и «выкл»; выбранный в программе цвет/градиент/картинку веб
              бережёт в профиле, но не рисует (слияние моделей 2026-08-02). */}
          <RowValue>{prefs.bgType === "cover" ? t("settings.appearance.background.fromCover") : t("common.off")}</RowValue>
          <Switch
            checked={prefs.bgType === "cover"}
            onChange={(on: boolean) => set({ bgType: on ? "cover" : "none" })}
            label={t("settings.appearance.background.ariaLabel")}
          />
        </div>
      </SettingRow>
      <SettingRow title={t("web.settings.npPanelRow.title")} hint={t("web.settings.npPanelRow.hint")}>
        <Switch checked={prefs.npOpen} onChange={(npOpen: boolean) => set({ npOpen })} label={t("web.settings.npPanelRow.title")} />
      </SettingRow>
    </>
  );

  const playbackPane = (
    <>
      <GroupTitle>{t("settings.playback.soundGroup")}</GroupTitle>
      <SettingRow title={t("settings.equalizer.enable.title")} hint={t("settings.equalizer.enable.hint")}>
        <Switch checked={prefs.eqOn} onChange={(eqOn: boolean) => set({ eqOn })} label={t("settings.equalizer.enable.title")} />
      </SettingRow>
      {/* Эквалайзер в вебе — прямо в разделе, а не отдельным под-экраном:
          под-экранов у этого каркаса пока нет, а прятать десять фейдеров за
          лишним переходом ради симметрии — хуже, чем показать их сразу. */}
      <div style={prefs.eqOn ? undefined : { opacity: 0.4, pointerEvents: "none" }}>
        <div className="eq-faders" style={{ margin: "var(--sp-2) 0 var(--sp-3)", padding: 0 }}>
          {/* Ключи EQ_PRESETS (рус. слова) — персистентные значения prefs.eqPreset,
              как и "Свой": сознательно не переведены, та же договорённость, что в
              приложении (иначе сохранённая настройка разъедется между клиентами). */}
          <ChipGroup items={[...Object.keys(EQ_PRESETS), "Свой"]} value={prefs.eqPreset} onChange={applyEqPreset} />
        </div>
        <div className="eq-faders">
          {prefs.eqBands.map((v, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-1)" }}>
              <Fader
                value={v}
                min={-12}
                max={12}
                height={120}
                onChange={(nv: number) => setBand(i, nv)}
                ariaLabel={t("settings.equalizer.bandAria", { freq: EQ_LABELS[i] })}
              />
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--text-3)" }}>{EQ_LABELS[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  const sourcesPane = (
    <>
      <GroupTitle>{t("settings.sources.searchGroup")}</GroupTitle>
      <SettingRow title={t("settings.sources.searchGrouping.title")} hint={t("settings.sources.searchGrouping.hint")}>
        <Switch
          checked={prefs.searchGrouping}
          onChange={(searchGrouping: boolean) => set({ searchGrouping })}
          label={t("settings.sources.searchGrouping.title")}
        />
      </SettingRow>
    </>
  );

  return (
    <SettingsScreen
      caps={WEB_CAPS}
      initialTab="appearance"
      panes={{
        account: accountPane,
        appearance: appearancePane,
        playback: playbackPane,
        sources: sourcesPane,
      }}
    />
  );
}
