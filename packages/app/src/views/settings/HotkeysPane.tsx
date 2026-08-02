/** РАЗДЕЛ «ГОРЯЧИЕ КЛАВИШИ» с переназначением.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Раздел общий, а не «приложенческий»: слушатель клавиш — один модуль
 *  (lib/hotkeys), и в браузере он работает без единой правки, а сочетания
 *  лежат в общей модели настроек (prefs.hotkeys). Каркас настроек рисует свой
 *  СПРАВОЧНЫЙ вариант раздела только там, где площадка этот раздел не
 *  передала (SettingsScreen.tsx, HotkeysReferencePane) — здесь настоящий, с
 *  переназначением.
 *
 *  Конфликт (одно сочетание у двух действий) не запрещается, а показывается:
 *  обе строки краснеют. Запрет заставил бы человека угадывать, что именно
 *  занято, — а так видно обе стороны. */

import { Button, Kbd } from "@muza/ui";
import { useT } from "../../i18n";
import { DEFAULT_HOTKEYS, HOTKEY_ACTIONS, hotkeyActionLabel, type HotkeyAction } from "../../lib/hotkeys";
import { HotkeyRow, paneStyle, SettingRow } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export function HotkeysPane() {
  const { t, lang } = useT();
  const { prefs, set, onOpenHotkeys, paneClass } = useSettingsScreen();
  // Сочетания, встречающиеся у >1 действия — конфликт (обе строки красные).
  const counts = new Map<string, number>();
  for (const a of HOTKEY_ACTIONS) counts.set(prefs.hotkeys[a.id], (counts.get(prefs.hotkeys[a.id]) ?? 0) + 1);
  const setKey = (id: HotkeyAction, combo: string) => set({ hotkeys: { ...prefs.hotkeys, [id]: combo } });
  return (
    <div className={paneClass} style={paneStyle}>
      {HOTKEY_ACTIONS.map((a) => (
        <HotkeyRow
          key={a.id}
          label={hotkeyActionLabel(a.id, lang)}
          combo={prefs.hotkeys[a.id]}
          conflict={(counts.get(prefs.hotkeys[a.id]) ?? 0) > 1}
          onCapture={(combo) => setKey(a.id, combo)}
        />
      ))}
      <SettingRow title={t("settings.hotkeys.help.title")} hint={t("settings.hotkeys.help.hint")} onClick={onOpenHotkeys} chevron>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <Kbd>?</Kbd>
          <Kbd>Esc</Kbd>
        </div>
      </SettingRow>
      <div style={{ marginTop: "var(--sp-2)" }}>
        <Button variant="ghost" icon="rotate-ccw" onClick={() => set({ hotkeys: { ...DEFAULT_HOTKEYS } })}>
          {t("settings.hotkeys.resetAll")}
        </Button>
      </div>
    </div>
  );
}
