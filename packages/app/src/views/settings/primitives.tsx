/** ОБЩИЕ КИРПИЧИ ЭКРАНА НАСТРОЕК (волна веб-паритета «настройки», 2026-08-02).
 *
 *  Приехали как есть из apps/desktop/src/views/SettingsView.tsx: ряд-плашка,
 *  живой ползунок, заголовок группы, свотчи акцента, редактор списка чисел —
 *  всё, из чего складывается КАЖДЫЙ ряд настроек. До переезда их знало только
 *  приложение, и веб рисовал свои похожие ряды руками — они уже разъехались
 *  (у веба был другой Row, другой отступ и своя копия LiveSlider).
 *
 *  ⚠️ Здесь НЕТ ни одного значения из Prefs и ни одного вызова платформы:
 *  кирпичи знают только про свои пропсы. Это условие того, чтобы одна и та же
 *  плашка выглядела одинаково в приложении (где prefs — большой объект
 *  types.ts) и в браузере (где настроек меньше).
 *
 *  Разметка и стили скопированы БЕЗ правок: приложение после переезда обязано
 *  выглядеть ровно как до него. Правишь вид — правишь здесь, и меняется сразу
 *  в обеих программах. */

import { useEffect, useState } from "react";
import { Button, Chip, ChipGroup, ColorPicker, Icon, IconButton, Slider, Tooltip } from "@muza/ui";
import { useT } from "../../i18n";
import { comboFromEvent, formatCombo } from "../../lib/hotkeys";

/** Пол ОБЩЕЙ плотности стекла («Прозрачность» во «Внешнем виде»).
 *
 *  СНЯТ 30 → 0 по требованию владельца 04.08: «минимальное значение почему-то
 *  30, а не 0. Это как раз то ограничение, о котором я говорил: пользователь
 *  хочет настроить под себя, а получает захардкоженные 30%».
 *
 *  ⚠️ ЧТО ЭТО СТОИТ, ЧЕСТНО. Ниже 30% текст на панелях и в меню перестаёт
 *  добирать 4.5:1 — ровно поэтому пол и стоял. Обещание контраста остаётся
 *  ровно там, где его можно держать: сторож «стеклянная лестница»
 *  (theme/themeVars.test.ts) по-прежнему меряет ход 30–100 и не даст сломать
 *  читаемость СИСТЕМНЫМИ правками. Всё, что ниже 30, — осознанный выбор
 *  человека, сделанный руками, а не наш недосмотр. Это разные вещи, и мешать
 *  их нельзя: система обязана быть читаемой по умолчанию, но не обязана
 *  запрещать.
 *
 *  На зональные ползунки стекла («Кастомизация» → стекло плеера/меню/диалогов/
 *  сайдбара/панели) пол не распространялся и раньше: там 0% всегда был
 *  законным видом. Теперь общий ползунок ведёт себя так же. */
export const GLASS_MIN = 0;

/** ПОЛЕ РАЗДЕЛА — вертикальная раскладка его содержимого. Отступы живут ВНУТРИ
 *  скроллера панели, а не на её рамке: так они уезжают вместе с рядами при
 *  прокрутке, а рельс слева тянется на всю высоту зоны без «рамки» сверху.
 *
 *  ⚠️ КОНТРАКТ КАРКАСА: поле заводит САМ РАЗДЕЛ, ровно один раз (см. шапку
 *  SettingsScreen.tsx). Ставить это поле ещё и снаружи нельзя — отступы
 *  сложатся: так и вышло у веба, где каркас заворачивал в поле готовые
 *  компоненты разделов, уже завернувшие себя (60px до первого ряда против 36
 *  у разделов, собранных на странице, замер 2026-08-02).
 *
 *  Новый раздел пишется через <SettingsPane> ниже, а не этой константой:
 *  константа осталась ради разделов, приехавших из приложения с уже написанной
 *  обёрткой (у них на той же обёртке висит класс анимации paneClass). */
export const paneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-3)",
  paddingTop: "var(--sp-6)",
  paddingBottom: "var(--sp-6)",
};

/** Обёртка раздела: то самое ЕДИНСТВЕННОЕ поле вокруг его содержимого.
 *
 *  Раздел, собранный на площадке фрагментом (`<>…</>`), заворачивается в неё —
 *  тогда он неотличим от раздела, приехавшего готовым компонентом, и каркасу
 *  не нужно знать, чем раздел нарисован. Каркас поля НЕ добавляет вовсе.
 *
 *  className — тот же `paneClass` из контекста экрана, что берут готовые
 *  разделы (анимация смены панели в приложении). Площадка без анимации не
 *  передаёт ничего. */
