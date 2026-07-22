"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ChipGroup, Fader, Icon, Switch } from "@muza/ui";
import { DesktopOnlyOverlay } from "@muza/app/components/DesktopOnly";
import { EQ_PRESETS } from "../../../src/audioFx";
import { usePrefs } from "../../../src/prefs";
import { useSession } from "../../../src/session";

/** Настройки веба — структура десктопного SettingsView (сайдбар категорий +
 *  панель справа), состав минимальный (полная кастомизация — фишка десктопа):
 *  эквалайзер (та же 10-полосная модель, что в приложении), акцент ДС,
 *  сценография, панель «Сейчас играет», витрины десктопных функций, аккаунт.
 *  Навигация — role=tablist/tab/tabpanel, как в десктопе (SettingsView.tsx):
 *  выбор категории мгновенно меняет соседнюю панель, ни маршрута, ни истории.
 *  Раскладка и адаптив (<900px — горизонтальные табы-чипы) — globals.css,
 *  секция «Настройки». */

const EQ_LABELS = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];

const ACCENTS: { key: "blue" | "red" | "bolt"; color: string; label: string }[] = [
  { key: "blue", color: "#3b82f6", label: "Небесный (дефолт)" },
  { key: "bolt", color: "#327ad9", label: "Молния логотипа" },
  { key: "red", color: "#f76967", label: "Пламя логотипа" },
];

/** Категории настроек — зеркало десктопной модели (SETTINGS_TAB_KEYS +
 *  SETTINGS_TAB_ICONS в SettingsView.tsx), состав веба: порядок массива =
 *  порядок пунктов навигации. */
const SECTIONS = [
  { key: "appearance", icon: "paintbrush", label: "Внешний вид" },
  { key: "sound", icon: "audio-lines", label: "Звук" },
  { key: "search", icon: "search", label: "Поиск" },
  { key: "integrations", icon: "plug", label: "Интеграции" },
  { key: "offline", icon: "hard-drive", label: "Оффлайн" },
  { key: "customize", icon: "sparkles", label: "Кастомизация+" },
  { key: "account", icon: "user", label: "Аккаунт" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

/** id пункта навигации — на него ссылается aria-labelledby панели. */
const sectionTabId = (key: string) => `settings-tab-${key}`;
/** id панели — на него ссылается aria-controls пунктов навигации. */
const SETTINGS_PANE_ID = "settings-pane";

function Row({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-4)",
        padding: "var(--sp-3) 0",
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 200, flex: 1 }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-1)" }}>{title}</div>
        {hint ? (
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: 2 }}>{hint}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Заголовок группы внутри панели (для панелей с несколькими темами). */
function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: "var(--sp-5) 0 var(--sp-2)",
        fontSize: "var(--fs-caption)",
        fontWeight: 600,
        letterSpacing: "var(--ls-caps)",
        textTransform: "uppercase",
        color: "var(--text-3)",
      }}
    >
      {children}
    </h3>
  );
}

/** Шапка активной панели — название категории (как заголовок раздела десктопа). */
function PaneTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: "0 0 var(--sp-2)",
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        fontSize: 17,
        color: "var(--text-1)",
      }}
    >
      {children}
    </h2>
  );
}

const RADII = [
  { key: "mild" as const, label: "Сдержанные" },
  { key: "soft" as const, label: "Мягкие" },
  { key: "round" as const, label: "Круглые" },
];

const FONTS = [
  { key: "golos" as const, label: "Golos" },
  { key: "unbounded" as const, label: "Unbounded" },
  { key: "system" as const, label: "Системный" },
];

