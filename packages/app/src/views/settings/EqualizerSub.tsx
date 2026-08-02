/** ПОД-ЭКРАН «ЭКВАЛАЙЗЕР»: десятиполосник с вертикальными фейдерами.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Эквалайзер реально крутит звук (Web Audio) на обеих площадках, поэтому
 *  умения ему не нужно: полосы лежат в общей модели настроек, а применяет их
 *  плеер. */

import { Button, ChipGroup, Fader, Switch } from "@muza/ui";
import { useT, type TranslationKey, type TParams } from "../../i18n";
import { paneStyle, SettingRow, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

/** Полосы десятиполосника, Гц. Числа, а не строки: подпись «1 к»/«1 k»
 *  собирается через словарь, а не хардкодится языко-зависимой буквой. */
const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** ⚠️ Ключи EQ_PRESETS — это ПЕРСИСТЕНТНЫЕ значения prefs.eqPreset, общие с
 *  DEFAULT_PREFS и уже лежащие в сохранённых настройках людей. Переименование
 *  сломало бы совместимость, поэтому они сознательно не переведены. */
const EQ_PRESETS: Record<string, number[]> = {
  Ровный: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Бас: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Рок: [5, 4, 2, 0, -1, 0, 2, 3, 4, 4],
  Поп: [-1, 0, 2, 4, 5, 4, 2, 0, -1, -1],
  Вокал: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
};

/** Подпись частоты: до 1 кГц — как есть, дальше «1k»/«1к». */
function eqBandLabel(hz: number, t: (key: TranslationKey, params?: TParams) => string): string {
  return hz >= 1000 ? `${hz / 1000}${t("settings.playback.equalizer.kiloSuffix")}` : `${hz}`;
}

export function EqualizerSub() {
  const { t } = useT();
  const { prefs, setPrefs, closeSub, paneClass } = useSettingsScreen();
  const eqOn = prefs.eqOn;
  const eqPreset = prefs.eqPreset;
  const eqBands = prefs.eqBands;
  const setEqOn = (on: boolean) => setPrefs({ ...prefs, eqOn: on });
  const applyPreset = (name: string) => setPrefs({ ...prefs, eqPreset: name, eqBands: EQ_PRESETS[name] ?? prefs.eqBands });
  const setBand = (i: number, v: number) =>
    setPrefs({
      ...prefs,
      eqPreset: "Свой",
      eqBands: prefs.eqBands.map((x, j) => (j === i ? Math.round(v) : x)),
    });

  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.equalizer.title")} onBack={closeSub} />
      <SettingRow title={t("settings.equalizer.enable.title")} hint={t("settings.equalizer.enable.hint")}>
        <Switch checked={eqOn} onChange={setEqOn} label={t("settings.equalizer.title")} />
      </SettingRow>
      <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
        <ChipGroup items={[...Object.keys(EQ_PRESETS), "Свой"]} value={eqPreset} onChange={applyPreset} />
      </div>
      {/* Панель полос — нативный десятиполосник: вертикальные фейдеры в ряд */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "var(--sp-2)",
          padding: "var(--sp-5) var(--sp-5) var(--sp-4)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-2)",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {EQ_BANDS.map((f, i) => (
          <div key={f} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-2)", flex: "none" }}>
            <span
              style={{
                fontSize: "var(--fs-caption)",
                color: eqOn ? "var(--text-2)" : "var(--text-3)",
                fontVariantNumeric: "tabular-nums",
                minWidth: 34,
                textAlign: "center",
              }}
            >
              {eqBands[i] > 0 ? `+${eqBands[i]}` : eqBands[i]}
            </span>
            <Fader
              value={eqBands[i]}
              min={-12}
              max={12}
              height={150}
              disabled={!eqOn}
              onChange={(v: number) => setBand(i, v)}
              ariaLabel={t("settings.equalizer.bandAria", { freq: eqBandLabel(f, t) })}
            />
            <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{eqBandLabel(f, t)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <Button variant="ghost" icon="rotate-ccw" disabled={!eqOn} onClick={() => applyPreset("Ровный")}>
          {t("settings.equalizer.resetBands")}
        </Button>
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.equalizer.dbRange")}</span>
      </div>
    </div>
  );
}
