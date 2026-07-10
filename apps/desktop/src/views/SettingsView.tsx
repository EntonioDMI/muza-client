import { useEffect, useRef, useState } from "react";
import { Button, ChipGroup, Fader, Icon, IconButton, Slider, Switch, Tabs } from "@muza/ui";
import { DEFAULT_PREFS, type Prefs } from "../types";
import { cacheClear, cacheStats, engineAvailable, type CacheStats } from "../lib/engine";

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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
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

// Эти клавиши уже реально работают (обработчик в App); переназначение — позже
const HOTKEYS: { action: string; combo: string }[] = [
  { action: "Играть / пауза", combo: "Space" },
  { action: "Следующий трек", combo: "Ctrl + →" },
  { action: "Предыдущий трек", combo: "Ctrl + ←" },
  { action: "Перемотка +5 с", combo: "→" },
  { action: "Перемотка −5 с", combo: "←" },
  { action: "Лайк", combo: "L" },
  { action: "Без звука", combo: "M" },
  { action: "Поиск", combo: "Ctrl + K" },
];

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
  prefs,
  setPrefs,
  username,
  onLogout,
  intent,
}: {
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  username: string;
  onLogout: () => void;
  intent?: SettingsIntent | null;
}) {
  const [tab, setTab] = useState("appearance");
  const [sub, setSub] = useState<Sub>(null);

  // Маркетплейс: фильтр витрины (открывается из «Расширений» с нужной категорией)
  const [marketFilter, setMarketFilter] = useState("Всё");
  const openMarket = (filter: string) => {
    setMarketFilter(filter);
    setSub("market");
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
      <SettingRow title="Размытие фона" hint="Blur обложки за интерфейсом (позже)">
        <DisabledSlider value={40} max={80} label="Размытие фона" />
      </SettingRow>
      <SettingRow title="Прозрачность по зонам" hint="Плеер, «сейчас играет», меню, диалоги, сайдбар (позже)" chevron>
        <RowValue>Общая</RowValue>
      </SettingRow>

      <GroupTitle>Цвета и слои</GroupTitle>
      <SettingRow title="Базовый фон" hint="Тон и температура bg-слоёв (позже)">
        <RowValue>Графит</RowValue>
      </SettingRow>
      <SettingRow title="Роли акцента" hint="Отдельно для play, слайдеров, активного трека (позже)" chevron>
        <RowValue>Единый</RowValue>
      </SettingRow>
      <SettingRow title="Приглушение текста" hint="Контраст text-2 / text-3 (позже)">
        <DisabledSlider value={60} max={100} label="Приглушение текста" />
      </SettingRow>

      <GroupTitle>Форма и размеры</GroupTitle>
      <SettingRow title="Скругление по типам" hint="Плитки, кнопки, поля, панели отдельно (позже)" chevron>
        <RowValue>Пресет</RowValue>
      </SettingRow>
      <SettingRow title="Плотность интерфейса" hint="Отступы и высота строк (позже)">
        <RowValue>Просторно</RowValue>
      </SettingRow>
      <SettingRow title="Ширины зон" hint="Сайдбар, «сейчас играет», плеер-бар (позже)" chevron>
        <RowValue>Стандарт</RowValue>
      </SettingRow>

      <GroupTitle>Типографика</GroupTitle>
      <SettingRow title="Размер текста" hint="Базовый размер интерфейса (позже)">
        <DisabledSlider value={15} max={20} label="Размер текста" />
      </SettingRow>
      <SettingRow title="Размер караоке-текста" hint="Отдельно от интерфейса (Stage 3)">
        <DisabledSlider value={28} max={44} label="Размер караоке-текста" />
      </SettingRow>

      <GroupTitle>Движение</GroupTitle>
      <SettingRow title="Анимации" hint="Плавные переходы интерфейса">
        <Switch checked={prefs.anims} onChange={(anims: boolean) => set({ anims })} label="Анимации" />
      </SettingRow>
      <SettingRow title="Скорость анимаций" hint="Быстрее или мягче (позже)">
        <RowValue>Стандарт</RowValue>
      </SettingRow>

      <GroupTitle>Компоновка и элементы</GroupTitle>
      <SettingRow title="Кнопки плеер-бара" hint="Состав и порядок (позже)" chevron>
        <RowValue>Стандарт</RowValue>
      </SettingRow>
      <SettingRow title="Вкладки сайдбара" hint="Состав, порядок, переименование (позже)" chevron></SettingRow>
      <SettingRow title="Строка трека" hint="Обложка, альбом, длительность, источник (позже)" chevron></SettingRow>

      <GroupTitle>Фон</GroupTitle>
      <SettingRow title="Тип фона" hint="Цвет, градиент, картинка, обои, из обложки, URL (позже)">
        <RowValue>Из обложки</RowValue>
      </SettingRow>
      <SettingRow title="Фон по зонам" hint="Глобально или отдельно для зон (позже)" chevron>
        <RowValue>Глобально</RowValue>
      </SettingRow>
      <SettingRow title="Затемнение фона" hint="Чтобы контент читался поверх (позже)">
        <DisabledSlider value={40} max={100} label="Затемнение фона" />
      </SettingRow>
      <SettingRow title="Реакция на обложку" hint="Фон подстраивается под цвет трека (позже)">
        <Switch checked={false} disabled label="Реакция на обложку" />
      </SettingRow>

      <GroupTitle>Поведение</GroupTitle>
      <SettingRow title="Действие по двойному клику" hint="Что делает даблклик по треку (позже)">
        <RowValue>Играть</RowValue>
      </SettingRow>
      <SettingRow title="Стартовый экран" hint="Что открывается при запуске (позже)">
        <RowValue>Главная</RowValue>
      </SettingRow>

      <GroupTitle>Темы</GroupTitle>
      <SettingRow title="Сохранить как тему" hint="Текущая кастомизация одним файлом (позже)">
        <Button variant="ghost" icon="save" disabled>
          Сохранить
        </Button>
      </SettingRow>
      <SettingRow title="Маркетплейс тем" hint="Ставить и делиться — витрина уже смотрится" onClick={() => openMarket("Темы")} chevron></SettingRow>

      <GroupTitle>CSS-тир</GroupTitle>
      <SettingRow title="Свой CSS" hint="Опасная зона: сниппеты и переопределение токенов (Stage 6)" chevron>
        <RowValue>Выкл</RowValue>
      </SettingRow>

      <div style={{ marginTop: "var(--sp-2)" }}>
        <Button
          variant="ghost"
          icon="rotate-ccw"
          onClick={() =>
            set({
              accent: DEFAULT_PREFS.accent,
              radius: DEFAULT_PREFS.radius,
              bgCover: DEFAULT_PREFS.bgCover,
              blur: DEFAULT_PREFS.blur,
              glassOpacity: DEFAULT_PREFS.glassOpacity,
              anims: DEFAULT_PREFS.anims,
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
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <ChipGroup items={["Всё", "Темы", "Плагины"]} value={marketFilter} onChange={setMarketFilter} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
        {MARKET_ITEMS.filter(
          (m) => marketFilter === "Всё" || (marketFilter === "Темы" ? m.kind === "theme" : m.kind === "plugin"),
        ).map((m) => (
          <MarketCard key={m.name} item={m} />
        ))}
      </div>
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
        Витрина-макет: установка, подпись и capability-права придут в Stage 6.
      </div>
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
        <SettingRow title="Email" hint="Для восстановления пароля (позже — смена из приложения)">
          <RowValue>указан при регистрации</RowValue>
        </SettingRow>
        <SettingRow title="Сменить пароль" hint="Появится вместе с восстановлением" chevron></SettingRow>
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
        <SettingRow title="Выгрузить или удалить данные" hint="Появится к релизу (Stage 4)" danger chevron></SettingRow>
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
        <SettingRow title="Фон" hint="Цвет, градиент, картинка, из обложки (позже — больше типов)">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
            <RowValue>Из обложки</RowValue>
            <Switch checked={prefs.bgCover} onChange={(bgCover: boolean) => set({ bgCover })} label="Фон из обложки" />
          </div>
        </SettingRow>
        <SettingRow title="Масштаб интерфейса" hint="Появится позже">
          <DisabledSlider value={100} max={150} label="Масштаб интерфейса" />
        </SettingRow>
        <SettingRow title="Кастомизация" hint="Редактор темы: слои, форма, типографика, темы, CSS" onClick={() => setSub("customize")} chevron></SettingRow>
      </div>
    ) : tab === "playback" ? (
      <div key="playback" className={paneClass} style={paneStyle}>
        <GroupTitle>Переходы</GroupTitle>
        <SettingRow title="Кроссфейд" hint="Плавный переход между треками (4 секунды)">
          <Switch checked={prefs.crossfade} onChange={(v: boolean) => set({ crossfade: v })} label="Кроссфейд" />
        </SettingRow>
        <SettingRow title="Gapless" hint="Треки альбома без паузы (Stage 3)">
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
        <SettingRow title="Конец очереди" hint="Что играть, когда очередь кончилась (Stage 3)">
          <RowValue>Похожее</RowValue>
        </SettingRow>
        <SettingRow title="Запоминать позицию трека" hint="Продолжать с места остановки (Stage 3)">
          <Switch checked disabled label="Запоминать позицию" />
        </SettingRow>
        <GroupTitle>Стрим</GroupTitle>
        <SettingRow title="Качество стрима" hint="Максимум или эконом (Stage 3)">
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
        <SettingRow title="Что предпочитать" hint="Официальное · любое лучшее · всегда спрашивать (Stage 3)">
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
        <SettingRow title="Bandcamp" hint="Появится позже">
          <Switch checked={false} disabled label="Bandcamp" />
        </SettingRow>
        <GroupTitle>Поиск</GroupTitle>
        <SettingRow title="Где искать" hint="Каталог, источники, локальное (позже)">
          <RowValue>Везде</RowValue>
        </SettingRow>
        <SettingRow title="Мгновенный поиск" hint="Каталог при вводе, источники — по Enter">
          <Switch checked disabled label="Мгновенный поиск" />
        </SettingRow>
        <SettingRow title="Прямые и локальные источники" hint="Папки и добавленное по ссылке (Stage 3–4)" chevron></SettingRow>
      </div>
    ) : tab === "lyrics" ? (
      <div key="lyrics" className={paneClass} style={paneStyle}>
        <GroupTitle>Отображение</GroupTitle>
        <SettingRow title="Синхро-текст" hint="Караоке-строки в такт (Stage 3)">
          <Switch checked disabled label="Синхро-текст" />
        </SettingRow>
        <SettingRow title="Автоскролл" hint="Следовать за текущей строкой (Stage 3)">
          <Switch checked disabled label="Автоскролл" />
        </SettingRow>
        <SettingRow title="Размер караоке-текста" hint="Настройка в Кастомизации (Stage 3)">
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
        <SettingRow title="Discord Rich Presence" hint="Статус, шаблоны строк, предпросмотр (Stage 3)" onClick={() => setSub("discord")} chevron>
          <RowValue>Выкл</RowValue>
        </SettingRow>
        <SettingRow title="Скробблинг Last.fm" hint="Подключение аккаунта (Stage 3)" chevron>
          <RowValue>Не подключён</RowValue>
        </SettingRow>
        <SettingRow title="Скробблинг ListenBrainz" hint="Подключение аккаунта (Stage 3)" chevron>
          <RowValue>Не подключён</RowValue>
        </SettingRow>
        <SettingRow title="Медиаклавиши" hint="Play/Pause/Next с клавиатуры (Stage 3)">
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
        <SettingRow title="Плагины" hint="Capability-права, ревью, подпись (Stage 6)">
          <RowValue>0 установлено</RowValue>
        </SettingRow>
        <SettingRow title="Маркетплейс плагинов" hint="Каталог расширений — витрина уже смотрится" onClick={() => openMarket("Плагины")} chevron></SettingRow>
        <SettingRow title="Маркетплейс тем" hint="Ставить и делиться темами — витрина уже смотрится" onClick={() => openMarket("Темы")} chevron></SettingRow>
        <SettingRow title="Установить из файла" hint="Для разработчиков (Stage 6)">
          <Button variant="ghost" icon="folder-open" disabled>
            Выбрать файл
          </Button>
        </SettingRow>
      </div>
    ) : (
      <div key="system" className={paneClass} style={paneStyle}>
        <SettingRow title="Запускать при старте Windows" hint="Появится с системной интеграцией (Stage 4)">
          <Switch checked={prefs.autostart} disabled label="Автозапуск" />
        </SettingRow>
        <SettingRow title="Сворачивать в трей" hint="Появится с системной интеграцией (Stage 4)">
          <Switch checked={prefs.tray} disabled label="Трей" />
        </SettingRow>
        <SettingRow title="При закрытии окна" hint="Сворачивать или выходить (Stage 4)">
          <RowValue>Сворачивать</RowValue>
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
    </div>
  );
}
