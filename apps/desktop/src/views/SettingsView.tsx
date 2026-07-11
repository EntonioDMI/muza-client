import { useEffect, useRef, useState } from "react";
import { Button, ChipGroup, Dialog, Fader, Icon, IconButton, Slider, Switch, Tabs } from "@muza/ui";
import { ApiError, type MarketTheme, type MuzaApi, type RecsSettings, type ScrobblingStatus } from "@muza/api-client";
import { DEFAULT_PREFS, type Prefs } from "../types";
import { cacheClear, cacheStats, engineAvailable, type CacheStats } from "../lib/engine";
import { openExternal } from "../lib/system";
import { HOTKEYS } from "../lib/hotkeysList";
import {
  addTheme,
  applyTheme,
  deleteTheme,
  listThemes,
  parseTheme,
  sanitizeTokens,
  saveTheme,
  serializeTheme,
  tokensFromPrefs,
  type SavedTheme,
} from "../lib/themes";

/* Структура и состав — docs/notes/2026-07-10-настройки-спецификация.md:
   11 вкладок-разделов; «Внешний вид» = простые (пресеты) + под-экран
   «Кастомизация» (редактор темы). Тяжёлые пункты — отдельные под-экраны
   (Кастомизация, Эквалайзер, Discord RPC), не строки. Живое управляет prefs
   (CSS-переменные в App), остальное — визуальный макет: disabled-заглушки
   с честным этапом. */

function SettingRow({
  title,
  hint,
  onClick,
  chevron,
  danger,
  children,
}: {
  title: string;
  hint?: string;
  onClick?: () => void;
  chevron?: boolean;
  danger?: boolean;
  children?: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const Tag = (onClick ? "button" : "div") as "button";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-5)",
        padding: "var(--sp-4) var(--sp-5)",
        border: "none",
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        borderRadius: "var(--r-md)",
        background: onClick && hover ? "var(--surface-3)" : "var(--surface-2)",
        cursor: onClick ? "pointer" : "default",
        fontFamily: "var(--font-ui)",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-body)", fontWeight: 500, color: danger ? "var(--danger)" : "var(--text-1)" }}>{title}</div>
        {hint ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: 2 }}>{hint}</div> : null}
      </div>
      {children}
      {chevron ? <Icon name="chevron-right" size={18} color="var(--text-3)" /> : null}
    </Tag>
  );
}

/** Текущее значение будущего селекта (строка-значение справа). */
function RowValue({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", flex: "none" }}>{children}</span>;
}

/** Слайдер-заглушка: рисуется как настоящий, но не тянется (функционал позже). */
function DisabledSlider({ value, max, label, width = 160 }: { value: number; max: number; label: string; width?: number }) {
  return (
    <div style={{ pointerEvents: "none", opacity: 0.4, width, flex: "none" }}>
      <Slider value={value} max={max} ariaLabel={label} />
    </div>
  );
}

/** Живой слайдер со значением справа (blur, стекло). */
function LiveSlider({
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

/** Ручки рекомендаций (Stage 5): ε-новизна и период возврата любимого.
 *  Значения живут на сервере (/me/recs-settings) — действуют на ленту и
 *  радио со следующего запроса; запись дебаунсится. Аноним — disabled. */
function RecsTuning({
  api,
  enabled,
  onNotify,
}: {
  api: MuzaApi;
  enabled: boolean;
  onNotify: (text: string, icon?: string) => void;
}) {
  const [s, setS] = useState<RecsSettings | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api
      .getRecsSettings()
      .then((v) => {
        if (alive) setS(v);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, enabled]);

  const push = (next: { epsilon?: number; tauScale?: number }) => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      api
        .updateRecsSettings(next)
        .then(setS)
        .catch(() => onNotify("Не удалось сохранить настройки рекомендаций", "x"));
    }, 600);
  };

  if (!enabled || s === null) {
    return (
      <SettingRow title="Новизна и повторы" hint={enabled ? "Загружаем…" : "Слайдеры рекомендаций доступны после входа с аккаунтом"}>
        <DisabledSlider value={30} max={100} label="Рекомендации" />
      </SettingRow>
    );
  }

  // τ-шкала геометрическая: линейный слайдер зажимал бы «чаще» в первых 20%
  const tauPos = Math.round((Math.log(s.tauScale / s.tauScaleMin) / Math.log(s.tauScaleMax / s.tauScaleMin)) * 100);
  const tauFromPos = (v: number) =>
    Math.round(s.tauScaleMin * Math.pow(s.tauScaleMax / s.tauScaleMin, v / 100) * 100) / 100;

  return (
    <>
      <SettingRow title="Новизна" hint="Доля незнакомого вперемешку с лучшим (ε-исследование в ленте и радио)">
        <LiveSlider
          value={Math.round(s.epsilon * 100)}
          max={Math.round(s.epsilonMax * 100)}
          label="Новизна"
          suffix={`${Math.round(s.epsilon * 100)} %`}
          onChange={(v) => {
            const epsilon = Math.round(v) / 100;
            setS({ ...s, epsilon });
            push({ epsilon });
          }}
        />
      </SettingRow>
      <SettingRow title="Повторы любимого" hint="Левее — любимое возвращается чаще, правее — реже">
        <LiveSlider
          value={tauPos}
          max={100}
          label="Повторы любимого"
          suffix={`×${s.tauScale}`}
          onChange={(v) => {
            const tauScale = tauFromPos(v);
            setS({ ...s, tauScale });
            push({ tauScale });
          }}
        />
      </SettingRow>
    </>
  );
}

/** Заголовок группы внутри раздела. */
function GroupTitle({ children }: { children: React.ReactNode }) {
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

/** Плашка-клавиша для раздела горячих клавиш. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "var(--r-xs)",
        background: "var(--surface-3)",
        color: "var(--text-1)",
        fontSize: "var(--fs-caption)",
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Компактный текстовый инпут для строк настроек (Discord-кнопка и т.п.). */
function SettingInput({
  value,
  onChange,
  placeholder,
  width = 220,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
  type?: "text" | "password";
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      // placeholder — не имя поля: screen reader получает label явно
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
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
        outline: "none",
        boxSizing: "border-box",
        flex: "none",
      }}
    />
  );
}

/** Редактор списка чисел «через запятую» (шаги скорости, пресеты сна) —
 *  кастомизация закардкоженных значений по правке владельца. Применяется
 *  по blur/Enter; мусор отбрасывается, пустой список → дефолт. */
function StepsEditor({
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
      <SettingInput value={raw} onChange={setRaw} width={200} />
      {suffix ? (
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", flex: "none" }}>{suffix}</span>
      ) : null}
      <Button variant="ghost" icon="check" onClick={apply}>
        Применить
      </Button>
    </div>
  );
}

/** Свотч «свой цвет»: нативный пикер, замаскированный под кружок с пипеткой. */
function CustomAccentSwatch({
  color,
  selected,
  onPick,
}: {
  color: string;
  selected: boolean;
  onPick: (hex: string) => void;
}) {
  return (
    <label
      title="Свой цвет"
      style={{
        position: "relative",
        width: 44,
        height: 44,
        borderRadius: "var(--r-pill)",
        background: color,
        cursor: "pointer",
        outline: selected ? "2px solid var(--text-1)" : "2px solid transparent",
        outlineOffset: 3,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "outline-color var(--dur-base) var(--ease-out)",
      }}
    >
      <Icon name="pipette" size={16} color="rgba(255,255,255,.9)" />
      <input
        type="color"
        value={color}
        aria-label="Свой акцентный цвет"
        onChange={(e) => onPick(e.target.value)}
        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
      />
    </label>
  );
}

/** Цветовая точка с нативным пикером (реюз механики CustomAccentSwatch). */
function ColorDot({ color, label, onPick }: { color: string; label: string; onPick: (hex: string) => void }) {
  return (
    <label
      title={label}
      style={{
        position: "relative",
        width: 36,
        height: 36,
        borderRadius: "var(--r-pill)",
        background: color,
        cursor: "pointer",
        outline: "2px solid var(--surface-4)",
        outlineOffset: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name="pipette" size={14} color="rgba(255,255,255,.85)" />
      <input
        type="color"
        value={color}
        aria-label={label}
        onChange={(e) => onPick(e.target.value)}
        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
      />
    </label>
  );
}

/** Карточка витрины маркетплейса: тема (градиент-превью) или плагин (иконка). */
function MarketCard({ item }: { item: (typeof MARKET_ITEMS)[number] }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-3)",
        padding: "var(--sp-4)",
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
      }}
    >
      {item.kind === "theme" ? (
        <div
          aria-hidden="true"
          style={{
            height: 64,
            borderRadius: "var(--r-sm)",
            background: `linear-gradient(120deg, ${item.colors![0]} 0%, ${item.colors![0]} 45%, ${item.colors![1]} 45%, ${item.colors![1]} 75%, ${item.colors![2]} 75%)`,
          }}
        ></div>
      ) : (
        <div
          aria-hidden="true"
          style={{
            height: 64,
            borderRadius: "var(--r-sm)",
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={item.icon!} size={28} color="var(--accent-text)" />
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-1)" }}>{item.name}</div>
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: 2, lineHeight: 1.5 }}>{item.desc}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
          {item.author} · {item.meta}
        </div>
      </div>
      <Button variant="secondary" icon="download" disabled style={{ alignSelf: "flex-start" }}>
        Установить
      </Button>
    </div>
  );
}