export function SettingsPane({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={className} style={paneStyle}>
      {children}
    </div>
  );
}

export function SettingRow({
  title,
  titleExtra,
  hint,
  onClick,
  chevron,
  danger,
  children,
}: {
  title: string;
  /** Доп. узел справа от заголовка — бейджи и т.п. («Полный доступ»). */
  titleExtra?: React.ReactNode;
  hint?: string;
  onClick?: () => void;
  chevron?: boolean;
  danger?: boolean;
  children?: React.ReactNode;
}) {
  const Tag = (onClick ? "button" : "div") as "button";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      // Якорь поиска по настройкам: searchSettings ведёт к ряду по видимому
      // названию (data-rowtitle + CSS.escape) — ручной разметки ~150 рядов нет.
      data-rowtitle={title}
      // Подсветка — каналом CSS (.muza-setting-row в @muza/ui/interactions.css),
      // а не useState: до ~150 рядов на экране, и каждый платил перерисовкой за
      // проход курсора. Класс висит и на некликабельном ряду — он просто не
      // читает переменную (см. background ниже), зато класс один на все ряды.
      className="muza-setting-row"
      onClick={onClick}
      style={{
        // ⚠️ РАСКЛАДКА РЯДА (display/align/gap) ЖИВЁТ В CSS, А НЕ ЗДЕСЬ —
        // settingsShell.css, правило .muza-setting-row. Инлайн-стиль сильнее
        // любого селектора, и пока эти три свойства стояли тут, узкий экран
        // перестроить ряд не мог В ПРИНЦИПЕ: контрол (сегменты «English /
        // Русский», ~250px) не жался, заголовку с подсказкой оставалось ~45px,
        // и текст вставал СТОЛБИКОМ ПО ОДНОМУ СЛОВУ — та самая жалоба
        // владельца «в настройках совершенно ничего не понятно» (10.08).
        // Теперь ряд ниже 560px контейнера складывается в стек: заголовок и
        // подсказка во всю ширину, контрол под ними.
        padding: "var(--sp-4) var(--sp-5)",
        border: "none",
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        borderRadius: "var(--r-md)",
        // T6: на сильном скруглении (radiusTiles до 200%) контролы у правого
        // края (Switch/кнопки) своим прямоугольным боксом вылезали за
        // скруглённый силуэт плашки — border-radius родителя не клипает детей
        // сам по себе. Клип, не запас padding: фокус-кольца/тени контролов
        // остаются внутри padding var(--sp-4/5), проверено живьём на 200%.
        overflow: "hidden",
        // Некликабельный ряд не подсвечивается вовсе — он и не читает канал:
        // подсветка обещает нажатие, и обещать его нечему.
        background: onClick ? "var(--setting-bg)" : "var(--surface-2)",
        cursor: onClick ? "pointer" : "default",
        fontFamily: "var(--font-ui)",
        transition: "background var(--dur-state) var(--ease-standard)",
      }}
    >
      <div className="muza-setting-row__text" style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <div style={{ fontSize: "var(--fs-body)", fontWeight: 400, color: danger ? "var(--danger)" : "var(--text-1)" }}>{title}</div>
          {titleExtra}
        </div>
        {hint ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: 2, lineHeight: 1.45 }}>{hint}</div> : null}
      </div>
      {/* Обёртка контрола нужна СТЕКУ: в узком ряду она встаёт второй строкой
          и прижимает контрол к левому краю (в широком — не делает ничего).
          Без неё сегменты и слайдеры оставались приклеены к правому краю
          плашки и читались как оторванные от своего заголовка. */}
      {children ? <div className="muza-setting-row__control">{children}</div> : null}
      {chevron ? <Icon name="chevron-right" size={18} color="var(--text-3)" /> : null}
    </Tag>
  );
}

