/** Свой шрифт пользователя (2026-07-20, жалоба владельца «нельзя загрузить
 *  свой шрифт»): файл берётся обычным <input type="file"> (работает и в Tauri,
 *  и в вебе — Rust не нужен), хранится dataURL-ом в ОТДЕЛЬНОМ ключе
 *  localStorage (не в prefs: файл до мегабайт, prefs читаются каждый кадр
 *  настройками), регистрируется рантайм-инжектом @font-face. В реестре шрифтов
 *  появляется ключ "custom" (fonts.ts), дальше — обычный путь --font-ui.
 *
 *  Шрифт НЕ входит в THEME_KEYS: файл — локальный ресурс устройства, тема
 *  чужой машины не может его принести (ключ "custom" без файла честно падает
 *  в системный хвост Segoe — см. fontFamily).
 *
 *  ПЕРЕЕЗД 2026-08-02 из apps/desktop/src/lib/customFont.ts: живёт рядом с
 *  реестром шрифтов (prefs/fonts.ts), который про ключ "custom" знает. Кода
 *  платформы здесь нет — <input type="file"> + localStorage работают и во
 *  вкладке браузера, так что своим шрифтом веб сможет пользоваться тем же
 *  модулем, без второй копии. */

const STORAGE_KEY = "muza.customFont.v1";
const STYLE_ID = "muza-custom-font";
/** CSS-family зарегистрированного своего шрифта. */
export const CUSTOM_FONT_FAMILY = "Muza Custom Font";
/** Разумный потолок: тяжелее — это уже пак начертаний, localStorage не резиновый. */
export const CUSTOM_FONT_MAX_BYTES = 8 * 1024 * 1024;
export const CUSTOM_FONT_EXTENSIONS = ["ttf", "otf", "woff", "woff2"];

export interface StoredCustomFont {
  /** Имя файла без расширения — подпись в списке шрифтов. */
  name: string;
  dataUrl: string;
}

export function loadCustomFont(): StoredCustomFont | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCustomFont;
    if (typeof parsed?.name !== "string" || typeof parsed?.dataUrl !== "string") return null;
    if (!parsed.dataUrl.startsWith("data:")) return null; // только вшитые байты, не внешние URL
    return parsed;
  } catch {
    return null;
  }
}

/** Инжект/обновление @font-face; отсутствие шрифта убирает стиль.
 *  Возвращает имя для UI (null — свой шрифт не загружен). */
export function applyCustomFont(doc: Document = document): string | null {
  const stored = loadCustomFont();
  const existing = doc.getElementById(STYLE_ID);
  if (!stored) {
    existing?.remove();
    return null;
  }
  const css = `@font-face { font-family: "${CUSTOM_FONT_FAMILY}"; src: url("${stored.dataUrl}"); font-display: swap; }`;
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== css) existing.textContent = css;
  } else {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    doc.head.appendChild(style);
  }
  return stored.name;
}

/** Валидация + чтение выбранного файла в dataURL + сохранение + применение.
 *  Бросает Error с ключом i18n-причины — потребитель переводит сам. */
export async function installCustomFontFile(file: File, doc: Document = document): Promise<StoredCustomFont> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!CUSTOM_FONT_EXTENSIONS.includes(ext)) throw new Error("badExtension");
  if (file.size > CUSTOM_FONT_MAX_BYTES) throw new Error("tooLarge");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("readFailed"));
    reader.readAsDataURL(file);
  });
  const name = file.name.replace(/\.[^.]+$/, "");
  const stored: StoredCustomFont = { name, dataUrl };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    throw new Error("storageFull"); // квота localStorage — файл слишком тяжёлый
  }
  applyCustomFont(doc);
  return stored;
}

export function removeCustomFont(doc: Document = document): void {
  localStorage.removeItem(STORAGE_KEY);
  applyCustomFont(doc); // снимет <style>
}