/** Карточка темы маркетплейса (Stage 6): превью из payload + живая установка. */
function MarketThemeCard({
  theme,
  onInstall,
  onRemove,
}: {
  theme: MarketTheme;
  onInstall: () => void;
  onRemove?: () => void;
}) {
  const p = theme.payload as { accent?: string; customAccent?: string; bgColor?: string; baseBg?: string; bgType?: string; customCss?: string };
  const accent =
    p.accent === "custom" && typeof p.customAccent === "string"
      ? p.customAccent
      : p.accent === "red"
        ? "#f76967"
        : p.accent === "bolt"
          ? "#327ad9"
          : "#3b82f6";
  const bg =
    p.bgType === "color" || p.bgType === "gradient"
      ? (typeof p.bgColor === "string" ? p.bgColor : "#121110")
      : p.baseBg === "amoled"
        ? "#000000"
        : p.baseBg === "warm"
          ? "#151110"
          : p.baseBg === "cold"
            ? "#0f1114"
            : "#121110";
  const hasCss = typeof p.customCss === "string" && p.customCss.trim().length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", padding: "var(--sp-4)", borderRadius: "var(--r-md)", background: "var(--surface-2)" }}>
      <div
        aria-hidden="true"
        style={{
          height: 64,
          borderRadius: "var(--r-sm)",
          background: `linear-gradient(120deg, ${bg} 0%, ${bg} 62%, ${accent} 62%)`,
          outline: "1px solid var(--surface-3)",
          outlineOffset: -1,
        }}
      ></div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-1)" }}>{theme.name}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
          {theme.author} · {theme.installs} устан.{hasCss ? " · содержит CSS" : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <Button variant="secondary" icon="download" onClick={onInstall}>
          Установить
        </Button>
        {onRemove ? <IconButton icon="trash-2" label="Снять с публикации" onClick={onRemove} /> : null}
      </div>
    </div>
  );
}

/** Шапка под-экрана: назад + заголовок. */
function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
      <IconButton icon="arrow-left" label="Назад" onClick={onBack} />
      <h2 style={{ margin: 0, fontSize: "var(--fs-title)", fontWeight: 700, color: "var(--text-1)" }}>{title}</h2>
    </div>
  );
}

function AccentSwatch({
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
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
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
        transition: "outline-color var(--dur-base) var(--ease-out)",
      }}
    ></button>
  );
}

function PresetTile({
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
  radius: Prefs["radius"];
  selected: boolean;
  onClick: () => void;
}) {
  const r = radius === "round" ? 15 : radius === "mild" ? 6 : 10;
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
        transition: "background var(--dur-base) var(--ease-out)",
      }}
    >
      <span style={{ display: "flex", gap: 6 }}>
        <span style={{ width: 44, height: 30, borderRadius: r, background: accentColor, display: "block", transition: "border-radius var(--dur-base) var(--ease-out)" }}></span>
        <span style={{ width: 24, height: 30, borderRadius: r, background: "var(--surface-4)", display: "block", transition: "border-radius var(--dur-base) var(--ease-out)" }}></span>
      </span>
      <span>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-1)" }}>{name}</span>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>{hint}</span>
      </span>
    </button>
  );
}

/** Диапазон плотности стекла: ниже 30% интерфейс нечитаем. */
const GLASS_MIN = 30;

const paneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-3)",
  paddingBottom: "var(--sp-6)",
};

const TABS = [
  { key: "account", label: "Аккаунт" },
  { key: "appearance", label: "Внешний вид" },
  { key: "playback", label: "Воспроизведение" },
  { key: "sources", label: "Источники" },
  { key: "lyrics", label: "Тексты" },
  { key: "library", label: "Библиотека" },
  { key: "integrations", label: "Интеграции" },
  { key: "hotkeys", label: "Клавиши" },
  { key: "extensions", label: "Расширения" },
  { key: "system", label: "Система" }, // «О приложении» — секция внутри Системы
];

// Список клавиш общий с оверлеем «?» — lib/hotkeysList (обработчики в App)

type Sub = "customize" | "equalizer" | "discord" | "market" | "data" | null;

/** Запрос извне открыть под-экран (кнопка эквалайзера в плеер-баре). */
export interface SettingsIntent {
  sub: Exclude<Sub, null>;
  nonce: number;
}

/** Вкладка, которой принадлежит каждый под-экран. */
const SUB_HOME_TAB: Record<Exclude<Sub, null>, string> = {
  customize: "appearance",
  equalizer: "playback",
  discord: "integrations",
  market: "extensions",
  data: "account",
};

/** Витрина маркетплейса (демо-каталог; установка — Stage 6). */
const MARKET_ITEMS: {
  kind: "theme" | "plugin";
  name: string;
  author: string;
  desc: string;
  meta: string;
  colors?: [string, string, string];
  icon?: string;
}[] = [
  { kind: "theme", name: "Nord", author: "arctic", desc: "Холодный сине-серый минимализм", meta: "12 400 установок", colors: ["#2e3440", "#5e81ac", "#88c0d0"] },
  { kind: "theme", name: "AMOLED", author: "muza", desc: "Чистый чёрный для OLED-экранов", meta: "9 800 установок", colors: ["#000000", "#111111", "#3b82f6"] },
  { kind: "theme", name: "Синтвейв", author: "neon_dreams", desc: "Розовый неон и фиолетовый закат", meta: "7 150 установок", colors: ["#241734", "#ff3caa", "#7c3aed"] },
  { kind: "theme", name: "Крем", author: "daylight", desc: "Тёплая светлая тема (превью)", meta: "3 020 установок", colors: ["#f5efe6", "#d9a441", "#8a6d3b"] },
  { kind: "plugin", name: "Синхро-переводчик", author: "polyglot", desc: "Перевод строк текста на лету, вторая строка под оригиналом", meta: "21 300 установок", icon: "languages" },
  { kind: "plugin", name: "Каденс", author: "vjlab", desc: "Визуализатор в режиме прослушивания: волны и частицы в такт", meta: "15 700 установок", icon: "audio-waveform" },
  { kind: "plugin", name: "Скробблер+", author: "fmtools", desc: "Расширенный скробблинг: оффлайн-очередь, правила пропуска", meta: "8 400 установок", icon: "radio-tower" },
  { kind: "plugin", name: "Автотеги", author: "muza", desc: "Жанры и настроения для локальных файлов по акустике", meta: "5 900 установок", icon: "tags" },
];

/** Полосы эквалайзера (десятиполосник) и пресеты. Значения в дБ (−12..+12). */
const EQ_BANDS = ["31", "62", "125", "250", "500", "1к", "2к", "4к", "8к", "16к"];
const EQ_PRESETS: Record<string, number[]> = {
  Ровный: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Бас: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Рок: [5, 4, 2, 0, -1, 0, 2, 3, 4, 4],
  Поп: [-1, 0, 2, 4, 5, 4, 2, 0, -1, -1],
  Вокал: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
};

