/** Реестр шрифтов интерфейса (зона 5 спеки настроек 19.07).
 *
 *  До 19.07 шрифт не менялся ВООБЩЕ — Golos/Unbounded были зашиты в токенах.
 *  Решение владельца: набор готовых с кириллицей (локально, @fontsource —
 *  оффлайн десктопа не ломается) плюс системные. Ключ хранится в
 *  prefs.fontUi/fontDisplay; family уезжает в var(--font-ui)/(--font-display).
 *
 *  Системные шрифты не перечисляются через ОС (в WebView нет API) — канвас-
 *  детект по курируемому списку: ширина эталонной строки шрифтом X против
 *  запасного; совпала до пикселя — шрифта X в системе нет. */

export interface FontChoice {
  key: string;
  /** Человеческое имя — в Select оно же рисуется САМИМ шрифтом (мгновенное превью). */
  label: string;
  family: string;
  /** true — надо проверять наличие в системе канвас-детектом. */
  systemProbe?: boolean;
}

/** Хвост — как у родных токенов ДС: без него сломанный шрифт молча падал бы в Times. */
const TAIL = '"Segoe UI", system-ui, sans-serif';

export const FONT_CHOICES: FontChoice[] = [
  { key: "golos", label: "Golos Text", family: `"Golos Text", ${TAIL}` },
  { key: "unbounded", label: "Unbounded", family: `"Unbounded", "Golos Text", ${TAIL}` },
  { key: "inter", label: "Inter", family: `"Inter", ${TAIL}` },
  { key: "manrope", label: "Manrope", family: `"Manrope", ${TAIL}` },
  { key: "rubik", label: "Rubik", family: `"Rubik", ${TAIL}` },
  { key: "montserrat", label: "Montserrat", family: `"Montserrat", ${TAIL}` },
  { key: "plex", label: "IBM Plex Sans", family: `"IBM Plex Sans", ${TAIL}` },
  { key: "system", label: "Segoe UI", family: TAIL },
  { key: "sys-arial", label: "Arial", family: `Arial, ${TAIL}`, systemProbe: true },
  { key: "sys-verdana", label: "Verdana", family: `Verdana, ${TAIL}`, systemProbe: true },
  { key: "sys-tahoma", label: "Tahoma", family: `Tahoma, ${TAIL}`, systemProbe: true },
  { key: "sys-georgia", label: "Georgia", family: `Georgia, ${TAIL}`, systemProbe: true },
  { key: "sys-times", label: "Times New Roman", family: `"Times New Roman", ${TAIL}`, systemProbe: true },
];

/** family по ключу; неизвестный ключ (тема из будущей версии) — дефолт Golos. */
export function fontFamily(key: string): string {
  return (FONT_CHOICES.find((f) => f.key === key) ?? FONT_CHOICES[0]).family;
}

/** Канвас-детект: measureText эталона шрифтом-кандидатом против monospace.
 *  Ширины совпали → кандидата в системе нет, браузер молча взял запасной. */
export function probeFont(family: string, measure: (font: string) => number): boolean {
  const probe = "мМwWиШ1lIФы—";
  const base = measure(`16px monospace`);
  const withCandidate = measure(`16px ${family}, monospace`);
  return withCandidate !== base;
}

/** Список к показу в Select: бандловые всегда, системные — прошедшие детект.
 *  Без канваса (тесты, страховка) — только бандловые и "system". */
export function availableFonts(doc: Document = document): FontChoice[] {
  let measure: ((font: string) => number) | null = null;
  try {
    const ctx = doc.createElement("canvas").getContext("2d");
    if (ctx) {
      measure = (font: string) => {
        ctx.font = font;
        return ctx.measureText("мМwWиШ1lIФы—").width;
      };
    }
  } catch {
    measure = null;
  }
  return FONT_CHOICES.filter((f) => {
    if (!f.systemProbe) return true;
    if (!measure) return false;
    return probeFont(f.family.split(",")[0], measure);
  });
}
