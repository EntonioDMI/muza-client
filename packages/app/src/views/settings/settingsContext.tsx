/** СВЯЗУЮЩАЯ ТКАНЬ ЭКРАНА НАСТРОЕК (волна «настройки», 2026-08-02).
 *
 *  Экран настроек распилен на 23 файла — по файлу на раздел и на под-экран.
 *  Пилить пришлось потому, что apps/desktop/src/views/SettingsView.tsx вырос
 *  до 4372 строк и стал единственным экраном, который не переехал в общий
 *  пакет: в нём было двенадцать прямых обращений к Tauri.
 *
 *  Чтобы у двадцати трёх файлов не выросло по сорок пропсов, всё общее едет
 *  контекстом. В нём ТРИ разных вещи, и их полезно не путать:
 *
 *   1. ДАННЫЕ ЭКРАНА — prefs/set, api, кто вошёл, тосты. Меняются постоянно.
 *   2. УМЕНИЯ ПЛОЩАДКИ (`caps`) — что эта программа вообще может. Ими
 *      решается, ЕСТЬ ли ряд: нет умения — ряда нет вовсе, не серого. Тот же
 *      список фильтрует поиск по настройкам (lib/settingsIndex.ts), поэтому
 *      поиск физически не может привести к ряду, которого нет.
 *   3. ПОРТЫ (`platform`) — чем ряд ДЕЛАЕТ своё дело. Умения выводятся из
 *      портов (settingsCaps ниже), так что разъехаться им негде.
 *
 *  Плюс небольшое состояние, которое обязано пережить переключение раздела и
 *  потому не может жить внутри панели: расширения (ставить можно и из файла в
 *  «Расширениях», и с витрины в «Маркетплейсе» — экран согласия ОДИН),
 *  проверка обновлений и версия программы. Всё остальное состояние живёт в
 *  своей панели и честно перезапрашивается при входе — ровно как раньше, когда
 *  этим управляли эффекты по `tab`/`sub`.
 *
 *  ⚠️ Ни одного импорта из `@tauri-apps/*` и ни одного `import.meta.env`:
 *  файл живёт в общем пакете и попадает в оба бандла. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, Dialog, Icon, Switch } from "@muza/ui";
import { isFullAccessManifest, PERMISSION_INFO, type PluginPermission } from "@muza/core";
import type { MuzaApi } from "@muza/api-client";
import { useT } from "../../i18n";
import type { Prefs } from "../../prefs/types";
import type {
  InstalledPluginRef,
  PlatformAdapter,
  PluginErrorRecord,
  StagedPluginRef,
  UpdateFound,
} from "../../platform";
import { SETTINGS_INDEX, type SettingsCapability } from "../../lib/settingsIndex";
import type { SettingsTabKey } from "./SettingsNav";

/** Под-экраны настроек: тяжёлый пункт — отдельный экран, а не строка.
 *  Порядок массива ни на что не влияет, это просто перечень. */
export const SETTINGS_SUB_KEYS = [
  "customize",
  "equalizer",
  "outputs",
  "discord",
  "market",
  "data",
  "stats",
  "licenses",
  "bar",
  "nav",
  "sessions",
  "privacy",
  "stage0",
] as const;

export type SettingsSubKey = (typeof SETTINGS_SUB_KEYS)[number];

/** Раздел, которому принадлежит под-экран: вход в под-экран подсвечивает в
 *  рельсе его раздел, а «назад» возвращает именно туда. */
