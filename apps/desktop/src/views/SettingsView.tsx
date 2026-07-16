import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge, Button, ChipGroup, ColorPicker, Dialog, Fader, Icon, IconButton, Kbd, Select, Slider, Switch, Tabs } from "@muza/ui";
import { ApiError, type MarketPlugin, type MarketTheme, type MuzaApi, type RecsSettings, type ScrobblingStatus, type SessionInfo } from "@muza/api-client";
import { DEFAULT_PREFS, RADIUS_OVERRIDE_OFF, type BarButtonKey, type NavItemKey, type Prefs, type StatsBlockKey } from "../types";
import { useT, type TParams, type TranslationKey } from "../i18n";
import { normalizeStatsBlocks, statsBlockLabel } from "../lib/statsBlocks";
import { barButtonLabel, normalizeBarButtons } from "../lib/barButtons";
import { VIS_LIMITS } from "../shell/visualizerMath";
import { activeVisPreset, BAR_PRESETS, WAVE_PRESETS } from "../lib/visualizerPresets";
import { NAV_ITEM_META, navItemLabel, normalizeNavItems } from "../lib/navItems";
import { isPluginKey, parsePluginKey, pluginSlotKey } from "../lib/pluginSlots";
import { isFullAccessManifest, PERMISSION_INFO, type PluginPermission } from "@muza/core";
import {
  cancelInstall,
  finalizeInstall,
  listInstalled,
  pickAndStagePlugin,
  setPluginEnabled,
  stagePluginFromMarket,
  uninstallPlugin,
  type StagedPlugin,
} from "../plugins/install";
import { fullAccessHost } from "../plugins/fullAccessHost";
import type { InstalledPluginInfo } from "../plugins/types";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { cacheClear, cacheStats, engineAvailable, type CacheStats } from "../lib/engine";
import { formatTemplate, rpcAvailable } from "../lib/discord";
import { openExternal } from "../lib/system";
import { checkForUpdate, updaterAvailable, type FoundUpdate } from "../lib/updater";
import {
  comboFromEvent,
  DEFAULT_HOTKEYS,
  formatCombo,
  HOTKEY_ACTIONS,
  hotkeyActionLabel,
  type HotkeyAction,
} from "../lib/hotkeys";
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

/** Функция перевода — тип совпадает с useT().t; передаётся параметром в
 *  свободные (module-level) функции без доступа к React-контексту. */
type T = (key: TranslationKey, params?: TParams) => string;

/** Демо-значения для предпросмотра шаблонов Discord-активности. */
function discordPreviewVars(t: T) {
  return { track: t("settings.integrations.discord.preview.track"), artist: t("settings.integrations.discord.preview.artist"), album: t("settings.integrations.discord.preview.album") };
}

/** Человеческое имя устройства из user-agent (грубая эвристика для списка сессий). */
function deviceLabel(ua: string | null, t: T): string {
  if (!ua) return t("settings.account.sessions.unknownDevice");
  const low = ua.toLowerCase();
  const os = low.includes("windows")
    ? "Windows"
    : low.includes("android")
      ? "Android"
      : low.includes("iphone") || low.includes("ipad")
        ? "iOS"
        : low.includes("mac")
          ? "macOS"
          : low.includes("linux")
            ? "Linux"
            : t("settings.account.sessions.genericDevice");
  const app = low.includes("muza") || low.includes("tauri") ? "Muza" : t("settings.account.sessions.browser");
  return `${os} · ${app}`;
}

/* Структура и состав — docs/notes/2026-07-10-настройки-спецификация.md:
   11 вкладок-разделов; «Внешний вид» = простые (пресеты) + под-экран
   «Кастомизация» (редактор темы). Тяжёлые пункты — отдельные под-экраны
   (Кастомизация, Эквалайзер, Discord RPC), не строки. Живое управляет prefs
   (CSS-переменные в App), остальное — визуальный макет: disabled-заглушки
   с честным этапом. */

function SettingRow({
  title,
  titleExtra,
  hint,
  onClick,
  chevron,
  danger,
  children,
}: {
  title: string;
  /** Доп. узел справа от заголовка — бейджи и т.п. (T44b: «Полный доступ»). */
  titleExtra?: React.ReactNode;
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
        // T6: на сильном скруглении (radiusTiles до 200%) контролы у правого
        // края (Switch/кнопки) своим прямоугольным боксом вылезали за
        // скруглённый силуэт плашки — border-radius родителя не клипает детей
        // сам по себе. Клип, не запас padding: фокус-кольца/тени контролов
        // остаются внутри padding var(--sp-4/5), проверено живьём на 200%.
        overflow: "hidden",
        background: onClick && hover ? "var(--surface-3)" : "var(--surface-2)",
        cursor: onClick ? "pointer" : "default",
        fontFamily: "var(--font-ui)",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <div style={{ fontSize: "var(--fs-body)", fontWeight: 500, color: danger ? "var(--danger)" : "var(--text-1)" }}>{title}</div>
          {titleExtra}
        </div>
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

/** Строка-ползунок визуализатора (T50): диапазон приезжает из VIS_LIMITS
 *  (единая точка правды с рендером и пресетами) — настройки не хранят
 *  собственных границ и не могут с ним разъехаться. */
function VisSliderRow({
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
  const { t } = useT();
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
        .catch(() => onNotify(t("settings.playback.recs.saveFailed"), "x"));
    }, 600);
  };

  if (!enabled || s === null) {
    return (
      <SettingRow title={t("settings.playback.recs.title")} hint={enabled ? t("common.loading") : t("settings.playback.recs.needsAccount")}>
        <DisabledSlider value={30} max={100} label={t("settings.playback.recs.title")} />
      </SettingRow>
    );
  }

  // τ-шкала геометрическая: линейный слайдер зажимал бы «чаще» в первых 20%
  const tauPos = Math.round((Math.log(s.tauScale / s.tauScaleMin) / Math.log(s.tauScaleMax / s.tauScaleMin)) * 100);
  const tauFromPos = (v: number) =>
    Math.round(s.tauScaleMin * Math.pow(s.tauScaleMax / s.tauScaleMin, v / 100) * 100) / 100;

  return (
    <>
      <SettingRow title={t("settings.playback.recs.novelty.title")} hint={t("settings.playback.recs.novelty.hint")}>
        <LiveSlider
          value={Math.round(s.epsilon * 100)}
          max={Math.round(s.epsilonMax * 100)}
          label={t("settings.playback.recs.novelty.title")}
          suffix={`${Math.round(s.epsilon * 100)} %`}
          onChange={(v) => {
            const epsilon = Math.round(v) / 100;
            setS({ ...s, epsilon });
            push({ epsilon });
          }}
        />
      </SettingRow>
      <SettingRow title={t("settings.playback.recs.repeats.title")} hint={t("settings.playback.recs.repeats.hint")}>
        <LiveSlider
          value={tauPos}
          max={100}
          label={t("settings.playback.recs.repeats.title")}
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

/** Строка переназначения хоткея: клик по плашке → режим захвата (ловит
 *  следующую клавишу по e.code), Esc отменяет, конфликт подсвечен. */
function HotkeyRow({
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
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer",
          outline: conflict ? "1px solid var(--danger)" : "none",
          transition: "background var(--dur-fast) var(--ease-out)",
        }}
      >
        {capturing ? t("settings.hotkeys.pressKey") : formatCombo(combo)}
      </button>
    </SettingRow>
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
      <SettingInput value={raw} onChange={setRaw} width={200} />
      {suffix ? (
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", flex: "none" }}>{suffix}</span>
      ) : null}
      <Button variant="ghost" icon="check" onClick={apply}>
        {t("common.apply")}
      </Button>
    </div>
  );
}

/** Свотч «свой цвет»: нативный пикер, замаскированный под кружок с пипеткой. */
/** Свотч «свой акцент» — теперь тонкая обёртка над ДС ColorPicker
 *  (компонент родился здесь и уехал в дизайн-систему). */
function CustomAccentSwatch({
  color,
  selected,
  onPick,
}: {
  color: string;
  selected: boolean;
  onPick: (hex: string) => void;
}) {
  const { t } = useT();
  return <ColorPicker value={color} selected={selected} size={44} label={t("settings.appearance.accent.customLabel")} onChange={onPick} />;
}

/** Цветовая точка фона — тоже ДС ColorPicker. */
function ColorDot({ color, label, onPick }: { color: string; label: string; onPick: (hex: string) => void }) {
  return <ColorPicker value={color} size={36} label={label} onChange={onPick} />;
}

/** Карточка темы маркетплейса (Stage 6): превью из payload + живая установка. */
function MarketThemeCard({
  theme,
  onInstall,
  onRemove,
  onReport,
}: {
  theme: MarketTheme;
  onInstall: () => void;
  onRemove?: () => void;
  onReport?: () => void;
}) {
  const { t } = useT();
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
          {theme.author} · {t("settings.market.installsCount", { n: theme.installs })}
          {hasCss ? ` · ${t("settings.market.hasCss")}` : ""}
          {theme.hidden ? <span style={{ color: "var(--danger)" }}> · {t("settings.market.hiddenByModeration")}</span> : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <Button variant="secondary" icon="download" onClick={onInstall}>
          {t("common.install")}
        </Button>
        {onRemove ? <IconButton icon="trash-2" label={t("settings.market.unpublish")} onClick={onRemove} /> : null}
        {onReport ? <IconButton icon="flag" label={t("settings.market.report")} onClick={onReport} /> : null}
      </div>
    </div>
  );
}

/** Карточка плагина маркетплейса (T45b): бейджи «Полный доступ»/«На
 *  модерации», установка через рантайм T44/T44b (стейджинг из данных →
 *  тот же экран согласия, что и установка из файла), report + hide/approve
 *  для админа. */
