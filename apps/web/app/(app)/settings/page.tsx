"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ChipGroup, Fader, Icon, Switch } from "@muza/ui";
import { DesktopOnlyOverlay } from "@muza/app/components/DesktopOnly";
import { LANGS, useT, type Lang } from "@muza/app";
import { EQ_PRESETS } from "../../../src/audioFx";
import { usePrefs } from "../../../src/prefs";
import { useSession } from "../../../src/session";

/** Настройки веба — структура десктопного SettingsView (сайдбар категорий +
 *  панель справа), состав минимальный (полная кастомизация — фишка десктопа):
 *  эквалайзер (та же 10-полосная модель, что в приложении), акцент ДС,
 *  сценография, панель «Сейчас играет», витрины десктопных функций, аккаунт.
 *  Навигация — role=tablist/tab/tabpanel, как в десктопе (SettingsView.tsx):
 *  выбор категории мгновенно меняет соседнюю панель, ни маршрута, ни истории.
 *  Раскладка и адаптив (<900px — горизонтальные табы-чипы) — globals.css,
 *  секция «Настройки». */

const EQ_LABELS = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];

/** Ключи, цвета и иконки переиспользуют desktop-словарь (settings.appearance.accent.*
 *  — тот же набор blue/red/bolt) — подписи собираются в рендере через t(). */
const ACCENTS: { key: "blue" | "red" | "bolt"; color: string }[] = [
  { key: "blue", color: "#3b82f6" },
  { key: "bolt", color: "#327ad9" },
  { key: "red", color: "#f76967" },
];

type TFn = ReturnType<typeof useT>["t"];

/** Подпись акцента — реюз desktop-ключей settings.appearance.accent.*. */
function accentLabel(key: "blue" | "red" | "bolt", t: TFn): string {
  if (key === "blue") return t("settings.appearance.accent.blue");
  if (key === "red") return t("settings.appearance.accent.red");
  return t("settings.appearance.accent.bolt");
}

/** Категории настроек — зеркало десктопной модели (SETTINGS_TAB_KEYS +
 *  SETTINGS_TAB_ICONS в SettingsView.tsx), состав веба: порядок массива =
 *  порядок пунктов навигации. Подписи — в sectionLabel() ниже (часть реюзает
 *  settings.tabs.* десктопа, часть — свои web.settings.tabs.* без аналога). */
const SECTIONS = [
  { key: "appearance", icon: "paintbrush" },
  { key: "sound", icon: "audio-lines" },
  { key: "search", icon: "search" },
  { key: "integrations", icon: "plug" },
  { key: "offline", icon: "hard-drive" },
  { key: "customize", icon: "sparkles" },
  { key: "account", icon: "user" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

function sectionLabel(key: SectionKey, t: TFn): string {
  switch (key) {
    case "appearance":
      return t("settings.tabs.appearance");
    case "integrations":
      return t("settings.tabs.integrations");
    case "account":
      return t("settings.tabs.account");
    case "sound":
      return t("web.settings.tabs.sound");
    case "search":
      return t("web.settings.tabs.search");
    case "offline":
      return t("web.settings.tabs.offline");
    case "customize":
      return t("web.settings.tabs.customizePlus");
  }
}

/** id пункта навигации — на него ссылается aria-labelledby панели. */
const sectionTabId = (key: string) => `settings-tab-${key}`;
/** id панели — на него ссылается aria-controls пунктов навигации. */
const SETTINGS_PANE_ID = "settings-pane";

function Row({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-4)",
        padding: "var(--sp-3) 0",
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 200, flex: 1 }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-1)" }}>{title}</div>
        {hint ? (
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: 2 }}>{hint}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Заголовок группы внутри панели (для панелей с несколькими темами). */
function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: "var(--sp-5) 0 var(--sp-2)",
        fontSize: "var(--fs-caption)",
        fontWeight: 600,
        letterSpacing: "var(--ls-caps)",
        textTransform: "uppercase",
        color: "var(--text-3)",
      }}
    >
      {children}
    </h3>
  );
}