export const SUB_HOME_TAB: Record<SettingsSubKey, SettingsTabKey> = {
  customize: "appearance",
  equalizer: "playback",
  outputs: "playback",
  discord: "integrations",
  // Витрина переехала в «Внешний вид» 2026-08-11 (решение владельца). Была за
  // «Расширениями» — разделом, которого в браузере нет вовсе, и оформления
  // оказывались заперты вместе с плагинами, хотя тема это просто набор
  // значений настроек и ставится где угодно. Вход теперь один: «Внешний вид →
  // Кастомизация → Маркетплейс тем», и он есть на обеих площадках.
  // ⚠️ Половина расширений у витрины осталась и открывается из «Расширений»
  // (ExtensionsPane → «Маркетплейс расширений»). На «назад» это не влияет:
  // выход из под-экрана возвращает в ТЕКУЩИЙ раздел (SettingsScreen: closeSub
  // просто гасит sub), а эта карта нужна ровно одному потребителю — заявке
  // «открыть под-экран снаружи» из полосы плеера, и на витрину её не бывает.
  market: "appearance",
  data: "account",
  stats: "library",
  licenses: "system",
  bar: "appearance",
  nav: "appearance",
  sessions: "account",
  privacy: "account",
  stage0: "system",
};

/** Играющий трек — честный предпросмотр статуса Discord (обложка сырая, как
 *  в реальной активности); null — демо-значения. */
export interface SettingsNowPlaying {
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  duration: number;
}

/** Расширения: одно состояние на весь экран. Ставить можно из двух мест, а
 *  экран согласия и разрешение на перезапуск — общие. */
export interface SettingsPluginsState {
  /** Установленные на этом устройстве; пусто, когда площадка не умеет. */
  installed: InstalledPluginRef[];
  /** Ошибки расширений с полным доступом. */
  errors: PluginErrorRecord[];
  /** Идёт выбор файла — кнопка «Установить из файла» ждёт. */
  busy: boolean;
  /** Открыть системный выбор файла и показать экран согласия. */
  installFromFile: () => Promise<void>;
  /** Поставить с витрины: тот же экран согласия, данные вместо файла. */
  installFromMarket: (payload: {
    manifest: Record<string, unknown>;
    code: string;
    css?: string;
    strings?: Record<string, string>;
  }) => Promise<void>;
  setEnabled: (id: string, on: boolean) => Promise<void>;
  remove: (id: string, name: string) => Promise<void>;
  clearErrors: () => void;
}

/** Проверка и установка обновления: живёт над панелями, чтобы «найдено 0.1.4»
 *  не исчезало при уходе в другой раздел и обратно (так было и до распила). */
export interface SettingsUpdateState {
  state: "idle" | "checking" | "none" | "found" | "installing" | "error";
  found: UpdateFound | null;
  /** Проценты скачивания; −1 — размер заранее неизвестен. */
  pct: number;
  check: () => Promise<void>;
  install: () => Promise<void>;
}

export interface SettingsScreenCtx {
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  /** Точечная правка настроек. */
  set: (patch: Partial<Prefs>) => void;
  api: MuzaApi;
  /** false у анонима: серверные функции аккаунта недоступны. */
  serverSession: boolean;
  username: string;
  isAdmin: boolean;
  onLogout: () => void;
  onNotify: (text: string, icon?: string) => void;
  /** Строка «Помощь / закрыть» открывает диалог горячих клавиш. */
  onOpenHotkeys: () => void;
  nowPlaying: SettingsNowPlaying | null;
  /** Адрес значка программы: предпросмотр статуса Discord показывает его там,
   *  где у трека нет обложки. Приходит пропсом, а не импортом файла — тот же
   *  приём, что у экрана входа (glyphSrc): пути к ассетам считают сборщики
   *  площадок, и они у Vite и Next разные. */
  glyphSrc: string;
  /** Что умеет площадка — см. шапку. */
  caps: ReadonlySet<SettingsCapability>;
  /** Чем ряды делают своё дело. */
  platform: PlatformAdapter;
  /** Открыть под-экран (раздел подсветится сам). */
  openSub: (sub: SettingsSubKey) => void;
  /** Выйти из под-экрана в свой раздел. */
  closeSub: () => void;
  /** Перейти в раздел, при желании сразу в под-экран. */
  goTo: (tab: SettingsTabKey, sub?: SettingsSubKey | null) => void;
  /** Класс анимации панели: у самой первой панели его нет (вход в настройки
   *  анимирует обёртка экрана, иначе анимация играет дважды). */
  paneClass?: string;
  /** С каким фильтром открыли витрину. */
  marketFilter: "all" | "themes" | "plugins";
  setMarketFilter: (v: "all" | "themes" | "plugins") => void;
  plugins: SettingsPluginsState;
  updates: SettingsUpdateState;
  /** Версия программы; null — ещё не спросили либо площадка её не знает. */
  appVersion: string | null;
}

