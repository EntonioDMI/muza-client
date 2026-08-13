/** ПОД-ЭКРАН «КАСТОМИЗАЦИЯ» — самая большая страница настроек: стекло, цвета,
 *  форма, типографика, движение, компоновка, фон, визуализатор, поведение,
 *  свои оформления и свой CSS.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки, порядка рядов и формул ползунков.
 *
 *  Почему это отдельная страница, а не часть «Внешнего вида»: здесь ~80 рядов
 *  тонкой подстройки, и вываливать их вместе с «тема/акцент/углы» значит
 *  сделать первый экран настроек нечитаемым. Наверху — то, что меняют часто,
 *  здесь — то, что меняют однажды.
 *
 *  Два общих приёма страницы:
 *   • ползунки ЖИВЫЕ — значение применяется на каждое движение, потому что
 *     подбирать размытие или плотность вслепую невозможно;
 *   • ряд, которому сейчас нечего делать (тонкая настройка фона при другом
 *     типе фона), не исчезает, а гаснет с честной подсказкой — иначе его
 *     нельзя было бы найти поиском по настройкам. */

import { useMemo, useRef, useState } from "react";
import { Button, ChipGroup, IconButton, Select, Switch, Tabs } from "@muza/ui";
import { useT, type TranslationKey } from "../../i18n";
import { legacyInvertFromSpin, normalizeDiscs, normalizeSpin, SPIN_PAIRS } from "../../prefs/backdrop";
import { DEFAULT_PREFS, RADIUS_OVERRIDE_OFF, type BgAnimDiscs, type BgAnimSpin, type Prefs } from "../../prefs/types";
import { matchPreset, PRESETS_BG } from "../../prefs/presets";
import { availableFonts, CUSTOM_FONT_CHOICE_KEY, fontFamily } from "../../prefs/fonts";
import { applyCustomFont, installCustomFontFile, removeCustomFont } from "../../prefs/customFont";
import type { SavedTheme } from "../../prefs/themes";
import { VIS_LIMITS } from "../../lib/visualizerMath";
import { activeVisPreset, BAR_PRESETS, WAVE_PRESETS } from "../../lib/visualizerPresets";
import { ColorDot, GroupTitle, LiveSlider, paneStyle, PresetRow, SettingInput, SettingRow, SubHeader, VisSliderRow } from "./primitives";
import { currentAccentHex } from "./appearancePresets";
import { useSettingsScreen } from "./settingsContext";
import { ThemeDialogs, useThemeLibrary } from "./themeLibrary";

/** Потолок силы качания, % от базовой амплитуды: 300% — заметная тряска,
 *  дальше начинается морская болезнь, а не музыка. */
const BASS_STRENGTH_MAX = 300;

/** Пункты «сколько обложек» — одни и те же для фона приложения и для караоке. */
function discItems(t: (key: TranslationKey) => string) {
  return [
    { key: "one", label: t("settings.customize.background.discs.one") },
    { key: "two", label: t("settings.customize.background.discs.two") },
  ];
}

/** Пункты «куда крутятся». У ОДНОЙ обложки «навстречу друг другу» и «в разные
 *  стороны» смысла не имеют — ей не с кем расходиться, поэтому список короче.
 *  Так человек не выбирает пункт, который ничего не изменит. */
function spinItems(t: (key: TranslationKey) => string, discs: BgAnimDiscs) {
  const both = [
    { key: "cw", label: t("settings.customize.background.spin.cw") },
    { key: "ccw", label: t("settings.customize.background.spin.ccw") },
  ];
  if (discs === "one") return both;
  return [
    { key: "inward", label: t("settings.customize.background.spin.inward") },
    { key: "outward", label: t("settings.customize.background.spin.outward") },
    ...both,
  ];
}

/** Что показать выбранным в списке направлений. Одна обложка крутится так же,
 *  как левый круг пары (SPIN_PAIRS), — значит «навстречу» она отображает как
 *  «по часовой», и список не врёт о том, что происходит на экране. */
function spinValue(discs: BgAnimDiscs, spin: BgAnimSpin): string {
  return discs === "one" ? SPIN_PAIRS[normalizeSpin(spin)][0] : normalizeSpin(spin);
}