/** Текущее значение будущего селекта (строка-значение справа). */
export function RowValue({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", flex: "none" }}>{children}</span>;
}

/** Слайдер-заглушка: рисуется как настоящий, но не тянется (функционал позже). */
export function DisabledSlider({ value, max, label, width = 160 }: { value: number; max: number; label: string; width?: number }) {
  return (
    <div style={{ pointerEvents: "none", opacity: 0.4, width, flex: "none" }}>
      <Slider value={value} max={max} ariaLabel={label} />
    </div>
  );
}

/** Слайдер масштаба интерфейса: применяет масштаб ТОЛЬКО на отпускании.
 *  Живое применение (как у LiveSlider) здесь — петля обратной связи: каждый
 *  тик меняет zoom корня, весь интерфейс прыгает, и ползунок уезжает из-под
 *  курсора — «экран дёргается, мышь не удержать» (жалоба 2026-07-16). Пока
 *  тянут — живёт только цифра процента; зум встаёт один раз, на pointerup
 *  (событие всплывает с захватившего указатель Slider). Клавиатура (стрелки
 *  на фокусе) применяет на keyup — у неё петли нет, но путь один и тот же. */
export function ScaleSlider({ value, label, onCommit }: { value: number; label: string; onCommit: (v: number) => void }) {
  const [live, setLive] = useState<number | null>(null); // null = не тянут
  const shown = live ?? value;
  const commit = () => {
    if (live === null) return;
    setLive(null);
    if (live !== value) onCommit(live);
  };
  return (
    <div
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", width: 240 }}
    >
      <Slider value={shown - 85} max={40} onChange={(v) => setLive(85 + Math.round(v))} ariaLabel={label} style={{ flex: 1 }} />
      <span
        style={{
          fontSize: "var(--fs-caption)",
          color: "var(--text-3)",
          width: 48,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {shown} %
      </span>
    </div>
  );
}

/** Живой слайдер со значением справа (blur, стекло). */
export function LiveSlider({
  value,
  max,
  label,
  suffix,
  onChange,
}: {
  value: number;
  max: number;
  label: string;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", width: 240 }}>
      <Slider value={value} max={max} onChange={onChange} ariaLabel={label} style={{ flex: 1 }} />
      <span
        style={{
          fontSize: "var(--fs-caption)",
          color: "var(--text-3)",
          width: 48,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {suffix}
      </span>
    </div>
  );
}

/** Ряд «пресеты + Настроить» (спека 19.07 §4.1): чипы именованных состояний
 *  функции + стрелка, раскрывающая дочерние ползунки тонкой подстройки.
 *
 *  Инвариант пресетов: активный пресет НЕ хранится полем настроек — он
 *  ВЫЧИСЛЯЕТСЯ (matchPreset) сравнением текущих значений с наборами. Чип
 *  «Своё» — индикатор, а не значение: появляется только когда значения не
 *  совпали ни с одним пресетом, и по нему нельзя кликнуть «в никуда». */
export function PresetRow({
  title,
  hint,
  chips,
  active,
  disabled,
  onPick,
  children,
}: {
  title: string;
  hint?: string;
  chips: { key: string; label: string }[];
  /** Результат matchPreset: ключ пресета либо "custom". */
  active: string;
  /** Функция сейчас недоступна (например, фон не «Анимированный»). */
  disabled?: boolean;
  onPick: (key: string) => void;
  children?: React.ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const items = active === "custom" ? [...chips, { key: "custom", label: t("settings.presetRow.customChip") }] : chips;
  return (
    <>
      <SettingRow title={title} hint={hint}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            ...(disabled ? { pointerEvents: "none", opacity: 0.4 } : null),
          }}
        >
          <ChipGroup
            items={items}
            value={active}
            onChange={(k: string) => {
              // «Своё» — индикатор текущего состояния, не команда
              if (k !== "custom") onPick(k);
            }}
          />
          <IconButton
            icon={open ? "chevron-up" : "chevron-down"}
            size="sm"
            label={t("settings.presetRow.tune")}
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
          />
        </div>
      </SettingRow>
      {open && !disabled ? children : null}
    </>
  );
}

/** Строка-ползунок визуализатора (T50): диапазон приезжает из VIS_LIMITS
 *  (единая точка правды с рендером и пресетами) — настройки не хранят
 *  собственных границ и не могут с ним разъехаться. */
export function VisSliderRow({
  title,
  hint,
  value,
  limit,
  unit = "%",
  onChange,
}: {
  title: string;
  hint: string;
  value: number;
  limit: { readonly min: number; readonly max: number };
  /** Единица подписи; пустая строка — голое число (плотность баров). */
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <SettingRow title={title} hint={hint}>
      <LiveSlider
        value={value - limit.min}
        max={limit.max - limit.min}
        label={title}
        suffix={unit ? `${value} ${unit}` : String(value)}
        onChange={(v) => onChange(limit.min + Math.round(v))}
      />
    </SettingRow>
  );
}

/** Заголовок группы внутри раздела. */
export function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: "var(--sp-4) 0 0",
        fontSize: "var(--fs-caption)",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-3)",
      }}
    >
      {children}
    </h3>
  );
}