const Ctx = createContext<SettingsScreenCtx | null>(null);

/** Контекст экрана настроек. Бросает вне провайдера — это не «мягкая
 *  деградация», а ошибка сборки экрана, и молчать о ней нельзя. */
export function useSettingsScreen(): SettingsScreenCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettingsScreen: нет SettingsProvider над этим деревом");
  return ctx;
}

/** УМЕНИЯ ИЗ ПОРТОВ — единственное место, где список умений вычисляется.
 *
 *  Ровно поэтому поиск по настройкам не может привести в пустоту: и ряд, и
 *  строка индекса спрашивают ОДИН И ТОТ ЖЕ список, а он выведен из того, что
 *  площадка реально умеет, а не написан руками в двух местах.
 *
 *  Часть умений порта не имеет вовсе — они держатся не на железе, а на том,
 *  есть ли в самой программе то, чем ряд управляет. Два таких общие обеим
 *  площадкам (витрина оформлений — сервер; свой файл шрифта — <input
 *  type="file"> + localStorage), остальные пять есть только у приложения.
 *  Все они дописываются здесь константой — площадка, которой они не нужны,
 *  передаёт свой список руками. */
export function settingsCaps(platform: PlatformAdapter): SettingsCapability[] {
  // ⚠️ Четыре последних умения порта НЕ имеют и площадкам не общи: это не
  // железо, а наличие в самой программе того, чем ряд управляет —
  //   lookEdit    — слой правки вида (Ctrl+E);
  //   sleepTimer  — кнопка-луна в полосе плеера;
  //   streamQuality, videoTrack — движок добычи на устройстве.
  // Порта под них нет нарочно: розетка описывает, ЧЕМ ряд делает своё дело, а
  // здесь дело делает код самой программы. Поэтому они стоят константой, а
  // площадка, у которой их нет, снимает их руками — так и предусмотрено
  // контрактом ниже (apps/web settings/page.tsx → SKIP_IN_BROWSER).
  const caps: SettingsCapability[] = [
    "themeMarket",
    "customFont",
    "sourcePicker",
    "lookEdit",
    "sleepTimer",
    "streamQuality",
    "videoTrack",
  ];
  if (platform.localFiles) caps.push("localFiles");
  if (platform.storedMedia) caps.push("offlineCache");
  if (platform.system?.setAutostart) caps.push("autostart");
  if (platform.system?.configureTray) caps.push("tray");
  if (platform.updates) caps.push("updates");
  if (platform.miniPlayer) caps.push("miniPlayer");
  if (platform.diagnostics) caps.push("diagnostics");
  if (platform.plugins) caps.push("plugins");
  if (platform.audioDevices) caps.push("audioOutputs");
  if (platform.discordStatus) caps.push("discord");
  return caps;
}

/** ОПИСЬ РЯДОВ РАЗДЕЛА, ПРИЕХАВШЕГО ГОТОВЫМ.
 *
 *  Каркас настроек (SettingsScreen) спрашивает у площадки опись — «ключ индекса
 *  → где этот ряд нарисован»; по ней решается, показывать ли результат поиска и
 *  куда он ведёт. Раздел, который площадка взяла готовым компонентом отсюда
 *  (`<AccountPane/>`, «Интеграции», «Медиатека», «Система»), рисует ровно то,
 *  что знает индекс, и ровно там, где индекс написал, — минус ряды без умения.
 *  Переписывать это руками на странице нельзя: список разъехался бы с
 *  компонентом на первой же правке, поэтому опись берётся ЗДЕСЬ, из того же
 *  индекса, что и сам поиск.
 *
 *  Ряды под-экранов раздела сюда входят: «а можно ли туда попасть» каркас
 *  выясняет отдельно, по списку под-экранов площадки.
 *
 *  Раздел, который площадка собрала своей разметкой (у веба это оформление,
 *  звук, тексты, источники), перечисляет ключи руками рядом с этой разметкой —
 *  там и только там видно, какие ряды написаны на самом деле и в каком месте. */