export function CustomizeSub() {
  const { t, lang } = useT();
  const { prefs, set, caps, onNotify, openSub, closeSub, setMarketFilter, paneClass } = useSettingsScreen();
  const accentHex = currentAccentHex(prefs, t);

  // ── Свои оформления и свой CSS ───────────────────────────────────
  const themeLib = useThemeLibrary();
  const { cssDraft, setCssDraft } = themeLib;

  const openMarket = (filter: "themes" | "plugins") => {
    setMarketFilter(filter);
    openSub("market");
  };

  // ── Свой шрифт ───────────────────────────────────────────────────
  // applyCustomFont идемпотентен: лениво поднимает шрифт из хранилища и
  // отдаёт его имя (null — файла нет). Дальше состоянием ведёт экран.
  const [customFontName, setCustomFontName] = useState<string | null>(() => applyCustomFont());
  const fontFileRef = useRef<HTMLInputElement>(null);
  const customFontFamily = fontFamily(CUSTOM_FONT_CHOICE_KEY);
  const onCustomFontFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const stored = await installCustomFontFile(file);
      setCustomFontName(stored.name);
      onNotify(t("settings.customize.typography.customFont.installed", { name: stored.name }), "type");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "readFailed";
      onNotify(t(`settings.customize.typography.customFont.errors.${reason}` as TranslationKey), "x");
    }
  };
  const onRemoveCustomFont = () => {
    removeCustomFont();
    setCustomFontName(null);
    // выбранный «свой» без файла честно падал бы в системный — возвращаем дефолты
    const patch: Partial<Prefs> = {};
    if (prefs.fontUi === CUSTOM_FONT_CHOICE_KEY) patch.fontUi = "golos";
    if (prefs.fontDisplay === CUSTOM_FONT_CHOICE_KEY) patch.fontDisplay = "unbounded";
    if (Object.keys(patch).length > 0) set(patch);
  };

  // Список шрифтов для двух выпадашек: системные определяются один раз на
  // вход (пока настройки открыты, список не меняется); свой — первой строкой.
  const fonts = useMemo(() => {
    const base = availableFonts();
    return customFontName ? [{ key: CUSTOM_FONT_CHOICE_KEY, label: customFontName, family: customFontFamily }, ...base] : base;
  }, [customFontName, customFontFamily]);

  // ── Направление вращения основного фона ──────────────────────────
  // Пишется ДВА поля, и это временно: фон приложения пока рисует
  // apps/desktop/src/App.tsx по старому тумблеру bgAnimatedInvert. Без зеркала
  // человек крутил бы новый список и не видел на экране ничего. Правда — за
  // bgAnimSpin (см. Prefs.bgAnimatedInvert и prefs/backdrop.ts); зеркало
  // снимается вместе с переводом App.tsx на AnimatedBackdrop.
  const setMainSpin = (bgAnimSpin: BgAnimSpin) =>
    set({ bgAnimSpin, bgAnimatedInvert: legacyInvertFromSpin(bgAnimSpin) });

  return (
    <>
      <div className={paneClass} style={paneStyle}>
        <SubHeader title={t("settings.customize.title")} onBack={closeSub} />

        <GroupTitle>{t("settings.customize.glass.groupTitle")}</GroupTitle>
        {/* Ряды, которым нечего делать при выключённом стекле, ГАСНУТ, а не
            исчезают: исчезнувший ряд не найти поиском по настройкам, и человек
            решает, что возможность пропала. Гашение — общий приём страницы
            (см. шапку файла), подсказка при этом честно объясняет причину. */}
        <SettingRow
          title={t("settings.customize.glass.panelBlur.title")}
          hint={prefs.glassOn ? t("settings.customize.glass.panelBlur.hint") : t("settings.customize.glass.offHint")}
        >
          <div style={prefs.glassOn ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
            <LiveSlider
              value={prefs.blur}
              max={64}
              label={t("settings.customize.glass.panelBlur.title")}
              suffix={`${prefs.blur} px`}
              onChange={(v) => set({ blur: Math.round(v) })}
            />
          </div>
        </SettingRow>
        <SettingRow title={t("settings.customize.glass.bgBlur.title")} hint={t("settings.customize.glass.bgBlur.hint")}>
          <LiveSlider
            value={prefs.blurScenery}
            max={80}
            label={t("settings.customize.glass.bgBlur.title")}
            suffix={`${prefs.blurScenery} px`}
            onChange={(v) => set({ blurScenery: Math.round(v) })}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.customize.glass.zones.title")}
          hint={prefs.glassOn ? t("settings.customize.glass.zones.hint") : t("settings.customize.glass.offHint")}
        >
          <div style={prefs.glassOn ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
            <Switch checked={prefs.glassZonesOn} onChange={(glassZonesOn: boolean) => set({ glassZonesOn })} label={t("settings.customize.glass.zones.title")} />
          </div>
        </SettingRow>
        {prefs.glassZonesOn && prefs.glassOn ? (
          <>
            <SettingRow title={t("settings.customize.glass.zonePlayer.title")} hint={t("settings.customize.glass.zonePlayer.hint")}>
              <LiveSlider
                value={prefs.glassPlayer}
                max={100}
                label={t("settings.customize.glass.zonePlayer.ariaLabel")}
                suffix={`${prefs.glassPlayer} %`}
                onChange={(v) => set({ glassPlayer: Math.round(v) })}
              />
            </SettingRow>
            <SettingRow title={t("settings.customize.glass.zoneMenu.title")} hint={t("settings.customize.glass.zoneMenu.hint")}>
              <LiveSlider
                value={prefs.glassMenu}
                max={100}
                label={t("settings.customize.glass.zoneMenu.ariaLabel")}
                suffix={`${prefs.glassMenu} %`}
                onChange={(v) => set({ glassMenu: Math.round(v) })}
              />
            </SettingRow>
            <SettingRow title={t("settings.customize.glass.zoneDialog.title")} hint={t("settings.customize.glass.zoneDialog.hint")}>
              <LiveSlider
                value={prefs.glassDialog}
                max={100}
                label={t("settings.customize.glass.zoneDialog.ariaLabel")}
                suffix={`${prefs.glassDialog} %`}
                onChange={(v) => set({ glassDialog: Math.round(v) })}
              />
            </SettingRow>
            <SettingRow title={t("settings.customize.glass.zoneSidebar.title")} hint={t("settings.customize.glass.zoneSidebar.hint")}>
              <LiveSlider
                value={prefs.glassSidebar}
                max={100}
                label={t("settings.customize.glass.zoneSidebar.ariaLabel")}
                suffix={`${prefs.glassSidebar} %`}
                onChange={(v) => set({ glassSidebar: Math.round(v) })}
              />
            </SettingRow>
            <SettingRow title={t("settings.customize.glass.zoneNowPlaying.title")} hint={t("settings.customize.glass.zoneNowPlaying.hint")}>
              <LiveSlider
                value={prefs.glassNowPlaying}
                max={100}
                label={t("settings.customize.glass.zoneNowPlaying.ariaLabel")}
                suffix={`${prefs.glassNowPlaying} %`}
                onChange={(v) => set({ glassNowPlaying: Math.round(v) })}
              />
            </SettingRow>
          </>
        ) : null}

        <GroupTitle>{t("settings.customize.colors.groupTitle")}</GroupTitle>
        <SettingRow title={t("settings.customize.colors.baseBg.title")} hint={t("settings.customize.colors.baseBg.hint")}>
          <Tabs
            items={[
              { key: "graphite", label: t("settings.customize.colors.baseBg.graphite") },
              { key: "warm", label: t("settings.customize.colors.baseBg.warm") },
              { key: "cold", label: t("settings.customize.colors.baseBg.cold") },
              { key: "amoled", label: t("settings.customize.colors.baseBg.amoled") },
            ]}
            value={prefs.baseBg}
            onChange={(k: string) => set({ baseBg: k as Prefs["baseBg"] })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.colors.accentRoles.title")} hint={t("settings.customize.colors.accentRoles.hint")}>
          <Switch
            checked={prefs.accentRolesOn}
            onChange={(on: boolean) =>
              // включение засевает роли ТЕКУЩИМ акцентом: ничего не мигает,
              // дальше цвета разводятся пикерами
              set(
                on
                  ? { accentRolesOn: true, accentPlay: accentHex, accentSlider: accentHex, accentActive: accentHex }
                  : { accentRolesOn: false },
              )
            }
            label={t("settings.customize.colors.accentRoles.title")}
          />
        </SettingRow>
        {prefs.accentRolesOn ? (
          <>
            <SettingRow title={t("settings.customize.colors.accentPlay.title")} hint={t("settings.customize.colors.accentPlay.hint")}>
              <ColorDot color={prefs.accentPlay} label={t("settings.customize.colors.accentPlay.pickerLabel")} onPick={(accentPlay) => set({ accentPlay })} />
            </SettingRow>
            <SettingRow title={t("settings.customize.colors.accentSlider.title")} hint={t("settings.customize.colors.accentSlider.hint")}>
              <ColorDot
                color={prefs.accentSlider}
                label={t("settings.customize.colors.accentSlider.pickerLabel")}
                onPick={(accentSlider) => set({ accentSlider })}
              />
            </SettingRow>
            <SettingRow title={t("settings.customize.colors.accentActive.title")} hint={t("settings.customize.colors.accentActive.hint")}>
              <ColorDot
                color={prefs.accentActive}
                label={t("settings.customize.colors.accentActive.pickerLabel")}
                onPick={(accentActive) => set({ accentActive })}
              />
            </SettingRow>
          </>
        ) : null}
        <SettingRow title={t("settings.customize.colors.textDim.title")} hint={t("settings.customize.colors.textDim.hint")}>
          <LiveSlider
            value={prefs.textDim - 40}
            max={40}
            label={t("settings.customize.colors.textDim.title")}
            suffix={`${prefs.textDim} %`}
            onChange={(v) => set({ textDim: 40 + Math.round(v) })}
          />
        </SettingRow>

        <GroupTitle>{t("settings.customize.shape.groupTitle")}</GroupTitle>
        {/* ⚠️ ВСЯ ЭТА ГРУППА — ПОДСТРОЙКА ПОВЕРХ ОБЩЕГО «Скругления» («Внешний
            вид»), а не замена ему. Проценты множат опорное число, px —
            перебивают его для одного вида элементов. Сентинел «Авто» (999) не
            ставит токен вовсе, и форма органа управления считается из общего
            скругления (tokens/radius.css). До 2026-08-13 «Авто» означало
            ЖЁСТКУЮ пилюлю, и кнопки с полями не слушались общей настройки
            вообще — отсюда жалоба «закругление работает далеко не на все
            элементы». */}
        <SettingRow title={t("settings.customize.shape.tiles.title")} hint={t("settings.customize.shape.tiles.hint")}>
          <LiveSlider
            value={prefs.radiusTiles}
            max={200}
            label={t("settings.customize.shape.tiles.title")}
            suffix={`${prefs.radiusTiles} %`}
            onChange={(v) => set({ radiusTiles: Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.shape.buttons.title")} hint={t("settings.customize.shape.buttons.hint")}>
          <LiveSlider
            value={prefs.radiusControls >= RADIUS_OVERRIDE_OFF ? 27 : prefs.radiusControls}
            max={27}
            label={t("settings.customize.shape.buttons.title")}
            suffix={prefs.radiusControls >= RADIUS_OVERRIDE_OFF ? t("settings.customize.shape.auto") : `${prefs.radiusControls} px`}
            onChange={(v) => set({ radiusControls: Math.round(v) >= 27 ? RADIUS_OVERRIDE_OFF : Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.shape.tabs.title")} hint={t("settings.customize.shape.tabs.hint")}>
          <LiveSlider
            value={prefs.radiusTabs >= RADIUS_OVERRIDE_OFF ? 27 : prefs.radiusTabs}
            max={27}
            label={t("settings.customize.shape.tabs.title")}
            suffix={prefs.radiusTabs >= RADIUS_OVERRIDE_OFF ? t("settings.customize.shape.auto") : `${prefs.radiusTabs} px`}
            onChange={(v) => set({ radiusTabs: Math.round(v) >= 27 ? RADIUS_OVERRIDE_OFF : Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.shape.fields.title")} hint={t("settings.customize.shape.fields.hint")}>
          <LiveSlider
            value={prefs.radiusFields >= RADIUS_OVERRIDE_OFF ? 27 : prefs.radiusFields}
            max={27}
            label={t("settings.customize.shape.fields.title")}
            suffix={prefs.radiusFields >= RADIUS_OVERRIDE_OFF ? t("settings.customize.shape.auto") : `${prefs.radiusFields} px`}
            onChange={(v) => set({ radiusFields: Math.round(v) >= 27 ? RADIUS_OVERRIDE_OFF : Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.shape.panels.title")} hint={t("settings.customize.shape.panels.hint")}>
          <LiveSlider
            value={prefs.radiusPanels}
            max={200}
            label={t("settings.customize.shape.panels.title")}
            suffix={`${prefs.radiusPanels} %`}
            onChange={(v) => set({ radiusPanels: Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.shape.density.title")} hint={t("settings.customize.shape.density.hint")}>
          <LiveSlider
            value={prefs.density}
            max={100}
            label={t("settings.customize.shape.density.title")}
            suffix={`${52 + Math.round((16 * prefs.density) / 100)} px`}
            onChange={(v) => set({ density: Math.round(v) })}
          />
        </SettingRow>
        {/* Размер плитки (он же минимум колонки текучих сеток — одна величина
            на оба случая), внутренний отступ плитки и зазор между зонами. */}
        <SettingRow title={t("settings.customize.shape.tileSize.title")} hint={t("settings.customize.shape.tileSize.hint")}>
          <LiveSlider
            value={prefs.tileSize - 140}
            max={100}
            label={t("settings.customize.shape.tileSize.title")}
            suffix={`${prefs.tileSize} px`}
            onChange={(v) => set({ tileSize: 140 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.shape.padTile.title")} hint={t("settings.customize.shape.padTile.hint")}>
          <LiveSlider
            value={prefs.padTile - 8}
            max={16}
            label={t("settings.customize.shape.padTile.title")}
            suffix={`${prefs.padTile} px`}
            onChange={(v) => set({ padTile: 8 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.shape.gapZone.title")} hint={t("settings.customize.shape.gapZone.hint")}>
          {/* Пол 0, а не 4: плоская раскладка легитимно ставит зазор в ноль
              (зоны встык), и ползунок обязан уметь и показать его, и вернуть. */}
          <LiveSlider
            value={prefs.gapZone}
            max={20}
            label={t("settings.customize.shape.gapZone.title")}
            suffix={`${prefs.gapZone} px`}
            onChange={(v) => set({ gapZone: Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.shape.sidebarWidth.title")} hint={t("settings.customize.shape.sidebarWidth.hint")}>
          <LiveSlider
            value={prefs.wSidebar - 240}
            max={100}
            label={t("settings.customize.shape.sidebarWidth.title")}
            suffix={`${prefs.wSidebar} px`}
            onChange={(v) => set({ wSidebar: 240 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.shape.nowPlayingWidth.title")} hint={t("settings.customize.shape.nowPlayingWidth.hint")}>
          <LiveSlider
            value={prefs.wNowPlaying - 300}
            max={120}
            label={t("settings.customize.shape.nowPlayingWidth.title")}
            suffix={`${prefs.wNowPlaying} px`}
            onChange={(v) => set({ wNowPlaying: 300 + Math.round(v) })}
          />
        </SettingRow>

        <GroupTitle>{t("settings.customize.typography.groupTitle")}</GroupTitle>
        {/* Каждое название в списке нарисовано СВОИМ шрифтом — живое превью
            вместо слепого выбора по имени. */}
        <SettingRow title={t("settings.customize.typography.fontUi.title")} hint={t("settings.customize.typography.fontUi.hint")}>
          <Select
            ariaLabel={t("settings.customize.typography.fontUi.title")}
            items={fonts.map((f) => ({ key: f.key, label: <span style={{ fontFamily: f.family }}>{f.label}</span> }))}
            value={prefs.fontUi}
            onChange={(fontUi: string) => set({ fontUi })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.typography.fontDisplay.title")} hint={t("settings.customize.typography.fontDisplay.hint")}>
          <Select
            ariaLabel={t("settings.customize.typography.fontDisplay.title")}
            items={fonts.map((f) => ({ key: f.key, label: <span style={{ fontFamily: f.family }}>{f.label}</span> }))}
            value={prefs.fontDisplay}
            onChange={(fontDisplay: string) => set({ fontDisplay })}
          />
        </SettingRow>
        {caps.has("customFont") ? (
          <SettingRow title={t("settings.customize.typography.customFont.title")} hint={t("settings.customize.typography.customFont.hint")}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              {customFontName ? (
                <>
                  <span
                    style={{
                      fontFamily: customFontFamily,
                      fontSize: "var(--fs-body)",
                      color: "var(--text-2)",
                      maxWidth: 150,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {customFontName}
                  </span>
                  <IconButton
                    icon="trash-2"
                    size="sm"
                    label={t("settings.customize.typography.customFont.remove")}
                    onClick={onRemoveCustomFont}
                  />
                </>
              ) : null}
              <Button variant="secondary" icon="upload" onClick={() => fontFileRef.current?.click()}>
                {t(customFontName ? "settings.customize.typography.customFont.replace" : "settings.customize.typography.customFont.pick")}
              </Button>
              <input
                ref={fontFileRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // повторный выбор того же файла снова даёт событие
                  void onCustomFontFile(file);
                }}
              />
            </div>
          </SettingRow>
        ) : null}
        <SettingRow title={t("settings.customize.typography.fontScale.title")} hint={t("settings.customize.typography.fontScale.hint")}>
          <LiveSlider
            value={prefs.fontScale - 85}
            max={40}
            label={t("settings.customize.typography.fontScale.title")}
            suffix={`${prefs.fontScale} %`}
            onChange={(v) => set({ fontScale: 85 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.typography.headingScale.title")} hint={t("settings.customize.typography.headingScale.hint")}>
          <LiveSlider
            value={prefs.headingScale - 85}
            max={35}
            label={t("settings.customize.typography.headingScale.title")}
            suffix={`${prefs.headingScale} %`}
            onChange={(v) => set({ headingScale: 85 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.typography.lineSpacing.title")} hint={t("settings.customize.typography.lineSpacing.hint")}>
          <LiveSlider
            value={prefs.lineSpacing - 125}
            max={35}
            label={t("settings.customize.typography.lineSpacing.title")}
            suffix={(prefs.lineSpacing / 100).toFixed(2).replace(".", lang === "ru" ? "," : ".")}
            onChange={(v) => set({ lineSpacing: 125 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.typography.spaceScale.title")} hint={t("settings.customize.typography.spaceScale.hint")}>
          <LiveSlider
            value={prefs.spaceScale - 85}
            max={40}
            label={t("settings.customize.typography.spaceScale.title")}
            suffix={`${prefs.spaceScale} %`}
            onChange={(v) => set({ spaceScale: 85 + Math.round(v) })}
          />
        </SettingRow>
        {/* Размер строки караоке жил тут вторым рядом (дубль) — сведён в
            «Тексты песен»: караоке это тексты песен, а не общая типографика. */}

        <GroupTitle>{t("settings.customize.motion.groupTitle")}</GroupTitle>
        <SettingRow title={t("settings.customize.motion.anims.title")} hint={t("settings.customize.motion.anims.hint")}>
          <Switch checked={prefs.anims} onChange={(anims: boolean) => set({ anims })} label={t("settings.customize.motion.anims.title")} />
        </SettingRow>
        <SettingRow title={t("settings.customize.motion.animSpeed.title")} hint={t("settings.customize.motion.animSpeed.hint")}>
          <div style={prefs.anims ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
            <LiveSlider
              value={prefs.animSpeed - 60}
              max={110}
              label={t("settings.customize.motion.animSpeed.title")}
              suffix={`${prefs.animSpeed} %`}
              onChange={(v) => set({ animSpeed: 60 + Math.round(v) })}
            />
          </div>
        </SettingRow>
        {/* Раздельные длительности по группам — множители поверх общей
            скорости выше. Гаснут вместе с выключателем движения. */}
        <SettingRow title={t("settings.customize.motion.durMenu.title")} hint={t("settings.customize.motion.durMenu.hint")}>
          <div style={prefs.anims ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
            <LiveSlider
              value={prefs.durMenuMult - 60}
              max={110}
              label={t("settings.customize.motion.durMenu.title")}
              suffix={`${prefs.durMenuMult} %`}
              onChange={(v) => set({ durMenuMult: 60 + Math.round(v) })}
            />
          </div>
        </SettingRow>
        <SettingRow title={t("settings.customize.motion.durDialog.title")} hint={t("settings.customize.motion.durDialog.hint")}>
          <div style={prefs.anims ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
            <LiveSlider
              value={prefs.durDialogMult - 60}
              max={110}
              label={t("settings.customize.motion.durDialog.title")}
              suffix={`${prefs.durDialogMult} %`}
              onChange={(v) => set({ durDialogMult: 60 + Math.round(v) })}
            />
          </div>
        </SettingRow>
        <SettingRow title={t("settings.customize.motion.durPage.title")} hint={t("settings.customize.motion.durPage.hint")}>
          <div style={prefs.anims ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
            <LiveSlider
              value={prefs.durPageMult - 60}
              max={110}
              label={t("settings.customize.motion.durPage.title")}
              suffix={`${prefs.durPageMult} %`}
              onChange={(v) => set({ durPageMult: 60 + Math.round(v) })}
            />
          </div>
        </SettingRow>
        <SettingRow title={t("settings.customize.motion.ease.title")} hint={t("settings.customize.motion.ease.hint")}>
          <div style={prefs.anims ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
            <Tabs
              items={[
                { key: "soft", label: t("settings.customize.motion.ease.soft") },
                { key: "crisp", label: t("settings.customize.motion.ease.crisp") },
                { key: "linear", label: t("settings.customize.motion.ease.linear") },
              ]}
              value={prefs.easeStyle}
              onChange={(k: string) => set({ easeStyle: k as Prefs["easeStyle"] })}
            />
          </div>
        </SettingRow>
        <SettingRow title={t("settings.customize.motion.scrollSpeed.title")} hint={t("settings.customize.motion.scrollSpeed.hint")}>
          <LiveSlider
            value={prefs.scrollSpeed - 50}
            max={250}
            label={t("settings.customize.motion.scrollSpeed.title")}
            suffix={`${prefs.scrollSpeed} %`}
            onChange={(v) => set({ scrollSpeed: 50 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.motion.scrollSmooth.title")} hint={t("settings.customize.motion.scrollSmooth.hint")}>
          <Switch
            checked={prefs.scrollSmooth}
            onChange={(scrollSmooth: boolean) => set({ scrollSmooth })}
            label={t("settings.customize.motion.scrollSmooth.title")}
          />
        </SettingRow>

        <GroupTitle>{t("settings.customize.layout.groupTitle")}</GroupTitle>
        <SettingRow title={t("settings.customize.layout.barButtons.title")} hint={t("settings.customize.layout.barButtons.hint")} onClick={() => openSub("bar")} chevron></SettingRow>
        <SettingRow title={t("settings.customize.layout.navTabs.title")} hint={t("settings.customize.layout.navTabs.hint")} onClick={() => openSub("nav")} chevron></SettingRow>
        <SettingRow title={t("settings.customize.layout.rowCover.title")} hint={t("settings.customize.layout.rowCover.hint")}>
          <Switch
            checked={prefs.rowShow.cover}
            onChange={(on: boolean) => set({ rowShow: { ...prefs.rowShow, cover: on } })}
            label={t("settings.customize.layout.rowCover.title")}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.layout.rowDuration.title")} hint={t("settings.customize.layout.rowDuration.hint")}>
          <Switch
            checked={prefs.rowShow.duration}
            onChange={(on: boolean) => set({ rowShow: { ...prefs.rowShow, duration: on } })}
            label={t("settings.customize.layout.rowDuration.title")}
          />
        </SettingRow>
        {/* Переключатель «Альбом» СКРЫТ до серверных данных: сервер поле
            альбома пока не отдаёт, включённый переключатель ничего не менял —
            а переключатель без действия хуже отсутствующего. */}
        <SettingRow title={t("settings.customize.layout.rowSource.title")} hint={t("settings.customize.layout.rowSource.hint")}>
          <Switch
            checked={prefs.rowShow.source}
            onChange={(on: boolean) => set({ rowShow: { ...prefs.rowShow, source: on } })}
            label={t("settings.customize.layout.rowSource.title")}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.layout.playerHeight.title")} hint={t("settings.customize.layout.playerHeight.hint")}>
          <LiveSlider
            value={prefs.hPlayerBar - 56}
            max={64}
            label={t("settings.customize.layout.playerHeight.title")}
            suffix={`${prefs.hPlayerBar} px`}
            onChange={(v) => set({ hPlayerBar: 56 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.layout.playerCover.title")} hint={t("settings.customize.layout.playerCover.hint")}>
          <LiveSlider
            value={prefs.coverBarSize - 40}
            max={40}
            label={t("settings.customize.layout.playerCover.title")}
            suffix={`${prefs.coverBarSize} px`}
            onChange={(v) => set({ coverBarSize: 40 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.layout.progressThickness.title")} hint={t("settings.customize.layout.progressThickness.hint")}>
          <LiveSlider
            value={prefs.hProgress - 2}
            max={14}
            label={t("settings.customize.layout.progressThickness.title")}
            suffix={`${prefs.hProgress} px`}
            onChange={(v) => set({ hProgress: 2 + Math.round(v) })}
          />
        </SettingRow>

        <GroupTitle>{t("settings.customize.background.groupTitle")}</GroupTitle>
        <SettingRow title={t("settings.customize.background.type.title")} hint={t("settings.customize.background.type.hint")}>
          <Select
            ariaLabel={t("settings.customize.background.type.title")}
            items={[
              { key: "none", label: t("common.off"), icon: "circle-off" },
              { key: "cover", label: t("settings.customize.background.type.cover"), icon: "image" },
              { key: "color", label: t("settings.customize.background.type.color"), icon: "paintbrush" },
              { key: "gradient", label: t("settings.customize.background.type.gradient"), icon: "blend" },
              { key: "image", label: t("settings.customize.background.type.image"), icon: "link" },
              { key: "animated", label: t("settings.customize.background.type.animated"), icon: "sparkles" },
            ]}
            value={prefs.bgType}
            onChange={(k: string) => set({ bgType: k as Prefs["bgType"] })}
          />
        </SettingRow>
        {prefs.bgType === "animated" ? (
          <>
            <SettingRow title={t("settings.customize.background.discs.title")} hint={t("settings.customize.background.discs.hint")}>
              <Select
                ariaLabel={t("settings.customize.background.discs.title")}
                items={discItems(t)}
                value={normalizeDiscs(prefs.bgAnimDiscs)}
                onChange={(k: string) => set({ bgAnimDiscs: k as Prefs["bgAnimDiscs"] })}
              />
            </SettingRow>
            <SettingRow title={t("settings.customize.background.spin.title")} hint={t("settings.customize.background.spin.hint")}>
              <Select
                ariaLabel={t("settings.customize.background.spin.title")}
                items={spinItems(t, normalizeDiscs(prefs.bgAnimDiscs))}
                value={spinValue(normalizeDiscs(prefs.bgAnimDiscs), prefs.bgAnimSpin)}
                onChange={(k: string) => setMainSpin(k as BgAnimSpin)}
              />
            </SettingRow>
          </>
        ) : null}
        {/* Ряд виден ВСЕГДА (иначе его не найти поиском), но при другом типе
            фона гаснет с честной подсказкой почему. */}
        <PresetRow
          title={t("settings.customize.background.anim.title")}
          hint={prefs.bgType === "animated" ? t("settings.customize.background.anim.hint") : t("settings.customize.background.anim.disabledHint")}
          chips={[
            { key: "calm", label: t("settings.customize.background.anim.presets.calm") },
            { key: "lively", label: t("settings.customize.background.anim.presets.lively") },
            { key: "bright", label: t("settings.customize.background.anim.presets.bright") },
          ]}
          active={matchPreset(PRESETS_BG, prefs)}
          disabled={prefs.bgType !== "animated"}
          onPick={(k) => set(PRESETS_BG[k])}
        >
          <SettingRow title={t("settings.customize.background.animSpeed.title")} hint={t("settings.customize.background.animSpeed.hint")}>
            <LiveSlider
              value={prefs.bgAnimSpeedSec - 16}
              max={164}
              label={t("settings.customize.background.animSpeed.title")}
              suffix={t("settings.customize.units.seconds", { n: prefs.bgAnimSpeedSec })}
              onChange={(v) => set({ bgAnimSpeedSec: 16 + Math.round(v) })}
            />
          </SettingRow>
          <SettingRow title={t("settings.customize.background.animOpacity.title")} hint={t("settings.customize.background.animOpacity.hint")}>
            <LiveSlider
              value={prefs.bgAnimOpacity - 5}
              max={55}
              label={t("settings.customize.background.animOpacity.title")}
              suffix={`${prefs.bgAnimOpacity} %`}
              onChange={(v) => set({ bgAnimOpacity: 5 + Math.round(v) })}
            />
          </SettingRow>
          <SettingRow title={t("settings.customize.background.animScale.title")} hint={t("settings.customize.background.animScale.hint")}>
            <LiveSlider
              value={prefs.bgAnimScale - 100}
              max={100}
              label={t("settings.customize.background.animScale.title")}
              suffix={`${prefs.bgAnimScale} %`}
              onChange={(v) => set({ bgAnimScale: 100 + Math.round(v) })}
            />
          </SettingRow>
          <SettingRow title={t("settings.customize.background.animEdge.title")} hint={t("settings.customize.background.animEdge.hint")}>
            <LiveSlider
              value={prefs.bgAnimEdge}
              max={40}
              label={t("settings.customize.background.animEdge.title")}
              suffix={`${prefs.bgAnimEdge} %`}
              onChange={(v) => set({ bgAnimEdge: Math.round(v) })}
            />
          </SettingRow>
        </PresetRow>
        {prefs.bgType === "color" || prefs.bgType === "gradient" ? (
          <SettingRow
            title={prefs.bgType === "gradient" ? t("settings.customize.background.color.gradientTitle") : t("settings.customize.background.color.title")}
            hint={t("settings.customize.background.color.hint")}
          >
            <div style={{ display: "flex", gap: "var(--sp-3)" }}>
              <ColorDot color={prefs.bgColor} label={t("settings.customize.background.color.title")} onPick={(bgColor) => set({ bgColor })} />
              {prefs.bgType === "gradient" ? (
                <ColorDot color={prefs.bgColor2} label={t("settings.customize.background.color.secondGradientColor")} onPick={(bgColor2) => set({ bgColor2 })} />
              ) : null}
            </div>
          </SettingRow>
        ) : null}
        {prefs.bgType === "image" ? (
          <SettingRow title={t("settings.customize.background.imageUrl.title")} hint={t("settings.customize.background.imageUrl.hint")}>
            <SettingInput value={prefs.bgImageUrl} onChange={(bgImageUrl) => set({ bgImageUrl })} placeholder="https://…" width={260} />
          </SettingRow>
        ) : null}
        <SettingRow title={t("settings.customize.background.dim.title")} hint={t("settings.customize.background.dim.hint")}>
          <LiveSlider
            value={prefs.bgDim}
            max={80}
            label={t("settings.customize.background.dim.title")}
            suffix={`${prefs.bgDim} %`}
            onChange={(v) => set({ bgDim: Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.customize.background.tint.title")} hint={t("settings.customize.background.tint.hint")}>
          <Switch checked={prefs.bgTint} onChange={(bgTint: boolean) => set({ bgTint })} label={t("settings.customize.background.tint.title")} />
        </SettingRow>

        {/* ── ФОН В КАРАОКЕ ───────────────────────────────────────────────
            Отдельная группа, а не пара строк внутри «Фона»: у режима
            прослушивания своя картина, и настраивают её отдельно от подложки
            под интерфейсом (заявка владельца 03.08 — он поставил гифку фоном и
            ждал её в караоке, а там была обложка трека без единой ручки).
            Первый пункт списка — «Обложка трека», он же значение по умолчанию:
            у не трогавшего настройку караоке выглядит ровно как вчера. */}
        <GroupTitle>{t("settings.customize.karaokeBg.groupTitle")}</GroupTitle>
        <SettingRow title={t("settings.customize.karaokeBg.type.title")} hint={t("settings.customize.karaokeBg.type.hint")}>
          <Select
            ariaLabel={t("settings.customize.karaokeBg.type.title")}
            items={[
              { key: "cover", label: t("settings.customize.background.type.cover"), icon: "image" },
              { key: "same", label: t("settings.customize.karaokeBg.type.same"), icon: "copy" },
              { key: "none", label: t("common.off"), icon: "circle-off" },
              { key: "color", label: t("settings.customize.background.type.color"), icon: "paintbrush" },
              { key: "gradient", label: t("settings.customize.background.type.gradient"), icon: "blend" },
              { key: "image", label: t("settings.customize.background.type.image"), icon: "link" },
              { key: "animated", label: t("settings.customize.background.type.animated"), icon: "sparkles" },
            ]}
            value={prefs.karaokeBgType}
            onChange={(k: string) => set({ karaokeBgType: k as Prefs["karaokeBgType"] })}
          />
        </SettingRow>
        {prefs.karaokeBgType === "color" || prefs.karaokeBgType === "gradient" ? (
          <SettingRow
            title={prefs.karaokeBgType === "gradient" ? t("settings.customize.background.color.gradientTitle") : t("settings.customize.background.color.title")}
            hint={t("settings.customize.background.color.hint")}
          >
            <div style={{ display: "flex", gap: "var(--sp-3)" }}>
              <ColorDot color={prefs.karaokeBgColor} label={t("settings.customize.background.color.title")} onPick={(karaokeBgColor) => set({ karaokeBgColor })} />
              {prefs.karaokeBgType === "gradient" ? (
                <ColorDot
                  color={prefs.karaokeBgColor2}
                  label={t("settings.customize.background.color.secondGradientColor")}
                  onPick={(karaokeBgColor2) => set({ karaokeBgColor2 })}
                />
              ) : null}
            </div>
          </SettingRow>
        ) : null}
        {prefs.karaokeBgType === "image" ? (
          <SettingRow title={t("settings.customize.background.imageUrl.title")} hint={t("settings.customize.karaokeBg.imageUrl.hint")}>
            <SettingInput value={prefs.karaokeBgImageUrl} onChange={(karaokeBgImageUrl) => set({ karaokeBgImageUrl })} placeholder="https://…" width={260} />
          </SettingRow>
        ) : null}
        {prefs.karaokeBgType === "animated" ? (
          <>
            <SettingRow title={t("settings.customize.background.discs.title")} hint={t("settings.customize.background.discs.hint")}>
              <Select
                ariaLabel={t("settings.customize.karaokeBg.discsAriaLabel")}
                items={discItems(t)}
                value={normalizeDiscs(prefs.karaokeBgAnimDiscs)}
                onChange={(k: string) => set({ karaokeBgAnimDiscs: k as BgAnimDiscs })}
              />
            </SettingRow>
            <SettingRow title={t("settings.customize.background.spin.title")} hint={t("settings.customize.background.spin.hint")}>
              <Select
                ariaLabel={t("settings.customize.karaokeBg.spinAriaLabel")}
                items={spinItems(t, normalizeDiscs(prefs.karaokeBgAnimDiscs))}
                value={spinValue(normalizeDiscs(prefs.karaokeBgAnimDiscs), prefs.karaokeBgAnimSpin)}
                onChange={(k: string) => set({ karaokeBgAnimSpin: k as BgAnimSpin })}
              />
            </SettingRow>
            <SettingRow title={t("settings.customize.background.animSpeed.title")} hint={t("settings.customize.background.animSpeed.hint")}>
              <LiveSlider
                value={prefs.karaokeBgAnimSpeedSec - 16}
                max={164}
                label={t("settings.customize.background.animSpeed.title")}
                suffix={t("settings.customize.units.seconds", { n: prefs.karaokeBgAnimSpeedSec })}
                onChange={(v) => set({ karaokeBgAnimSpeedSec: 16 + Math.round(v) })}
              />
            </SettingRow>
            <SettingRow title={t("settings.customize.background.animOpacity.title")} hint={t("settings.customize.background.animOpacity.hint")}>
              <LiveSlider
                value={prefs.karaokeBgAnimOpacity - 5}
                max={55}
                label={t("settings.customize.background.animOpacity.title")}
                suffix={`${prefs.karaokeBgAnimOpacity} %`}
                onChange={(v) => set({ karaokeBgAnimOpacity: 5 + Math.round(v) })}
              />
            </SettingRow>
            <SettingRow title={t("settings.customize.background.animScale.title")} hint={t("settings.customize.background.animScale.hint")}>
              <LiveSlider
                value={prefs.karaokeBgAnimScale - 100}
                max={100}
                label={t("settings.customize.background.animScale.title")}
                suffix={`${prefs.karaokeBgAnimScale} %`}
                onChange={(v) => set({ karaokeBgAnimScale: 100 + Math.round(v) })}
              />
            </SettingRow>
            {/* Заход за край прячет круги за рамкой окна — одной обложке по
                центру прятаться не за что, ряд ей просто не нужен. */}
            {normalizeDiscs(prefs.karaokeBgAnimDiscs) === "two" ? (
              <SettingRow title={t("settings.customize.background.animEdge.title")} hint={t("settings.customize.background.animEdge.hint")}>
                <LiveSlider
                  value={prefs.karaokeBgAnimEdge}
                  max={40}
                  label={t("settings.customize.background.animEdge.title")}
                  suffix={`${prefs.karaokeBgAnimEdge} %`}
                  onChange={(v) => set({ karaokeBgAnimEdge: Math.round(v) })}
                />
              </SettingRow>
            ) : null}
          </>
        ) : null}

        <GroupTitle>{t("settings.customize.visualizerGroup")}</GroupTitle>
        {/* Визуализатор и отклик на бас устроены внутри как встроенные
            расширения и жили в «Расширениях», но человеку это неоткуда знать —
            он ищет визуализатор во внешнем виде. Ключи словаря остались
            settings.extensions.* — переехало место рендера, не имена. */}
        <SettingRow title={t("settings.extensions.visualizer.title")} hint={t("settings.extensions.visualizer.hint")}>
          <Switch
            checked={prefs.visualizer !== "off"}
            onChange={(on: boolean) => set({ visualizer: on ? "bars" : "off" })}
            label={t("settings.extensions.visualizer.title")}
          />
        </SettingRow>
        {/* Ручки показываются только для того вида, на который влияют: у баров
            и волны общего почти нет, а вываливать всё сразу — ровно та беда,
            за которую настройки уже критиковали. */}
        {prefs.visualizer !== "off"
          ? (() => {
              const visPresets = prefs.visualizer === "bars" ? BAR_PRESETS : WAVE_PRESETS;
              return (
                <>
                  <SettingRow title={t("settings.extensions.visualizerKind.title")} hint={t("settings.extensions.visualizerKind.hint")}>
                    <Tabs
                      items={[
                        { key: "bars", label: t("settings.extensions.visualizerKind.bars") },
                        { key: "wave", label: t("settings.extensions.visualizerKind.wave") },
                      ]}
                      value={prefs.visualizer}
                      onChange={(k: string) => set({ visualizer: k as Prefs["visualizer"] })}
                    />
                  </SettingRow>
                  <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                    <ChipGroup
                      items={[
                        ...visPresets.map((p) => ({ key: p.key, label: t(`settings.extensions.visualizerStyle.${p.key}`) })),
                        { key: "custom", label: t("settings.extensions.visualizerStyle.custom") },
                      ]}
                      value={activeVisPreset(visPresets, prefs) ?? "custom"}
                      onChange={(k: string) => {
                        const p = visPresets.find((x) => x.key === k);
                        if (p) set(p.set);
                      }}
                    />
                  </div>
                  {prefs.visualizer === "bars" ? (
                    <>
                      <VisSliderRow
                        title={t("settings.extensions.visualizerBars.title")}
                        hint={t("settings.extensions.visualizerBars.hint")}
                        value={prefs.visualizerBars}
                        limit={VIS_LIMITS.bars}
                        unit=""
                        onChange={(v) => set({ visualizerBars: v })}
                      />
                      <VisSliderRow
                        title={t("settings.extensions.visualizerBarFill.title")}
                        hint={t("settings.extensions.visualizerBarFill.hint")}
                        value={prefs.visualizerBarFill}
                        limit={VIS_LIMITS.barFill}
                        onChange={(v) => set({ visualizerBarFill: v })}
                      />
                      <VisSliderRow
                        title={t("settings.extensions.visualizerBarRound.title")}
                        hint={t("settings.extensions.visualizerBarRound.hint")}
                        value={prefs.visualizerBarRound}
                        limit={VIS_LIMITS.barRound}
                        onChange={(v) => set({ visualizerBarRound: v })}
                      />
                      <VisSliderRow
                        title={t("settings.extensions.visualizerBarCalm.title")}
                        hint={t("settings.extensions.visualizerBarCalm.hint")}
                        value={prefs.visualizerBarCalm}
                        limit={VIS_LIMITS.barCalm}
                        onChange={(v) => set({ visualizerBarCalm: v })}
                      />
                      <SettingRow title={t("settings.extensions.visualizerPeaks.title")} hint={t("settings.extensions.visualizerPeaks.hint")}>
                        <Switch
                          checked={prefs.visualizerPeaks}
                          onChange={(on: boolean) => set({ visualizerPeaks: on })}
                          label={t("settings.extensions.visualizerPeaks.title")}
                        />
                      </SettingRow>
                      {/* Скорость падения показывается только при включённых
                          шапках: ползунок, который ничего не делает, читается
                          как сломанный, а не как «выключено выше». */}
                      {prefs.visualizerPeaks ? (
                        <VisSliderRow
                          title={t("settings.extensions.visualizerPeakFall.title")}
                          hint={t("settings.extensions.visualizerPeakFall.hint")}
                          value={prefs.visualizerPeakFall}
                          limit={VIS_LIMITS.peakFall}
                          onChange={(v) => set({ visualizerPeakFall: v })}
                        />
                      ) : null}
                      <SettingRow title={t("settings.extensions.visualizerMirror.title")} hint={t("settings.extensions.visualizerMirror.hint")}>
                        <Switch
                          checked={prefs.visualizerMirror}
                          onChange={(on: boolean) => set({ visualizerMirror: on })}
                          label={t("settings.extensions.visualizerMirror.title")}
                        />
                      </SettingRow>
                    </>
                  ) : (
                    <>
                      <VisSliderRow
                        title={t("settings.extensions.visualizerWaveThick.title")}
                        hint={t("settings.extensions.visualizerWaveThick.hint")}
                        value={prefs.visualizerWaveThick}
                        limit={VIS_LIMITS.waveThick}
                        onChange={(v) => set({ visualizerWaveThick: v })}
                      />
                      <VisSliderRow
                        title={t("settings.extensions.visualizerWaveFill.title")}
                        hint={t("settings.extensions.visualizerWaveFill.hint")}
                        value={prefs.visualizerWaveFill}
                        limit={VIS_LIMITS.waveFill}
                        onChange={(v) => set({ visualizerWaveFill: v })}
                      />
                      <VisSliderRow
                        title={t("settings.extensions.visualizerWaveSmooth.title")}
                        hint={t("settings.extensions.visualizerWaveSmooth.hint")}
                        value={prefs.visualizerWaveSmooth}
                        limit={VIS_LIMITS.waveSmooth}
                        onChange={(v) => set({ visualizerWaveSmooth: v })}
                      />
                      <VisSliderRow
                        title={t("settings.extensions.visualizerWaveCalm.title")}
                        hint={t("settings.extensions.visualizerWaveCalm.hint")}
                        value={prefs.visualizerWaveCalm}
                        limit={VIS_LIMITS.waveCalm}
                        onChange={(v) => set({ visualizerWaveCalm: v })}
                      />
                      <VisSliderRow
                        title={t("settings.extensions.visualizerWaveAmp.title")}
                        hint={t("settings.extensions.visualizerWaveAmp.hint")}
                        value={prefs.visualizerWaveAmp}
                        limit={VIS_LIMITS.waveAmp}
                        onChange={(v) => set({ visualizerWaveAmp: v })}
                      />
                    </>
                  )}
                  <VisSliderRow
                    title={t("settings.extensions.visualizerOpacity.title")}
                    hint={t("settings.extensions.visualizerOpacity.hint")}
                    value={prefs.visualizerOpacity}
                    limit={VIS_LIMITS.opacity}
                    onChange={(v) => set({ visualizerOpacity: v })}
                  />
                </>
              );
            })()
          : null}
        <SettingRow title={t("settings.extensions.bassShake.title")} hint={t("settings.extensions.bassShake.hint")}>
          <Switch checked={prefs.bassShake} onChange={(on: boolean) => set({ bassShake: on })} label={t("settings.extensions.bassShake.title")} />
        </SettingRow>
        {prefs.bassShake ? (
          <>
            <SettingRow title={t("settings.extensions.bassShakeStrength.title")} hint={t("settings.extensions.bassShakeStrength.hint")}>
              <LiveSlider
                value={prefs.bassShakeStrength}
                max={BASS_STRENGTH_MAX}
                label={t("settings.extensions.bassShakeStrength.title")}
                suffix={`${prefs.bassShakeStrength} %`}
                onChange={(v) => set({ bassShakeStrength: Math.round(v) })}
              />
            </SettingRow>
            {/* Раскрытые тайминги отклика на бас — два ползунка вместо четырёх
                зашитых чисел (атака/спад → резкость, масштаб/подъём → размах);
                50 = прежнее поведение. */}
            <SettingRow title={t("settings.extensions.bassSharp.title")} hint={t("settings.extensions.bassSharp.hint")}>
              <LiveSlider
                value={prefs.bassSharp}
                max={100}
                label={t("settings.extensions.bassSharp.title")}
                suffix={`${prefs.bassSharp} %`}
                onChange={(v) => set({ bassSharp: Math.round(v) })}
              />
            </SettingRow>
            <SettingRow title={t("settings.extensions.bassReach.title")} hint={t("settings.extensions.bassReach.hint")}>
              <LiveSlider
                value={prefs.bassReach}
                max={100}
                label={t("settings.extensions.bassReach.title")}
                suffix={`${prefs.bassReach} %`}
                onChange={(v) => set({ bassReach: Math.round(v) })}
              />
            </SettingRow>
          </>
        ) : null}

        <GroupTitle>{t("settings.customize.behavior.groupTitle")}</GroupTitle>
        {/* Ряда «Действие по двойному клику» здесь больше нет (2026-08-05).
            Строка трека запускает трек ОДИНОЧНЫМ кликом по всей левой части, а
            двойного клика у неё не осталось вовсе — настройка управляла бы
            жестом, которого нет. «В очередь» никуда не делась: она в меню «⋯»
            и по правому клику (App.queueTrack). */}
        <SettingRow title={t("settings.customize.behavior.startView.title")} hint={t("settings.customize.behavior.startView.hint")}>
          <Select
            ariaLabel={t("settings.customize.behavior.startView.title")}
            items={[
              { key: "home", label: t("settings.customize.behavior.startView.home"), icon: "home" },
              { key: "search", label: t("settings.customize.behavior.startView.search"), icon: "search" },
              { key: "favorites", label: t("settings.customize.behavior.startView.favorites"), icon: "heart" },
              { key: "library", label: t("settings.customize.behavior.startView.library"), icon: "library-big" },
            ]}
            value={prefs.startView}
            onChange={(k: string) => set({ startView: k as Prefs["startView"] })}
          />
        </SettingRow>

        <GroupTitle>{t("settings.customize.themes.groupTitle")}</GroupTitle>
        <SettingRow title={t("settings.customize.themes.saveAs.title")} hint={t("settings.customize.themes.saveAs.hint")}>
          <Button variant="ghost" icon="save" onClick={themeLib.openSave}>
            {t("common.save")}
          </Button>
        </SettingRow>
        {themeLib.themes.map((theme: SavedTheme) => (
          <SettingRow key={theme.id} title={theme.name} hint={new Date(theme.createdAt).toLocaleDateString(lang)}>
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <Button variant="secondary" icon="paintbrush" onClick={() => themeLib.apply(theme)}>
                {t("common.apply")}
              </Button>
              <IconButton icon="copy" label={t("settings.customize.themes.copyJson")} onClick={() => void themeLib.copy(theme)} />
              <IconButton icon="trash-2" label={t("settings.customize.themes.deleteTheme")} onClick={() => themeLib.remove(theme.id)} />
            </div>
          </SettingRow>
        ))}
        <SettingRow title={t("settings.customize.themes.importRow.title")} hint={t("settings.customize.themes.importRow.hint")}>
          <Button variant="ghost" icon="clipboard-paste" onClick={themeLib.openImport}>
            {t("settings.customize.themes.importRow.button")}
          </Button>
        </SettingRow>
        {caps.has("themeMarket") ? (
          <SettingRow title={t("settings.customize.themes.marketRow.title")} hint={t("settings.customize.themes.marketRow.hint")} onClick={() => openMarket("themes")} chevron></SettingRow>
        ) : null}

        <GroupTitle>{t("settings.customize.css.groupTitle")}</GroupTitle>
        <SettingRow title={t("settings.customize.css.toggle.title")} hint={t("settings.customize.css.toggle.hint")}>
          <Switch checked={prefs.customCssOn} onChange={(customCssOn: boolean) => set({ customCssOn })} label={t("settings.customize.css.toggle.title")} />
        </SettingRow>
        {prefs.customCssOn ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {/* Черновик, а не запись на каждый символ: иначе весь интерфейс
                перерисовывался бы на каждое нажатие клавиши. */}
            <textarea
              value={cssDraft}
              onChange={(e) => setCssDraft(e.target.value)}
              spellCheck={false}
              placeholder={":root { --accent: #22c55e; }\n.muza-view { /* … */ }"}
              aria-label={t("settings.customize.css.toggle.title")}
              style={{
                minHeight: 140,
                resize: "vertical",
                padding: "var(--sp-3)",
                border: "none",
                borderRadius: "var(--r-sm)",
                background: "var(--surface-3)",
                color: "var(--text-1)",
                fontFamily: "Consolas, monospace",
                fontSize: 13,
                lineHeight: 1.5,
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
              <Button variant="secondary" icon="check" disabled={cssDraft === prefs.customCss} onClick={() => set({ customCss: cssDraft })}>
                {t("settings.customize.css.apply")}
              </Button>
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.customize.css.appliesHint")}</span>
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: "var(--sp-2)" }}>
          <Button
            variant="ghost"
            icon="rotate-ccw"
            onClick={() =>
              set({
                accent: DEFAULT_PREFS.accent,
                accentRolesOn: DEFAULT_PREFS.accentRolesOn,
                radius: DEFAULT_PREFS.radius,
                radiusTiles: DEFAULT_PREFS.radiusTiles,
                radiusPanels: DEFAULT_PREFS.radiusPanels,
                radiusControls: DEFAULT_PREFS.radiusControls,
                radiusFields: DEFAULT_PREFS.radiusFields,
                radiusTabs: DEFAULT_PREFS.radiusTabs,
                blur: DEFAULT_PREFS.blur,
                glassOpacity: DEFAULT_PREFS.glassOpacity,
                glassOn: DEFAULT_PREFS.glassOn,
                glassZonesOn: DEFAULT_PREFS.glassZonesOn,
                glassPlayer: DEFAULT_PREFS.glassPlayer,
                glassMenu: DEFAULT_PREFS.glassMenu,
                glassDialog: DEFAULT_PREFS.glassDialog,
                glassSidebar: DEFAULT_PREFS.glassSidebar,
                glassNowPlaying: DEFAULT_PREFS.glassNowPlaying,
                anims: DEFAULT_PREFS.anims,
                bgType: DEFAULT_PREFS.bgType,
                bgColor: DEFAULT_PREFS.bgColor,
                bgColor2: DEFAULT_PREFS.bgColor2,
                bgImageUrl: DEFAULT_PREFS.bgImageUrl,
                bgDim: DEFAULT_PREFS.bgDim,
                bgTint: DEFAULT_PREFS.bgTint,
                bgAnimatedInvert: DEFAULT_PREFS.bgAnimatedInvert,
                bgAnimDiscs: DEFAULT_PREFS.bgAnimDiscs,
                bgAnimSpin: DEFAULT_PREFS.bgAnimSpin,
                // Фон караоке сбрасывается вместе с остальным оформлением —
                // «Сбросить оформление» обязано возвращать ВЕСЬ вид, иначе
                // кнопка врёт: сцена осталась бы чужой.
                karaokeBgType: DEFAULT_PREFS.karaokeBgType,
                karaokeBgColor: DEFAULT_PREFS.karaokeBgColor,
                karaokeBgColor2: DEFAULT_PREFS.karaokeBgColor2,
                karaokeBgImageUrl: DEFAULT_PREFS.karaokeBgImageUrl,
                karaokeBgAnimSpeedSec: DEFAULT_PREFS.karaokeBgAnimSpeedSec,
                karaokeBgAnimOpacity: DEFAULT_PREFS.karaokeBgAnimOpacity,
                karaokeBgAnimScale: DEFAULT_PREFS.karaokeBgAnimScale,
                karaokeBgAnimEdge: DEFAULT_PREFS.karaokeBgAnimEdge,
                karaokeBgAnimDiscs: DEFAULT_PREFS.karaokeBgAnimDiscs,
                karaokeBgAnimSpin: DEFAULT_PREFS.karaokeBgAnimSpin,
                blurScenery: DEFAULT_PREFS.blurScenery,
                baseBg: DEFAULT_PREFS.baseBg,
                textDim: DEFAULT_PREFS.textDim,
                uiScale: DEFAULT_PREFS.uiScale,
                animSpeed: DEFAULT_PREFS.animSpeed,
                // размер строки караоке здесь НЕ сбрасывается: его ряд живёт в
                // «Текстах песен», кнопка сбрасывает только оформление
                wSidebar: DEFAULT_PREFS.wSidebar,
                wNowPlaying: DEFAULT_PREFS.wNowPlaying,
                customCssOn: DEFAULT_PREFS.customCssOn,
              })
            }
          >
            {t("settings.customize.resetAppearance")}
          </Button>
        </div>
      </div>

      <ThemeDialogs lib={themeLib} />
    </>
  );
}