function MarketPluginCard({
  item,
  isAdmin,
  installing,
  onInstall,
  onRemove,
  onReport,
  onHideToggle,
  onApprove,
}: {
  item: MarketPlugin;
  isAdmin: boolean;
  installing: boolean;
  onInstall: () => void;
  onRemove?: () => void;
  onReport?: () => void;
  onHideToggle?: () => void;
  onApprove?: () => void;
}) {
  const { t } = useT();
  const manifest = (item.payload as { manifest?: { description?: string } }).manifest;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", padding: "var(--sp-4)", borderRadius: "var(--r-md)", background: "var(--surface-2)" }}>
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
        <Icon name="puzzle" size={28} color="var(--accent-text)" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-1)" }}>{item.name}</span>
          {item.fullAccess ? (
            <Badge tone="accent" style={{ background: "color-mix(in srgb, var(--danger) 22%, transparent)", color: "var(--danger)" }}>
              {t("settings.extensions.fullAccessBadge")}
            </Badge>
          ) : null}
          {item.pending ? <Badge tone="neutral">{t("settings.market.pendingBadge")}</Badge> : null}
        </div>
        {manifest?.description ? (
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: 2, lineHeight: 1.5 }}>{manifest.description}</div>
        ) : null}
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
          {item.author} · v{item.version} · {t("settings.market.installsCount", { n: item.installs })}
          {item.hidden ? <span style={{ color: "var(--danger)" }}> · {t("settings.market.hiddenByModerationShort")}</span> : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
        <Button variant="secondary" icon="download" disabled={installing} onClick={onInstall}>
          {installing ? t("settings.market.installing") : t("common.install")}
        </Button>
        {onRemove ? <IconButton icon="trash-2" label={t("settings.market.unpublish")} onClick={onRemove} /> : null}
        {onReport ? <IconButton icon="flag" label={t("settings.market.report")} onClick={onReport} /> : null}
        {isAdmin && onHideToggle ? (
          <IconButton
            icon={item.hidden ? "eye" : "eye-off"}
            label={item.hidden ? t("settings.market.unhide") : t("settings.market.hide")}
            onClick={onHideToggle}
          />
        ) : null}
        {isAdmin && item.pending && onApprove ? (
          <Button variant="primary" icon="check" onClick={onApprove}>
            {t("settings.market.approve")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Шапка под-экрана: назад + заголовок. */
function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
      <IconButton icon="arrow-left" label={t("common.back")} onClick={onBack} />
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

/** Потолок силы качания (T48), % от базовой амплитуды T14: 300% — заметная
 *  тряска, дальше начинается морская болезнь, а не музыка. */
const BASS_STRENGTH_MAX = 300;

const paneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-3)",
  paddingBottom: "var(--sp-6)",
};

/** Ключи разделов настроек — порядок массива = порядок пунктов навигации.
 *  Подписи НЕ хранятся здесь (модуль верхнего уровня не имеет доступа к
 *  useT()) — берутся в компоненте из словаря по `settings.tabs.<key>`
 *  (T28, i18n): ключи этого массива буквально совпадают с ключами словаря,
 *  см. i18n/en.ts. «О приложении» — секция внутри Системы, не свой раздел. */
const SETTINGS_TAB_KEYS = [
  "account",
  "appearance",
  "playback",
  "sources",
  "lyrics",
  "library",
  "integrations",
  "hotkeys",
  "extensions",
  "system",
] as const;

type SettingsTabKey = (typeof SETTINGS_TAB_KEYS)[number];

/** Иконка раздела (lucide, kebab-case). Нужна схлопнутому рельсу: на узкой
 *  панели подписи прячутся и иконка остаётся единственной приметой раздела —
 *  поэтому берём те, что уже что-то значат в этом же приложении (paintbrush —
 *  темы, puzzle — плагины, library-big — «Библиотека» в сайдбаре).
 *  Record<> по ключам массива: добавили раздел — TS потребует иконку. */
const SETTINGS_TAB_ICONS: Record<SettingsTabKey, string> = {
  account: "user",
  appearance: "paintbrush",
  playback: "play",
  sources: "globe",
  lyrics: "mic-vocal",
  library: "library-big",
  integrations: "plug",
  hotkeys: "keyboard",
  extensions: "puzzle",
  system: "monitor-cog",
};

/** id пункта навигации — на него ссылается aria-labelledby панели. */
const navItemId = (key: string) => `muza-settings-nav-${key}`;
/** id панели — на него ссылается aria-controls пунктов навигации. */
const SETTINGS_PANE_ID = "muza-settings-pane";

/** Вертикальная навигация по разделам настроек (левая колонка каркаса).
 *
 *  role=tablist, а не список ссылок: выбор раздела мгновенно меняет соседнюю
 *  панель и никуда не «уходит» (ни маршрута, ни истории) — это ровно
 *  tab/tabpanel. Тот же набор ролей, что у Tabs из @muza/ui, плюс то, чего
 *  Tabs не даёт: aria-orientation=vertical и связка aria-controls ↔
 *  aria-labelledby с панелью. Роving tabindex со стрелками намеренно нет —
 *  все пункты достижимы Tab'ом, как и сегменты Tabs по всему приложению.
 *
 *  Вид (в т.ч. схлопывание в рельс на узкой панели) — в app.css,
 *  .muza-settings-nav; активный пункт стилизуется по aria-selected, чтобы
 *  доступность и подсветка не разъехались. */
function SettingsNav({ value, onChange }: { value: string; onChange: (key: SettingsTabKey) => void }) {
  const { t } = useT();
  return (
    <nav
      className="muza-settings-nav"
      role="tablist"
      aria-orientation="vertical"
      aria-label={t("settings.title")}
    >
      {/* Заголовок экрана — шапка этой же плашки (не сосед сетки снаружи):
          так он выровнен по левому краю с подписями пунктов. В рельсе
          прячется по @container, aria-label выше его дублирует. */}
      <h1 className="muza-settings-nav__title">{t("settings.title")}</h1>
      {SETTINGS_TAB_KEYS.map((key) => {
        const label = t(`settings.tabs.${key}`);
        return (
          <button
            key={key}
            id={navItemId(key)}
            type="button"
            role="tab"
            aria-selected={key === value}
            aria-controls={SETTINGS_PANE_ID}
            // Рельс прячет подпись СТИЛЕМ, а не условным рендером (@container
            // из JS не виден), поэтому подпись нужна и машине, и глазу при
            // любой ширине: aria-label — скринридеру, title — курсору (он же
            // спасает, если длинная подпись схлопнулась в многоточие).
            // Тот же приём, что у AccentSwatch выше.
            aria-label={label}
            title={label}
            className="muza-settings-nav__item"
            onClick={() => onChange(key)}
          >
            <Icon name={SETTINGS_TAB_ICONS[key]} size={20} />
            <span className="muza-settings-nav__label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// Хоткеи переназначаемы — определения/дефолты в lib/hotkeys, биндинги в prefs.hotkeys

type Sub =
  | "customize"
  | "equalizer"
  | "discord"
  | "market"
  | "data"
  | "stats"
  | "licenses"
  | "bar"
  | "nav"
  | "sessions"
  | "privacy"
  | null;

/** Открытый код внутри клиента: id (→ имя из словаря) · лицензия · сайт
 *  (под-экран «Лицензии»). id — стабильный ключ словаря `settings.system.licenses.items.*`,
 *  не переводится (не показывается пользователю напрямую). */
type LicenseId =
  | "react"
  | "tauri"
  | "vite"
  | "typescript"
  | "lucide"
  | "golosText"
  | "unbounded"
  | "zod"
  | "ytdlp"
  | "deno"
  | "serde"
  | "ed25519Dalek"
  | "lofty"
  | "vitest";
const OSS_LICENSES: { id: LicenseId; license: string; url: string }[] = [
  { id: "react", license: "MIT", url: "https://react.dev" },
  { id: "tauri", license: "MIT / Apache-2.0", url: "https://tauri.app" },
  { id: "vite", license: "MIT", url: "https://vite.dev" },
  { id: "typescript", license: "Apache-2.0", url: "https://www.typescriptlang.org" },
  { id: "lucide", license: "ISC", url: "https://lucide.dev" },
  { id: "golosText", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Golos+Text" },
  { id: "unbounded", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Unbounded" },
  { id: "zod", license: "MIT", url: "https://zod.dev" },
  { id: "ytdlp", license: "Unlicense", url: "https://github.com/yt-dlp/yt-dlp" },
  { id: "deno", license: "MIT", url: "https://deno.com" },
  { id: "serde", license: "MIT / Apache-2.0", url: "https://serde.rs" },
  { id: "ed25519Dalek", license: "BSD-3-Clause", url: "https://github.com/dalek-cryptography/curve25519-dalek" },
  { id: "lofty", license: "MIT / Apache-2.0", url: "https://github.com/Serial-ATA/lofty-rs" },
  { id: "vitest", license: "MIT", url: "https://vitest.dev" },
];

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
  stats: "library",
  licenses: "system",
  bar: "appearance",
  nav: "appearance",
  sessions: "account",
  privacy: "account",
};

/** Полосы эквалайзера (десятиполосник) в Гц + пресеты. Значения в дБ (−12..+12).
 *  Частоты — числа (не строки): подпись «1к»/«1k» собирается форматтером
 *  `eqBandLabel` через словарь, а не хардкодится с языко-зависимой буквой. */
const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
/** Подпись частоты полосы эквалайзера: до 1 кГц — как есть, дальше «1k»/«1к» и т.п. */
function eqBandLabel(hz: number, t: T): string {
  return hz >= 1000 ? `${hz / 1000}${t("settings.playback.equalizer.kiloSuffix")}` : `${hz}`;
}
/** ВАЖНО: ключи EQ_PRESETS (рус. слова) — это ПЕРСИСТЕНТНЫЕ значения prefs.eqPreset,
 *  разделяемые с DEFAULT_PREFS.eqPreset (types.ts) и веб-клиентом (apps/web) —
 *  вне зоны этой правки (T29/T30: только SettingsView.tsx + i18n), переименование
 *  сломало бы совместимость с уже сохранёнными prefs и требует правок в types.ts
 *  и apps/web. Сознательно НЕ переведено — см. отчёт T29/T30. */
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
  isAdmin,
  onLogout,
  onNotify,
  onOpenHotkeys,
  onPluginsChanged,
  intent,
}: {
  api: MuzaApi;
  /** false у анонима: серверные функции аккаунта (смена пароля) недоступны. */
  serverSession: boolean;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  username: string;
  /** T45b: показывает hide/approve на карточках маркетплейса плагинов. */
  isAdmin?: boolean;
  onLogout: () => void;
  onNotify: (text: string, icon?: string) => void;
  /** T9: строка «Помощь / закрыть» кликабельна — открывает диалог горячих клавиш (App). */
  onOpenHotkeys: () => void;
  /** T45b-fix: installed.json изменился (установка/toggle/удаление плагина) —
   *  дёргает usePlugins.refresh() в Player, чтобы уровень-1 плагин ожил
   *  (слоты/iframe) БЕЗ перезагрузки приложения. См. docs/notes про gap T45b. */
  onPluginsChanged?: () => void;
  intent?: SettingsIntent | null;
}) {
  const { t, lang } = useT();
  const [tab, setTab] = useState("appearance");
  const [sub, setSub] = useState<Sub>(null);

  // Плагины уровня 1 (T44) + «Полный доступ» (T44b): установленные + мастер
  // установки из файла
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginInfo[]>([]);
  // T45b-fix: обновляет и локальный список (эта вкладка), и рантайм usePlugins
  // в Player (App.tsx) — иначе новый/переключённый L1-плагин не оживал бы
  // (не появлялся в слотах/iframe) до перезагрузки приложения.
  const refreshPlugins = () => {
    void listInstalled().then(setInstalledPlugins).catch(() => setInstalledPlugins([]));
    onPluginsChanged?.();
  };
  useEffect(() => {
    refreshPlugins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [staged, setStaged] = useState<StagedPlugin | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const startInstall = async () => {
    setInstallBusy(true);
    try {
      const s = await pickAndStagePlugin(lang);
      if (s) setStaged(s); // откроется модалка согласия
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("settings.extensions.errors.readFailed"), "x");
    } finally {
      setInstallBusy(false);
    }
  };
  // T44b: громкий экран согласия для app:full-access — чекбокс + задержка
  // кнопки (несколько секунд, чтобы не кликнули на автомате), кнопка отказа
  // остаётся дефолтным фокусом Dialog (первая в actions). Сбрасывается на
  // каждый новый staged (новый выбор файла/повтор согласия при апгрейде —
  // finalizeInstall/plugin_finalize_install переустанавливает целиком, так
  // что «апгрейд до full-access» — это тот же путь установки заново).
  const FULL_ACCESS_DELAY_SEC = 5;
  const [fullAccessAck, setFullAccessAck] = useState(false);
  const [fullAccessRemaining, setFullAccessRemaining] = useState(FULL_ACCESS_DELAY_SEC);
  useEffect(() => {
    if (!staged || !isFullAccessManifest(staged.manifest)) return;
    setFullAccessAck(false);
    setFullAccessRemaining(FULL_ACCESS_DELAY_SEC);
    const iv = setInterval(() => setFullAccessRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged]);
  const fullAccessBlocked = (m: StagedPlugin["manifest"]) =>
    isFullAccessManifest(m) && (!fullAccessAck || fullAccessRemaining > 0);
  const confirmInstall = async () => {
    if (!staged) return;
    // Дублирует disabled на кнопке ниже (программный вызов/гонка) — то же
    // рассуждение, что и в plugins.rs::plugin_finalize_install: не доверяем
    // одному только disabled в разметке.
    if (fullAccessBlocked(staged.manifest)) return;
    try {
      await finalizeInstall(staged, staged.manifest.permissions);
      onNotify(t("settings.extensions.pluginInstalled", { name: staged.manifest.name }), "puzzle");
      setStaged(null);
      refreshPlugins();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("settings.extensions.errors.installFailed"), "x");
    }
  };
  const declineInstall = () => {
    if (staged) void cancelInstall(staged);
    setStaged(null);
  };
  // T44b: выключение full-access-плагина не выгружает уже исполненный код
  // (realm не умеет — §5.3 дока) — предлагаем рестарт сразу после toggle off.
  const [restartPromptName, setRestartPromptName] = useState<string | null>(null);
  const togglePlugin = async (id: string, on: boolean) => {
    try {
      await setPluginEnabled(id, on);
      if (!on) {
        const p = installedPlugins.find((pl) => pl.id === id);
        if (p && isFullAccessManifest(p.manifest)) setRestartPromptName(p.manifest.name);
      }
      refreshPlugins();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("settings.extensions.errors.toggleFailed"), "x");
    }
  };
  const removePlugin = async (id: string, name: string) => {
    try {
      await uninstallPlugin(id);
      onNotify(t("settings.extensions.pluginRemoved", { name }), "trash-2");
      refreshPlugins();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("settings.extensions.errors.removeFailed"), "x");
    }
  };
  // T44b: хост-реестр ошибок full-access-плагинов (репорт из try/catch
  // IIFE в plugins.rs::build_full_access_script + ошибки самого invoke).
  const fullAccessErrorsVersion = useSyncExternalStore(
    (cb) => fullAccessHost.subscribe(cb),
    () => fullAccessHost.runtimeVersion(),
  );
  void fullAccessErrorsVersion;
  const fullAccessErrors = fullAccessHost.getErrors();
  // Валидные плагинные ключи композиции (только включённые уровень-1 плагины)
  const enabledLevel1 = installedPlugins.filter((p) => p.enabled && !isFullAccessManifest(p.manifest));
  const pluginBarKeys = enabledLevel1.flatMap((p) =>
    (p.manifest.contributes?.barButtons ?? []).map((b) => pluginSlotKey(p.id, b.id)),
  );
  const pluginNavKeys = enabledLevel1.flatMap((p) =>
    (p.manifest.contributes?.navItems ?? []).map((n) => pluginSlotKey(p.id, n.id)),
  );
  // Мета для строк композиции: родной ключ → *_META, плагинный → contributes
  const barMeta = (key: string): { label: string; hint: string } => {
    if (isPluginKey(key)) {
      const pk = parsePluginKey(key);
      const pl = installedPlugins.find((p) => p.id === pk?.pluginId);
      const item = pl?.manifest.contributes?.barButtons?.find((b) => b.id === pk?.slotId);
      return {
        label: item?.title ?? t("settings.appearance.plugin.genericLabel"),
        hint: pl ? t("settings.appearance.plugin.hint", { name: pl.manifest.name }) : t("settings.appearance.plugin.genericLabel"),
      };
    }
    return barButtonLabel(key as BarButtonKey, lang);
  };
  const navMeta = (key: string): { label: string; icon: string } => {
    if (isPluginKey(key)) {
      const pk = parsePluginKey(key);
      const pl = installedPlugins.find((p) => p.id === pk?.pluginId);
      const item = pl?.manifest.contributes?.navItems?.find((n) => n.id === pk?.slotId);
      return { label: item?.title ?? t("settings.appearance.plugin.genericLabel"), icon: item?.icon ?? "puzzle" };
    }
    return { label: navItemLabel(key as NavItemKey, lang), icon: NAV_ITEM_META[key as NavItemKey].icon };
  };

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
      setPwdErr(t("settings.account.password.errors.tooShort"));
      return;
    }
    if (pwdNew !== pwdRepeat) {
      setPwdErr(t("settings.account.password.errors.mismatch"));
      return;
    }
    setPwdBusy(true);
    setPwdErr(null);
    try {
      await api.changePassword(pwdCur, pwdNew);
      setPwdOpen(false);
      onNotify(t("settings.account.password.changed"), "shield-check");
    } catch (e) {
      setPwdErr(e instanceof ApiError ? e.message : t("settings.account.password.errors.changeFailed"));
    } finally {
      setPwdBusy(false);
    }
  };

  // Смена почты (волна C1): пароль + новая почта → письмо на новый адрес
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailPwd, setEmailPwd] = useState("");
  const [emailNew, setEmailNew] = useState("");
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  // T3: dev-фолбэк сервера (SMTP выключен) — письмо реально не уходит,
  // но сервер отдаёт ссылку подтверждения в ответе; без этого её негде
  // увидеть кроме серверного лога.
  const [emailConfirmUrl, setEmailConfirmUrl] = useState<string | null>(null);
  const openEmailChange = () => {
    setEmailPwd("");
    setEmailNew("");
    setEmailErr(null);
    setEmailConfirmUrl(null);
    setEmailOpen(true);
  };
  const closeEmailChange = () => {
    setEmailOpen(false);
    setEmailConfirmUrl(null);
  };
  const submitEmailChange = async () => {
    if (!emailNew.includes("@")) {
      setEmailErr(t("settings.account.email.errors.notAnEmail"));
      return;
    }
    setEmailBusy(true);
    setEmailErr(null);
    try {
      const { confirmUrl } = await api.changeEmail(emailPwd, emailNew.trim());
      if (confirmUrl) {
        // Dev: реальной отправки не было — держим диалог открытым со ссылкой
        setEmailConfirmUrl(confirmUrl);
      } else {
        setEmailOpen(false);
        onNotify(t("settings.account.email.sent"), "mail");
      }
    } catch (e) {
      // generic-текст + деталь от сервера (429 rate-limit / 502 SMTP / занятая
      // почта и т.п.), когда она есть — иначе просто generic
      const detail = e instanceof ApiError ? e.message : null;
      setEmailErr(detail ? t("settings.account.email.errors.sendFailedDetail", { detail }) : t("settings.account.email.errors.sendFailed"));
    } finally {
      setEmailBusy(false);
    }
  };

  // Сессии и устройства (волна C2)
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  useEffect(() => {
    if (sub !== "sessions" || !serverSession) return;
    let alive = true;
    api
      .listSessions()
      .then((s) => {
        if (alive) setSessions(s);
      })
      .catch(() => {
        if (alive) setSessions([]);
      });
    return () => {
      alive = false;
    };
  }, [sub, serverSession, api]);
  const revokeSession = async (id: string) => {
    try {
      await api.revokeSession(id);
      setSessions((list) => list?.filter((s) => s.id !== id) ?? list);
      onNotify(t("settings.account.sessions.revoked"), "shield-check");
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : t("settings.account.sessions.errors.revokeFailed"), "x");
    }
  };

  // Выгрузка/удаление данных (волна C3)
  const [exportBusy, setExportBusy] = useState(false);
  const doExport = async () => {
    setExportBusy(true);
    try {
      const data = await api.exportData();
      const json = JSON.stringify(data, null, 2);
      const name = `muza-export-${new Date().toISOString().slice(0, 10)}.json`;
      if (engineAvailable()) {
        // Tauri: нативный save-диалог + запись через Rust (паттерн ShareDialog);
        // JSON юникодный — base64 через TextEncoder, голый btoa падает на кириллице
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({ defaultPath: name, filters: [{ name: "JSON", extensions: ["json"] }] });
        if (path) {
          const bytes = new TextEncoder().encode(json);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("share_save_file", { path, dataBase64: btoa(binary) });
          onNotify(t("settings.privacy.exported"), "download");
        }
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : t("settings.privacy.errors.exportFailed"), "x");
    } finally {
      setExportBusy(false);
    }
  };
  const [delOpen, setDelOpen] = useState(false);
  const [delPwd, setDelPwd] = useState("");
  const [delErr, setDelErr] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const submitDelete = async () => {
    setDelBusy(true);
    setDelErr(null);
    try {
      await api.deleteAccount(delPwd);
      setDelOpen(false);
      onNotify(t("settings.privacy.accountDeleted"), "trash-2");
      onLogout();
    } catch (e) {
      setDelErr(e instanceof ApiError ? e.message : t("settings.privacy.errors.deleteFailed"));
    } finally {
      setDelBusy(false);
    }
  };

  // Маркетплейс: фильтр витрины (открывается из «Расширений» с нужной категорией).
  // Ключи ("all"/"themes"/"plugins") — эфемерный локальный стейт (не persisted в
  // Prefs), можно использовать английские id + перевод через ChipGroup {key,label}.
  const [marketFilter, setMarketFilter] = useState<"all" | "themes" | "plugins">("all");
  const openMarket = (filter: "themes" | "plugins") => {
    setMarketFilter(filter);
    setSub("market");
  };

  // ── Автообновление (Stage 8): GitHub Releases через tauri-plugin-updater ──
  const [updState, setUpdState] = useState<"idle" | "checking" | "none" | "found" | "installing" | "error">("idle");
  const [updFound, setUpdFound] = useState<FoundUpdate | null>(null);
  const [updPct, setUpdPct] = useState(-1);
  const checkUpdates = async () => {
    setUpdState("checking");
    try {
      const found = await checkForUpdate();
      setUpdFound(found);
      setUpdState(found ? "found" : "none");
    } catch {
      setUpdState("error");
    }
  };
  const installUpdate = async () => {
    if (!updFound) return;
    setUpdState("installing");
    setUpdPct(-1);
    try {
      await updFound.install(setUpdPct); // дальше relaunch — код ниже не выполнится
    } catch {
      setUpdState("error");
      onNotify(t("settings.system.update.errors.installFailed"), "x");
    }
  };

  // Версия в «О приложении»: раньше была хардкодом «0.1.0» и протухла (в бандле
  // уже 0.1.1) — настройки врали. Единственный источник истины — version из
  // tauri.conf.json, его и отдаёт getVersion(). Вне Tauri (vite-превью в
  // браузере) версии бандла не существует: показываем тот же честный appOnly,
  // что и строка автообновления выше, а не выдуманное число. Ошибку глотаем —
  // версия не повод ронять всю панель настроек.
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    getVersion().then(setAppVersion).catch(() => undefined);
  }, []);

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
    onNotify(t("settings.customize.themes.saved"), "save");
  };
  const applySavedTheme = (theme: SavedTheme) => {
    setPrefs(applyTheme(theme.tokens, prefs));
    setCssDraft(typeof theme.tokens.customCss === "string" ? theme.tokens.customCss : "");
    onNotify(t("settings.customize.themes.applied", { name: theme.name }), "paintbrush");
  };
  const removeTheme = (id: string) => {
    deleteTheme(id);
    setThemes(listThemes());
    onNotify(t("settings.customize.themes.removed"), "trash-2");
  };
  const copyTheme = async (theme: SavedTheme) => {
    try {
      await navigator.clipboard.writeText(serializeTheme(theme.name, theme.tokens));
      onNotify(t("settings.customize.themes.copied"), "copy");
    } catch {
      onNotify(t("settings.customize.themes.errors.clipboardUnavailable"), "x");
    }
  };
  const submitImportTheme = () => {
    const parsed = parseTheme(themeImportText);
    if (!parsed) {
      setThemeImportErr(t("settings.customize.themes.errors.notMuzaJson"));
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
    onNotify(t("settings.customize.themes.imported", { name: parsed.name }), "clipboard-paste");
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
      .then((themes) => {
        if (alive) setMarketThemes(themes);
      })
      .catch(() => {
        if (alive) setMarketThemes([]);
      });
    return () => {
      alive = false;
    };
  }, [sub, serverSession, api]);

  const doInstallTheme = async (theme: MarketTheme) => {
    // счётчик — best-effort: сервер лёг, а payload уже у нас
    const installed = await api.installMarketTheme(theme.id).catch(() => null);
    const tokens = sanitizeTokens(installed?.payload ?? theme.payload);
    addTheme(theme.name, tokens);
    setThemes(listThemes());
    const next = applyTheme(tokens, prefs);
    setPrefs(next);
    setCssDraft(next.customCss);
    setMarketThemes((list) => list?.map((x) => (x.id === theme.id ? { ...x, installs: x.installs + 1 } : x)) ?? list);
    onNotify(t("settings.market.themeInstalled", { name: theme.name }), "download");
  };

  const installTheme = async (theme: MarketTheme) => {
    const css = (theme.payload as { customCss?: unknown }).customCss;
    if (typeof css === "string" && css.trim().length > 0) {
      setCssWarnTheme(theme); // CSS может переопределить что угодно — спрашиваем
      return;
    }
    await doInstallTheme(theme);
  };

  const unpublishTheme = async (theme: MarketTheme) => {
    try {
      await api.deleteMarketTheme(theme.id);
      setMarketThemes((list) => list?.filter((x) => x.id !== theme.id) ?? list);
      onNotify(t("settings.market.themeUnpublished"), "trash-2");
    } catch {
      onNotify(t("settings.market.errors.unpublishThemeFailed"), "x");
    }
  };

  const reportTheme = async (theme: MarketTheme) => {
    try {
      await api.reportMarketTheme(theme.id);
      onNotify(t("settings.market.reportSent"), "flag");
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : t("settings.market.errors.reportFailed"), "x");
    }
  };

  const openPublishTheme = () => {
    setPublishName("");
    setPublishErr(null);
    setPublishOpen(true);
  };
  const submitPublishTheme = async () => {
    if (publishName.trim().length < 2) {
      setPublishErr(t("settings.market.errors.nameTooShort"));
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
      onNotify(t("settings.market.themePublished", { name: published.name }), "upload");
    } catch (e) {
      setPublishErr(e instanceof ApiError ? e.message : t("settings.market.errors.publishFailed"));
    } finally {
      setPublishBusy(false);
    }
  };

  // ── Маркетплейс плагинов (T45b): серверный каталог, установка через
  // тот же рантайм-пайплайн T44/T44b (staged → согласие → finalizeInstall) ─
  const [marketPlugins, setMarketPlugins] = useState<MarketPlugin[] | null>(null);
  const [marketPluginInstalling, setMarketPluginInstalling] = useState<string | null>(null);
  useEffect(() => {
    if (sub !== "market" || !serverSession) return;
    let alive = true;
    api
      .getMarketPlugins()
      .then((p) => {
        if (alive) setMarketPlugins(p);
      })
      .catch(() => {
        if (alive) setMarketPlugins([]);
      });
    return () => {
      alive = false;
    };
  }, [sub, serverSession, api]);

  /** Скачивает payload целиком (install = инкремент счётчика + payload) и
   *  стейджит его тем же Rust-путём, что и .muzaplugin — дальше открывается
   *  ОДНА И ТА ЖЕ модалка согласия (staged), full-access получает тот же
   *  громкий экран T44b, без изменений в UI-коде согласия. */
  const installFromMarket = async (m: MarketPlugin) => {
    setMarketPluginInstalling(m.id);
    try {
      const installed = await api.installMarketPlugin(m.id);
      const payload = installed.payload as {
        manifest?: Record<string, unknown>;
        code?: string;
        css?: string;
        strings?: Record<string, string>;
      };
      if (!payload.manifest || typeof payload.code !== "string") {
        throw new Error(t("settings.market.errors.corruptPayload"));
      }
      const s = await stagePluginFromMarket(
        {
          manifest: payload.manifest,
          code: payload.code,
          css: payload.css,
          strings: payload.strings,
        },
        lang,
      );
      setStaged(s); // модалка согласия T44/T44b — confirmInstall/declineInstall уже готовы
      setMarketPlugins((list) => list?.map((x) => (x.id === m.id ? { ...x, installs: x.installs + 1 } : x)) ?? list);
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("settings.market.errors.installPluginFailed"), "x");
    } finally {
      setMarketPluginInstalling(null);
    }
  };

  const unpublishMarketPlugin = async (m: MarketPlugin) => {
    try {
      await api.deleteMarketPlugin(m.id);
      setMarketPlugins((list) => list?.filter((x) => x.id !== m.id) ?? list);
      onNotify(t("settings.market.pluginUnpublished"), "trash-2");
    } catch {
      onNotify(t("settings.market.errors.unpublishPluginFailed"), "x");
    }
  };

  const reportMarketPlugin = async (m: MarketPlugin) => {
    try {
      await api.reportMarketPlugin(m.id);
      onNotify(t("settings.market.reportSent"), "flag");
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : t("settings.market.errors.reportFailed"), "x");
    }
  };

  /** Модерация (админ): скрыть/вернуть — гейтится на видимость в текущем
   *  списке (§5.4 дока: pending/hidden видит только автор — если сервер
   *  когда-нибудь добавит isAdmin-бypass в GET /market/plugins, кнопка
   *  заработает и для чужих скрытых строк без изменений здесь). */
  const toggleHideMarketPlugin = async (m: MarketPlugin) => {
    try {
      await api.hideMarketPlugin(m.id, !m.hidden);
      setMarketPlugins((list) => list?.map((x) => (x.id === m.id ? { ...x, hidden: !x.hidden } : x)) ?? list);
      onNotify(m.hidden ? t("settings.market.pluginUnhidden") : t("settings.market.pluginHidden"), m.hidden ? "eye" : "eye-off");
    } catch {
      onNotify(t("settings.market.errors.visibilityFailed"), "x");
    }
  };

  const approveMarketPluginRow = async (m: MarketPlugin) => {
    try {
      await api.approveMarketPlugin(m.id);
      setMarketPlugins((list) => list?.map((x) => (x.id === m.id ? { ...x, pending: false } : x)) ?? list);
      onNotify(t("settings.market.pluginApproved", { name: m.name }), "check");
    } catch {
      onNotify(t("settings.market.errors.approveFailed"), "x");
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
      onNotify(t("settings.integrations.lastfm.allowInBrowser"), "radio-tower");
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        if (lfmCancelRef.current) return;
        try {
          const { username } = await api.lastfmConnectComplete(token);
          setScrob((s) =>
            s ? { ...s, lastfm: { ...s.lastfm, connected: true, username } } : s,
          );
          onNotify(t("settings.integrations.lastfm.connected", { username }), "radio-tower");
          return;
        } catch (e) {
          // 409 = ещё не нажал «Разрешить» — ждём дальше
          if (!(e instanceof ApiError && e.status === 409)) throw e;
        }
      }
      onNotify(t("settings.integrations.lastfm.errors.timeout"), "x");
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : t("settings.integrations.lastfm.errors.connectFailed"), "x");
    } finally {
      setLfmWaiting(false);
    }
  };

  const lfmDisconnect = async () => {
    try {
      await api.lastfmDisconnect();
      setScrob((s) => (s ? { ...s, lastfm: { ...s.lastfm, connected: false, username: null } } : s));
      onNotify(t("settings.integrations.lastfm.disconnected"), "radio-tower");
    } catch {
      onNotify(t("settings.integrations.lastfm.errors.disconnectFailed"), "x");
    }
  };

  const lbConnect = async () => {
    const token = lbToken.trim();
    if (token.length < 8) {
      setLbErr(t("settings.integrations.listenbrainz.errors.pasteToken"));
      return;
    }
    setLbBusy(true);
    setLbErr(null);
    try {
      const { username } = await api.listenbrainzConnect(token);
      setScrob((s) => (s ? { ...s, listenbrainz: { connected: true, username } } : s));
      setLbOpen(false);
      setLbToken("");
      onNotify(t("settings.integrations.listenbrainz.connected", { username }), "radio-tower");
    } catch (e) {
      setLbErr(e instanceof ApiError ? e.message : t("settings.integrations.listenbrainz.errors.connectFailed"));
    } finally {
      setLbBusy(false);
    }
  };

  const lbDisconnect = async () => {
    try {
      await api.listenbrainzDisconnect();
      setScrob((s) => (s ? { ...s, listenbrainz: { connected: false, username: null } } : s));
      onNotify(t("settings.integrations.listenbrainz.disconnected"), "radio-tower");
    } catch {
      onNotify(t("settings.integrations.listenbrainz.errors.disconnectFailed"), "x");
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

  // Discord RPC (T4): доступен ли Application ID (компайл-тайм client_id
  // в rpc.rs) — честный хинт в под-панели, пока владелец его не пришлёт.
  const [discordAvail, setDiscordAvail] = useState<boolean | null>(null);
  useEffect(() => {
    if (sub === "discord") rpcAvailable().then(setDiscordAvail);
  }, [sub]);
  const fmtGb = (bytes: number) =>
    bytes >= 1024 * 1024 * 1024
      ? t("settings.library.units.gb", { n: (bytes / (1024 * 1024 * 1024)).toFixed(1) })
      : t("settings.library.units.mb", { n: Math.round(bytes / (1024 * 1024)) });
  // Анимация панели — только при переключении вкладки/под-экрана пользователем.
  // Вход в сами настройки анимирует обёртка <main> в App, поэтому первую панель
  // НЕ анимируем. Старый `mounted`-ref был багом: он переключался в true при
  // первом же async-ререндере (загрузка скробблинга/тем/кэша) и добавлял
  // muza-view к уже показанной панели → анимация играла второй раз. Ключ —
  // сравнение с ПЕРВОЙ панелью, устойчивое к async-ререндерам без смены вкладки.
  const paneKey = sub ?? tab;
  const initialPaneKey = useRef(paneKey);
  const switchedRef = useRef(false);
  if (paneKey !== initialPaneKey.current) switchedRef.current = true;
  const paneClass = switchedRef.current ? "muza-view" : undefined;

  const presets = [
    {
      key: "muza",
      name: t("settings.appearance.presets.muza.name"),
      hint: t("settings.appearance.presets.muza.hint"),
      accent: "blue" as const,
      accentColor: "#3b82f6",
      radius: "soft" as const,
    },
    {
      key: "flame",
      name: t("settings.appearance.presets.flame.name"),
      hint: t("settings.appearance.presets.flame.hint"),
      accent: "red" as const,
      accentColor: "#f76967",
      radius: "round" as const,
    },
    {
      key: "graphite",
      name: t("settings.appearance.presets.graphite.name"),
      hint: t("settings.appearance.presets.graphite.hint"),
      accent: "bolt" as const,
      accentColor: "#327ad9",
      radius: "mild" as const,
    },
  ];

  // Текущий hex акцента — им сеются роли акцента при включении
  const currentAccentHex =
    prefs.accent === "custom"
      ? prefs.customAccent
      : (presets.find((p) => p.accent === prefs.accent)?.accentColor ?? "#3b82f6");

  // ── Под-экраны (тяжёлые пункты — не строки) ──────────────────────

  const customizePane = (
    <div key="customize" className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.customize.title")} onBack={() => setSub(null)} />

      <GroupTitle>{t("settings.customize.glass.groupTitle")}</GroupTitle>
      <SettingRow title={t("settings.customize.glass.panelBlur.title")} hint={t("settings.customize.glass.panelBlur.hint")}>
        <LiveSlider
          value={prefs.blur}
          max={64}
          label={t("settings.customize.glass.panelBlur.title")}
          suffix={`${prefs.blur} px`}
          onChange={(v) => set({ blur: Math.round(v) })}
        />
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
      <SettingRow title={t("settings.customize.glass.zones.title")} hint={t("settings.customize.glass.zones.hint")}>
        <Switch checked={prefs.glassZonesOn} onChange={(glassZonesOn: boolean) => set({ glassZonesOn })} label={t("settings.customize.glass.zones.title")} />
      </SettingRow>
      {prefs.glassZonesOn ? (
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
            // включение сеет роли текущим акцентом — WYSIWYG: ничего не мигает,
            // дальше цвета разводятся пикерами
            set(
              on
                ? { accentRolesOn: true, accentPlay: currentAccentHex, accentSlider: currentAccentHex, accentActive: currentAccentHex }
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
          suffix={prefs.radiusControls >= RADIUS_OVERRIDE_OFF ? t("settings.customize.shape.pill") : `${prefs.radiusControls} px`}
          onChange={(v) => set({ radiusControls: Math.round(v) >= 27 ? RADIUS_OVERRIDE_OFF : Math.round(v) })}
        />
      </SettingRow>
      <SettingRow title={t("settings.customize.shape.tabs.title")} hint={t("settings.customize.shape.tabs.hint")}>
        <LiveSlider
          value={prefs.radiusTabs >= RADIUS_OVERRIDE_OFF ? 27 : prefs.radiusTabs}
          max={27}
          label={t("settings.customize.shape.tabs.title")}
          suffix={prefs.radiusTabs >= RADIUS_OVERRIDE_OFF ? t("settings.customize.shape.pill") : `${prefs.radiusTabs} px`}
          onChange={(v) => set({ radiusTabs: Math.round(v) >= 27 ? RADIUS_OVERRIDE_OFF : Math.round(v) })}
        />
      </SettingRow>
      <SettingRow title={t("settings.customize.shape.fields.title")} hint={t("settings.customize.shape.fields.hint")}>
        <LiveSlider
          value={prefs.radiusFields >= RADIUS_OVERRIDE_OFF ? 27 : prefs.radiusFields}
          max={27}
          label={t("settings.customize.shape.fields.title")}
          suffix={prefs.radiusFields >= RADIUS_OVERRIDE_OFF ? t("settings.customize.shape.preset") : `${prefs.radiusFields} px`}
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
      <SettingRow title={t("settings.customize.typography.fontScale.title")} hint={t("settings.customize.typography.fontScale.hint")}>
        <LiveSlider
          value={prefs.fontScale - 85}
          max={40}
          label={t("settings.customize.typography.fontScale.title")}
          suffix={`${prefs.fontScale} %`}
          onChange={(v) => set({ fontScale: 85 + Math.round(v) })}
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
      <SettingRow title={t("settings.customize.typography.karaokeSize.title")} hint={t("settings.customize.typography.karaokeSize.hint")}>
        <LiveSlider
          value={prefs.karaokeSize - 36}
          max={36}
          label={t("settings.customize.typography.karaokeSize.title")}
          suffix={`${prefs.karaokeSize} px`}
          onChange={(v) => set({ karaokeSize: 36 + Math.round(v) })}
        />
      </SettingRow>

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

      <GroupTitle>{t("settings.customize.layout.groupTitle")}</GroupTitle>
      <SettingRow title={t("settings.customize.layout.barButtons.title")} hint={t("settings.customize.layout.barButtons.hint")} onClick={() => setSub("bar")} chevron></SettingRow>
      <SettingRow title={t("settings.customize.layout.navTabs.title")} hint={t("settings.customize.layout.navTabs.hint")} onClick={() => setSub("nav")} chevron></SettingRow>
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
        <SettingRow title={t("settings.customize.background.invert.title")} hint={t("settings.customize.background.invert.hint")}>
          <Switch
            checked={prefs.bgAnimatedInvert}
            onChange={(bgAnimatedInvert: boolean) => set({ bgAnimatedInvert })}
            label={t("settings.customize.background.invert.ariaLabel")}
          />
        </SettingRow>
      ) : null}
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

      <GroupTitle>{t("settings.customize.behavior.groupTitle")}</GroupTitle>
      <SettingRow title={t("settings.customize.behavior.doubleClick.title")} hint={t("settings.customize.behavior.doubleClick.hint")}>
        <Tabs
          items={[
            { key: "play", label: t("settings.customize.behavior.doubleClick.play") },
            { key: "queue", label: t("settings.customize.behavior.doubleClick.queue") },
          ]}
          value={prefs.doubleClickAction}
          onChange={(k: string) => set({ doubleClickAction: k as Prefs["doubleClickAction"] })}
        />
      </SettingRow>
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
        <Button variant="ghost" icon="save" onClick={openSaveTheme}>
          {t("common.save")}
        </Button>
      </SettingRow>
      {themes.map((theme) => (
        <SettingRow key={theme.id} title={theme.name} hint={new Date(theme.createdAt).toLocaleDateString(lang)}>
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <Button variant="secondary" icon="paintbrush" onClick={() => applySavedTheme(theme)}>
              {t("common.apply")}
            </Button>
            <IconButton icon="copy" label={t("settings.customize.themes.copyJson")} onClick={() => void copyTheme(theme)} />
            <IconButton icon="trash-2" label={t("settings.customize.themes.deleteTheme")} onClick={() => removeTheme(theme.id)} />
          </div>
        </SettingRow>
      ))}
      <SettingRow title={t("settings.customize.themes.importRow.title")} hint={t("settings.customize.themes.importRow.hint")}>
        <Button variant="ghost" icon="clipboard-paste" onClick={() => setThemeImportOpen(true)}>
          {t("settings.customize.themes.importRow.button")}
        </Button>
      </SettingRow>
      <SettingRow title={t("settings.customize.themes.marketRow.title")} hint={t("settings.customize.themes.marketRow.hint")} onClick={() => openMarket("themes")} chevron></SettingRow>

      <GroupTitle>{t("settings.customize.css.groupTitle")}</GroupTitle>
      <SettingRow title={t("settings.customize.css.toggle.title")} hint={t("settings.customize.css.toggle.hint")}>
        <Switch checked={prefs.customCssOn} onChange={(customCssOn: boolean) => set({ customCssOn })} label={t("settings.customize.css.toggle.title")} />
      </SettingRow>
      {prefs.customCssOn ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
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
          {t("settings.customize.resetAppearance")}
        </Button>
      </div>
    </div>
  );

  const equalizerPane = (
    <div key="equalizer" className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.equalizer.title")} onBack={() => setSub(null)} />
      <SettingRow title={t("settings.equalizer.enable.title")} hint={t("settings.equalizer.enable.hint")}>
        <Switch checked={eqOn} onChange={setEqOn} label={t("settings.equalizer.title")} />
      </SettingRow>
      <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
        {/* Ключи пресетов (EQ_PRESETS) — персистентные значения prefs.eqPreset,
            общие с DEFAULT_PREFS (types.ts) и apps/web — вне зоны этой правки,
            сознательно не переведены (см. комментарий у EQ_PRESETS). */}
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

  const discordPane = (
    <div key="discord" className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.integrations.discord.title")} onBack={() => setSub(null)} />
      <SettingRow
        title={t("settings.integrations.discord.enable.title")}
        hint={discordAvail === false ? t("settings.integrations.discord.enable.hintNoAppId") : t("settings.integrations.discord.enable.hint")}
      >
        <Switch checked={prefs.discordRpcOn} onChange={(discordRpcOn: boolean) => set({ discordRpcOn })} label={t("settings.integrations.discord.enable.ariaLabel")} />
      </SettingRow>
      <GroupTitle>{t("settings.integrations.discord.whatToShow")}</GroupTitle>
      <SettingRow title={t("settings.integrations.discord.cover.title")} hint={t("settings.integrations.discord.cover.hint")}>
        <Switch checked={prefs.discordShowCover} onChange={(discordShowCover: boolean) => set({ discordShowCover })} label={t("settings.integrations.discord.cover.ariaLabel")} />
      </SettingRow>
      <SettingRow title={t("settings.integrations.discord.line1.title")} hint={t("settings.integrations.discord.line1.hint")}>
        <SettingInput value={prefs.discordLine1} placeholder="{track}" onChange={(v) => set({ discordLine1: v.slice(0, 128) })} />
      </SettingRow>
      <SettingRow title={t("settings.integrations.discord.line2.title")} hint={t("settings.integrations.discord.line2.hint")}>
        <SettingInput value={prefs.discordLine2} placeholder="{artist}" onChange={(v) => set({ discordLine2: v.slice(0, 128) })} />
      </SettingRow>
      <GroupTitle>{t("settings.integrations.discord.buttonGroup")}</GroupTitle>
      <SettingRow title={t("settings.integrations.discord.btnOn.title")} hint={t("settings.integrations.discord.btnOn.hint")}>
        <Switch checked={prefs.discordBtnOn} onChange={(discordBtnOn: boolean) => set({ discordBtnOn })} label={t("settings.integrations.discord.btnOn.ariaLabel")} />
      </SettingRow>
      <SettingRow title={t("settings.integrations.discord.btnLabel.title")} hint={t("settings.integrations.discord.btnLabel.hint")}>
        <SettingInput
          value={prefs.discordBtnLabel}
          placeholder={t("settings.integrations.discord.btnLabel.placeholder")}
          onChange={(v) => set({ discordBtnLabel: v.slice(0, 32) })}
        />
      </SettingRow>
      <SettingRow title={t("settings.integrations.discord.btnUrl.title")} hint={t("settings.integrations.discord.btnUrl.hint")}>
        <SettingInput
          value={prefs.discordBtnUrl}
          placeholder="https://…"
          width={260}
          onChange={(v) => set({ discordBtnUrl: v })}
        />
      </SettingRow>
      <GroupTitle>{t("settings.integrations.discord.previewGroup")}</GroupTitle>
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
          {t("settings.integrations.discord.preview.listeningTo")}
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
            <div style={{ fontSize: "var(--fs-caption)", fontWeight: 600, color: "var(--text-1)" }}>
              {formatTemplate(prefs.discordLine1, discordPreviewVars(t)) || t("settings.integrations.discord.preview.track")}
            </div>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
              {formatTemplate(prefs.discordLine2, discordPreviewVars(t)) || t("settings.integrations.discord.preview.artist")}
            </div>
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
            {prefs.discordBtnLabel.trim() || t("settings.integrations.discord.btnLabel.placeholder")}
          </div>
        ) : null}
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{t("settings.integrations.discord.preview.caption")}</div>
      </div>
    </div>
  );

  const marketPane = (
    <div key="market" className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.market.title")} onBack={() => setSub(null)} />
      <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
        <ChipGroup
          items={[
            { key: "all", label: t("settings.market.filter.all") },
            { key: "themes", label: t("settings.market.filter.themes") },
            { key: "plugins", label: t("settings.market.filter.plugins") },
          ]}
          value={marketFilter}
          onChange={(k) => setMarketFilter(k as "all" | "themes" | "plugins")}
        />
        {serverSession && marketFilter !== "plugins" ? (
          <Button variant="secondary" icon="upload" onClick={openPublishTheme} style={{ marginLeft: "auto" }}>
            {t("settings.market.publishTheme")}
          </Button>
        ) : null}
      </div>

      {marketFilter !== "plugins" ? (
        // Темы — настоящий серверный каталог (Stage 6)
        !serverSession ? (
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.market.themesNeedAccount")}</div>
        ) : marketThemes === null ? (
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("common.loading")}</div>
        ) : marketThemes.length === 0 ? (
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.market.themesEmpty")}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
            {marketThemes.map((theme) => (
              <MarketThemeCard
                key={theme.id}
                theme={theme}
                onInstall={() => void installTheme(theme)}
                onRemove={theme.isMine ? () => void unpublishTheme(theme) : undefined}
                onReport={!theme.isMine ? () => void reportTheme(theme) : undefined}
              />
            ))}
          </div>
        )
      ) : null}

      {marketFilter !== "themes" ? (
        <>
          {marketFilter === "all" ? <GroupTitle>{t("settings.market.filter.plugins")}</GroupTitle> : null}
          {!serverSession ? (
            <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.market.pluginsNeedAccount")}</div>
          ) : !engineAvailable() ? (
            <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.market.pluginsAppOnly")}</div>
          ) : marketPlugins === null ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("common.loading")}</div>
          ) : marketPlugins.length === 0 ? (
            <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.market.pluginsEmpty")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
              {marketPlugins.map((m) => (
                <MarketPluginCard
                  key={m.id}
                  item={m}
                  isAdmin={!!isAdmin}
                  installing={marketPluginInstalling === m.id}
                  onInstall={() => void installFromMarket(m)}
                  onRemove={m.isMine ? () => void unpublishMarketPlugin(m) : undefined}
                  onReport={!m.isMine ? () => void reportMarketPlugin(m) : undefined}
                  onHideToggle={isAdmin ? () => void toggleHideMarketPlugin(m) : undefined}
                  onApprove={isAdmin ? () => void approveMarketPluginRow(m) : undefined}
                />
              ))}
            </div>
          )}
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
      <SubHeader title={t("settings.data.title")} onBack={() => setSub(null)} />
      {dataDocBlock(t("settings.data.deviceOnly.title"), [
        t("settings.data.deviceOnly.item1"),
        t("settings.data.deviceOnly.item2"),
        t("settings.data.deviceOnly.item3"),
      ])}
      {dataDocBlock(t("settings.data.serverStored.title"), [
        t("settings.data.serverStored.item1"),
        t("settings.data.serverStored.item2"),
        t("settings.data.serverStored.item3"),
        t("settings.data.serverStored.item4"),
      ])}
      {dataDocBlock(t("settings.data.anonymousStats.title"), [t("settings.data.anonymousStats.item1"), t("settings.data.anonymousStats.item2")])}
      {dataDocBlock(t("settings.data.whatWeDontDo.title"), [
        t("settings.data.whatWeDontDo.item1"),
        t("settings.data.whatWeDontDo.item2"),
        t("settings.data.whatWeDontDo.item3"),
      ])}
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.data.deletionNote")}</div>
    </div>
  );

  // Под-экран «Сессии и устройства» (C2): активные refresh-сессии
  const sessionsPane = (
    <div key="sessions" className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.account.sessions.title")} onBack={() => setSub(null)} />
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.account.sessions.hint")}</div>
      {sessions === null ? (
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("common.loading")}</div>
      ) : sessions.length === 0 ? (
        <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.account.sessions.loadFailed")}</div>
      ) : (
        sessions.map((s) => (
          <SettingRow
            key={s.id}
            title={`${deviceLabel(s.userAgent, t)}${s.current ? ` · ${t("settings.account.sessions.currentSuffix")}` : ""}`}
            hint={`${s.ip ?? t("settings.account.sessions.unknownIp")} · ${new Date(s.createdAt).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
          >
            {s.current ? (
              <RowValue>{t("settings.account.sessions.thisDevice")}</RowValue>
            ) : (
              <Button variant="ghost" icon="log-out" onClick={() => void revokeSession(s.id)}>
                {t("settings.account.sessions.signOut")}
              </Button>
            )}
          </SettingRow>
        ))
      )}
    </div>
  );

  // Под-экран «Выгрузить или удалить данные» (C3)
  const privacyPane = (
    <div key="privacy" className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.privacy.title")} onBack={() => setSub(null)} />
      <SettingRow title={t("settings.privacy.export.title")} hint={t("settings.privacy.export.hint")}>
        <Button variant="secondary" icon="download" disabled={exportBusy} onClick={() => void doExport()}>
          {exportBusy ? t("settings.privacy.export.busy") : t("settings.privacy.export.button")}
        </Button>
      </SettingRow>
      <SettingRow title={t("settings.privacy.deleteAccount.title")} hint={t("settings.privacy.deleteAccount.hint")} danger>
        <Button
          variant="ghost"
          icon="trash-2"
          onClick={() => {
            setDelPwd("");
            setDelErr(null);
            setDelOpen(true);
          }}
        >
          {t("settings.privacy.deleteAccount.button")}
        </Button>
      </SettingRow>
      <SettingRow
        title={t("settings.privacy.privacyDoc.title")}
        hint={t("settings.privacy.privacyDoc.hint")}
        onClick={() => void openExternal("https://muza.lol/privacy")}
        chevron
      ></SettingRow>
    </div>
  );

  // Под-экран «Лицензии»: открытый код внутри клиента (честный список руками —
  // полная машинная выжимка сотен транзитивных пакетов тут никому не помогает)
  const licensesPane = (
    <div key="licenses" className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.system.licenses.title")} onBack={() => setSub(null)} />
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.system.licenses.hint")}</div>
      {OSS_LICENSES.map((d) => (
        <SettingRow
          key={d.id}
          title={t(`settings.system.licenses.items.${d.id}`)}
          hint={d.url.replace("https://", "")}
          onClick={() => void openExternal(d.url)}
          chevron
        >
          <RowValue>{d.license}</RowValue>
        </SettingRow>
      ))}
    </div>
  );

  // Под-экраны компоновки (волна 3): кнопки бара и вкладки сайдбара —
  // тот же паттерн, что statsBlocks (Switch + ↑/↓, порядок массива = порядок в UI)
  const barButtons = normalizeBarButtons(prefs.barButtons, pluginBarKeys);
  const barToggle = (key: string, on: boolean) =>
    set({ barButtons: barButtons.map((b) => (b.key === key ? { ...b, on } : b)) });
  const barMove = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= barButtons.length) return;
    const next = [...barButtons];
    [next[i], next[j]] = [next[j], next[i]];
    set({ barButtons: next });
  };
  const barPane = (
    <div key="bar" className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.bar.title")} onBack={() => setSub(null)} />
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.bar.hint")}</div>
      {barButtons.map((b, i) => (
        <SettingRow key={b.key} title={barMeta(b.key).label} hint={barMeta(b.key).hint}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <span style={{ opacity: i === 0 ? 0.3 : 1 }}>
              <IconButton icon="chevron-up" size="sm" label={t("settings.bar.moveUp", { name: barMeta(b.key).label })} onClick={() => barMove(i, -1)} />
            </span>
            <span style={{ opacity: i === barButtons.length - 1 ? 0.3 : 1 }}>
              <IconButton icon="chevron-down" size="sm" label={t("settings.bar.moveDown", { name: barMeta(b.key).label })} onClick={() => barMove(i, 1)} />
            </span>
            <Switch checked={b.on} onChange={(on: boolean) => barToggle(b.key, on)} label={barMeta(b.key).label} />
          </div>
        </SettingRow>
      ))}
      <div>
        <Button variant="ghost" icon="rotate-ccw" onClick={() => set({ barButtons: DEFAULT_PREFS.barButtons })}>
          {t("settings.bar.reset")}
        </Button>
      </div>
    </div>
  );

  const navItems = normalizeNavItems(prefs.navItems, pluginNavKeys);
  const navToggle = (key: string, on: boolean) =>
    set({ navItems: navItems.map((n) => (n.key === key ? { ...n, on } : n)) });
  const navRename = (key: string, label: string) =>
    set({ navItems: navItems.map((n) => (n.key === key ? { ...n, label: label || undefined } : n)) });
  const navMove = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= navItems.length) return;
    const next = [...navItems];
    [next[i], next[j]] = [next[j], next[i]];
    set({ navItems: next });
  };
  const navPane = (
    <div key="nav" className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.nav.title")} onBack={() => setSub(null)} />
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.nav.hint")}</div>
      {navItems.map((n, i) => (
        <SettingRow key={n.key} title={navMeta(n.key).label} hint={n.key === "home" ? t("settings.nav.homeCannotDisable") : undefined}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <SettingInput
              value={n.label ?? ""}
              placeholder={navMeta(n.key).label}
              width={140}
              onChange={(v) => navRename(n.key, v.trim().slice(0, 24))}
            />
            <span style={{ opacity: i === 0 ? 0.3 : 1 }}>
              <IconButton icon="chevron-up" size="sm" label={t("settings.bar.moveUp", { name: navMeta(n.key).label })} onClick={() => navMove(i, -1)} />
            </span>
            <span style={{ opacity: i === navItems.length - 1 ? 0.3 : 1 }}>
              <IconButton icon="chevron-down" size="sm" label={t("settings.bar.moveDown", { name: navMeta(n.key).label })} onClick={() => navMove(i, 1)} />
            </span>
            <Switch
              checked={n.on}
              disabled={n.key === "home"}
              onChange={(on: boolean) => navToggle(n.key, on)}
              label={navMeta(n.key).label}
            />
          </div>
        </SettingRow>
      ))}
      <div>
        <Button variant="ghost" icon="rotate-ccw" onClick={() => set({ navItems: DEFAULT_PREFS.navItems })}>
          {t("settings.nav.reset")}
        </Button>
      </div>
    </div>
  );

  // Под-экран «Статистика»: видимость и порядок блоков страницы + период.
  // Порядок массива prefs.statsBlocks = порядок на странице.
  const statsBlocks = normalizeStatsBlocks(prefs.statsBlocks);
  const statsToggle = (key: StatsBlockKey, on: boolean) =>
    set({ statsBlocks: statsBlocks.map((b) => (b.key === key ? { ...b, on } : b)) });
  const statsMove = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= statsBlocks.length) return;
    const next = [...statsBlocks];
    [next[i], next[j]] = [next[j], next[i]];
    set({ statsBlocks: next });
  };
  const statsPane = (
    <div key="stats" className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.stats.title")} onBack={() => setSub(null)} />

      <GroupTitle>{t("settings.stats.blocksGroup")}</GroupTitle>
      {statsBlocks.map((b, i) => (
        <SettingRow key={b.key} title={statsBlockLabel(b.key, lang).label} hint={statsBlockLabel(b.key, lang).hint}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <span style={{ opacity: i === 0 ? 0.3 : 1 }}>
              <IconButton
                icon="chevron-up"
                size="sm"
                label={t("settings.bar.moveUp", { name: statsBlockLabel(b.key, lang).label })}
                onClick={() => statsMove(i, -1)}
              />
            </span>
            <span style={{ opacity: i === statsBlocks.length - 1 ? 0.3 : 1 }}>
              <IconButton
                icon="chevron-down"
                size="sm"
                label={t("settings.bar.moveDown", { name: statsBlockLabel(b.key, lang).label })}
                onClick={() => statsMove(i, 1)}
              />
            </span>
            <Switch checked={b.on} onChange={(on: boolean) => statsToggle(b.key, on)} label={statsBlockLabel(b.key, lang).label} />
          </div>
        </SettingRow>
      ))}

      <GroupTitle>{t("settings.stats.periodGroup")}</GroupTitle>
      <SettingRow title={t("settings.stats.period.title")} hint={t("settings.stats.period.hint")}>
        <Tabs
          items={[
            { key: "week", label: t("settings.stats.period.week") },
            { key: "month", label: t("settings.stats.period.month") },
            { key: "year", label: t("settings.stats.period.year") },
            { key: "all", label: t("settings.stats.period.allTime") },
          ]}
          value={prefs.statsPeriod}
          onChange={(k: string) => set({ statsPeriod: k as Prefs["statsPeriod"] })}
        />
      </SettingRow>
    </div>
  );

  // ── Вкладки ───────────────────────────────────────────────────────

  const pane =
    sub === "customize" ? (
      customizePane
    ) : sub === "stats" ? (
      statsPane
    ) : sub === "equalizer" ? (
      equalizerPane
    ) : sub === "discord" ? (
      discordPane
    ) : sub === "market" ? (
      marketPane
    ) : sub === "data" ? (
      dataPane
    ) : sub === "licenses" ? (
      licensesPane
    ) : sub === "bar" ? (
      barPane
    ) : sub === "nav" ? (
      navPane
    ) : sub === "sessions" ? (
      sessionsPane
    ) : sub === "privacy" ? (
      privacyPane
    ) : tab === "account" ? (
      <div key="account" className={paneClass} style={paneStyle}>
        <SettingRow title={t("settings.account.profile.title")} hint={username}>
          <Button variant="ghost" icon="log-out" onClick={onLogout}>
            {t("settings.account.profile.signOut")}
          </Button>
        </SettingRow>
        <SettingRow
          title={t("settings.account.email.title")}
          hint={serverSession ? t("settings.account.email.hint") : t("settings.account.needsAccount")}
          onClick={serverSession ? openEmailChange : undefined}
          chevron={serverSession}
        ></SettingRow>
        <SettingRow
          title={t("settings.account.password.title")}
          hint={serverSession ? t("settings.account.password.hint") : t("settings.account.needsAccountPassword")}
          onClick={serverSession ? openPwd : undefined}
          chevron={serverSession}
        ></SettingRow>
        <SettingRow
          title={t("settings.account.sessions.rowTitle")}
          hint={serverSession ? t("settings.account.sessions.rowHint") : t("settings.account.needsAccountShort")}
          onClick={serverSession ? () => setSub("sessions") : undefined}
          chevron={serverSession}
        ></SettingRow>
        <GroupTitle>{t("settings.account.privacyGroup")}</GroupTitle>
        <SettingRow title={t("settings.account.telemetry.title")} hint={t("settings.account.telemetry.hint")}>
          <Switch checked={prefs.telemetry} onChange={(on: boolean) => set({ telemetry: on })} label={t("settings.account.telemetry.title")} />
        </SettingRow>
        <SettingRow
          title={t("settings.account.dataDoc.title")}
          hint={t("settings.account.dataDoc.hint")}
          onClick={() => setSub("data")}
          chevron
        ></SettingRow>
        <SettingRow
          title={t("settings.account.exportOrDelete.title")}
          hint={serverSession ? t("settings.account.exportOrDelete.hint") : t("settings.account.needsAccountServer")}
          onClick={serverSession ? () => setSub("privacy") : undefined}
          danger
          chevron={serverSession}
        ></SettingRow>
      </div>
    ) : tab === "appearance" ? (
      <div key="appearance" className={paneClass} style={paneStyle}>
        {/* T28 (i18n): переключатель — первый элемент вкладки по требованию
            владельца («Внешний вид» вверху). Живой, без перезагрузки —
            меняет prefs.language, LanguageProvider (App) перерендерит все
            места, использующие useT(). */}
        <SettingRow title={t("settings.appearance.language.title")} hint={t("settings.appearance.language.hint")}>
          <Tabs
            items={[
              { key: "en", label: t("settings.appearance.language.optionEn") },
              { key: "ru", label: t("settings.appearance.language.optionRu") },
            ]}
            value={prefs.language}
            onChange={(k: string) => set({ language: k as Prefs["language"] })}
          />
        </SettingRow>
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
        <SettingRow title={t("settings.appearance.theme.title")} hint={t("settings.appearance.theme.hint")}>
          <Tabs
            items={[
              { key: "dark", label: t("settings.appearance.theme.dark") },
              { key: "light", label: t("settings.appearance.theme.light") },
            ]}
            value={prefs.theme}
            onChange={(k: string) => set({ theme: k as Prefs["theme"] })}
          />
        </SettingRow>
        <SettingRow title={t("settings.appearance.accent.title")} hint={t("settings.appearance.accent.hint")}>
          <div style={{ display: "flex", gap: "var(--sp-3)" }}>
            <AccentSwatch color="#3b82f6" label={t("settings.appearance.accent.blue")} selected={prefs.accent === "blue"} onClick={() => set({ accent: "blue" })} />
            <AccentSwatch color="#f76967" label={t("settings.appearance.accent.red")} selected={prefs.accent === "red"} onClick={() => set({ accent: "red" })} />
            <AccentSwatch color="#327ad9" label={t("settings.appearance.accent.bolt")} selected={prefs.accent === "bolt"} onClick={() => set({ accent: "bolt" })} />
            <CustomAccentSwatch
              color={prefs.customAccent}
              selected={prefs.accent === "custom"}
              onPick={(customAccent) => set({ accent: "custom", customAccent })}
            />
          </div>
        </SettingRow>
        <SettingRow title={t("settings.appearance.radius.title")} hint={t("settings.appearance.radius.hint")}>
          <Tabs
            items={[
              { key: "mild", label: t("settings.appearance.radius.mild") },
              { key: "soft", label: t("settings.appearance.radius.soft") },
              { key: "round", label: t("settings.appearance.radius.round") },
            ]}
            value={prefs.radius}
            onChange={(radius: string) => set({ radius: radius as Prefs["radius"] })}
          />
        </SettingRow>
        <SettingRow title={t("settings.appearance.glass.title")} hint={t("settings.appearance.glass.hint")}>
          <LiveSlider
            value={prefs.glassOpacity - GLASS_MIN}
            max={100 - GLASS_MIN}
            label={t("settings.appearance.glass.title")}
            suffix={`${prefs.glassOpacity} %`}
            onChange={(v) => set({ glassOpacity: GLASS_MIN + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.appearance.background.title")} hint={t("settings.appearance.background.hint")}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
            <RowValue>
              {prefs.bgType === "cover"
                ? t("settings.appearance.background.fromCover")
                : prefs.bgType === "none"
                  ? t("common.off")
                  : t("settings.appearance.background.custom")}
            </RowValue>
            <Switch
              checked={prefs.bgType === "cover"}
              onChange={(on: boolean) => set({ bgType: on ? "cover" : "none" })}
              label={t("settings.appearance.background.ariaLabel")}
            />
          </div>
        </SettingRow>
        <SettingRow title={t("settings.appearance.scale.title")} hint={t("settings.appearance.scale.hint")}>
          <LiveSlider
            value={prefs.uiScale - 85}
            max={40}
            label={t("settings.appearance.scale.title")}
            suffix={`${prefs.uiScale} %`}
            onChange={(v) => set({ uiScale: 85 + Math.round(v) })}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.appearance.customize.title")}
          hint={t("settings.appearance.customize.hint")}
          onClick={() => setSub("customize")}
          chevron
        ></SettingRow>
      </div>
    ) : tab === "playback" ? (
      <div key="playback" className={paneClass} style={paneStyle}>
        <GroupTitle>{t("settings.playback.transitionsGroup")}</GroupTitle>
        <SettingRow title={t("settings.playback.crossfade.title")} hint={t("settings.playback.crossfade.hint")}>
          <Switch checked={prefs.crossfade} onChange={(v: boolean) => set({ crossfade: v })} label={t("settings.playback.crossfade.title")} />
        </SettingRow>
        <SettingRow
          title={t("settings.playback.gapless.title")}
          hint={prefs.crossfade ? t("settings.playback.gapless.hintCrossfadeOn") : t("settings.playback.gapless.hint")}
        >
          <Switch checked={prefs.gapless} onChange={(v: boolean) => set({ gapless: v })} label={t("settings.playback.gapless.title")} />
        </SettingRow>
        <GroupTitle>{t("settings.playback.soundGroup")}</GroupTitle>
        <SettingRow title={t("settings.playback.equalizer.rowTitle")} hint={t("settings.playback.equalizer.rowHint")} onClick={() => setSub("equalizer")} chevron>
          <RowValue>{eqOn ? eqPreset : t("common.off")}</RowValue>
        </SettingRow>
        <SettingRow title={t("settings.playback.normalize.title")} hint={t("settings.playback.normalize.hint")}>
          <Switch checked={prefs.normalize} onChange={(v: boolean) => set({ normalize: v })} label={t("settings.playback.normalize.title")} />
        </SettingRow>
        <SettingRow title={t("settings.playback.speedSteps.title")} hint={t("settings.playback.speedSteps.hint")}>
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
        <GroupTitle>{t("settings.playback.queueGroup")}</GroupTitle>
        <SettingRow title={t("settings.playback.radioEndless.title")} hint={t("settings.playback.radioEndless.hint")}>
          <Switch checked={prefs.radioEndless} onChange={(v: boolean) => set({ radioEndless: v })} label={t("settings.playback.radioEndless.title")} />
        </SettingRow>
        <GroupTitle>{t("settings.playback.recsGroup")}</GroupTitle>
        <RecsTuning api={api} enabled={serverSession} onNotify={onNotify} />
        <SettingRow title={t("settings.playback.resumePosition.title")} hint={t("settings.playback.resumePosition.hint")}>
          <Switch
            checked={prefs.resumePosition}
            onChange={(resumePosition: boolean) => set({ resumePosition })}
            label={t("settings.playback.resumePosition.ariaLabel")}
          />
        </SettingRow>
        <GroupTitle>{t("settings.playback.streamGroup")}</GroupTitle>
        <SettingRow title={t("settings.playback.streamQuality.title")} hint={t("settings.playback.streamQuality.hint")}>
          <Tabs
            items={[
              { key: "auto", label: t("settings.playback.streamQuality.auto") },
              { key: "econom", label: t("settings.playback.streamQuality.econom") },
            ]}
            value={prefs.streamQuality}
            onChange={(k: string) => set({ streamQuality: k as Prefs["streamQuality"] })}
          />
        </SettingRow>
        <SettingRow title={t("settings.playback.sleepTimer.title")} hint={t("settings.playback.sleepTimer.hint")}>
          <StepsEditor
            values={prefs.sleepPresets}
            onApply={(sleepPresets) => set({ sleepPresets: sleepPresets.map(Math.round) })}
            min={1}
            max={600}
            maxCount={6}
            fallback={DEFAULT_PREFS.sleepPresets}
            suffix={t("settings.playback.sleepTimer.minSuffix")}
          />
        </SettingRow>
      </div>
    ) : tab === "sources" ? (
      <div key="sources" className={paneClass} style={paneStyle}>
        <SettingRow title={t("settings.sources.policy.title")} hint={t("settings.sources.policy.hint")}>
          <Tabs
            items={[
              { key: "official", label: t("settings.sources.policy.official") },
              { key: "soundcloudFirst", label: t("settings.sources.policy.soundcloudFirst") },
            ]}
            value={prefs.sourcePolicy}
            onChange={(k: string) => set({ sourcePolicy: k as Prefs["sourcePolicy"] })}
          />
        </SettingRow>
        <GroupTitle>{t("settings.sources.priorityGroup")}</GroupTitle>
        <SettingRow title="YouTube / YT Music" hint={t("settings.sources.youtube.hint")}>
          <Switch
            checked={prefs.sourcesEnabled.youtube}
            disabled={prefs.sourcesEnabled.youtube && !prefs.sourcesEnabled.soundcloud && !prefs.sourcesEnabled.bandcamp}
            onChange={(on: boolean) => set({ sourcesEnabled: { ...prefs.sourcesEnabled, youtube: on } })}
            label="YouTube / YT Music"
          />
        </SettingRow>
        <SettingRow title="SoundCloud" hint={t("settings.sources.soundcloud.hint")}>
          <Switch
            checked={prefs.sourcesEnabled.soundcloud}
            disabled={prefs.sourcesEnabled.soundcloud && !prefs.sourcesEnabled.youtube && !prefs.sourcesEnabled.bandcamp}
            onChange={(on: boolean) => set({ sourcesEnabled: { ...prefs.sourcesEnabled, soundcloud: on } })}
            label="SoundCloud"
          />
        </SettingRow>
        <SettingRow title="Bandcamp" hint={t("settings.sources.bandcamp.hint")}>
          <Switch
            checked={prefs.sourcesEnabled.bandcamp}
            disabled={prefs.sourcesEnabled.bandcamp && !prefs.sourcesEnabled.youtube && !prefs.sourcesEnabled.soundcloud}
            onChange={(on: boolean) => set({ sourcesEnabled: { ...prefs.sourcesEnabled, bandcamp: on } })}
            label="Bandcamp"
          />
        </SettingRow>
        <GroupTitle>{t("settings.sources.searchGroup")}</GroupTitle>
        <SettingRow title={t("settings.sources.searchScope.title")} hint={t("settings.sources.searchScope.hint")}>
          <Tabs
            items={[
              { key: "all", label: t("settings.sources.searchScope.all") },
              { key: "catalog", label: t("settings.sources.searchScope.catalogOnly") },
            ]}
            value={prefs.searchScope}
            onChange={(k: string) => set({ searchScope: k as Prefs["searchScope"] })}
          />
        </SettingRow>
        <SettingRow title={t("settings.sources.instantSearch.title")} hint={t("settings.sources.instantSearch.hint")}>
          <Switch checked={prefs.instantSearch} onChange={(instantSearch: boolean) => set({ instantSearch })} label={t("settings.sources.instantSearch.title")} />
        </SettingRow>
        <SettingRow title={t("settings.sources.searchGrouping.title")} hint={t("settings.sources.searchGrouping.hint")}>
          <Switch
            checked={prefs.searchGrouping}
            onChange={(searchGrouping: boolean) => set({ searchGrouping })}
            label={t("settings.sources.searchGrouping.title")}
          />
        </SettingRow>
        <SettingRow title={t("settings.sources.directLocal.title")} hint={t("settings.sources.directLocal.hint")}>
          <RowValue>{t("settings.sources.directLocal.value")}</RowValue>
        </SettingRow>
      </div>
    ) : tab === "lyrics" ? (
      <div key="lyrics" className={paneClass} style={paneStyle}>
        <GroupTitle>{t("settings.lyrics.displayGroup")}</GroupTitle>
        <SettingRow title={t("settings.lyrics.synced.title")} hint={t("settings.lyrics.synced.hint")}>
          <Switch checked={prefs.syncedLyrics} onChange={(syncedLyrics: boolean) => set({ syncedLyrics })} label={t("settings.lyrics.synced.title")} />
        </SettingRow>
        <SettingRow title={t("settings.lyrics.autoScroll.title")} hint={t("settings.lyrics.autoScroll.hint")}>
          <Switch checked={prefs.lyricsAutoScroll} onChange={(lyricsAutoScroll: boolean) => set({ lyricsAutoScroll })} label={t("settings.lyrics.autoScroll.title")} />
        </SettingRow>
        <SettingRow title={t("settings.lyrics.karaokeSize.title")} hint={t("settings.lyrics.karaokeSize.hint")}>
          <LiveSlider
            value={prefs.karaokeSize - 36}
            max={36}
            label={t("settings.lyrics.karaokeSize.title")}
            suffix={`${prefs.karaokeSize} px`}
            onChange={(v) => set({ karaokeSize: 36 + Math.round(v) })}
          />
        </SettingRow>
        <GroupTitle>{t("settings.lyrics.understandingGroup")}</GroupTitle>
        <SettingRow title={t("settings.lyrics.translation.title")} hint={t("settings.lyrics.translation.hint")}>
          <RowValue>{t("common.off")}</RowValue>
        </SettingRow>
        <SettingRow title={t("settings.lyrics.meaningMode.title")} hint={t("settings.lyrics.meaningMode.hint")}>
          <Switch checked={prefs.meaningMode} onChange={(meaningMode: boolean) => set({ meaningMode })} label={t("settings.lyrics.meaningMode.title")} />
        </SettingRow>
      </div>
    ) : tab === "library" ? (
      <div key="library" className={paneClass} style={paneStyle}>
        <SettingRow title={t("settings.library.localFiles.title")} hint={t("settings.library.localFiles.hint")}>
          <RowValue>{t("settings.library.localFiles.value")}</RowValue>
        </SettingRow>
        <SettingRow
          title={t("settings.library.cache.title")}
          hint={cache ? t("settings.library.cache.hintFilled", { size: fmtGb(cache.bytes), files: cache.files }) : t("settings.library.cache.hintEmpty")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
            <LiveSlider
              value={prefs.cacheLimitGb - 1}
              max={15}
              label={t("settings.library.cache.limitLabel")}
              suffix={t("settings.library.units.gb", { n: prefs.cacheLimitGb })}
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
              {t("settings.library.cache.clear")}
            </Button>
          </div>
        </SettingRow>
        <SettingRow title={t("settings.library.offline.title")} hint={t("settings.library.offline.hint")}>
          <RowValue>
            {cache ? t("settings.library.offline.value", { n: cache.pinnedFiles, size: fmtGb(cache.pinnedBytes) }) : t("settings.library.offline.empty")}
          </RowValue>
        </SettingRow>
        <SettingRow title={t("settings.library.importPlaylists.title")} hint={t("settings.library.importPlaylists.hint")}>
          <RowValue>{t("settings.library.importPlaylists.value")}</RowValue>
        </SettingRow>
        <SettingRow title={t("settings.library.stats.title")} hint={t("settings.library.stats.hint")} onClick={() => setSub("stats")} chevron></SettingRow>
      </div>
    ) : tab === "integrations" ? (
      <div key="integrations" className={paneClass} style={paneStyle}>
        <SettingRow title={t("settings.integrations.discord.rowTitle")} hint={t("settings.integrations.discord.rowHint")} onClick={() => setSub("discord")} chevron>
          <RowValue>{prefs.discordRpcOn ? t("common.on") : t("common.off")}</RowValue>
        </SettingRow>
        <SettingRow
          title={t("settings.integrations.lastfm.title")}
          hint={
            !serverSession
              ? t("settings.integrations.needsAccount")
              : !scrob
                ? scrobErr
                  ? t("settings.integrations.serverUnavailable")
                  : t("settings.integrations.checkingStatus")
                : scrob.lastfm.connected
                  ? t("settings.integrations.lastfm.connectedAs", { username: scrob.lastfm.username ?? "" })
                  : scrob.lastfm.available
                    ? t("settings.integrations.lastfm.willSync")
                    : t("settings.integrations.lastfm.noApiKeys")
          }
        >
          {serverSession && scrob?.lastfm.connected ? (
            <Button variant="ghost" icon="unlink" onClick={() => void lfmDisconnect()}>
              {t("common.disconnect")}
            </Button>
          ) : serverSession && scrob?.lastfm.available ? (
            <Button variant="secondary" icon="link" disabled={lfmWaiting} onClick={() => void lfmConnect()}>
              {lfmWaiting ? t("settings.integrations.lastfm.waitingBrowser") : t("common.connect")}
            </Button>
          ) : (
            <RowValue>{serverSession && scrob ? t("settings.integrations.unavailable") : t("settings.integrations.notConnected")}</RowValue>
          )}
        </SettingRow>
        <SettingRow
          title={t("settings.integrations.listenbrainz.title")}
          hint={
            !serverSession
              ? t("settings.integrations.needsAccount")
              : !scrob && scrobErr
                ? t("settings.integrations.serverUnavailable")
                : scrob?.listenbrainz.connected
                  ? t("settings.integrations.listenbrainz.connectedAs", { username: scrob.listenbrainz.username ?? "" })
                  : t("settings.integrations.listenbrainz.hint")
          }
        >
          {serverSession && scrob?.listenbrainz.connected ? (
            <Button variant="ghost" icon="unlink" onClick={() => void lbDisconnect()}>
              {t("common.disconnect")}
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
              {t("common.connect")}
            </Button>
          ) : (
            <RowValue>{t("settings.integrations.notConnected")}</RowValue>
          )}
        </SettingRow>
        <SettingRow title={t("settings.integrations.mediaKeys.title")} hint={t("settings.integrations.mediaKeys.hint")}>
          <Switch checked={prefs.mediaKeys} onChange={(mediaKeys: boolean) => set({ mediaKeys })} label={t("settings.integrations.mediaKeys.title")} />
        </SettingRow>
      </div>
    ) : tab === "hotkeys" ? (
      (() => {
        // combo, встречающиеся у >1 действия — конфликт (обе строки красные)
        const counts = new Map<string, number>();
        for (const a of HOTKEY_ACTIONS) counts.set(prefs.hotkeys[a.id], (counts.get(prefs.hotkeys[a.id]) ?? 0) + 1);
        const setKey = (id: HotkeyAction, combo: string) => set({ hotkeys: { ...prefs.hotkeys, [id]: combo } });
        return (
          <div key="hotkeys" className={paneClass} style={paneStyle}>
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
      })()
    ) : tab === "extensions" ? (
      <div key="extensions" className={paneClass} style={paneStyle}>
        <GroupTitle>{t("settings.extensions.builtInGroup")}</GroupTitle>
        <SettingRow title={t("settings.extensions.visualizer.title")} hint={t("settings.extensions.visualizer.hint")}>
          <Switch
            checked={prefs.visualizer !== "off"}
            onChange={(on: boolean) => set({ visualizer: on ? "bars" : "off" })}
            label={t("settings.extensions.visualizer.title")}
          />
        </SettingRow>
        {/* Ручки показываются только для того вида, на который влияют: у баров
            и волны общего почти нет, а вываливать всё сразу — ровно та беда,
            за которую настройки уже критиковали (равновесная простыня опций).
            Пресеты — по конвенции «пресеты→ползунки» (lib/visualizerPresets):
            чип записывает числа в обычные префы, подсветка вычисляется
            обратным сравнением, «Свой» — индикатор, а не значение. */}
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
          <SettingRow title={t("settings.extensions.bassShakeStrength.title")} hint={t("settings.extensions.bassShakeStrength.hint")}>
            <LiveSlider
              value={prefs.bassShakeStrength}
              max={BASS_STRENGTH_MAX}
              label={t("settings.extensions.bassShakeStrength.title")}
              suffix={`${prefs.bassShakeStrength} %`}
              onChange={(v) => set({ bassShakeStrength: Math.round(v) })}
            />
          </SettingRow>
        ) : null}
        <GroupTitle>{t("settings.extensions.externalGroup")}</GroupTitle>
        <SettingRow
          title={t("settings.extensions.installFromFile.title")}
          hint={engineAvailable() ? t("settings.extensions.installFromFile.hint") : t("settings.extensions.appOnly")}
        >
          <Button variant="ghost" icon="folder-open" disabled={!engineAvailable() || installBusy} onClick={() => void startInstall()}>
            {t("settings.extensions.installFromFile.button")}
          </Button>
        </SettingRow>
        {installedPlugins.length === 0 ? (
          <SettingRow title={t("settings.extensions.installed.title")} hint={t("settings.extensions.installed.emptyHint")}>
            <RowValue>{t("settings.extensions.installed.zero")}</RowValue>
          </SettingRow>
        ) : (
          installedPlugins.map((p) => (
            <SettingRow
              key={p.id}
              title={p.manifest.name}
              titleExtra={
                isFullAccessManifest(p.manifest) ? (
                  <Badge tone="accent" style={{ background: "color-mix(in srgb, var(--danger) 22%, transparent)", color: "var(--danger)" }}>
                    {t("settings.extensions.fullAccessBadge")}
                  </Badge>
                ) : undefined
              }
              hint={t("settings.extensions.installed.hint", { version: p.version, author: p.manifest.author, n: p.granted.length })}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                <Switch
                  checked={p.enabled}
                  onChange={(on: boolean) => void togglePlugin(p.id, on)}
                  label={t("settings.extensions.installed.enableAria", { name: p.manifest.name })}
                />
                <IconButton
                  icon="trash-2"
                  size="sm"
                  label={t("settings.extensions.installed.deleteAria", { name: p.manifest.name })}
                  onClick={() => void removePlugin(p.id, p.manifest.name)}
                />
              </div>
            </SettingRow>
          ))
        )}
        {fullAccessErrors.length > 0 ? (
          <>
            <GroupTitle>{t("settings.extensions.errorsGroup")}</GroupTitle>
            {fullAccessErrors.map((err, i) => (
              <SettingRow
                key={`${err.pluginId}-${err.at}-${i}`}
                title={installedPlugins.find((p) => p.id === err.pluginId)?.manifest.name ?? err.pluginId}
                hint={err.message}
                danger
              >
                <RowValue>{new Date(err.at).toLocaleTimeString()}</RowValue>
              </SettingRow>
            ))}
            <SettingRow title={t("settings.extensions.errorLog.title")} hint={t("settings.extensions.errorLog.hint", { n: fullAccessErrors.length })}>
              <Button variant="ghost" icon="trash-2" onClick={() => fullAccessHost.clearErrors()}>
                {t("settings.extensions.errorLog.clear")}
              </Button>
            </SettingRow>
          </>
        ) : null}
        <SettingRow title={t("settings.extensions.pluginMarket.title")} hint={t("settings.extensions.pluginMarket.hint")} onClick={() => openMarket("plugins")} chevron></SettingRow>
        <SettingRow title={t("settings.extensions.themeMarket.title")} hint={t("settings.extensions.themeMarket.hint")} onClick={() => openMarket("themes")} chevron></SettingRow>
      </div>
    ) : (
      <div key="system" className={paneClass} style={paneStyle}>
        <SettingRow
          title={t("settings.system.autostart.title")}
          hint={engineAvailable() ? t("settings.system.autostart.hint") : t("settings.system.appOnly")}
        >
          <Switch
            checked={prefs.autostart}
            disabled={!engineAvailable()}
            onChange={(autostart: boolean) => set({ autostart })}
            label={t("settings.system.autostart.title")}
          />
        </SettingRow>
        <SettingRow title={t("settings.system.tray.title")} hint={engineAvailable() ? t("settings.system.tray.hint") : t("settings.system.appOnly")}>
          <Switch checked={prefs.tray} disabled={!engineAvailable()} onChange={(tray: boolean) => set({ tray })} label={t("settings.system.tray.title")} />
        </SettingRow>
        <SettingRow
          title={t("settings.system.closeAction.title")}
          hint={prefs.tray ? t("settings.system.closeAction.hintTray") : t("settings.system.closeAction.hintNoTray")}
        >
          <div style={prefs.tray && engineAvailable() ? undefined : { pointerEvents: "none", opacity: 0.4 }}>
            <Tabs
              items={[
                { key: "tray", label: t("settings.system.closeAction.minimize") },
                { key: "exit", label: t("settings.system.closeAction.exit") },
              ]}
              value={prefs.closeToTray ? "tray" : "exit"}
              onChange={(k: string) => set({ closeToTray: k === "tray" })}
            />
          </div>
        </SettingRow>
        <SettingRow
          title={t("settings.system.update.title")}
          hint={updaterAvailable() ? t("settings.system.update.hint") : t("settings.system.appOnly")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
            <RowValue>
              {updState === "checking"
                ? t("settings.system.update.checking")
                : updState === "none"
                  ? t("settings.system.update.upToDate")
                  : updState === "found"
                    ? t("settings.system.update.available", { version: updFound?.version ?? "" })
                    : updState === "installing"
                      ? updPct >= 0
                        ? t("settings.system.update.downloadingPct", { pct: updPct })
                        : t("settings.system.update.downloading")
                      : updState === "error"
                        ? t("settings.system.update.checkFailed")
                        : t("settings.system.update.stableChannel")}
            </RowValue>
            {updState === "found" || updState === "installing" ? (
              <Button variant="primary" icon="download" disabled={updState === "installing"} onClick={() => void installUpdate()}>
                {updState === "installing" ? t("settings.market.installing") : t("common.install")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                icon="refresh-cw"
                disabled={!updaterAvailable() || updState === "checking"}
                onClick={() => void checkUpdates()}
              >
                {t("settings.system.update.check")}
              </Button>
            )}
          </div>
        </SettingRow>
        <SettingRow title={t("settings.system.miniPlayer.title")} hint={t("settings.system.miniPlayer.hint")}>
          <Switch
            checked={prefs.miniPlayer}
            disabled={!engineAvailable()}
            onChange={(miniPlayer: boolean) => set({ miniPlayer })}
            label={t("settings.system.miniPlayer.title")}
          />
        </SettingRow>
        {/* T28: переключатель языка переехал в «Внешний вид» (первый элемент
            вкладки, по требованию владельца) — здесь была заглушка-стаб. */}
        <GroupTitle>{t("settings.system.aboutGroup")}</GroupTitle>
        <SettingRow title={t("settings.system.version.title")} hint={t("settings.system.version.hint")}>
          <RowValue>{appVersion ?? (isTauri() ? "…" : t("settings.system.appOnly"))}</RowValue>
        </SettingRow>
        <SettingRow title={t("settings.system.licenses.rowTitle")} hint={t("settings.system.licenses.rowHint")} onClick={() => setSub("licenses")} chevron></SettingRow>
        <SettingRow title={t("settings.system.website.title")} hint={t("settings.system.website.hint")} onClick={() => void openExternal("https://muza.lol")} chevron></SettingRow>
        <SettingRow
          title={t("settings.system.sourceCode.title")}
          hint={t("settings.system.sourceCode.hint")}
          onClick={() => void openExternal("https://github.com/EntonioDMI/muza-client")}
          chevron
        ></SettingRow>
      </div>
    );

  return (
    // maxWidth 920 = 220 (навигация) + 20 (гаттер) + 680 (панель): панель
    // остаётся примерно той же ширины, что и прежняя одноколоночная (720),
    // навигация приезжает сбоку, а не за её счёт. Класс muza-settings —
    // container query для схлопывания навигации, см. app.css.
    <div
      className="muza-settings"
      style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0", maxWidth: 920, margin: "0 auto" }}
    >
      {/* Навигация слева вместо горизонтальных вкладок: список не зависит от
          длины подписей, поэтому раскладка не перестраивается при смене языка
          (у <Tabs wrap> точка переноса ехала: RU 5+5, EN 7+3).
          Заголовок «Настройки» — внутри SettingsNav, шапкой плашки. */}
      <div className="muza-settings__cols">
        <SettingsNav
          value={tab}
          onChange={(nextTab) => {
            // T28: параметр переименован из "t" в "nextTab" — совпадало по имени
            // с useT().t (переводчик) в замыкающей области видимости, затеняло его
            setSub(null); // под-экран живёт внутри раздела — смена раздела закрывает его
            setTab(nextTab);
          }}
        />
        {/* Под-экран (sub !== null) рендерится сюда же вместо содержимого
            раздела: навигация остаётся на месте с подсвеченным разделом,
            назад — кнопкой SubHeader. */}
        <div className="muza-settings__pane" id={SETTINGS_PANE_ID} role="tabpanel" aria-labelledby={navItemId(tab)}>
          {pane}
        </div>
      </div>

      {/* T44/T44b: согласие на права при установке плагина из файла —
          app:full-access получает отдельный громкий экран (чекбокс + задержка
          кнопки), обычные права — честный список с выделением опасных. */}
      <Dialog
        open={staged !== null}
        title={staged ? t("settings.extensions.installDialog.title", { name: staged.manifest.name }) : t("settings.extensions.installDialog.titleGeneric")}
        onClose={declineInstall}
        actions={
          <>
            {/* Кнопка отказа — первая в разметке = дефолтный фокус Dialog
                (см. muza-design-system Dialog: focus jumps to first field/button). */}
            <Button variant="ghost" onClick={declineInstall}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              icon="download"
              disabled={!staged || fullAccessBlocked(staged.manifest)}
              onClick={() => void confirmInstall()}
            >
              {staged && isFullAccessManifest(staged.manifest) && fullAccessRemaining > 0
                ? t("settings.extensions.installDialog.wait", { n: fullAccessRemaining })
                : t("common.install")}
            </Button>
          </>
        }
      >
        {staged ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 320, maxWidth: 420 }}>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              {staged.manifest.description} · v{staged.manifest.version} · {staged.manifest.author}
            </div>
            {isFullAccessManifest(staged.manifest) ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--sp-3)",
                    padding: "var(--sp-4)",
                    borderRadius: "var(--r-md)",
                    background: "color-mix(in srgb, var(--danger) 14%, transparent)",
                  }}
                >
                  <Icon name="shield-alert" size={22} color="var(--danger)" />
                  <div style={{ fontSize: "var(--fs-body)", color: "var(--danger)", fontWeight: 600, lineHeight: 1.4 }}>
                    {t("settings.extensions.installDialog.fullAccessWarning", { author: staged.manifest.author })}
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", cursor: "pointer" }}>
                  <Switch checked={fullAccessAck} onChange={setFullAccessAck} label={t("settings.extensions.installDialog.trustAuthor")} />
                  <span style={{ fontSize: "var(--fs-body)", color: "var(--text-1)" }}>{t("settings.extensions.installDialog.trustAuthor")}</span>
                </label>
              </>
            ) : staged.manifest.permissions.length === 0 ? (
              <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.extensions.installDialog.noPermissions")}</div>
            ) : (
              <>
                <div style={{ fontSize: "var(--fs-body)", color: "var(--text-1)", fontWeight: 600 }}>{t("settings.extensions.installDialog.permissionsAsk")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                  {staged.manifest.permissions.map((perm) => {
                    const info = PERMISSION_INFO[perm as PluginPermission];
                    return (
                      <div key={perm} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                        <Icon
                          name={info?.dangerous ? "shield-alert" : "check"}
                          size={16}
                          color={info?.dangerous ? "var(--danger)" : "var(--accent-text)"}
                        />
                        <span style={{ fontSize: "var(--fs-body)", color: info?.dangerous ? "var(--danger)" : "var(--text-2)" }}>
                          {info?.label ?? perm}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {staged.manifest.net_allow?.length ? (
                  <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
                    {t("settings.extensions.installDialog.network", { list: staged.manifest.net_allow.join(", ") })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </Dialog>

      {/* T44b: выключение full-access-плагина не выгружает исполненный код
          (realm живёт до рестарта, §5.3 дока) — предлагаем рестарт сразу. */}
      <Dialog
        open={restartPromptName !== null}
        title={t("settings.extensions.restartDialog.title")}
        onClose={() => setRestartPromptName(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRestartPromptName(null)}>
              {t("settings.extensions.restartDialog.later")}
            </Button>
            <Button variant="primary" icon="refresh-cw" onClick={() => void relaunch()}>
              {t("settings.extensions.restartDialog.restart")}
            </Button>
          </>
        }
      >
        <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
          {t("settings.extensions.restartDialog.body", { name: restartPromptName ?? "" })}
        </div>
      </Dialog>

      {/* Смена пароля: старый → новый (сервер разлогинит остальные устройства) */}
      <Dialog
        open={pwdOpen}
        title={t("settings.account.password.dialogTitle")}
        onClose={() => setPwdOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPwdOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="shield-check" disabled={pwdBusy} onClick={() => void submitPwd()}>
              {pwdBusy ? t("settings.account.password.changing") : t("settings.account.password.submit")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <SettingInput type="password" value={pwdCur} onChange={setPwdCur} placeholder={t("settings.account.password.currentPlaceholder")} width={300} />
          <SettingInput type="password" value={pwdNew} onChange={setPwdNew} placeholder={t("settings.account.password.newPlaceholder")} width={300} />
          <SettingInput type="password" value={pwdRepeat} onChange={setPwdRepeat} placeholder={t("settings.account.password.repeatPlaceholder")} width={300} />
          {pwdErr ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{pwdErr}</div>
          ) : (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.account.password.otherDevicesNote")}</div>
          )}
        </div>
      </Dialog>

      {/* Смена почты (C1): пароль + новая почта → письмо на новый адрес.
          T3: dev-фолбэк сервера (SMTP выключен) — вместо тоста показываем
          ссылку подтверждения прямо в диалоге, иначе её негде увидеть. */}
      <Dialog
        open={emailOpen}
        title={t("settings.account.email.dialogTitle")}
        onClose={closeEmailChange}
        actions={
          emailConfirmUrl ? (
            <Button variant="primary" onClick={closeEmailChange}>
              {t("settings.account.email.done")}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={closeEmailChange}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" icon="mail" disabled={emailBusy} onClick={() => void submitEmailChange()}>
                {emailBusy ? t("settings.account.email.sending") : t("settings.account.email.submit")}
              </Button>
            </>
          )
        }
      >
        {emailConfirmUrl ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 320 }}>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.5 }}>{t("settings.account.email.devNote")}</div>
            <Button
              variant="ghost"
              icon="external-link"
              onClick={() => void openExternal(emailConfirmUrl)}
              style={{ alignSelf: "flex-start" }}
            >
              {t("settings.account.email.openConfirmLink")}
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
            <SettingInput type="password" value={emailPwd} onChange={setEmailPwd} placeholder={t("settings.account.email.passwordPlaceholder")} width={300} />
            <SettingInput value={emailNew} onChange={setEmailNew} placeholder={t("settings.account.email.newEmailPlaceholder")} width={300} />
            {emailErr ? (
              <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{emailErr}</div>
            ) : (
              <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.account.email.confirmNote")}</div>
            )}
          </div>
        )}
      </Dialog>

      {/* Удаление аккаунта (C3): двухшаговое — кнопка в под-экране, тут пароль */}
      <Dialog
        open={delOpen}
        title={t("settings.privacy.deleteDialog.title")}
        onClose={() => setDelOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDelOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="trash-2" disabled={delBusy || delPwd.length < 8} onClick={() => void submitDelete()}>
              {delBusy ? t("settings.privacy.deleteDialog.deleting") : t("settings.privacy.deleteDialog.confirm")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.5 }}>{t("settings.privacy.deleteDialog.body")}</div>
          <SettingInput type="password" value={delPwd} onChange={setDelPwd} placeholder={t("settings.privacy.deleteDialog.passwordPlaceholder")} width={300} />
          {delErr ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{delErr}</div> : null}
        </div>
      </Dialog>

      {/* ListenBrainz: user token со страницы настроек LB */}
      <Dialog
        open={lbOpen}
        title={t("settings.integrations.listenbrainz.dialogTitle")}
        onClose={() => setLbOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setLbOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="link" disabled={lbBusy} onClick={() => void lbConnect()}>
              {lbBusy ? t("settings.integrations.listenbrainz.checking") : t("common.connect")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 320 }}>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.5 }}>{t("settings.integrations.listenbrainz.dialogBody")}</div>
          <Button
            variant="ghost"
            icon="external-link"
            onClick={() => void openExternal("https://listenbrainz.org/settings/")}
            style={{ alignSelf: "flex-start" }}
          >
            {t("settings.integrations.listenbrainz.openSettings")}
          </Button>
          <SettingInput value={lbToken} onChange={setLbToken} placeholder={t("settings.integrations.listenbrainz.tokenPlaceholder")} width={320} />
          {lbErr ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{lbErr}</div> : null}
        </div>
      </Dialog>

      {/* Сохранить тему: имя (одноимённая перезаписывается) */}
      <Dialog
        open={themeNameOpen}
        title={t("settings.customize.themes.saveDialog.title")}
        onClose={() => setThemeNameOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setThemeNameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="save" onClick={submitSaveTheme}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <SettingInput value={themeName} onChange={setThemeName} placeholder={t("settings.customize.themes.namePlaceholder")} width={300} />
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.customize.themes.saveDialog.hint")}</div>
        </div>
      </Dialog>

      {/* Импорт темы: JSON из буфера (Ctrl+V) */}
      <Dialog
        open={themeImportOpen}
        title={t("settings.customize.themes.importDialog.title")}
        onClose={() => setThemeImportOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setThemeImportOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="clipboard-paste" onClick={submitImportTheme}>
              {t("settings.customize.themes.importDialog.submit")}
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
          {themeImportErr ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{themeImportErr}</div>
          ) : (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.customize.themes.importDialog.hint")}</div>
          )}
        </div>
      </Dialog>

      {/* Публикация темы в маркетплейс */}
      <Dialog
        open={publishOpen}
        title={t("settings.market.publishDialog.title")}
        onClose={() => setPublishOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="upload" disabled={publishBusy} onClick={() => void submitPublishTheme()}>
              {publishBusy ? t("settings.market.publishDialog.publishing") : t("settings.market.publishDialog.submit")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <SettingInput value={publishName} onChange={setPublishName} placeholder={t("settings.customize.themes.namePlaceholder")} width={300} />
          {publishErr ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{publishErr}</div>
          ) : (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.market.publishDialog.hint")}</div>
          )}
        </div>
      </Dialog>

      {/* Тема с чужим CSS: честное предупреждение перед установкой */}
      <Dialog
        open={cssWarnTheme !== null}
        title={t("settings.market.cssWarnDialog.title")}
        onClose={() => setCssWarnTheme(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setCssWarnTheme(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              icon="download"
              onClick={() => {
                const theme = cssWarnTheme;
                setCssWarnTheme(null);
                if (theme) void doInstallTheme(theme);
              }}
            >
              {t("settings.market.cssWarnDialog.installAnyway")}
            </Button>
          </>
        }
      >
        <div style={{ maxWidth: 360, fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.55 }}>
          {t("settings.market.cssWarnDialog.body")}
        </div>
      </Dialog>
    </div>
  );
}