export function paneRows(
  tab: SettingsTabKey,
  caps?: Iterable<SettingsCapability>,
): Record<string, SettingsSubKey | null> {
  const has = caps ? new Set(caps) : null;
  const out: Record<string, SettingsSubKey | null> = {};
  for (const entry of SETTINGS_INDEX) {
    if (entry.tab !== tab) continue;
    if (entry.needs && has && !has.has(entry.needs)) continue;
    out[entry.titleKey] = (entry.sub as SettingsSubKey | null) ?? null;
  }
  return out;
}

/** Валидные ключи плагинных кнопок бара — только у включённых расширений
 *  уровня 1 (полный доступ рисует себя сам, слотов не занимает). */
export function enabledLevel1Plugins(installed: readonly InstalledPluginRef[]): InstalledPluginRef[] {
  return installed.filter((p) => p.enabled && !isFullAccessManifest(p.manifest));
}

/** Задержка кнопки согласия на полный доступ, секунды: столько нельзя нажать
 *  «Установить» — чтобы не кликнули на автомате. */
const FULL_ACCESS_DELAY_SEC = 5;

/** Всё, что провайдеру нужно снаружи: поля контекста, которые он не считает
 *  сам, плюс дети и один сигнал наружу. */
export type SettingsProviderProps = {
  children: ReactNode;
  /** Список установленных расширений изменился — плееру пора перечитать
   *  рантайм, иначе новое расширение не оживёт до перезапуска программы. */
  onPluginsChanged?: () => void;
} & Omit<SettingsScreenCtx, "marketFilter" | "setMarketFilter" | "plugins" | "updates" | "appVersion" | "set">;