/** Шапка активной панели — название категории (как заголовок раздела десктопа). */
function PaneTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: "0 0 var(--sp-2)",
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        fontSize: 17,
        color: "var(--text-1)",
      }}
    >
      {children}
    </h2>
  );
}

/** Те же ключи mild/soft/round, что prefs.radius десктопа — подписи реюзают
 *  settings.appearance.radius.* (десктопный ChipGroup того же значения). */
const RADIUS_KEYS = ["mild", "soft", "round"] as const;

function radiusLabel(key: (typeof RADIUS_KEYS)[number], t: TFn): string {
  if (key === "mild") return t("settings.appearance.radius.mild");
  if (key === "round") return t("settings.appearance.radius.round");
  return t("settings.appearance.radius.soft");
}

/** Golos/Unbounded — имена шрифтов, не переводятся ни в одном языке (как в
 *  десктопе); «Системный» — единственная переводимая подпись этого чипа. */
const FONT_KEYS = ["golos", "unbounded", "system"] as const;

function fontLabel(key: (typeof FONT_KEYS)[number], t: TFn): string {
  if (key === "golos") return "Golos";
  if (key === "unbounded") return "Unbounded";
  return t("web.settings.fontSystem");
}

export default function SettingsPage() {
  const { prefs, set } = usePrefs();
  const { session, logout } = useSession();
  const router = useRouter();
  const { t, lang } = useT();
  const colorRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<SectionKey>("appearance");

  const applyPreset = (name: string) => {
    const bands = EQ_PRESETS[name];
    set(bands ? { eqPreset: name, eqBands: bands } : { eqPreset: name });
  };

  const setBand = (i: number, v: number) => {
    const bands = [...prefs.eqBands];
    bands[i] = Math.round(v);
    // Значение — персистентный ключ prefs.eqPreset (см. EQ_PRESETS в audioFx.ts),
    // сознательно не переведён, как и на десктопе (SettingsView.tsx:1070).
    set({ eqBands: bands, eqPreset: "Свой" });
  };

  const appearancePane = (
    <>
      <PaneTitle>{t("settings.tabs.appearance")}</PaneTitle>
      <Row title={t("web.settings.lightTheme.title")} hint={t("web.settings.lightTheme.hint")}>
        <Switch
          checked={prefs.theme === "light"}
          onChange={(on: boolean) => set({ theme: on ? "light" : "dark" })}
          label={t("web.settings.lightTheme.title")}
        />
      </Row>
      <Row title={t("settings.appearance.language.title")} hint={t("settings.appearance.language.hint")}>
        <ChipGroup
          items={LANGS.map((l) => ({
            key: l,
            label: l === "ru" ? t("settings.appearance.language.optionRu") : t("settings.appearance.language.optionEn"),
          }))}
          value={lang}
          onChange={(key: string) => set({ language: key as Lang })}
        />
      </Row>
      <Row title={t("settings.appearance.accent.title")} hint={t("settings.appearance.accent.hint")}>
        <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          {ACCENTS.map((a) => (
            <button
              key={a.key}
              type="button"
              className={prefs.accent === a.key ? "swatch active" : "swatch"}
              style={{ background: a.color }}
              aria-label={accentLabel(a.key, t)}
              aria-pressed={prefs.accent === a.key}
              onClick={() => set({ accent: a.key })}
            />
          ))}
          <button
            type="button"
            className={prefs.accent === "custom" ? "swatch active" : "swatch"}
            style={{ background: prefs.accent === "custom" ? prefs.customAccent : "var(--surface-3)" }}
            aria-label={t("settings.appearance.accent.customLabel")}
            aria-pressed={prefs.accent === "custom"}
            onClick={() => colorRef.current?.click()}
          />
          <input
            ref={colorRef}
            type="color"
            value={prefs.customAccent}
            aria-hidden="true"
            tabIndex={-1}
            style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
            onInput={(e) => set({ accent: "custom", customAccent: (e.target as HTMLInputElement).value })}
          />
        </div>
      </Row>
      <Row title={t("settings.appearance.radius.title")} hint={t("settings.appearance.radius.hint")}>
        <ChipGroup
          items={RADIUS_KEYS.map((k) => ({ key: k, label: radiusLabel(k, t) }))}
          value={prefs.radius}
          onChange={(key: string) =>
            set({ radius: (RADIUS_KEYS as readonly string[]).includes(key) ? (key as (typeof RADIUS_KEYS)[number]) : "soft" })
          }
        />
      </Row>
      <Row title={t("settings.customize.typography.fontUi.title")} hint={t("web.settings.fontHint")}>
        <ChipGroup
          items={FONT_KEYS.map((k) => ({ key: k, label: fontLabel(k, t) }))}
          value={prefs.fontUi}
          onChange={(key: string) =>
            set({ fontUi: (FONT_KEYS as readonly string[]).includes(key) ? (key as (typeof FONT_KEYS)[number]) : "golos" })
          }
        />
      </Row>
      <Row title={t("settings.appearance.glass.title")} hint={t("settings.appearance.glass.hint")}>
        <input
          type="range"
          min={30}
          max={90}
          value={prefs.glassOpacity}
          aria-label={t("settings.appearance.glass.title")}
          aria-valuetext={`${prefs.glassOpacity}%`}
          style={{ width: 200, accentColor: "var(--accent)" }}
          onChange={(e) => set({ glassOpacity: Number(e.target.value) })}
        />
      </Row>
      <Row title={t("settings.appearance.background.ariaLabel")} hint={t("web.settings.backgroundHint")}>
        <Switch checked={prefs.bgCover} onChange={(bgCover: boolean) => set({ bgCover })} label={t("settings.appearance.background.ariaLabel")} />
      </Row>
      <Row title={t("web.settings.npPanelRow.title")} hint={t("web.settings.npPanelRow.hint")}>
        <Switch checked={prefs.npOpen} onChange={(npOpen: boolean) => set({ npOpen })} label={t("web.settings.npPanelRow.title")} />
      </Row>
    </>
  );

  const soundPane = (
    <>
      <PaneTitle>{t("web.settings.tabs.sound")}</PaneTitle>
      <Row title={t("settings.equalizer.title")} hint={t("web.settings.eqHint")}>
        <Switch checked={prefs.eqOn} onChange={(eqOn: boolean) => set({ eqOn })} label={t("settings.equalizer.title")} />
      </Row>
      <div style={prefs.eqOn ? undefined : { opacity: 0.4, pointerEvents: "none" }}>
        <div className="eq-faders" style={{ margin: "var(--sp-2) 0 var(--sp-3)", padding: 0 }}>
          {/* Ключи EQ_PRESETS (рус. слова) — персистентные значения prefs.eqPreset,
              как и "Свой": сознательно не переведены, см. audioFx.ts и SettingsView.tsx
              десктопа (та же договорённость, чтобы не разъехаться по клиентам). */}
          <ChipGroup items={[...Object.keys(EQ_PRESETS), "Свой"]} value={prefs.eqPreset} onChange={applyPreset} />
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

  const searchPane = (
    <>
      <PaneTitle>{t("web.settings.tabs.search")}</PaneTitle>
      <Row title={t("settings.sources.searchGrouping.title")} hint={t("settings.sources.searchGrouping.hint")}>
        <Switch
          checked={prefs.searchGrouping}
          onChange={(searchGrouping: boolean) => set({ searchGrouping })}
          label={t("settings.sources.searchGrouping.title")}
        />
      </Row>
    </>
  );

  /* Витрины десктопных функций под оверлеями (по слову владельца 21.07):
     функция отрисована и понятна, но менять — в приложении */
  const integrationsPane = (
    <>
      <PaneTitle>{t("settings.tabs.integrations")}</PaneTitle>
      <GroupTitle>Discord</GroupTitle>
      <DesktopOnlyOverlay hint={t("settings.integrations.discord.rowHint")}>
        <Row title={t("settings.integrations.discord.title")} hint={t("settings.integrations.discord.rowHint")}>
          <Switch checked onChange={() => {}} label={t("settings.integrations.discord.title")} />
        </Row>
        <Row title={t("settings.integrations.discord.buttonGroup")} hint={t("settings.integrations.discord.btnOn.hint")}>
          <Switch checked onChange={() => {}} label={t("settings.integrations.discord.buttonGroup")} />
        </Row>
      </DesktopOnlyOverlay>
    </>
  );

  const offlinePane = (
    <>
      <PaneTitle>{t("web.settings.tabs.offline")}</PaneTitle>
      <DesktopOnlyOverlay hint={t("web.settings.offlineSaveHint")}>
        <Row title={t("web.settings.offlineSaveTitle")} hint={t("web.settings.offlineSaveHint")}>
          <Switch checked onChange={() => {}} label={t("web.settings.offlineSaveTitle")} />
        </Row>
        <Row title={t("settings.library.cache.limitLabel")}>
          <ChipGroup
            items={[2, 5, 10].map((n) => t("settings.library.units.gb", { n }))}
            value={t("settings.library.units.gb", { n: 5 })}
            onChange={() => {}}
          />
        </Row>
      </DesktopOnlyOverlay>
    </>
  );

  const customizePane = (
    <>
      <PaneTitle>{t("web.settings.tabs.customizePlus")}</PaneTitle>
      <DesktopOnlyOverlay hint={t("web.settings.bgTitle")}>
        <Row title={t("web.settings.bgTitle")} hint={t("settings.customize.background.type.hint")}>
          <ChipGroup
            items={[
              t("settings.customize.background.type.cover"),
              t("settings.customize.background.type.gradient"),
              t("settings.customize.background.type.animated"),
            ]}
            value={t("settings.customize.background.type.cover")}
            onChange={() => {}}
          />
        </Row>
        <Row title={t("settings.customize.css.toggle.title")} hint={t("settings.customize.css.toggle.hint")}>
          <Switch checked={false} onChange={() => {}} label={t("settings.customize.css.toggle.title")} />
        </Row>
        <Row title={t("settings.customize.themes.marketRow.title")} hint={t("web.settings.marketplaceHint")}>
          <Button variant="secondary">{t("web.settings.openMarketplace")}</Button>
        </Row>
      </DesktopOnlyOverlay>
    </>
  );

  const accountPane = (
    <>
      <PaneTitle>{t("settings.tabs.account")}</PaneTitle>
      <Row title={session?.user.username ?? ""} hint={t("web.settings.accountHint")}>
        <Button
          variant="ghost"
          icon="log-out"
          onClick={() => {
            void logout().then(() => router.replace("/login"));
          }}
        >
          {t("settings.account.profile.signOut")}
        </Button>
      </Row>
    </>
  );

  const panes: Record<SectionKey, React.ReactNode> = {
    appearance: appearancePane,
    sound: soundPane,
    search: searchPane,
    integrations: integrationsPane,
    offline: offlinePane,
    customize: customizePane,
    account: accountPane,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <h1 className="page-title" style={{ marginBottom: "var(--sp-5)" }}>
        {t("settings.title")}
      </h1>
      <div className="settings-layout">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label={t("settings.title")}>
          {SECTIONS.map((s) => {
            const active = s.key === section;
            return (
              <button
                key={s.key}
                id={sectionTabId(s.key)}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={SETTINGS_PANE_ID}
                className="settings-nav__item"
                onClick={() => setSection(s.key)}
              >
                {/* активная категория — акцентная иконка, как пункты сайдбара */}
                <Icon name={s.icon} size={20} color={active ? "var(--accent-text)" : "currentColor"} />
                {sectionLabel(s.key, t)}
              </button>
            );
          })}
        </nav>
        <div
          className="settings-pane"
          id={SETTINGS_PANE_ID}
          role="tabpanel"
          aria-labelledby={sectionTabId(section)}
        >
          {panes[section]}
        </div>
      </div>
    </div>
  );
}