/** Строка переназначения хоткея: клик по плашке → режим захвата (ловит
 *  следующую клавишу по e.code), Esc отменяет, конфликт подсвечен. */
export function HotkeyRow({
  label,
  combo,
  conflict,
  onCapture,
}: {
  label: string;
  combo: string;
  conflict: boolean;
  onCapture: (combo: string) => void;
}) {
  const { t } = useT();
  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(false);
        return;
      }
      const c = comboFromEvent(e);
      if (!c) return; // голый модификатор — ждём полную комбинацию
      onCapture(c);
      setCapturing(false);
    };
    // capture-фаза: перехватываем ДО глобального плеер-хоткея
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onCapture]);

  return (
    <SettingRow title={label} hint={conflict ? t("settings.hotkeys.conflictHint") : undefined}>
      <button
        type="button"
        onClick={() => setCapturing((v) => !v)}
        style={{
          minWidth: 96,
          padding: "6px 12px",
          border: "none",
          borderRadius: "var(--r-sm)",
          background: capturing ? "var(--accent-soft)" : "var(--surface-3)",
          color: capturing ? "var(--accent-text)" : conflict ? "var(--danger)" : "var(--text-1)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-caption)",
          fontWeight: 400,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer",
          outline: conflict ? "1px solid var(--danger)" : "none",
          transition: "background var(--dur-state) var(--ease-standard)",
        }}
      >
        {capturing ? t("settings.hotkeys.pressKey") : formatCombo(combo)}
      </button>
    </SettingRow>
  );
}

/** Компактный текстовый инпут для строк настроек (Discord-кнопка и т.п.). */
export function SettingInput({
  value,
  onChange,
  placeholder,
  width = 220,
  type = "text",
  onKeyDown,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
  type?: "text" | "password";
  /** Поле, которое применяет введённое само (StepsEditor). */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      // placeholder — не имя поля: screen reader получает label явно
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      style={{
        height: 36,
        width,
        padding: "0 var(--sp-3)",
        border: "none",
        borderRadius: "var(--r-sm)",
        background: "var(--surface-3)",
        color: "var(--text-1)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-caption)",
        boxSizing: "border-box",
        flex: "none",
      }}
    />
  );
}

/** Редактор списка чисел «через запятую» (шаги скорости, пресеты сна) —
 *  кастомизация закардкоженных значений по правке владельца. Применяется
 *  по blur/Enter; мусор отбрасывается, пустой список → дефолт. */
export function StepsEditor({
  values,
  onApply,
  min,
  max,
  maxCount,
  fallback,
  suffix,
}: {
  values: number[];
  onApply: (v: number[]) => void;
  min: number;
  max: number;
  maxCount: number;
  fallback: number[];
  suffix?: string;
}) {
  const { t } = useT();
  const [raw, setRaw] = useState(values.join(", "));
  // значения могли поменяться извне (сброс) — синхронизируем черновик
  useEffect(() => setRaw(values.join(", ")), [values]);
  const apply = () => {
    const parsed = raw
      .split(/[,;\s]+/)
      .map((s) => Number(s.replace(",", ".")))
      .filter((n) => Number.isFinite(n) && n >= min && n <= max)
      .slice(0, maxCount);
    const out = parsed.length > 0 ? parsed : fallback;
    onApply(out);
    setRaw(out.join(", "));
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
      {/* Enter и уход фокуса применяют — ровно то, что обещает шапка функции и
          чего человек ждёт от поля ввода. До правки существовала ОДНА дорога,
          кнопка «Применить»: набрал шаги скорости, нажал Enter, ушёл — и
          значение пропадало молча, без единого признака, что его не взяли.
          Повторное применение (blur после клика по кнопке) безвредно:
          apply идемпотентен, он же и нормализует черновик. */}
      <SettingInput
        value={raw}
        onChange={setRaw}
        width={200}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
        }}
        onBlur={apply}
      />
      {suffix ? (
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", flex: "none" }}>{suffix}</span>
      ) : null}
      <Button variant="ghost" icon="check" onClick={apply}>
        {t("common.apply")}
      </Button>
    </div>
  );
}

/** Свотч «свой акцент» — тонкая обёртка над ДС ColorPicker
 *  (компонент родился в настройках и уехал в дизайн-систему). */
export function CustomAccentSwatch({
  color,
  selected,
  onPick,
}: {
  color: string;
  selected: boolean;
  onPick: (hex: string) => void;
}) {
  const { t } = useT();
  return <ColorPicker
      value={color}
      selected={selected}
      size={44}
      label={t("settings.appearance.accent.customLabel")}
      resetLabel={t("settings.appearance.accent.resetLabel")}
      onChange={onPick}
    />;
}