export function SettingsProvider({ children, onPluginsChanged, ...props }: SettingsProviderProps) {
  const { t } = useT();
  const { platform, onNotify, prefs, setPrefs } = props;
  const set = useCallback((patch: Partial<Prefs>) => setPrefs({ ...prefs, ...patch }), [prefs, setPrefs]);

  const [marketFilter, setMarketFilter] = useState<"all" | "themes" | "plugins">("all");

  // ── Расширения ───────────────────────────────────────────────────
  const pluginsPort = platform.plugins;
  // Сигнал наружу — через ref: колбэк приходит новым на каждый рендер
  // родителя, и в зависимостях он гонял бы перечитывание списка без конца.
  const onPluginsChangedRef = useRef(onPluginsChanged);
  onPluginsChangedRef.current = onPluginsChanged;
  const [installed, setInstalled] = useState<InstalledPluginRef[]>([]);
  // Обновляет и список этого экрана, и рантайм расширений в плеере — иначе
  // новое/переключённое расширение не оживало бы до перезапуска программы.
  const refreshPlugins = useCallback(() => {
    if (!pluginsPort) return;
    void pluginsPort
      .list()
      .then(setInstalled)
      .catch(() => setInstalled([]));
    onPluginsChangedRef.current?.();
  }, [pluginsPort]);
  useEffect(() => {
    refreshPlugins();
  }, [refreshPlugins]);

  const [staged, setStaged] = useState<StagedPluginRef | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  // Экран согласия на полный доступ: галочка + обратный отсчёт кнопки.
  // Сбрасывается на каждый новый staged (повторное согласие при обновлении —
  // это тот же путь установки заново).
  const [fullAccessAck, setFullAccessAck] = useState(false);
  const [fullAccessRemaining, setFullAccessRemaining] = useState(FULL_ACCESS_DELAY_SEC);
  useEffect(() => {
    if (!staged || !isFullAccessManifest(staged.manifest)) return;
    setFullAccessAck(false);
    setFullAccessRemaining(FULL_ACCESS_DELAY_SEC);
    const iv = setInterval(() => setFullAccessRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(iv);
  }, [staged]);
  const fullAccessBlocked = (m: StagedPluginRef["manifest"]) =>
    isFullAccessManifest(m) && (!fullAccessAck || fullAccessRemaining > 0);

  const [restartPromptName, setRestartPromptName] = useState<string | null>(null);

  const installFromFile = useCallback(async () => {
    if (!pluginsPort) return;
    setInstallBusy(true);
    try {
      const s = await pluginsPort.pickFile();
      if (s) setStaged(s); // откроется экран согласия
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("settings.extensions.errors.readFailed"), "x");
    } finally {
      setInstallBusy(false);
    }
  }, [pluginsPort, onNotify, t]);

  const installFromMarket = useCallback(
    async (payload: { manifest: Record<string, unknown>; code: string; css?: string; strings?: Record<string, string> }) => {
      if (!pluginsPort) return;
      const s = await pluginsPort.stageFromMarket(payload);
      setStaged(s); // тот же экран согласия, что и у установки из файла
    },
    [pluginsPort],
  );

  const confirmInstall = async () => {
    if (!staged || !pluginsPort) return;
    // Дублирует disabled на кнопке: одному только disabled в разметке не
    // доверяем (программный вызов, гонка отсчёта).
    if (fullAccessBlocked(staged.manifest)) return;
    try {
      await pluginsPort.finalize(staged, staged.manifest.permissions);
      onNotify(t("settings.extensions.pluginInstalled", { name: staged.manifest.name }), "puzzle");
      setStaged(null);
      refreshPlugins();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("settings.extensions.errors.installFailed"), "x");
    }
  };
  const declineInstall = () => {
    if (staged && pluginsPort) void pluginsPort.cancel(staged);
    setStaged(null);
  };

  const setPluginEnabled = useCallback(
    async (id: string, on: boolean) => {
      if (!pluginsPort) return;
      try {
        await pluginsPort.setEnabled(id, on);
        if (!on) {
          // Выключенное расширение с полным доступом остаётся в памяти до
          // перезапуска — предлагаем его сразу, а не молчим.
          const p = installed.find((pl) => pl.id === id);
          if (p && isFullAccessManifest(p.manifest)) setRestartPromptName(p.manifest.name);
        }
        refreshPlugins();
      } catch (e) {
        onNotify(e instanceof Error ? e.message : t("settings.extensions.errors.toggleFailed"), "x");
      }
    },
    [pluginsPort, installed, refreshPlugins, onNotify, t],
  );

  const removePlugin = useCallback(
    async (id: string, name: string) => {
      if (!pluginsPort) return;
      try {
        await pluginsPort.remove(id);
        onNotify(t("settings.extensions.pluginRemoved", { name }), "trash-2");
        refreshPlugins();
      } catch (e) {
        onNotify(e instanceof Error ? e.message : t("settings.extensions.errors.removeFailed"), "x");
      }
    },
    [pluginsPort, refreshPlugins, onNotify, t],
  );

  // Реестр ошибок расширений живёт в площадке — подписываемся на его версию.
  // Порта нет → подписка пустая, ошибок нет (и раздела «Расширения» тоже).
  const errorsVersion = useSyncExternalStore(
    useCallback((cb: () => void) => pluginsPort?.subscribeErrors(cb) ?? (() => undefined), [pluginsPort]),
    useCallback(() => pluginsPort?.errorsVersion() ?? 0, [pluginsPort]),
  );
  void errorsVersion;
  const pluginErrors = pluginsPort?.errors() ?? [];

  // ── Обновление программы ─────────────────────────────────────────
  const updatesPort = platform.updates;
  const [updState, setUpdState] = useState<SettingsUpdateState["state"]>("idle");
  const [updFound, setUpdFound] = useState<UpdateFound | null>(null);
  const [updPct, setUpdPct] = useState(-1);
  const checkUpdates = useCallback(async () => {
    if (!updatesPort) return;
    setUpdState("checking");
    try {
      const found = await updatesPort.check();
      setUpdFound(found);
      setUpdState(found ? "found" : "none");
    } catch {
      setUpdState("error");
    }
  }, [updatesPort]);
  const installUpdate = useCallback(async () => {
    if (!updFound) return;
    setUpdState("installing");
    setUpdPct(-1);
    try {
      await updFound.install(setUpdPct); // дальше перезапуск — код ниже не выполнится
    } catch {
      setUpdState("error");
      onNotify(t("settings.system.update.errors.installFailed"), "x");
    }
  }, [updFound, onNotify, t]);

  // ── Версия программы ─────────────────────────────────────────────
  // Спрашиваем один раз на весь экран: раньше здесь был хардкод «0.1.0», он
  // протух, и настройки врали. Ошибку глотаем — версия не повод ронять панель.
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const appInfo = platform.appInfo;
  useEffect(() => {
    if (!appInfo) return;
    appInfo
      .version()
      .then(setAppVersion)
      .catch(() => undefined);
  }, [appInfo]);

  const value = useMemo<SettingsScreenCtx>(
    () => ({
      ...props,
      set,
      marketFilter,
      setMarketFilter,
      plugins: {
        installed,
        errors: pluginErrors,
        busy: installBusy,
        installFromFile,
        installFromMarket,
        setEnabled: setPluginEnabled,
        remove: removePlugin,
        clearErrors: () => pluginsPort?.clearErrors(),
      },
      updates: { state: updState, found: updFound, pct: updPct, check: checkUpdates, install: installUpdate },
      appVersion,
    }),
    // props расписан полем-в-поле нарочно: объект пропсов новый на каждый
    // рендер родителя, и по нему memo не сработал бы никогда.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      props.prefs,
      props.setPrefs,
      props.api,
      props.serverSession,
      props.username,
      props.isAdmin,
      props.onLogout,
      props.onNotify,
      props.onOpenHotkeys,
      props.nowPlaying,
      props.glyphSrc,
      props.caps,
      props.platform,
      props.openSub,
      props.closeSub,
      props.goTo,
      props.paneClass,
      set,
      marketFilter,
      installed,
      installBusy,
      installFromFile,
      installFromMarket,
      setPluginEnabled,
      removePlugin,
      pluginsPort,
      errorsVersion,
      updState,
      updFound,
      updPct,
      checkUpdates,
      installUpdate,
      appVersion,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Согласие на права при установке расширения. Живёт ЗДЕСЬ, а не в
          «Расширениях»: ставить можно и из файла, и с витрины — а спрашивать
          человека надо одинаково и одним экраном. */}
      <Dialog
        open={staged !== null}
        title={staged ? t("settings.extensions.installDialog.title", { name: staged.manifest.name }) : t("settings.extensions.installDialog.titleGeneric")}
        onClose={declineInstall}
        actions={
          <>
            {/* Кнопка отказа — первая в разметке = дефолтный фокус Dialog. */}
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

      {/* Выключение расширения с полным доступом не выгружает уже исполненный
          код — предлагаем перезапуск сразу после переключателя. */}
      <Dialog
        open={restartPromptName !== null}
        title={t("settings.extensions.restartDialog.title")}
        onClose={() => setRestartPromptName(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRestartPromptName(null)}>
              {t("settings.extensions.restartDialog.later")}
            </Button>
            <Button variant="primary" icon="refresh-cw" onClick={() => void pluginsPort?.restart()}>
              {t("settings.extensions.restartDialog.restart")}
            </Button>
          </>
        }
      >
        <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
          {t("settings.extensions.restartDialog.body", { name: restartPromptName ?? "" })}
        </div>
      </Dialog>
    </Ctx.Provider>
  );
}
