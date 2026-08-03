/** СВОИ ОФОРМЛЕНИЯ: сохранить текущий вид под именем, применить, скопировать,
 *  вставить чужое — плюс черновик своего CSS.
 *
 *  Выделено из «Кастомизации» отдельным файлом (волна «настройки»,
 *  2026-08-02) по одной причине: это самостоятельный кусок с тремя диалогами
 *  и собственным состоянием, и внутри и без того самой длинной страницы
 *  настроек он терялся. Разметка и тексты не тронуты.
 *
 *  Оформление — это НАБОР ЗНАЧЕНИЙ настроек, а не отдельная сущность: поэтому
 *  «сохранить» просто снимает слепок текущих значений, а «применить» их
 *  возвращает. Отсюда же берётся обмен: слепок сериализуется в текст, и его
 *  можно передать человеку сообщением.
 *
 *  Черновик CSS живёт здесь, а не в настройках: писать прямо в настройки на
 *  каждый символ значило бы перерисовывать весь интерфейс на каждое нажатие
 *  клавиши. Применяется кнопкой. */

import { useState } from "react";
import { Button, Dialog } from "@muza/ui";
import { useT } from "../../i18n";
import { applyTheme, deleteTheme, listThemes, parseTheme, saveTheme, serializeTheme, type SavedTheme } from "../../prefs/themes";
import { SettingInput } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export interface ThemeLibrary {
  themes: SavedTheme[];
  cssDraft: string;
  setCssDraft: (v: string) => void;
  openSave: () => void;
  openImport: () => void;
  apply: (theme: SavedTheme) => void;
  remove: (id: string) => void;
  copy: (theme: SavedTheme) => Promise<void>;
  /** Внутреннее состояние диалогов — читает только ThemeDialogs ниже. */
  dialogs: {
    nameOpen: boolean;
    setNameOpen: (v: boolean) => void;
    name: string;
    setName: (v: string) => void;
    submitSave: () => void;
    importOpen: boolean;
    setImportOpen: (v: boolean) => void;
    importText: string;
    setImportText: (v: string) => void;
    importErr: string | null;
    submitImport: () => void;
  };
}

export function useThemeLibrary(): ThemeLibrary {
  // lang — ради дефолтного имени темы: у saveTheme он со значением по
  // умолчанию (EN), и без явной передачи русский интерфейс получал в списке
  // «My theme», хотя перевод лежит рядом.
  const { t, lang } = useT();
  const { prefs, setPrefs, onNotify } = useSettingsScreen();

  // Список читается из хранилища устройства при входе на страницу: его мог
  // пополнить соседний экран (витрина), и держать его выше по дереву значило
  // бы завести второй источник правды рядом с самим хранилищем.
  const [themes, setThemes] = useState<SavedTheme[]>(listThemes);
  const [cssDraft, setCssDraft] = useState(prefs.customCss);

  const [nameOpen, setNameOpen] = useState(false);
  const [name, setName] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importErr, setImportErr] = useState<string | null>(null);

  const openSave = () => {
    setName("");
    setNameOpen(true);
  };
  const submitSave = () => {
    saveTheme(name, prefs, lang);
    setThemes(listThemes());
    setNameOpen(false);
    onNotify(t("settings.customize.themes.saved"), "save");
  };
  const apply = (theme: SavedTheme) => {
    setPrefs(applyTheme(theme.tokens, prefs));
    setCssDraft(typeof theme.tokens.customCss === "string" ? theme.tokens.customCss : "");
    onNotify(t("settings.customize.themes.applied", { name: theme.name }), "paintbrush");
  };
  const remove = (id: string) => {
    deleteTheme(id);
    setThemes(listThemes());
    onNotify(t("settings.customize.themes.removed"), "trash-2");
  };
  const copy = async (theme: SavedTheme) => {
    try {
      await navigator.clipboard.writeText(serializeTheme(theme.name, theme.tokens));
      onNotify(t("settings.customize.themes.copied"), "copy");
    } catch {
      onNotify(t("settings.customize.themes.errors.clipboardUnavailable"), "x");
    }
  };
  const openImport = () => setImportOpen(true);
  const submitImport = () => {
    const parsed = parseTheme(importText);
    if (!parsed) {
      setImportErr(t("settings.customize.themes.errors.notMuzaJson"));
      return;
    }
    const next = applyTheme(parsed.tokens, prefs);
    setPrefs(next);
    setCssDraft(next.customCss);
    saveTheme(parsed.name, next, lang);
    setThemes(listThemes());
    setImportOpen(false);
    setImportText("");
    setImportErr(null);
    onNotify(t("settings.customize.themes.imported", { name: parsed.name }), "clipboard-paste");
  };

  return {
    themes,
    cssDraft,
    setCssDraft,
    openSave,
    openImport,
    apply,
    remove,
    copy,
    dialogs: {
      nameOpen,
      setNameOpen,
      name,
      setName,
      submitSave,
      importOpen,
      setImportOpen,
      importText,
      setImportText,
      importErr,
      submitImport,
    },
  };
}

/** Диалоги «Сохранить оформление» и «Вставить оформление». Рисуются СОСЕДОМ
 *  панели (см. AccountPane про transform и position: fixed). */
export function ThemeDialogs({ lib }: { lib: ThemeLibrary }) {
  const { t } = useT();
  const d = lib.dialogs;
  return (
    <>
      {/* Сохранить оформление: имя (одноимённое перезаписывается) */}
      <Dialog
        open={d.nameOpen}
        title={t("settings.customize.themes.saveDialog.title")}
        onClose={() => d.setNameOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => d.setNameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="save" onClick={d.submitSave}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <SettingInput value={d.name} onChange={d.setName} placeholder={t("settings.customize.themes.namePlaceholder")} width={300} />
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.customize.themes.saveDialog.hint")}</div>
        </div>
      </Dialog>

      {/* Вставить оформление: текст из буфера обмена */}
      <Dialog
        open={d.importOpen}
        title={t("settings.customize.themes.importDialog.title")}
        onClose={() => d.setImportOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => d.setImportOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="clipboard-paste" onClick={d.submitImport}>
              {t("settings.customize.themes.importDialog.submit")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 340 }}>
          <textarea
            value={d.importText}
            onChange={(e) => d.setImportText(e.target.value)}
            spellCheck={false}
            placeholder='{"muzaTheme": 1, "name": "…", "tokens": { … }}'
            aria-label={t("settings.customize.themes.importDialog.ariaLabel")}
            style={{
              minHeight: 120,
              resize: "vertical",
              padding: "var(--sp-3)",
              border: "none",
              borderRadius: "var(--r-sm)",
              background: "var(--surface-3)",
              color: "var(--text-1)",
              fontFamily: "Consolas, monospace",
              fontSize: 13,
              outline: "none",
            }}
          />
          {d.importErr ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{d.importErr}</div>
          ) : (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.customize.themes.importDialog.hint")}</div>
          )}
        </div>
      </Dialog>
    </>
  );
}