/** Цветовая точка фона — тоже ДС ColorPicker. */
export function ColorDot({ color, label, onPick }: { color: string; label: string; onPick: (hex: string) => void }) {
  return <ColorPicker value={color} size={36} label={label} onChange={onPick} />;
}

/** Шапка под-экрана: назад + заголовок. */
export function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
      <IconButton icon="arrow-left" label={t("common.back")} onClick={onBack} />
      <h2 style={{ margin: 0, fontSize: "var(--fs-title)", fontWeight: 600, color: "var(--text-1)" }}>{title}</h2>
    </div>
  );
}

export function AccentSwatch({
  color,
  label,
  selected,
  onClick,
}: {
  color: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  // Подсказка — Tooltip ДС, не нативный title (стоковая плашка WebView2).
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        style={{
          width: 44,
          height: 44,
          borderRadius: "var(--r-pill)",
          border: "none",
          background: color,
          cursor: "pointer",
          outline: selected ? "2px solid var(--text-1)" : "2px solid transparent",
          outlineOffset: 3,
          transition: "outline-color var(--dur-state) var(--ease-standard)",
        }}
      ></button>
    </Tooltip>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ОРГАНЫ, ПРИДУМАННЫЕ ПОД ВЕЛИЧИНУ (правка владельца 2026-08-14)
   ───────────────────────────────────────────────────────────────────────────
   Заявка дословно: «сейчас у нас используются просто ползунки, переключатели и
   информация… большинство элементов — это обычные переключатели, а не
   уникальные или удобные настройки». Речь НЕ про отказ от дизайн-системы:
   токены, палитра, типографика и материал остаются её. Меняется словарь
   УПРАВЛЕНИЯ — орган выбирается под величину, а не по тому, что лежит в наборе.

   Образец, который назвал сам владелец, — акцентный цвет: три готовых свотча
   плюс пипетка. Ни ползунка, ни тумблера, и при этом настройка полностью в
   руках человека. Ниже — та же мысль, обобщённая до трёх кирпичей:

   • SampleChoice — выбор ОБРАЗЦА вместо числа. Плитка рисует РЕЗУЛЬТАТ (сколько
     строк, какое стекло, какой фон), а не подписывает его словом. Точное
     значение никуда не девается: оно живёт под стрелкой «Настроить», ровно как
     у PresetRow. Применяется там, где число само по себе человеку ничего не
     говорит, а картинка говорит всё.
   • ChipSet — НАБОР значений (какие шаги скорости, какие пресеты сна). Это не
     выбор одного из и не число: это множество. До правки такие настройки
     редактировались строкой «1, 1.25, 1.5, 2» через запятую — самый
     разработческий орган во всей программе.
   • SampleBars / SampleGlass — рисовалки образцов, чтобы плитки в разных
     разделах выглядели одним семейством, а не тремя самоделками.

   ⚠️ ПОЧЕМУ ЭТО НЕ SettingRow. Ряд кладёт контрол СПРАВА от заголовка и на
   узком экране сворачивается в стек. Плиткам образцов нужна вся ширина всегда —
   иначе они схлопнутся в марки размером с чип и перестанут быть образцами.
   Поэтому у SampleChoice своя плашка: та же поверхность, тот же радиус, тот же
   отступ, что у ряда, но раскладка колонкой.

   ⚠️ ЯКОРЬ ПОИСКА. data-rowtitle обязателен: searchSettings прокручивает к ряду
   по видимому названию (см. SettingRow выше). Плашка образцов ищется точно так
   же, как обычный ряд, и запись в lib/settingsIndex.ts ей нужна такая же. */

/** Плашка выбора образцов: заголовок с подсказкой, под ним — сетка плиток,
 *  каждая из которых РИСУЕТ свой результат.
 *
 *  children (если переданы) — точное значение за стрелкой «Настроить»: обещание
 *  «удобно по умолчанию, но ничего не заперто» держится тем же приёмом, что в
 *  PresetRow, и человеку не нужно учить два разных раскрытия. */
export function SampleChoice({
  title,
  hint,
  items,
  value,
  disabled,
  /** Ширина плитки, ниже которой сетка переносит строку. Разным образцам нужна
   *  разная: полоскам строк хватает 82px, картинке фона нужно 112. */
  minTile = 108,
  /** Потолок ширины плитки. Без него три образца на широком окне
   *  растягиваются на полтысячи пикселей каждый, и внутри плитки остаётся
   *  пустое поле вокруг маленькой картинки — плитка перестаёт читаться как
   *  образец и начинает читаться как пустая панель. */
  maxTile = 260,
  onPick,
  children,
}: {
  title: string;
  hint?: string;
  items: { key: string; label: string; caption?: string; sample: React.ReactNode }[];
  value: string;
  disabled?: boolean;
  minTile?: number;
  maxTile?: number;
  onPick: (key: string) => void;
  children?: React.ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        data-rowtitle={title}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
          padding: "var(--sp-4) var(--sp-5)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-2)",
          fontFamily: "var(--font-ui)",
          // Тот же клип, что у ряда: на скруглении до 200% прямоугольные плитки
          // вылезали бы за скруглённый силуэт плашки.
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-3)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "var(--fs-body)", fontWeight: 400, color: "var(--text-1)" }}>{title}</div>
            {hint ? (
              <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: 2, lineHeight: 1.45 }}>{hint}</div>
            ) : null}
          </div>
          {children ? (
            <IconButton
              icon={open ? "chevron-up" : "chevron-down"}
              size="sm"
              label={t("settings.presetRow.tune")}
              disabled={disabled}
              onClick={() => setOpen((v) => !v)}
            />
          ) : null}
        </div>
        <div
          // Плитки — группа радиокнопок, и группе нужно ИМЯ: без него читалка
          // объявляет «выбрано, Обычное» без единого слова о том, чего это
          // обычное — стекла, размера или числа строк (W3C APG, radiogroup).
          role="radiogroup"
          aria-label={title}
          style={{
            display: "grid",
            // auto-fit + потолок: плитки заполняют ряд, пока их мало, и
            // переносятся, когда перестают влезать; лишнюю ширину забирает
            // не плитка, а пустое место справа (justifyContent).
            gridTemplateColumns: `repeat(auto-fit, minmax(${minTile}px, ${maxTile}px))`,
            justifyContent: "start",
            gap: "var(--sp-3)",
            ...(disabled ? { pointerEvents: "none", opacity: 0.4 } : null),
          }}
        >
          {items.map((it) => (
            <SampleTile
              key={it.key}
              label={it.label}
              caption={it.caption}
              sample={it.sample}
              selected={it.key === value}
              onClick={() => onPick(it.key)}
            />
          ))}
        </div>
      </div>
      {open && !disabled ? children : null}
    </>
  );
}