export function SettingsView({
  api,
  serverSession,
  prefs,
  setPrefs,
  username,
  onLogout,
  onNotify,
  intent,
}: {
  api: MuzaApi;
  /** false у анонима: серверные функции аккаунта (смена пароля) недоступны. */
  serverSession: boolean;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  username: string;
  onLogout: () => void;
  onNotify: (text: string, icon?: string) => void;
  intent?: SettingsIntent | null;
}) {
  const [tab, setTab] = useState("appearance");
  const [sub, setSub] = useState<Sub>(null);

  // Смена пароля (слайс «Аккаунт»): диалог старый → новый → повтор
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdCur, setPwdCur] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdRepeat, setPwdRepeat] = useState("");
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);
  const openPwd = () => {
    setPwdCur("");
    setPwdNew("");
    setPwdRepeat("");
    setPwdErr(null);
    setPwdOpen(true);
  };
  const submitPwd = async () => {
    if (pwdNew.length < 8) {
      setPwdErr("Новый пароль — минимум 8 символов");
      return;
    }
    if (pwdNew !== pwdRepeat) {
      setPwdErr("Пароли не совпадают");
      return;
    }
    setPwdBusy(true);
    setPwdErr(null);
    try {
      await api.changePassword(pwdCur, pwdNew);
      setPwdOpen(false);
      onNotify("Пароль изменён — другие устройства разлогинены", "shield-check");
    } catch (e) {
      setPwdErr(e instanceof ApiError ? e.message : "Не удалось сменить пароль");
    } finally {
      setPwdBusy(false);
    }
  };

  // Маркетплейс: фильтр витрины (открывается из «Расширений» с нужной категорией)
  const [marketFilter, setMarketFilter] = useState("Всё");
  const openMarket = (filter: string) => {
    setMarketFilter(filter);
    setSub("market");
  };

  // ── Темы как объекты + CSS-тир (Stage 6) ─────────────────────────
  const [themes, setThemes] = useState<SavedTheme[]>(listThemes);
  const [themeNameOpen, setThemeNameOpen] = useState(false);
  const [themeName, setThemeName] = useState("");
  const [themeImportOpen, setThemeImportOpen] = useState(false);
  const [themeImportText, setThemeImportText] = useState("");
  const [themeImportErr, setThemeImportErr] = useState<string | null>(null);
  // черновик CSS: textarea не пишет в prefs на каждый символ (перерисовка всего)
  const [cssDraft, setCssDraft] = useState(prefs.customCss);

  const openSaveTheme = () => {
    setThemeName("");
    setThemeNameOpen(true);
  };
  const submitSaveTheme = () => {
    saveTheme(themeName, prefs);
    setThemes(listThemes());
    setThemeNameOpen(false);
    onNotify("Тема сохранена", "save");
  };
  const applySavedTheme = (t: SavedTheme) => {
    setPrefs(applyTheme(t.tokens, prefs));
    setCssDraft(typeof t.tokens.customCss === "string" ? t.tokens.customCss : "");
    onNotify(`Тема «${t.name}» применена`, "paintbrush");
  };
  const removeTheme = (id: string) => {
    deleteTheme(id);
    setThemes(listThemes());
    onNotify("Тема удалена", "trash-2");
  };
  const copyTheme = async (t: SavedTheme) => {
    try {
      await navigator.clipboard.writeText(serializeTheme(t.name, t.tokens));
      onNotify("JSON темы в буфере — делись", "copy");
    } catch {
      onNotify("Буфер обмена недоступен", "x");
    }
  };
  const submitImportTheme = () => {
    const parsed = parseTheme(themeImportText);
    if (!parsed) {
      setThemeImportErr("Это не похоже на JSON темы Muza");
      return;
    }
    const next = applyTheme(parsed.tokens, prefs);
    setPrefs(next);
    setCssDraft(next.customCss);
    saveTheme(parsed.name, next);
    setThemes(listThemes());
    setThemeImportOpen(false);
    setThemeImportText("");
    setThemeImportErr(null);
    onNotify(`Тема «${parsed.name}» импортирована и применена`, "clipboard-paste");
  };

  // ── Маркетплейс тем (Stage 6): серверный каталог ─────────────────
  const [marketThemes, setMarketThemes] = useState<MarketTheme[] | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [publishErr, setPublishErr] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  // тема с чужим CSS перед установкой честно предупреждает
  const [cssWarnTheme, setCssWarnTheme] = useState<MarketTheme | null>(null);

  useEffect(() => {
    if (sub !== "market" || !serverSession) return;
    let alive = true;
    api
      .getMarketThemes()
      .then((t) => {
        if (alive) setMarketThemes(t);
      })
      .catch(() => {
        if (alive) setMarketThemes([]);
      });
    return () => {
      alive = false;
    };
  }, [sub, serverSession, api]);

  const doInstallTheme = async (t: MarketTheme) => {
    // счётчик — best-effort: сервер лёг, а payload уже у нас
    const installed = await api.installMarketTheme(t.id).catch(() => null);
    const tokens = sanitizeTokens(installed?.payload ?? t.payload);
    addTheme(t.name, tokens);
    setThemes(listThemes());
    const next = applyTheme(tokens, prefs);
    setPrefs(next);
    setCssDraft(next.customCss);
    setMarketThemes((list) => list?.map((x) => (x.id === t.id ? { ...x, installs: x.installs + 1 } : x)) ?? list);
    onNotify(`Тема «${t.name}» установлена и применена`, "download");
  };

  const installTheme = async (t: MarketTheme) => {
    const css = (t.payload as { customCss?: unknown }).customCss;
    if (typeof css === "string" && css.trim().length > 0) {
      setCssWarnTheme(t); // CSS может переопределить что угодно — спрашиваем
      return;
    }
    await doInstallTheme(t);
  };

  const unpublishTheme = async (t: MarketTheme) => {
    try {
      await api.deleteMarketTheme(t.id);
      setMarketThemes((list) => list?.filter((x) => x.id !== t.id) ?? list);
      onNotify("Тема снята с публикации", "trash-2");
    } catch {
      onNotify("Не удалось снять тему", "x");
    }
  };

  const openPublishTheme = () => {
    setPublishName("");
    setPublishErr(null);
    setPublishOpen(true);
  };
  const submitPublishTheme = async () => {
    if (publishName.trim().length < 2) {
      setPublishErr("Название — от 2 символов");
      return;
    }
    setPublishBusy(true);
    setPublishErr(null);
    try {
      const published = await api.publishMarketTheme(publishName.trim(), tokensFromPrefs(prefs));
      setMarketThemes((list) => {
        const rest = (list ?? []).filter((x) => x.id !== published.id);
        return [published, ...rest];
      });
      setPublishOpen(false);
      onNotify(`Тема «${published.name}» опубликована`, "upload");
    } catch (e) {
      setPublishErr(e instanceof ApiError ? e.message : "Не удалось опубликовать");
    } finally {
      setPublishBusy(false);
    }
  };

  // Эквалайзер живёт в Prefs (Stage 3: реально крутит звук через Web Audio)
  const eqOn = prefs.eqOn;
  const eqPreset = prefs.eqPreset;
  const eqBands = prefs.eqBands;
  const setEqOn = (on: boolean) => setPrefs({ ...prefs, eqOn: on });
  const applyPreset = (name: string) => {
    setPrefs({ ...prefs, eqPreset: name, eqBands: EQ_PRESETS[name] ?? prefs.eqBands });
  };
  const setBand = (i: number, v: number) => {
    setPrefs({
      ...prefs,
      eqPreset: "Свой",
      eqBands: prefs.eqBands.map((x, j) => (j === i ? Math.round(v) : x)),
    });
  };

  // Открытие под-экрана извне (кнопка EQ в плеер-баре)
  useEffect(() => {
    if (!intent) return;
    setTab(SUB_HOME_TAB[intent.sub]);
    setSub(intent.sub);
  }, [intent]);

  // Внешний скробблинг (Интеграции): статус с сервера + флоу подключения
  const [scrob, setScrob] = useState<ScrobblingStatus | null>(null);
  const [scrobErr, setScrobErr] = useState(false);
  const [lfmWaiting, setLfmWaiting] = useState(false);
  const lfmCancelRef = useRef(false);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbToken, setLbToken] = useState("");
  const [lbErr, setLbErr] = useState<string | null>(null);
  const [lbBusy, setLbBusy] = useState(false);
  // Сервер может быть ещё не поднят — честно говорим и перепроверяем сами,
  // пока вкладка открыта (иначе «Проверяем статус…» висело бы вечно)
  useEffect(() => {
    if (tab !== "integrations" || !serverSession) return;
    let dead = false;
    let iv: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const s = await api.getScrobbling();
        if (dead) return;
        setScrob(s);
        setScrobErr(false);
        if (iv) clearInterval(iv);
        iv = null;
      } catch {
        if (!dead) setScrobErr(true);
      }
    };
    void load();
    iv = setInterval(() => void load(), 5000);
    return () => {
      dead = true;
      if (iv) clearInterval(iv);
    };
  }, [tab, serverSession, api]);
  // Уход с экрана — поллинг подтверждения Last.fm останавливается
  useEffect(
    () => () => {
      lfmCancelRef.current = true;
    },
    [],
  );

  /** Last.fm: токен → браузер «Разрешить» → поллим complete до ~2 минут. */
  const lfmConnect = async () => {
    setLfmWaiting(true);
    lfmCancelRef.current = false;
    try {
      const { token, authUrl } = await api.lastfmConnectStart();
      await openExternal(authUrl);
      onNotify("Разреши доступ в браузере — ждём подтверждения", "radio-tower");
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        if (lfmCancelRef.current) return;
        try {
          const { username } = await api.lastfmConnectComplete(token);
          setScrob((s) =>
            s ? { ...s, lastfm: { ...s.lastfm, connected: true, username } } : s,
          );
          onNotify(`Last.fm подключён: ${username}`, "radio-tower");
          return;
        } catch (e) {
          // 409 = ещё не нажал «Разрешить» — ждём дальше
          if (!(e instanceof ApiError && e.status === 409)) throw e;
        }
      }
      onNotify("Не дождались подтверждения Last.fm — попробуй ещё раз", "x");
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : "Не удалось подключить Last.fm", "x");
    } finally {
      setLfmWaiting(false);
    }
  };

  const lfmDisconnect = async () => {
    try {
      await api.lastfmDisconnect();
      setScrob((s) => (s ? { ...s, lastfm: { ...s.lastfm, connected: false, username: null } } : s));
      onNotify("Last.fm отключён", "radio-tower");
    } catch {
      onNotify("Не удалось отключить Last.fm", "x");
    }
  };

  const lbConnect = async () => {
    const token = lbToken.trim();
    if (token.length < 8) {
      setLbErr("Вставь user token со страницы listenbrainz.org/settings");
      return;
    }
    setLbBusy(true);
    setLbErr(null);
    try {
      const { username } = await api.listenbrainzConnect(token);
      setScrob((s) => (s ? { ...s, listenbrainz: { connected: true, username } } : s));
      setLbOpen(false);
      setLbToken("");
      onNotify(`ListenBrainz подключён: ${username}`, "radio-tower");
    } catch (e) {
      setLbErr(e instanceof ApiError ? e.message : "Не удалось подключить ListenBrainz");
    } finally {
      setLbBusy(false);
    }
  };

  const lbDisconnect = async () => {
    try {
      await api.listenbrainzDisconnect();
      setScrob((s) => (s ? { ...s, listenbrainz: { connected: false, username: null } } : s));
      onNotify("ListenBrainz отключён", "radio-tower");
    } catch {
      onNotify("Не удалось отключить ListenBrainz", "x");
    }
  };
  const set = (patch: Partial<Prefs>) => setPrefs({ ...prefs, ...patch });

  // Кэш добычи (Stage 4): реальные цифры + живая очистка (пины переживают)
  const [cache, setCache] = useState<CacheStats | null>(null);
  const reloadCache = () => {
    if (!engineAvailable()) return;
    cacheStats().then(setCache).catch(() => undefined);
  };
  useEffect(() => {
    if (tab === "library") reloadCache();
  }, [tab]);
  const fmtGb = (bytes: number) =>
    bytes >= 1024 * 1024 * 1024
      ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`
      : `${Math.round(bytes / (1024 * 1024))} МБ`;
  // Первый рендер — без своей анимации (вход анимирует обёртка в App).
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const paneClass = mounted.current ? "muza-view" : undefined;

  const presets = [
    { key: "muza", name: "Муза", hint: "Синий · мягкие углы", accent: "blue" as const, accentColor: "#3b82f6", radius: "soft" as const },
    { key: "flame", name: "Пламя", hint: "Красный · круглее", accent: "red" as const, accentColor: "#f76967", radius: "round" as const },
    { key: "graphite", name: "Графит", hint: "Молния · строже", accent: "bolt" as const, accentColor: "#327ad9", radius: "mild" as const },
  ];

  // ── Под-экраны (тяжёлые пункты — не строки) ──────────────────────

  const customizePane = (
    <div key="customize" className={paneClass} style={paneStyle}>
      <SubHeader title="Кастомизация" onBack={() => setSub(null)} />

      <GroupTitle>Стекло и эффекты</GroupTitle>
      <SettingRow title="Размытие панелей" hint="Сила blur на матовом стекле">
        <LiveSlider value={prefs.blur} max={64} label="Размытие панелей" suffix={`${prefs.blur} px`} onChange={(v) => set({ blur: Math.round(v) })} />
      </SettingRow>
      <SettingRow title="Размытие фона" hint="Blur обложки или картинки за интерфейсом">
        <LiveSlider
          value={prefs.blurScenery}
          max={80}
          label="Размытие фона"
          suffix={`${prefs.blurScenery} px`}
          onChange={(v) => set({ blurScenery: Math.round(v) })}
        />
      </SettingRow>
      <SettingRow title="Прозрачность по зонам" hint="Плеер, «сейчас играет», меню, диалоги, сайдбар (позже)" chevron>
        <RowValue>Общая</RowValue>
      </SettingRow>

      <GroupTitle>Цвета и слои</GroupTitle>
      <SettingRow title="Базовый фон" hint="Тон и температура bg-слоёв">
        <Tabs
          items={[
            { key: "graphite", label: "Графит" },
            { key: "warm", label: "Тёплый" },
            { key: "cold", label: "Холодный" },
            { key: "amoled", label: "AMOLED" },
          ]}
          value={prefs.baseBg}
          onChange={(k: string) => set({ baseBg: k as Prefs["baseBg"] })}
        />
      </SettingRow>
      <SettingRow title="Роли акцента" hint="Отдельно для play, слайдеров, активного трека (позже)" chevron>
        <RowValue>Единый</RowValue>
      </SettingRow>
      <SettingRow title="Приглушение текста" hint="Яркость вторичного текста (подписи, хинты)">
        <LiveSlider
          value={prefs.textDim - 40}
          max={40}
          label="Приглушение текста"
          suffix={`${prefs.textDim} %`}
          onChange={(v) => set({ textDim: 40 + Math.round(v) })}
        />
      </SettingRow>

      <GroupTitle>Форма и размеры</GroupTitle>
      <SettingRow title="Скругление по типам" hint="Плитки, кнопки, поля, панели отдельно (позже)" chevron>
        <RowValue>Пресет</RowValue>
      </SettingRow>
      <SettingRow title="Плотность интерфейса" hint="Отступы и высота строк (позже)">
        <RowValue>Просторно</RowValue>
      </SettingRow>
      <SettingRow title="Ширина сайдбара" hint="На узком окне сайдбар всё равно ужимается">
        <LiveSlider
          value={prefs.wSidebar - 240}
          max={100}
          label="Ширина сайдбара"
          suffix={`${prefs.wSidebar} px`}
          onChange={(v) => set({ wSidebar: 240 + Math.round(v) })}
        />
      </SettingRow>
      <SettingRow title="Ширина «Сейчас играет»" hint="Правая панель с текстом">
        <LiveSlider
          value={prefs.wNowPlaying - 300}
          max={120}
          label="Ширина панели «Сейчас играет»"
          suffix={`${prefs.wNowPlaying} px`}
          onChange={(v) => set({ wNowPlaying: 300 + Math.round(v) })}
        />
      </SettingRow>

      <GroupTitle>Типографика</GroupTitle>
      <SettingRow title="Размер текста" hint="Базовый размер — через «Масштаб интерфейса» во Внешнем виде">
        <RowValue>{prefs.uiScale} %</RowValue>
      </SettingRow>
      <SettingRow title="Размер караоке-текста" hint="Строка в режиме прослушивания">
        <LiveSlider
          value={prefs.karaokeSize - 36}
          max={36}
          label="Размер караоке-текста"
          suffix={`${prefs.karaokeSize} px`}
          onChange={(v) => set({ karaokeSize: 36 + Math.round(v) })}
        />
      </SettingRow>

      <GroupTitle>Движение</GroupTitle>
      <SettingRow title="Анимации" hint="Плавные переходы интерфейса">
        <Switch checked={prefs.anims} onChange={(anims: boolean) => set({ anims })} label="Анимации" />
      </SettingRow>
      <SettingRow title="Скорость анимаций" hint="Быстрее или мягче">
        <div style={prefs.anims ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
          <Tabs
            items={[
              { key: "fast", label: "Быстрее" },
              { key: "normal", label: "Стандарт" },
              { key: "slow", label: "Мягче" },
            ]}
            value={prefs.animSpeed}
            onChange={(k: string) => set({ animSpeed: k as Prefs["animSpeed"] })}
          />
        </div>
      </SettingRow>

      <GroupTitle>Компоновка и элементы</GroupTitle>
      <SettingRow title="Кнопки плеер-бара" hint="Состав и порядок (позже)" chevron>
        <RowValue>Стандарт</RowValue>
      </SettingRow>
      <SettingRow title="Вкладки сайдбара" hint="Состав, порядок, переименование (позже)" chevron></SettingRow>
      <SettingRow title="Строка трека" hint="Обложка, альбом, длительность, источник (позже)" chevron></SettingRow>

      <GroupTitle>Фон</GroupTitle>
      <SettingRow title="Тип фона" hint="Что за интерфейсом">
        <Tabs
          items={[
            { key: "none", label: "Выкл" },
            { key: "cover", label: "Обложка" },
            { key: "color", label: "Цвет" },
            { key: "gradient", label: "Градиент" },
            { key: "image", label: "Картинка" },
          ]}
          value={prefs.bgType}
          onChange={(k: string) => set({ bgType: k as Prefs["bgType"] })}
        />
      </SettingRow>
      {prefs.bgType === "color" || prefs.bgType === "gradient" ? (
        <SettingRow title={prefs.bgType === "gradient" ? "Цвета градиента" : "Цвет фона"} hint="Пипетка открывает пикер">
          <div style={{ display: "flex", gap: "var(--sp-3)" }}>
            <ColorDot color={prefs.bgColor} label="Цвет фона" onPick={(bgColor) => set({ bgColor })} />
            {prefs.bgType === "gradient" ? (
              <ColorDot color={prefs.bgColor2} label="Второй цвет градиента" onPick={(bgColor2) => set({ bgColor2 })} />
            ) : null}
          </div>
        </SettingRow>
      ) : null}
      {prefs.bgType === "image" ? (
        <SettingRow title="Картинка по URL" hint="Ссылка на изображение; размытие — слайдером выше (0 = без blur)">
          <SettingInput value={prefs.bgImageUrl} onChange={(bgImageUrl) => set({ bgImageUrl })} placeholder="https://…" width={260} />
        </SettingRow>
      ) : null}
      <SettingRow title="Фон по зонам" hint="Глобально или отдельно для зон (позже)" chevron>
        <RowValue>Глобально</RowValue>
      </SettingRow>
      <SettingRow title="Затемнение фона" hint="Чтобы контент читался поверх">
        <LiveSlider
          value={prefs.bgDim}
          max={80}
          label="Затемнение фона"
          suffix={`${prefs.bgDim} %`}
          onChange={(v) => set({ bgDim: Math.round(v) })}
        />
      </SettingRow>
      <SettingRow title="Реакция на обложку" hint="Фон подстраивается под цвет трека (позже)">
        <Switch checked={false} disabled label="Реакция на обложку" />
      </SettingRow>

      <GroupTitle>Поведение</GroupTitle>
      <SettingRow title="Действие по двойному клику" hint="Что делает даблклик по треку (позже)">
        <RowValue>Играть</RowValue>
      </SettingRow>
      <SettingRow title="Стартовый экран" hint="Что открывается при запуске">
        <Tabs
          items={[
            { key: "home", label: "Главная" },
            { key: "search", label: "Поиск" },
            { key: "favorites", label: "Любимое" },
            { key: "library", label: "Библиотека" },
          ]}
          value={prefs.startView}
          onChange={(k: string) => set({ startView: k as Prefs["startView"] })}
        />
      </SettingRow>

      <GroupTitle>Темы</GroupTitle>
      <SettingRow title="Сохранить как тему" hint="Текущее оформление целиком, включая CSS-тир">
        <Button variant="ghost" icon="save" onClick={openSaveTheme}>
          Сохранить
        </Button>
      </SettingRow>
      {themes.map((t) => (
        <SettingRow key={t.id} title={t.name} hint={new Date(t.createdAt).toLocaleDateString("ru")}>
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <Button variant="secondary" icon="paintbrush" onClick={() => applySavedTheme(t)}>
              Применить
            </Button>
            <IconButton icon="copy" label="Скопировать JSON темы" onClick={() => void copyTheme(t)} />
            <IconButton icon="trash-2" label="Удалить тему" onClick={() => removeTheme(t.id)} />
          </div>
        </SettingRow>
      ))}
      <SettingRow title="Импорт темы" hint="Вставь JSON темы (из буфера или маркетплейса)">
        <Button variant="ghost" icon="clipboard-paste" onClick={() => setThemeImportOpen(true)}>
          Вставить
        </Button>
      </SettingRow>
      <SettingRow title="Маркетплейс тем" hint="Ставить и делиться темами" onClick={() => openMarket("Темы")} chevron></SettingRow>

      <GroupTitle>CSS-тир</GroupTitle>
      <SettingRow
        title="Свой CSS"
        hint="Опасная зона: переопределяет любые токены и стили; сломанный вид лечится выключателем или сбросом"
      >
        <Switch checked={prefs.customCssOn} onChange={(customCssOn: boolean) => set({ customCssOn })} label="Свой CSS" />
      </SettingRow>
      {prefs.customCssOn ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <textarea
            value={cssDraft}
            onChange={(e) => setCssDraft(e.target.value)}
            spellCheck={false}
            placeholder={":root { --accent: #22c55e; }\n.muza-view { /* … */ }"}
            aria-label="Свой CSS"
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
              Применить CSS
            </Button>
            <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              Применяется поверх всех токенов; входит в сохранённую тему. Настройки вроде своего акцента живут
              inline — их перебивает только !important.
            </span>
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
              radius: DEFAULT_PREFS.radius,
              blur: DEFAULT_PREFS.blur,
              glassOpacity: DEFAULT_PREFS.glassOpacity,
              anims: DEFAULT_PREFS.anims,
              bgType: DEFAULT_PREFS.bgType,
              bgColor: DEFAULT_PREFS.bgColor,
              bgColor2: DEFAULT_PREFS.bgColor2,
              bgImageUrl: DEFAULT_PREFS.bgImageUrl,
              bgDim: DEFAULT_PREFS.bgDim,
              blurScenery: DEFAULT_PREFS.blurScenery,
              baseBg: DEFAULT_PREFS.baseBg,
              textDim: DEFAULT_PREFS.textDim,
              uiScale: DEFAULT_PREFS.uiScale,
              animSpeed: DEFAULT_PREFS.animSpeed,
              karaokeSize: DEFAULT_PREFS.karaokeSize,
              wSidebar: DEFAULT_PREFS.wSidebar,
              wNowPlaying: DEFAULT_PREFS.wNowPlaying,
              customCssOn: DEFAULT_PREFS.customCssOn,
            })
          }
        >
          Сбросить оформление
        </Button>
      </div>
    </div>
  );

  const equalizerPane = (
    <div key="equalizer" className={paneClass} style={paneStyle}>
      <SubHeader title="Эквалайзер" onBack={() => setSub(null)} />
      <SettingRow title="Включить" hint="Живой десятиполосник — крутит звук каталожных треков">
        <Switch checked={eqOn} onChange={setEqOn} label="Эквалайзер" />
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
            <Fader value={eqBands[i]} min={-12} max={12} height={150} disabled={!eqOn} onChange={(v: number) => setBand(i, v)} ariaLabel={`Полоса ${f} Гц`} />
            <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{f}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <Button variant="ghost" icon="rotate-ccw" disabled={!eqOn} onClick={() => applyPreset("Ровный")}>
          Сбросить полосы
        </Button>
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>дБ, от −12 до +12</span>
      </div>
    </div>
  );

  const discordPane = (
    <div key="discord" className={paneClass} style={paneStyle}>
      <SubHeader title="Discord Rich Presence" onBack={() => setSub(null)} />
      <SettingRow title="Показывать в Discord" hint="Статус «слушает Muza»; нужен запущенный Discord и зарегистрированное приложение (client id)">
        <Switch checked={prefs.discordRpcOn} onChange={(discordRpcOn: boolean) => set({ discordRpcOn })} label="Discord RPC" />
      </SettingRow>
      <GroupTitle>Что показывать</GroupTitle>
      <SettingRow title="Название и артист">
        <Switch checked disabled label="Название и артист" />
      </SettingRow>
      <SettingRow title="Обложка трека">
        <Switch checked disabled label="Обложка" />
      </SettingRow>
      <GroupTitle>Кнопка в активности</GroupTitle>
      <SettingRow title="Показывать кнопку" hint="Кнопка под статусом в профиле Discord; заработает вместе с RPC">
        <Switch checked={prefs.discordBtnOn} onChange={(discordBtnOn: boolean) => set({ discordBtnOn })} label="Кнопка активности" />
      </SettingRow>
      <SettingRow title="Текст кнопки" hint="До 32 символов — лимит Discord">
        <SettingInput
          value={prefs.discordBtnLabel}
          placeholder="Открыть в Muza"
          onChange={(v) => set({ discordBtnLabel: v.slice(0, 32) })}
        />
      </SettingRow>
      <SettingRow title="Ссылка кнопки" hint="Куда ведёт клик: сайт, профиль, трек">
        <SettingInput
          value={prefs.discordBtnUrl}
          placeholder="https://…"
          width={260}
          onChange={(v) => set({ discordBtnUrl: v })}
        />
      </SettingRow>
      <GroupTitle>Шаблон строк (Stage 3)</GroupTitle>
      <SettingRow title="Первая строка" hint="Подстановки: {track}, {artist}, {album}">
        <RowValue>{"{track}"}</RowValue>
      </SettingRow>
      <SettingRow title="Вторая строка">
        <RowValue>{"{artist} — {album}"}</RowValue>
      </SettingRow>
      <GroupTitle>Предпросмотр</GroupTitle>
      {/* Карточка активности как в профиле Discord */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
          padding: "var(--sp-4) var(--sp-5)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-2)",
          maxWidth: 380,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-3)" }}>
          Слушает Muza
        </div>
        <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "var(--r-sm)",
              background: "var(--accent-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <Icon name="disc-3" size={24} color="var(--accent-text)" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--fs-caption)", fontWeight: 600, color: "var(--text-1)" }}>Кометы над городом</div>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>Северный ветер — Полночь</div>
          </div>
        </div>
        {prefs.discordBtnOn ? (
          <div
            style={{
              height: 34,
              borderRadius: "var(--r-xs)",
              background: "var(--surface-4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--fs-caption)",
              fontWeight: 600,
              color: "var(--text-1)",
            }}
            title={prefs.discordBtnUrl}
          >
            {prefs.discordBtnLabel.trim() || "Открыть в Muza"}
          </div>
        ) : null}
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>Предпросмотр · RPC подключится в Stage 3</div>
      </div>
    </div>
  );

  const marketPane = (
    <div key="market" className={paneClass} style={paneStyle}>
      <SubHeader title="Маркетплейс" onBack={() => setSub(null)} />
      <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
        <ChipGroup items={["Всё", "Темы", "Плагины"]} value={marketFilter} onChange={setMarketFilter} />
        {serverSession && marketFilter !== "Плагины" ? (
          <Button variant="secondary" icon="upload" onClick={openPublishTheme} style={{ marginLeft: "auto" }}>
            Опубликовать оформление
          </Button>
        ) : null}
      </div>

      {marketFilter !== "Плагины" ? (
        // Темы — настоящий серверный каталог (Stage 6)
        !serverSession ? (
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
            Маркетплейс тем доступен после входа с аккаунтом — анонимный аккаунт живёт только на устройстве.
          </div>
        ) : marketThemes === null ? (
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>Загружаем каталог…</div>
        ) : marketThemes.length === 0 ? (
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
            Пока пусто. Собери оформление в Кастомизации и стань первым — «Опубликовать оформление».
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
            {marketThemes.map((t) => (
              <MarketThemeCard
                key={t.id}
                theme={t}
                onInstall={() => void installTheme(t)}
                onRemove={t.isMine ? () => void unpublishTheme(t) : undefined}
              />
            ))}
          </div>
        )
      ) : null}

      {marketFilter !== "Темы" ? (
        <>
          {marketFilter === "Всё" ? <GroupTitle>Плагины</GroupTitle> : null}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
            {MARKET_ITEMS.filter((m) => m.kind === "plugin").map((m) => (
              <MarketCard key={m.name} item={m} />
            ))}
          </div>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
            Плагины — витрина: внешняя плагин-система требует песочницу (в работе). Встроенные расширения — во вкладке «Расширения».
          </div>
        </>
      ) : null}
    </div>
  );

  // Документ о данных (Stage 4): честно и по-человечески — что где живёт.
  const dataDocBlock = (title: string, items: string[]) => (
    <div style={{ marginBottom: "var(--sp-4)" }}>
      <div style={{ fontSize: "var(--fs-body)", fontWeight: 700, color: "var(--text-1)", marginBottom: "var(--sp-2)" }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {items.map((text, i) => (
          <div key={i} style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.55 }}>
            {text}
          </div>
        ))}
      </div>
    </div>
  );

  const dataPane = (
    <div key="data" className={paneClass} style={paneStyle}>
      <SubHeader title="Данные: что и где живёт" onBack={() => setSub(null)} />
      {dataDocBlock("Остаётся только на этом устройстве", [
        "— Аудио-кэш прослушанного и оффлайн-загрузки (байты музыки сервер не проходят: клиент добывает их сам).",
        "— Локальные файлы и их пути на диске.",
        "— Настройки, тема, ключи текущей сессии.",
      ])}
      {dataDocBlock("Хранится на сервере — для твоих же функций, видно только тебе", [
        "— Аккаунт: ник и хэш пароля; email — только если сам указал (восстановление пароля).",
        "— Лайки, дизлайки, плейлисты, выбранные версии треков.",
        "— История прослушиваний — из неё строится твоя статистика (и позже рекомендации).",
        "— От локальных файлов — только название, артист и отпечаток файла (hash), не сам файл и не путь.",
      ])}
      {dataDocBlock("Анонимная статистика (галочка в «Аккаунте»)", [
        "— Раз в ~10 минут уходят суммарные счётчики: сколько добыч удалось и с какими ошибками (по ним чинится добыча без обновления приложения) и сколько было прослушиваний.",
        "— Без привязки к аккаунту: ни ника, ни id, ни названий треков в этих счётчиках нет.",
      ])}
      {dataDocBlock("Чего мы не делаем", [
        "— Не продаём и не передаём данные.",
        "— Не собираем пофамильную историю в аналитику — агрегаты обезличены.",
        "— Не шлём писем без дела: только верификация и восстановление пароля.",
      ])}
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
        Удаление аккаунта удаляет всё серверное. Кнопка появится к релизу — пока это делается по запросу.
      </div>
    </div>
  );

  // ── Вкладки ───────────────────────────────────────────────────────

  const pane =
    sub === "customize" ? (
      customizePane
    ) : sub === "equalizer" ? (
      equalizerPane
    ) : sub === "discord" ? (
      discordPane
    ) : sub === "market" ? (
      marketPane
    ) : sub === "data" ? (
      dataPane
    ) : tab === "account" ? (
      <div key="account" className={paneClass} style={paneStyle}>
        <SettingRow title="Профиль" hint={username}>
          <Button variant="ghost" icon="log-out" onClick={onLogout}>
            Выйти
          </Button>
        </SettingRow>
        <SettingRow title="Email" hint="Для восстановления пароля (смена почты — позже)">
          <RowValue>указан при регистрации</RowValue>
        </SettingRow>
        <SettingRow
          title="Сменить пароль"
          hint={
            serverSession
              ? "Старый → новый; остальные устройства разлогинятся"
              : "Нужен аккаунт — у анонима пароля нет"
          }
          onClick={serverSession ? openPwd : undefined}
          chevron={serverSession}
        ></SettingRow>
        <SettingRow title="Сессии и устройства" hint="Где выполнен вход (позже)" chevron></SettingRow>
        <GroupTitle>Приватность</GroupTitle>
        <SettingRow
          title="Анонимная статистика"
          hint="Обезличенные агрегаты добычи и прослушиваний — по ним чинится добыча; без ника, id и названий треков"
        >
          <Switch
            checked={prefs.telemetry}
            onChange={(on: boolean) => set({ telemetry: on })}
            label="Анонимная статистика"
          />
        </SettingRow>
        <SettingRow
          title="Документ о данных"
          hint="Что остаётся на устройстве, что хранит сервер и что уходит в статистику"
          onClick={() => setSub("data")}
          chevron
        ></SettingRow>
        <SettingRow title="Выгрузить или удалить данные" hint="Появится к релизу" danger chevron></SettingRow>
      </div>
    ) : tab === "appearance" ? (
      <div key="appearance" className={paneClass} style={paneStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--sp-3)" }}>
          {presets.map((p) => (
            <PresetTile
              key={p.key}
              name={p.name}
              hint={p.hint}
              accentColor={p.accentColor}
              radius={p.radius}
              selected={prefs.accent === p.accent && prefs.radius === p.radius}
              onClick={() => set({ accent: p.accent, radius: p.radius })}
            />
          ))}
        </div>
        <SettingRow title="Тема" hint="Светлая — позже">
          <RowValue>Тёмная</RowValue>
        </SettingRow>
        <SettingRow title="Акцентный цвет" hint="Готовые или любой свой — пипетка справа">
          <div style={{ display: "flex", gap: "var(--sp-3)" }}>
            <AccentSwatch color="#3b82f6" label="Синий" selected={prefs.accent === "blue"} onClick={() => set({ accent: "blue" })} />
            <AccentSwatch color="#f76967" label="Красный" selected={prefs.accent === "red"} onClick={() => set({ accent: "red" })} />
            <AccentSwatch color="#327ad9" label="Молния" selected={prefs.accent === "bolt"} onClick={() => set({ accent: "bolt" })} />
            <CustomAccentSwatch
              color={prefs.customAccent}
              selected={prefs.accent === "custom"}
              onPick={(customAccent) => set({ accent: "custom", customAccent })}
            />
          </div>
        </SettingRow>
        <SettingRow title="Скругление" hint="Насколько мягкие углы у плиток">
          <Tabs
            items={[
              { key: "mild", label: "Меньше" },
              { key: "soft", label: "Стандарт" },
              { key: "round", label: "Больше" },
            ]}
            value={prefs.radius}
            onChange={(radius: string) => set({ radius: radius as Prefs["radius"] })}
          />
        </SettingRow>
        <SettingRow title="Стекло" hint="Общая плотность матовых панелей">
          <LiveSlider
            value={prefs.glassOpacity - GLASS_MIN}
            max={100 - GLASS_MIN}
            label="Плотность стекла"
            suffix={`${prefs.glassOpacity} %`}
            onChange={(v) => set({ glassOpacity: GLASS_MIN + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title="Фон" hint="Быстрый тумблер «из обложки»; все типы фона — в Кастомизации">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
            <RowValue>{prefs.bgType === "cover" ? "Из обложки" : prefs.bgType === "none" ? "Выкл" : "Свой"}</RowValue>
            <Switch
              checked={prefs.bgType === "cover"}
              onChange={(on: boolean) => set({ bgType: on ? "cover" : "none" })}
              label="Фон из обложки"
            />
          </div>
        </SettingRow>
        <SettingRow title="Масштаб интерфейса" hint="Весь интерфейс крупнее или мельче">
          <LiveSlider
            value={prefs.uiScale - 85}
            max={40}
            label="Масштаб интерфейса"
            suffix={`${prefs.uiScale} %`}
            onChange={(v) => set({ uiScale: 85 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title="Кастомизация" hint="Редактор темы: слои, форма, типографика, темы, CSS" onClick={() => setSub("customize")} chevron></SettingRow>
      </div>
    ) : tab === "playback" ? (
      <div key="playback" className={paneClass} style={paneStyle}>
        <GroupTitle>Переходы</GroupTitle>
        <SettingRow title="Кроссфейд" hint="Плавный переход между треками (4 секунды)">
          <Switch checked={prefs.crossfade} onChange={(v: boolean) => set({ crossfade: v })} label="Кроссфейд" />
        </SettingRow>
        <SettingRow title="Gapless" hint="Преднагрузка следующего трека уже работает; идеальный стык — позже">
          <Switch checked disabled label="Gapless" />
        </SettingRow>
        <GroupTitle>Звук</GroupTitle>
        <SettingRow title="Эквалайзер" hint="Пресеты и свои полосы — звук живой" onClick={() => setSub("equalizer")} chevron>
          <RowValue>{eqOn ? eqPreset : "Выкл"}</RowValue>
        </SettingRow>
        <SettingRow title="Нормализация громкости" hint="Выравнивает громкость между треками (−14 LUFS, если громкость трека измерена)">
          <Switch checked={prefs.normalize} onChange={(v: boolean) => set({ normalize: v })} label="Нормализация" />
        </SettingRow>
        <SettingRow title="Шаги скорости" hint="Кнопка «1×» в баре циклит эти значения; свои шаги — через запятую (0.25–4)">
          <StepsEditor
            values={prefs.speedSteps}
            onApply={(speedSteps) => set({ speedSteps })}
            min={0.25}
            max={4}
            maxCount={8}
            fallback={DEFAULT_PREFS.speedSteps}
            suffix="×"
          />
        </SettingRow>
        <GroupTitle>Очередь</GroupTitle>
        <SettingRow title="Бесконечное радио" hint="Очередь кончилась — продолжаем похожими треками (радио от последнего)">
          <Switch checked={prefs.radioEndless} onChange={(v: boolean) => set({ radioEndless: v })} label="Бесконечное радио" />
        </SettingRow>
        <GroupTitle>Рекомендации</GroupTitle>
        <RecsTuning api={api} enabled={serverSession} onNotify={onNotify} />
        <SettingRow title="Запоминать позицию трека" hint="Продолжать с места остановки (позже)">
          <Switch checked disabled label="Запоминать позицию" />
        </SettingRow>
        <GroupTitle>Стрим</GroupTitle>
        <SettingRow title="Качество стрима" hint="Максимум или эконом (позже; сейчас — лучший формат по рецепту)">
          <RowValue>Авто</RowValue>
        </SettingRow>
        <SettingRow title="Sleep timer" hint="Пресеты луны в баре: выкл → эти минуты → конец трека">
          <StepsEditor
            values={prefs.sleepPresets}
            onApply={(sleepPresets) => set({ sleepPresets: sleepPresets.map(Math.round) })}
            min={1}
            max={600}
            maxCount={6}
            fallback={DEFAULT_PREFS.sleepPresets}
            suffix="мин"
          />
        </SettingRow>
      </div>
    ) : tab === "sources" ? (
      <div key="sources" className={paneClass} style={paneStyle}>
        <SettingRow title="Что предпочитать" hint="Глобальная политика — позже; выбрать версию у трека уже можно: «⋯ → Версии и источники»">
          <RowValue>Официальное</RowValue>
        </SettingRow>
        <GroupTitle>Источники по приоритету</GroupTitle>
        <SettingRow title="YT Music" hint="Официальный каталог — основной">
          <Switch checked disabled label="YT Music" />
        </SettingRow>
        <SettingRow title="YouTube" hint="Фолбэк основного">
          <Switch checked disabled label="YouTube" />
        </SettingRow>
        <SettingRow title="SoundCloud" hint="Фолбэк">
          <Switch checked disabled label="SoundCloud" />
        </SettingRow>
        <SettingRow title="Bandcamp" hint="В поиске — позже; по прямой ссылке уже работает">
          <Switch checked={false} disabled label="Bandcamp" />
        </SettingRow>
        <GroupTitle>Поиск</GroupTitle>
        <SettingRow title="Где искать" hint="Каталог, источники, локальное (позже)">
          <RowValue>Везде</RowValue>
        </SettingRow>
        <SettingRow title="Мгновенный поиск" hint="Каталог при вводе, источники — по Enter">
          <Switch checked disabled label="Мгновенный поиск" />
        </SettingRow>
        <SettingRow title="Прямые и локальные источники" hint="Работает: файлы, папки и ссылки — в Медиатеке">
          <RowValue>Медиатека → Локальные / По ссылке</RowValue>
        </SettingRow>
      </div>
    ) : tab === "lyrics" ? (
      <div key="lyrics" className={paneClass} style={paneStyle}>
        <GroupTitle>Отображение</GroupTitle>
        <SettingRow title="Синхро-текст" hint="Караоке-строки в такт — работает">
          <Switch checked disabled label="Синхро-текст" />
        </SettingRow>
        <SettingRow title="Автоскролл" hint="Следовать за текущей строкой — работает">
          <Switch checked disabled label="Автоскролл" />
        </SettingRow>
        <SettingRow title="Размер караоке-текста" hint="Настройка в Кастомизации (позже)">
          <DisabledSlider value={28} max={44} label="Размер караоке-текста" />
        </SettingRow>
        <GroupTitle>Понимание</GroupTitle>
        <SettingRow title="Перевод" hint="Перевод строк на выбранный язык (позже)">
          <RowValue>Выкл</RowValue>
        </SettingRow>
        <SettingRow title="Режим смысла" hint="Аннотации Genius к строкам (Stage 5)">
          <Switch checked={false} disabled label="Режим смысла" />
        </SettingRow>
      </div>
    ) : tab === "library" ? (
      <div key="library" className={paneClass} style={paneStyle}>
        <SettingRow title="Локальные файлы" hint="Добавление файлов и папок — в Медиатеке, вкладка «Локальные»">
          <RowValue>Медиатека → Локальные</RowValue>
        </SettingRow>
        <SettingRow
          title="Кэш прослушанного"
          hint={
            cache
              ? `Занято ${fmtGb(cache.bytes)} · ${cache.files} файл(ов); очистка не трогает оффлайн`
              : "LRU-кэш добытого аудио — живой, эвикция по лимиту"
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
            <LiveSlider
              value={prefs.cacheLimitGb - 1}
              max={15}
              label="Лимит кэша"
              suffix={`${prefs.cacheLimitGb} ГБ`}
              onChange={(v) => set({ cacheLimitGb: 1 + Math.round(v) })}
            />
            <Button
              variant="ghost"
              icon="trash-2"
              disabled={!engineAvailable()}
              onClick={() => {
                void cacheClear().then(reloadCache);
              }}
            >
              Очистить
            </Button>
          </div>
        </SettingRow>
        <SettingRow title="Оффлайн-загрузки" hint="«Сохранить оффлайн» у трека или плейлиста; не эвиктится и переживает очистку">
          <RowValue>
            {cache ? `${cache.pinnedFiles} тр. · ${fmtGb(cache.pinnedBytes)}` : "0 треков"}
          </RowValue>
        </SettingRow>
        <SettingRow title="Импорт плейлистов" hint="Spotify, YouTube / YT Music, Apple Music — кнопка в Медиатеке">
          <RowValue>Медиатека → Импорт</RowValue>
        </SettingRow>
      </div>
    ) : tab === "integrations" ? (
      <div key="integrations" className={paneClass} style={paneStyle}>
        <SettingRow title="Discord Rich Presence" hint="Статус и кнопка работают (нужен Application ID из Dev Portal); шаблоны строк — позже" onClick={() => setSub("discord")} chevron>
          <RowValue>Выкл</RowValue>
        </SettingRow>
        <SettingRow
          title="Скробблинг Last.fm"
          hint={
            !serverSession
              ? "Нужен аккаунт Muza (у анонима синхронизации нет)"
              : !scrob
                ? scrobErr
                  ? "Сервер недоступен — проверю сам, как только поднимется"
                  : "Проверяем статус…"
                : scrob.lastfm.connected
                  ? `Подключён как ${scrob.lastfm.username} — прослушивания уходят сами`
                  : scrob.lastfm.available
                    ? "Прослушивания будут уходить в твой профиль Last.fm"
                    : "На сервере нет API-ключей Last.fm — впиши LASTFM_API_KEY и LASTFM_API_SECRET в .env (last.fm/api)"
          }
        >
          {serverSession && scrob?.lastfm.connected ? (
            <Button variant="ghost" icon="unlink" onClick={() => void lfmDisconnect()}>
              Отключить
            </Button>
          ) : serverSession && scrob?.lastfm.available ? (
            <Button variant="secondary" icon="link" disabled={lfmWaiting} onClick={() => void lfmConnect()}>
              {lfmWaiting ? "Ждём браузер…" : "Подключить"}
            </Button>
          ) : (
            <RowValue>{serverSession && scrob ? "Недоступен" : "Не подключён"}</RowValue>
          )}
        </SettingRow>
        <SettingRow
          title="Скробблинг ListenBrainz"
          hint={
            !serverSession
              ? "Нужен аккаунт Muza (у анонима синхронизации нет)"
              : !scrob && scrobErr
                ? "Сервер недоступен — проверю сам, как только поднимется"
                : scrob?.listenbrainz.connected
                  ? `Подключён как ${scrob.listenbrainz.username} — прослушивания уходят сами`
                  : "Открытая альтернатива Last.fm; нужен только user token"
          }
        >
          {serverSession && scrob?.listenbrainz.connected ? (
            <Button variant="ghost" icon="unlink" onClick={() => void lbDisconnect()}>
              Отключить
            </Button>
          ) : serverSession && scrob ? (
            <Button
              variant="secondary"
              icon="link"
              onClick={() => {
                setLbErr(null);
                setLbToken("");
                setLbOpen(true);
              }}
            >
              Подключить
            </Button>
          ) : (
            <RowValue>Не подключён</RowValue>
          )}
        </SettingRow>
        <SettingRow title="Медиаклавиши" hint="Play/Pause/Next с клавиатуры — работают">
          <Switch checked disabled label="Медиаклавиши" />
        </SettingRow>
      </div>
    ) : tab === "hotkeys" ? (
      <div key="hotkeys" className={paneClass} style={paneStyle}>
        {HOTKEYS.map((h) => (
          <SettingRow key={h.action} title={h.action} hint="Работает уже сейчас · переназначение — позже">
            <Kbd>{h.combo}</Kbd>
          </SettingRow>
        ))}
        <div style={{ marginTop: "var(--sp-2)" }}>
          <Button variant="ghost" icon="rotate-ccw" disabled>
            Сбросить все
          </Button>
        </div>
      </div>
    ) : tab === "extensions" ? (
      <div key="extensions" className={paneClass} style={paneStyle}>
        <GroupTitle>Встроенные</GroupTitle>
        <SettingRow title="Визуализатор" hint="Спектр или волна в такт в режиме прослушивания (каталожные треки)">
          <Switch
            checked={prefs.visualizer !== "off"}
            onChange={(on: boolean) => set({ visualizer: on ? "bars" : "off" })}
            label="Визуализатор"
          />
        </SettingRow>
        {prefs.visualizer !== "off" ? (
          <SettingRow title="Вид визуализатора" hint="Бары — спектр частот, волна — форма сигнала">
            <Tabs
              items={[
                { key: "bars", label: "Бары" },
                { key: "wave", label: "Волна" },
              ]}
              value={prefs.visualizer}
              onChange={(k: string) => set({ visualizer: k as Prefs["visualizer"] })}
            />
          </SettingRow>
        ) : null}
        <GroupTitle>Внешние плагины</GroupTitle>
        <SettingRow title="Плагины" hint="Внешняя плагин-система требует песочницу и capability-права — в работе">
          <RowValue>0 установлено</RowValue>
        </SettingRow>
        <SettingRow title="Маркетплейс плагинов" hint="Каталог расширений — пока витрина" onClick={() => openMarket("Плагины")} chevron></SettingRow>
        <SettingRow title="Маркетплейс тем" hint="Ставить и делиться темами — работает" onClick={() => openMarket("Темы")} chevron></SettingRow>
        <SettingRow title="Установить из файла" hint="Для разработчиков (с плагин-системой)">
          <Button variant="ghost" icon="folder-open" disabled>
            Выбрать файл
          </Button>
        </SettingRow>
      </div>
    ) : (
      <div key="system" className={paneClass} style={paneStyle}>
        <SettingRow
          title="Запускать при старте Windows"
          hint={engineAvailable() ? "Muza стартует вместе с системой" : "Работает только в приложении (не в браузере)"}
        >
          <Switch
            checked={prefs.autostart}
            disabled={!engineAvailable()}
            onChange={(autostart: boolean) => set({ autostart })}
            label="Автозапуск"
          />
        </SettingRow>
        <SettingRow
          title="Иконка в трее"
          hint={engineAvailable() ? "Muza в области уведомлений: клик открывает окно" : "Работает только в приложении (не в браузере)"}
        >
          <Switch
            checked={prefs.tray}
            disabled={!engineAvailable()}
            onChange={(tray: boolean) => set({ tray })}
            label="Трей"
          />
        </SettingRow>
        <SettingRow
          title="При закрытии окна"
          hint={
            prefs.tray
              ? "«Сворачивать» прячет в трей — музыка играет дальше"
              : "Без иконки в трее окно всегда закрывается с выходом"
          }
        >
          <div style={prefs.tray && engineAvailable() ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
            <Tabs
              items={[
                { key: "tray", label: "Сворачивать" },
                { key: "exit", label: "Выходить" },
              ]}
              value={prefs.closeToTray ? "tray" : "exit"}
              onChange={(k: string) => set({ closeToTray: k === "tray" })}
            />
          </div>
        </SettingRow>
        <SettingRow title="Автообновление" hint="Подписанные обновления — к первому релизу">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
            <RowValue>Стабильный канал</RowValue>
            <Button variant="ghost" icon="refresh-cw" disabled>
              Проверить
            </Button>
          </div>
        </SettingRow>
        <SettingRow title="Мини-плеер" hint="Компактное окно поверх всех (позже)">
          <Switch checked={false} disabled label="Мини-плеер" />
        </SettingRow>
        <SettingRow title="Язык интерфейса" hint="Пока только русский">
          <RowValue>Русский</RowValue>
        </SettingRow>
        <GroupTitle>О приложении</GroupTitle>
        <SettingRow title="Версия" hint="Muza · сборка разработки">
          <RowValue>0.1.0</RowValue>
        </SettingRow>
        <SettingRow title="Лицензии открытого кода" hint="Что внутри и под чем (к релизу)" chevron></SettingRow>
        <SettingRow title="Сайт и исходники клиента" hint="muza.lol · GitHub (к релизу)" chevron></SettingRow>
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0", maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: "var(--fs-h1)", fontWeight: 700, color: "var(--text-1)" }}>Настройки</h1>
      {/* wrap: разделов много — все вкладки видны при любой ширине,
          скрытый горизонтальный скролл был антипаттерном */}
      <Tabs
        wrap
        items={TABS}
        value={tab}
        onChange={(t: string) => {
          setSub(null); // под-экран живёт внутри вкладки — смена вкладки закрывает его
          setTab(t);
        }}
      />
      {pane}

      {/* Смена пароля: старый → новый (сервер разлогинит остальные устройства) */}
      <Dialog
        open={pwdOpen}
        title="Сменить пароль"
        onClose={() => setPwdOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPwdOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="shield-check" disabled={pwdBusy} onClick={() => void submitPwd()}>
              {pwdBusy ? "Меняем…" : "Сменить"}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <SettingInput type="password" value={pwdCur} onChange={setPwdCur} placeholder="Текущий пароль" width={300} />
          <SettingInput type="password" value={pwdNew} onChange={setPwdNew} placeholder="Новый пароль (от 8 символов)" width={300} />
          <SettingInput type="password" value={pwdRepeat} onChange={setPwdRepeat} placeholder="Новый пароль ещё раз" width={300} />
          {pwdErr ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{pwdErr}</div>
          ) : (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              После смены все остальные устройства разлогинятся; это — останется в сессии.
            </div>
          )}
        </div>
      </Dialog>

      {/* ListenBrainz: user token со страницы настроек LB */}
      <Dialog
        open={lbOpen}
        title="Подключить ListenBrainz"
        onClose={() => setLbOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setLbOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="link" disabled={lbBusy} onClick={() => void lbConnect()}>
              {lbBusy ? "Проверяем…" : "Подключить"}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 320 }}>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.5 }}>
            Скопируй user token со страницы настроек ListenBrainz и вставь сюда — токен проверится и
            сохранится на сервере Muza.
          </div>
          <Button
            variant="ghost"
            icon="external-link"
            onClick={() => void openExternal("https://listenbrainz.org/settings/")}
            style={{ alignSelf: "flex-start" }}
          >
            Открыть listenbrainz.org/settings
          </Button>
          <SettingInput value={lbToken} onChange={setLbToken} placeholder="User token" width={320} />
          {lbErr ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{lbErr}</div>
          ) : null}
        </div>
      </Dialog>

      {/* Сохранить тему: имя (одноимённая перезаписывается) */}
      <Dialog
        open={themeNameOpen}
        title="Сохранить тему"
        onClose={() => setThemeNameOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setThemeNameOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="save" onClick={submitSaveTheme}>
              Сохранить
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <SettingInput value={themeName} onChange={setThemeName} placeholder="Название темы" width={300} />
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
            В тему входит только оформление (цвета, фон, форма, CSS) — поведение и звук не переносятся.
          </div>
        </div>
      </Dialog>

      {/* Импорт темы: JSON из буфера (Ctrl+V) */}
      <Dialog
        open={themeImportOpen}
        title="Импорт темы"
        onClose={() => setThemeImportOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setThemeImportOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="clipboard-paste" onClick={submitImportTheme}>
              Импортировать
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 340 }}>
          <textarea
            value={themeImportText}
            onChange={(e) => setThemeImportText(e.target.value)}
            spellCheck={false}
            placeholder='{"muzaTheme": 1, "name": "…", "tokens": { … }}'
            aria-label="JSON темы"
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
          {themeImportErr ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{themeImportErr}</div>
          ) : (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              Применится сразу и появится в списке тем. Чужие поля отбрасываются.
            </div>
          )}
        </div>
      </Dialog>

      {/* Публикация темы в маркетплейс */}
      <Dialog
        open={publishOpen}
        title="Опубликовать оформление"
        onClose={() => setPublishOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="upload" disabled={publishBusy} onClick={() => void submitPublishTheme()}>
              {publishBusy ? "Публикуем…" : "Опубликовать"}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <SettingInput value={publishName} onChange={setPublishName} placeholder="Название темы" width={300} />
          {publishErr ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{publishErr}</div>
          ) : (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              Публикуется текущее оформление под твоим ником. Повторная публикация с тем же названием обновит тему.
            </div>
          )}
        </div>
      </Dialog>

      {/* Тема с чужим CSS: честное предупреждение перед установкой */}
      <Dialog
        open={cssWarnTheme !== null}
        title="Тема содержит свой CSS"
        onClose={() => setCssWarnTheme(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setCssWarnTheme(null)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              icon="download"
              onClick={() => {
                const t = cssWarnTheme;
                setCssWarnTheme(null);
                if (t) void doInstallTheme(t);
              }}
            >
              Установить всё равно
            </Button>
          </>
        }
      >
        <div style={{ maxWidth: 360, fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.55 }}>
          CSS автора может переопределить любой вид интерфейса. Это безопасно для данных, но если вид сломается —
          выключи «Свой CSS» в Кастомизации или нажми «Сбросить оформление».
        </div>
      </Dialog>
    </div>
  );
}
