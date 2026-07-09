import { useState } from "react";
import { Button, Icon, IconButton, Slider, Switch, Tabs } from "@muza/ui";
import type { Prefs } from "../types";

function SettingRow({
  title,
  hint,
  onClick,
  chevron,
  children,
}: {
  title: string;
  hint?: string;
  onClick?: () => void;
  chevron?: boolean;
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
        <div style={{ fontSize: "var(--fs-body)", fontWeight: 500, color: "var(--text-1)" }}>{title}</div>
        {hint ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: 2 }}>{hint}</div> : null}
      </div>
      {children}
      {chevron ? <Icon name="chevron-right" size={18} color="var(--text-3)" /> : null}
    </Tag>
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
        <span
          style={{
            width: 44,
            height: 30,
            borderRadius: r,
            background: accentColor,
            display: "block",
            transition: "border-radius var(--dur-base) var(--ease-out)",
          }}
        ></span>
        <span
          style={{
            width: 24,
            height: 30,
            borderRadius: r,
            background: "var(--surface-4)",
            display: "block",
            transition: "border-radius var(--dur-base) var(--ease-out)",
          }}
        ></span>
      </span>
      <span>
        <span
          style={{
            display: "block",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-body)",
            fontWeight: 600,
            color: "var(--text-1)",
          }}
        >
          {name}
        </span>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
          {hint}
        </span>
      </span>
    </button>
  );
}

export function SettingsView({
  prefs,
  setPrefs,
  username,
  onLogout,
}: {
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  username: string;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState("custom");
  const [sub, setSub] = useState<string | null>(null);
  const set = (patch: Partial<Prefs>) => setPrefs({ ...prefs, ...patch });
  const presets = [
    { key: "muza", name: "Муза", hint: "Синий · мягкие углы", accent: "blue" as const, accentColor: "#3b82f6", radius: "soft" as const },
    { key: "flame", name: "Пламя", hint: "Красный · круглее", accent: "red" as const, accentColor: "#f76967", radius: "round" as const },
    { key: "graphite", name: "Графит", hint: "Молния · строже", accent: "bolt" as const, accentColor: "#327ad9", radius: "mild" as const },
  ];

  if (sub === "advanced") {
    return (
      <div
        className="muza-view"
        style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0", maxWidth: 720 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <IconButton icon="arrow-left" label="Назад" onClick={() => setSub(null)} />
          <h1 style={{ margin: 0, fontSize: "var(--fs-h1)", fontWeight: 700, color: "var(--text-1)" }}>Продвинутые</h1>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", paddingBottom: "var(--sp-6)" }}>
          <SettingRow title="Размытие стекла" hint="Сила blur на матовых панелях">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", width: 240 }}>
              <Slider value={prefs.blur} max={64} onChange={(v: number) => set({ blur: Math.round(v) })} ariaLabel="Размытие стекла" style={{ flex: 1 }} />
              <span
                style={{
                  fontSize: "var(--fs-caption)",
                  color: "var(--text-3)",
                  width: 44,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {prefs.blur} px
              </span>
            </div>
          </SettingRow>
          <SettingRow title="Плотность стекла" hint="Насколько непрозрачны панели">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", width: 240 }}>
              <Slider
                value={prefs.glassOpacity}
                max={100}
                onChange={(v: number) => set({ glassOpacity: Math.round(Math.max(30, v)) })}
                ariaLabel="Плотность стекла"
                style={{ flex: 1 }}
              />
              <span
                style={{
                  fontSize: "var(--fs-caption)",
                  color: "var(--text-3)",
                  width: 44,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {prefs.glassOpacity} %
              </span>
            </div>
          </SettingRow>
          <SettingRow title="Анимации" hint="Плавные переходы интерфейса">
            <Switch checked={prefs.anims} onChange={(anims: boolean) => set({ anims })} label="Анимации" />
          </SettingRow>
          <div style={{ marginTop: "var(--sp-2)" }}>
            <Button variant="ghost" icon="rotate-ccw" onClick={() => set({ blur: 28, glassOpacity: 62, anims: true })}>
              Сбросить
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0", maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: "var(--fs-h1)", fontWeight: 700, color: "var(--text-1)" }}>Настройки</h1>
      <Tabs
        items={[
          { key: "general", label: "Общие" },
          { key: "custom", label: "Кастомизация" },
          { key: "sound", label: "Звук" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "custom" ? (
        <div key="custom" className="muza-view" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", paddingBottom: "var(--sp-6)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-3)" }}>
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
          <SettingRow title="Акцентный цвет" hint="Один на всё приложение">
            <div style={{ display: "flex", gap: "var(--sp-3)" }}>
              <AccentSwatch color="#3b82f6" label="Синий" selected={prefs.accent === "blue"} onClick={() => set({ accent: "blue" })} />
              <AccentSwatch color="#f76967" label="Красный" selected={prefs.accent === "red"} onClick={() => set({ accent: "red" })} />
              <AccentSwatch color="#327ad9" label="Молния" selected={prefs.accent === "bolt"} onClick={() => set({ accent: "bolt" })} />
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
          <SettingRow title="Обложка фоном" hint="Размытая обложка трека за интерфейсом">
            <Switch checked={prefs.bgCover} onChange={(bgCover: boolean) => set({ bgCover })} label="Обложка фоном" />
          </SettingRow>
          <SettingRow title="Продвинутые" hint="Размытие, плотность стекла, анимации" onClick={() => setSub("advanced")} chevron></SettingRow>
        </div>
      ) : tab === "general" ? (
        <div key="general" className="muza-view" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", paddingBottom: "var(--sp-6)" }}>
          <SettingRow title="Аккаунт" hint={username}>
            <Button variant="ghost" icon="log-out" onClick={onLogout}>
              Выйти
            </Button>
          </SettingRow>
          <SettingRow title="Запускать при старте Windows">
            <Switch checked={prefs.autostart} onChange={(autostart: boolean) => set({ autostart })} label="Автозапуск" />
          </SettingRow>
          <SettingRow title="Сворачивать в трей">
            <Switch checked={prefs.tray} onChange={(tray: boolean) => set({ tray })} label="Трей" />
          </SettingRow>
        </div>
      ) : (
        <div key="sound" className="muza-view" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", paddingBottom: "var(--sp-6)" }}>
          <SettingRow title="Нормализация громкости" hint="Выравнивает громкость между треками">
            <Switch checked={prefs.normalize} onChange={(normalize: boolean) => set({ normalize })} label="Нормализация" />
          </SettingRow>
          <SettingRow title="Плавный переход" hint="Кроссфейд между треками, 4 сек">
            <Switch checked={prefs.crossfade} onChange={(crossfade: boolean) => set({ crossfade })} label="Кроссфейд" />
          </SettingRow>
        </div>
      )}
    </div>
  );
}