/** Одна плитка-образец. Выбранная обведена акцентом, а не только залита: на
 *  плитке, ВНУТРИ которой нарисована картинка, одной заливкой выбор не читается —
 *  глаз считает разницу фона за часть образца. */
function SampleTile({
  label,
  caption,
  sample,
  selected,
  onClick,
}: {
  label: string;
  caption?: string;
  sample: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // Плитки — набор равноправных состояний одной величины: это radio, а не
      // группа независимых кнопок. aria-pressed соврал бы про независимость.
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        padding: "var(--sp-3)",
        border: "none",
        borderRadius: "var(--r-md)",
        background: selected ? "var(--surface-4)" : "var(--surface-3)",
        // Обводка внутрь (offset -2): наружная на плотной сетке съедала зазор
        // между соседними плитками и они слипались.
        outline: selected ? "2px solid var(--accent)" : "2px solid transparent",
        outlineOffset: -2,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--font-ui)",
        transition: "background var(--dur-state) var(--ease-standard), outline-color var(--dur-state) var(--ease-standard)",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 54,
          borderRadius: "var(--r-sm)",
          background: "var(--surface-1)",
          overflow: "hidden",
        }}
      >
        {sample}
      </span>
      <span style={{ display: "block", fontSize: "var(--fs-caption)", color: selected ? "var(--text-1)" : "var(--text-2)" }}>{label}</span>
      {caption ? <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{caption}</span> : null}
    </button>
  );
}

/** НАБОР ЗНАЧЕНИЙ чипами-переключателями: каждый чип включён или выключен, и
 *  вместе они и есть значение настройки.
 *
 *  Заменил StepsEditor там, где список значений заранее известен (шаги скорости,
 *  пресеты таймера сна). У поля «через запятую» было три беды разом: человек
 *  обязан знать синтаксис, обязан знать допустимые границы, и обязан не
 *  промахнуться — а промах молча отбрасывался фильтром. Здесь промахнуться
 *  нечем: доступные значения нарисованы, набранного мусора не бывает.
 *
 *  StepsEditor НЕ удалён — он остаётся для величин, у которых осмысленных
 *  значений бесконечность (там перечислить чипами нечего). */