export default function SettingsPage() {
  const { prefs, set } = usePrefs();
  const { session, logout } = useSession();
  const router = useRouter();
  const colorRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<SectionKey>("appearance");

  const applyPreset = (name: string) => {
    const bands = EQ_PRESETS[name];
    set(bands ? { eqPreset: name, eqBands: bands } : { eqPreset: name });
  };

  const setBand = (i: number, v: number) => {
    const bands = [...prefs.eqBands];
    bands[i] = Math.round(v);
    set({ eqBands: bands, eqPreset: "Свой" });
  };

  const appearancePane = (
    <>
      <PaneTitle>Внешний вид</PaneTitle>
      <Row title="Светлая тема" hint="Тёплый светлый интерфейс вместо графита">
        <Switch
          checked={prefs.theme === "light"}
          onChange={(on: boolean) => set({ theme: on ? "light" : "dark" })}
          label="Светлая тема"
        />
      </Row>
      <Row title="Акцентный цвет" hint="Красит кнопки, активные строки и караоке; пипетка — любой свой">
        <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          {ACCENTS.map((a) => (
            <button
              key={a.key}
              type="button"
              className={prefs.accent === a.key ? "swatch active" : "swatch"}
              style={{ background: a.color }}
              aria-label={a.label}
              aria-pressed={prefs.accent === a.key}
              onClick={() => set({ accent: a.key })}
            />
          ))}
          <button
            type="button"
            className={prefs.accent === "custom" ? "swatch active" : "swatch"}
            style={{ background: prefs.accent === "custom" ? prefs.customAccent : "var(--surface-3)" }}
            aria-label="Свой цвет"
            aria-pressed={prefs.accent === "custom"}
            onClick={() => colorRef.current?.click()}
          />
          <input
            ref={colorRef}
            type="color"
            value={prefs.customAccent}
            aria-hidden="true"
            tabIndex={-1}
            style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
            onInput={(e) => set({ accent: "custom", customAccent: (e.target as HTMLInputElement).value })}
          />
        </div>
      </Row>
      <Row title="Скругления" hint="Форма плиток, панелей и кнопок">
        <ChipGroup
          items={RADII.map((r) => r.label)}
          value={RADII.find((r) => r.key === prefs.radius)?.label ?? "Мягкие"}
          onChange={(label: string) => set({ radius: RADII.find((r) => r.label === label)?.key ?? "soft" })}
        />
      </Row>
      <Row title="Шрифт интерфейса" hint="Подписи и тексты всего веб-плеера">
        <ChipGroup
          items={FONTS.map((f) => f.label)}
          value={FONTS.find((f) => f.key === prefs.fontUi)?.label ?? "Golos"}
          onChange={(label: string) => set({ fontUi: FONTS.find((f) => f.label === label)?.key ?? "golos" })}
        />
      </Row>
      <Row title="Плотность стекла" hint="Насколько плотное матовое стекло у панелей">
        <input
          type="range"
          min={30}
          max={90}
          value={prefs.glassOpacity}
          aria-label="Плотность стекла"
          aria-valuetext={`${prefs.glassOpacity}%`}
          style={{ width: 200, accentColor: "var(--accent)" }}
          onChange={(e) => set({ glassOpacity: Number(e.target.value) })}
        />
      </Row>
      <Row title="Фон из обложки" hint="Размытая обложка трека за интерфейсом — фирменный вид Muza">
        <Switch checked={prefs.bgCover} onChange={(bgCover: boolean) => set({ bgCover })} label="Фон из обложки" />
      </Row>
      <Row title="Панель «Сейчас играет»" hint="Открывается сама при старте трека (на широком экране)">
        <Switch checked={prefs.npOpen} onChange={(npOpen: boolean) => set({ npOpen })} label="Панель «Сейчас играет»" />
      </Row>
    </>
  );

  const soundPane = (
    <>
      <PaneTitle>Звук</PaneTitle>
      <Row title="Эквалайзер" hint="10 полос, как в приложении. Работает на играющем треке">
        <Switch checked={prefs.eqOn} onChange={(eqOn: boolean) => set({ eqOn })} label="Эквалайзер" />
      </Row>
      <div style={prefs.eqOn ? undefined : { opacity: 0.4, pointerEvents: "none" }}>
        <div className="eq-faders" style={{ margin: "var(--sp-2) 0 var(--sp-3)", padding: 0 }}>
          <ChipGroup items={[...Object.keys(EQ_PRESETS), "Свой"]} value={prefs.eqPreset} onChange={applyPreset} />
        </div>
        <div className="eq-faders">
          {prefs.eqBands.map((v, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-1)" }}>
              <Fader value={v} min={-12} max={12} height={120} onChange={(nv: number) => setBand(i, nv)} ariaLabel={`Полоса ${EQ_LABELS[i]} Гц`} />
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--text-3)" }}>{EQ_LABELS[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  const searchPane = (
    <>
      <PaneTitle>Поиск</PaneTitle>
      <Row
        title="Группировать версии и ремиксы"
        hint="Оригинал и его ремиксы/спидапы/каверы — под одной карточкой вместо отдельных строк"
      >
        <Switch checked={prefs.searchGrouping} onChange={(searchGrouping: boolean) => set({ searchGrouping })} label="Группировать версии и ремиксы" />
      </Row>
    </>
  );

  /* Витрины десктопных функций под оверлеями (по слову владельца 21.07):
     функция отрисована и понятна, но менять — в приложении */
  const integrationsPane = (
    <>
      <PaneTitle>Интеграции</PaneTitle>
      <GroupTitle>Discord</GroupTitle>
      <DesktopOnlyOverlay hint="Discord-статус ведёт приложение для Windows">
        <Row title="Rich Presence" hint="Discord показывает трек, обложку и кнопку у тебя в профиле">
          <Switch checked onChange={() => {}} label="Rich Presence" />
        </Row>
        <Row title="Кнопка в статусе" hint="Своя надпись и ссылка под треком">
          <Switch checked onChange={() => {}} label="Кнопка в статусе" />
        </Row>
      </DesktopOnlyOverlay>
    </>
  );

  const offlinePane = (
    <>
      <PaneTitle>Оффлайн</PaneTitle>
      <DesktopOnlyOverlay hint="Оффлайн-кэш — в приложении для Windows">
        <Row title="Сохранять треки офлайн" hint="Слушать без интернета; кэш чистится сам по лимиту">
          <Switch checked onChange={() => {}} label="Сохранять треки офлайн" />
        </Row>
        <Row title="Лимит кэша" hint="Сколько места отдать под музыку">
          <ChipGroup items={["2 ГБ", "5 ГБ", "10 ГБ"]} value="5 ГБ" onChange={() => {}} />
        </Row>
      </DesktopOnlyOverlay>
    </>
  );

  const customizePane = (
    <>
      <PaneTitle>Кастомизация+</PaneTitle>
      <DesktopOnlyOverlay hint="Глубокая кастомизация — в приложении для Windows">
        <Row title="Фон интерфейса" hint="Цвет, градиент, картинка или живая анимированная сцена">
          <ChipGroup items={["Обложка", "Градиент", "Живой"]} value="Обложка" onChange={() => {}} />
        </Row>
        <Row title="Свой CSS" hint="Дописать стили поверх любой темы">
          <Switch checked={false} onChange={() => {}} label="Свой CSS" />
        </Row>
        <Row title="Темы из маркетплейса" hint="Готовые темы других пользователей — в один клик">
          <Button variant="secondary">Открыть маркетплейс</Button>
        </Row>
      </DesktopOnlyOverlay>
    </>
  );

  const accountPane = (
    <>
      <PaneTitle>Аккаунт</PaneTitle>
      <Row title={session?.user.username ?? ""} hint="Полные настройки аккаунта и оффлайн — в приложении для Windows">
        <Button
          variant="ghost"
          icon="log-out"
          onClick={() => {
            void logout().then(() => router.replace("/login"));
          }}
        >
          Выйти
        </Button>
      </Row>
    </>
  );

  const panes: Record<SectionKey, React.ReactNode> = {
    appearance: appearancePane,
    sound: soundPane,
    search: searchPane,
    integrations: integrationsPane,
    offline: offlinePane,
    customize: customizePane,
    account: accountPane,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <h1 className="page-title" style={{ marginBottom: "var(--sp-5)" }}>
        Настройки
      </h1>
      <div className="settings-layout">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Разделы настроек">
          {SECTIONS.map((s) => {
            const active = s.key === section;
            return (
              <button
                key={s.key}
                id={sectionTabId(s.key)}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={SETTINGS_PANE_ID}
                className="settings-nav__item"
                onClick={() => setSection(s.key)}
              >
                {/* активная категория — акцентная иконка, как пункты сайдбара */}
                <Icon name={s.icon} size={20} color={active ? "var(--accent-text)" : "currentColor"} />
                {s.label}
              </button>
            );
          })}
        </nav>
        <div
          className="settings-pane"
          id={SETTINGS_PANE_ID}
          role="tabpanel"
          aria-labelledby={sectionTabId(section)}
        >
          {panes[section]}
        </div>
      </div>
    </div>
  );
}