export function ChipSet({
  options,
  values,
  onChange,
  /** Сколько значений обязано остаться. Ноль шагов скорости означал бы кнопку
   *  «1×» в плеере, которой нечего переключать, — последний чип не снимается. */
  min = 1,
  max,
}: {
  options: { value: number; label: string }[];
  values: number[];
  onChange: (v: number[]) => void;
  min?: number;
  max?: number;
}) {
  const on = new Set(values);
  const toggle = (v: number) => {
    if (on.has(v)) {
      if (values.length <= min) return;
      onChange(values.filter((x) => x !== v));
      return;
    }
    if (max !== undefined && values.length >= max) return;
    // Порядок значений — возрастающий всегда, независимо от порядка нажатий:
    // кнопка «1×» в плеере ходит по этому списку по кругу, и «1 → 2 → 1.25»
    // читалось бы как поломка.
    onChange([...values, v].sort((a, b) => a - b));
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", justifyContent: "flex-end" }}>
      {options.map((o) => (
        <Chip
          key={o.value}
          selected={on.has(o.value)}
          onClick={() => toggle(o.value)}
          // Обводка акцентом ПОВЕРХ обычного выделения чипа. В группе с ОДНИМ
          // выбором ступени поверхности хватает: выбран ровно один, и глазу не
          // с чем путаться. Здесь выбранных пять из девяти вперемешку, и разница
          // «поверхность 4 против поверхности 2» на ряду вразнобой читается как
          // подсветка под курсором, а не как «это в наборе».
          style={on.has(o.value) ? { outline: "1.5px solid var(--accent)", outlineOffset: -1.5 } : undefined}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

/** Образец «сколько строк текста видно»: столбик полосок, средняя — активная.
 *  Полоски разной длины, чтобы читались словами, а не таблицей. */
export function SampleLines({ count, accent = true }: { count: number; accent?: boolean }) {
  // Нечётное окно караоке симметрично: середина — та строка, что поётся сейчас.
  const mid = Math.floor(count / 2);
  // Псевдослучайная, но УСТОЙЧИВАЯ длина: реальный текст неровный, а ровный
  // столбик читался бы как полоски прогресса, а не как строки песни.
  const widths = [86, 64, 78, 55, 92, 70, 60, 83, 68, 74, 58, 88, 62, 80];
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, width: "100%", padding: "0 var(--sp-3)" }}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          style={{
            display: "block",
            height: i === mid ? 5 : 3,
            width: `${widths[i % widths.length]}%`,
            borderRadius: 999,
            background: i === mid && accent ? "var(--accent)" : "var(--text-3)",
            opacity: i === mid ? 1 : 0.45,
          }}
        ></span>
      ))}
    </span>
  );
}

/** Образец «какое стекло»: настоящая матовая плашка поверх полосатой подложки.
 *
 *  Полосы — не украшение. Сквозь ровный фон ни размытие, ни плотность не видны
 *  вовсе: первая версия образца стояла на однотонной подложке, и все три
 *  плитки вышли неразличимы (замер скриншотом 14.08). Полоса даёт контур,
 *  который стекло обязано размыть и притушить, — тогда 35 % и 88 % отличаются
 *  с одного взгляда. Кайма по краю оставлена нарочно: рядом с открытой полосой
 *  видно, СКОЛЬКО именно стекло съело.
 *
 *  Цвет — rgba(var(--glass-base)), тот же, из которого themeVars собирает
 *  настоящие --glass-*. Через --surface-* это не сделать: они сами уже
 *  полупрозрачные (rgba(255,255,255,0.025) в тёмной теме), и доля от доли даёт
 *  невидимое — ровно та ошибка, что была здесь до правки. */
export function SampleGlass({ opacity }: { opacity: number }) {
  const blur = 4 + Math.round(opacity / 10);
  return (
    <span
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        height: "100%",
        // Полос немного и они приглушены: частая яркая «сигнальная лента»
        // перетягивала внимание на себя и читалась как узор образца, а не как
        // то, что стекло скрывает.
        background:
          "repeating-linear-gradient(115deg, color-mix(in srgb, var(--accent) 72%, transparent) 0 9px, transparent 9px 26px), var(--surface-4)",
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 9,
          borderRadius: "var(--r-sm)",
          background: `rgba(var(--glass-base, 28, 26, 23), ${opacity / 100})`,
          backdropFilter: `blur(${blur}px)`,
          WebkitBackdropFilter: `blur(${blur}px)`,
        }}
      ></span>
    </span>
  );
}

/** Образец визуализатора: рисует РЕЗУЛЬТАТ набора чисел, а не подписывает его
 *  словом. Пока стили выбирались чипами «Классика / Плотные / Воздушные», узнать
 *  разницу можно было единственным способом — нажать, уйти в режим прослушивания
 *  и посмотреть. Три чипа — три похода.
 *
 *  Форма спектра (SHAPE) намеренно постоянная и падающая слева направо: так
 *  выглядит настоящий звук, и рядом стоящие образцы отличаются ТОЛЬКО тем, чем
 *  отличаются пресеты. Случайные высоты сделали бы плитки несравнимыми. */
const SHAPE = [0.96, 0.78, 1, 0.66, 0.88, 0.58, 0.74, 0.48, 0.64, 0.4, 0.54, 0.33, 0.44, 0.27, 0.36, 0.22];

export function SampleVisualizer({
  kind,
  bars = 56,
  barFill = 84,
  barRound = 100,
  waveThick = 45,
  waveFill = 45,
}: {
  kind: "bars" | "wave";
  bars?: number;
  barFill?: number;
  barRound?: number;
  waveThick?: number;
  waveFill?: number;
}) {
  if (kind === "wave") {
    // Толщина линии и налив под ней — те же два числа, что у настоящей волны.
    const stroke = 0.8 + (waveThick / 100) * 5;
    return (
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" style={{ width: "84%", height: "70%", overflow: "visible" }} aria-hidden="true">
        <path d="M0 17 C 10 2, 18 32, 28 17 S 46 2, 56 17 S 74 32, 84 17 S 96 6, 100 17 L100 34 L0 34 Z" fill="var(--accent)" opacity={(waveFill / 100) * 0.55} />
        <path
          d="M0 17 C 10 2, 18 32, 28 17 S 46 2, 56 17 S 74 32, 84 17 S 96 6, 100 17"
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  // Столбиков в образце меньше, чем в настоящем ряду: 88 полосок в плитку
  // шириной 96 px не влезут физически. Пропорция сохранена — плотный пресет
  // остаётся заметно плотнее воздушного.
  const count = Math.max(5, Math.min(SHAPE.length, Math.round(bars / 6)));
  return (
    <span style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: `${((100 - barFill) / 100) * 4 + 1}px`, width: "84%", height: "70%" }}>
      {SHAPE.slice(0, count).map((h, i) => (
        <span
          key={i}
          style={{
            display: "block",
            flex: 1,
            height: `${Math.round(h * 100)}%`,
            borderRadius: (barRound / 100) * 3,
            background: "var(--accent)",
            // Дальние частоты тише — так же, как в настоящем визуализаторе.
            opacity: 0.5 + h * 0.5,
          }}
        ></span>
      ))}
    </span>
  );
}

export function PresetTile({
  name,
  hint,
  accentColor,
  radius,
  selected,
  onClick,
}: {
  name: string;
  hint: string;
  accentColor: string;
  /** Опорное скругление облика в px — то же число, что у ползунка «Скругление»
   *  (Prefs["radius"]). Было тремя именами до 2026-08-13. */
  radius: number;
  selected: boolean;
  onClick: () => void;
}) {
  // Превью — плашка высотой 30px, а число описывает УГОЛ ЗОНЫ во весь экран.
  // Коэффициент 0.6 подобран так, чтобы три привычных облика выглядели ровно
  // как раньше (8→5, 16→10, 28→15); потолок 15 — половина высоты плашки,
  // круглее самой себя она стать не может.
  const r = Math.min(15, Math.round(radius * 0.6));
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-3)",
        padding: "var(--sp-4)",
        border: "none",
        borderRadius: "var(--r-md)",
        background: selected ? "var(--surface-4)" : "var(--surface-2)",
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-state) var(--ease-standard)",
      }}
    >
      <span style={{ display: "flex", gap: 6 }}>
        <span style={{ width: 44, height: 30, borderRadius: r, background: accentColor, display: "block", transition: "border-radius var(--dur-state-move) var(--ease-in-out)" }}></span>
        <span style={{ width: 24, height: 30, borderRadius: r, background: "var(--surface-4)", display: "block", transition: "border-radius var(--dur-state-move) var(--ease-in-out)" }}></span>
      </span>
      <span>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", fontWeight: 400, color: "var(--text-1)" }}>{name}</span>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>{hint}</span>
      </span>
    </button>
  );
}
