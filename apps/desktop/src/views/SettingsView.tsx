/** ЭКРАН НАСТРОЕК ПРИЛОЖЕНИЯ — тонкая обёртка над общим экраном.
 *
 *  До 2026-08-02 здесь лежали 4372 строки: десять разделов, тринадцать
 *  под-экранов, десяток диалогов и двенадцать прямых обращений к Tauri в одном
 *  файле. Из-за последних экран остался единственным, который не переехал в
 *  общий пакет вместе со всеми остальными.
 *
 *  Теперь содержимое живёт в @muza/app/views/settings/* — по файлу на раздел и
 *  на под-экран, — а платформенные умения приходят РОЗЕТКОЙ (usePlatform).
 *  Здесь остались только те три вещи, которые честно принадлежат приложению:
 *
 *   1. КАРКАС: рельс разделов, поиск, переключение раздела и под-экрана,
 *      подсветка ряда после перехода из результатов поиска. Он повторяет
 *      @muza/app/views/settings/SettingsScreen.tsx один в один по разметке и
 *      механике, но тот пока НЕ УМЕЕТ под-экранов — а без них приложению
 *      нечего показать за строками «Кастомизация», «Эквалайзер» и ещё
 *      одиннадцатью. Каркас доучивает соседняя зона; как только он научится,
 *      этот файл схлопывается до <SettingsScreen panes=… subs=…/>.
 *   2. ЗАЯВКА ИЗВНЕ: кнопка эквалайзера в полосе плеера открывает нужный
 *      под-экран сразу.
 *   3. Геометрия раскладки приложения — SettingsView.layout.css.
 *
 *  ⚠️ Ни одного значения настроек и ни одной строки интерфейса здесь больше
 *  нет: правишь ряд — правишь файл раздела в @muza/app, и правка приезжает
 *  сразу в обе программы. */

import { useEffect, useMemo, useRef, useState } from "react";
import { SearchInput } from "@muza/ui";
import type { MuzaApi } from "@muza/api-client";
import { usePlatform } from "@muza/app/platform";
import { paneStyle, SettingRow } from "@muza/app/views/settings/primitives";
import { navItemId, SETTINGS_PANE_ID, SettingsNav, type SettingsTabKey } from "@muza/app/views/settings/SettingsNav";
import {
  settingsCaps,
  SettingsProvider,
  SUB_HOME_TAB,
  type SettingsSubKey,
} from "@muza/app/views/settings/settingsContext";
import { AccountPane } from "@muza/app/views/settings/AccountPane";
import { AppearancePane } from "@muza/app/views/settings/AppearancePane";
import { PlaybackPane } from "@muza/app/views/settings/PlaybackPane";
import { SourcesPane } from "@muza/app/views/settings/SourcesPane";
import { LyricsPane } from "@muza/app/views/settings/LyricsPane";
import { LibraryPane } from "@muza/app/views/settings/LibraryPane";
import { IntegrationsPane } from "@muza/app/views/settings/IntegrationsPane";
import { HotkeysPane } from "@muza/app/views/settings/HotkeysPane";
import { ExtensionsPane } from "@muza/app/views/settings/ExtensionsPane";
import { SystemPane } from "@muza/app/views/settings/SystemPane";
import { CustomizeSub } from "@muza/app/views/settings/CustomizeSub";
import { EqualizerSub } from "@muza/app/views/settings/EqualizerSub";
import { OutputsSub } from "@muza/app/views/settings/OutputsSub";
import { DiscordSub } from "@muza/app/views/settings/DiscordSub";
import { MarketSub } from "@muza/app/views/settings/MarketSub";
import { DataSub } from "@muza/app/views/settings/DataSub";
import { StatsSub } from "@muza/app/views/settings/StatsSub";
import { LicensesSub } from "@muza/app/views/settings/LicensesSub";
import { BarSub } from "@muza/app/views/settings/BarSub";
import { NavSub } from "@muza/app/views/settings/NavSub";
import { SessionsSub } from "@muza/app/views/settings/SessionsSub";
import { PrivacySub } from "@muza/app/views/settings/PrivacySub";
import { DiagnosticsSub } from "@muza/app/views/settings/DiagnosticsSub";
import { searchSettings, type SettingsSearchHit } from "@muza/app/lib/settingsIndex";
import { useT, type TranslationKey } from "../i18n";
import type { Prefs } from "../types";
import glyph from "@muza/ui/assets/logo/glyph.svg";
// Редизайн раскладки (колонки во всю высоту зоны, текучие ширины) — перекрывает
// габариты каркаса .muza-settings* из app.css; подробности в самом файле.
import "./SettingsView.layout.css";

/** Запрос извне открыть под-экран (кнопка эквалайзера в полосе плеера). */
export interface SettingsIntent {
  sub: SettingsSubKey;
  nonce: number;
}

/** Содержимое раздела. Порядок объекта роли не играет — рельс держит свой
 *  канонический порядок (SETTINGS_TAB_KEYS). */
const PANES: Record<SettingsTabKey, () => React.ReactElement> = {
  account: AccountPane,
  appearance: AppearancePane,
  playback: PlaybackPane,
  sources: SourcesPane,
  lyrics: LyricsPane,
  library: LibraryPane,
  integrations: IntegrationsPane,
  hotkeys: HotkeysPane,
  extensions: ExtensionsPane,
  system: SystemPane,
};

/** Содержимое под-экрана. */
const SUBS: Record<SettingsSubKey, () => React.ReactElement> = {
  customize: CustomizeSub,
  equalizer: EqualizerSub,
  outputs: OutputsSub,
  discord: DiscordSub,
  market: MarketSub,
  data: DataSub,
  stats: StatsSub,
  licenses: LicensesSub,
  bar: BarSub,
  nav: NavSub,
  sessions: SessionsSub,
  privacy: PrivacySub,
  stage0: DiagnosticsSub,
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
  onIntentUsed,
  nowPlaying,
}: {
  api: MuzaApi;
  /** false у анонима: серверные функции аккаунта (смена пароля) недоступны. */
  serverSession: boolean;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  username: string;
  /** Показывает скрыть/одобрить на карточках витрины расширений. */
  isAdmin?: boolean;
  onLogout: () => void;
  onNotify: (text: string, icon?: string) => void;
  /** Строка «Помощь / закрыть» кликабельна — открывает диалог клавиш (App). */
  onOpenHotkeys: () => void;
  /** Список расширений изменился — плееру пора перечитать рантайм, чтобы
   *  новое расширение ожило БЕЗ перезапуска программы. */
  onPluginsChanged?: () => void;
  intent?: SettingsIntent | null;
  /** Заявка исполнена — гасить её в App, иначе она сработает на следующем
   *  входе в настройки (поддерево пересоздаётся при смене экрана). */
  onIntentUsed?: () => void;
  /** Играющий трек — честный предпросмотр статуса Discord (обложка сырая,
   *  как в реальной активности); null — демо-значения. */
  nowPlaying?: { title: string; artist: string; album: string; cover: string | null; duration: number } | null;
}) {
  const { t } = useT();
  const platform = usePlatform();
  const [tab, setTab] = useState<SettingsTabKey>("appearance");
  const [sub, setSub] = useState<SettingsSubKey | null>(null);

  // Умения выводятся из портов розетки — один список и рядам, и поиску.
  const caps = useMemo(() => new Set(settingsCaps(platform)), [platform]);

  // Открытие под-экрана извне (кнопка эквалайзера в полосе плеера).
  // Заявку ОБЯЗАТЕЛЬНО гасим сразу после исполнения: поддерево экрана
  // пересоздаётся при каждой смене экрана, поэтому этот эффект отрабатывает
  // заново на КАЖДОМ входе в настройки. Пока заявка висела, войти в корень
  // настроек из сайдбара было нельзя — каждый вход проваливал в под-экран.
  useEffect(() => {
    if (!intent) return;
    setTab(SUB_HOME_TAB[intent.sub]);
    setSub(intent.sub);
    onIntentUsed?.();
  }, [intent, onIntentUsed]);

  // Анимация панели — только при переключении раздела/под-экрана человеком.
  // Вход в сами настройки анимирует обёртка экрана в App, поэтому ПЕРВУЮ
  // панель не анимируем: иначе анимация играет дважды. Сравнение именно с
  // первой панелью (а не флаг «уже монтировались») устойчиво к перерисовкам
  // от асинхронных загрузок без смены раздела.
  const paneKey = sub ?? tab;
  const initialPaneKey = useRef(paneKey);
  const switchedRef = useRef(false);
  if (paneKey !== initialPaneKey.current) switchedRef.current = true;
  const paneClass = switchedRef.current ? "muza-view" : undefined;

  // Прокрутка живёт в самой панели (.muza-settings__pane — скроллер): при
  // смене раздела возвращаем её к началу, иначе скролл прошлого раздела
  // протекает в следующий.
  const paneScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (paneScrollRef.current) paneScrollRef.current.scrollTop = 0;
  }, [paneKey]);

  // ── Поиск по настройкам ───────────────────────────────────────────
  const [searchQ, setSearchQ] = useState("");
  // Название ряда, к которому надо прокрутить и подсветить после перехода из
  // результатов. Ставится вместе с setTab/setSub — эффект ниже срабатывает
  // уже ПОСЛЕ рендера целевой панели.
  const [flashTitle, setFlashTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!flashTitle) return;
    setFlashTitle(null);
    const row = paneScrollRef.current?.querySelector<HTMLElement>(`[data-rowtitle="${CSS.escape(flashTitle)}"]`);
    // Ряда может не быть: он спрятан за выключенным переключателем или
    // свёрнутым «Настроить» — тогда просто открыли нужный раздел.
    if (!row) return;
    row.scrollIntoView?.({ block: "center" });
    row.classList.add("muza-settings-row--flash");
    // Таймер без уборки нарочно: setFlashTitle(null) выше перезапускает
    // эффект, и уборка сняла бы класс мгновенно, не дав подсветке пожить.
    setTimeout(() => row.classList.remove("muza-settings-row--flash"), 2000);
  }, [flashTitle]);
  const goToHit = (hit: SettingsSearchHit) => {
    setSearchQ("");
    setSub(hit.sub as SettingsSubKey | null);
    setTab(hit.tab as SettingsTabKey);
    setFlashTitle(hit.title);
  };
  const searchHits = searchQ.trim() ? searchSettings(searchQ, (key) => t(key as TranslationKey), caps) : [];

  const Pane = sub ? SUBS[sub] : PANES[tab];

  return (
    // Вся геометрия (высота во всю зону, текучие колонки, потолки ширины) —
    // в SettingsView.layout.css; базовый каркас и схлопывание рельса — в
    // app.css. Класс muza-settings — container query по ширине панели
    // настроек (не по окну: боковые зоны человек тянет руками).
    <div className="muza-settings">
      <SettingsProvider
        prefs={prefs}
        setPrefs={setPrefs}
        api={api}
        serverSession={serverSession}
        username={username}
        isAdmin={!!isAdmin}
        onLogout={onLogout}
        onNotify={onNotify}
        onOpenHotkeys={onOpenHotkeys}
        onPluginsChanged={onPluginsChanged}
        nowPlaying={nowPlaying ?? null}
        glyphSrc={glyph}
        caps={caps}
        platform={platform}
        openSub={setSub}
        closeSub={() => setSub(null)}
        goTo={(nextTab, nextSub) => {
          setTab(nextTab);
          setSub(nextSub ?? null);
        }}
        paneClass={paneClass}
      >
        {/* Навигация слева вместо горизонтальных вкладок: список не зависит от
            длины подписей, поэтому раскладка не перестраивается при смене
            языка. Заголовок «Настройки» — внутри SettingsNav, шапкой плашки. */}
        <div className="muza-settings__cols">
          <SettingsNav
            value={tab}
            onChange={(nextTab) => {
              setSub(null); // под-экран живёт внутри раздела — смена раздела закрывает его
              setTab(nextTab);
            }}
          />
          {/* Под-экран рисуется сюда же вместо содержимого раздела: навигация
              остаётся на месте с подсвеченным разделом, назад — кнопкой в
              шапке под-экрана. */}
          <div ref={paneScrollRef} className="muza-settings__pane" id={SETTINGS_PANE_ID} role="tabpanel" aria-labelledby={navItemId(tab)}>
            {/* Поиск — первый элемент панели: живёт над содержимым любого
                раздела. Непустой запрос подменяет содержимое списком найденных
                рядов; клик по результату ведёт в раздел с подсветкой ряда. */}
            <SearchInput
              value={searchQ}
              onChange={setSearchQ}
              placeholder={t("settings.search.placeholder")}
              style={{ marginTop: "var(--sp-6)" }}
            />
            {searchQ.trim() ? (
              <div key="search-results" style={paneStyle}>
                {searchHits.length === 0 ? (
                  <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.search.empty")}</div>
                ) : (
                  searchHits.map((hit) => (
                    <SettingRow
                      key={`${hit.tab}·${hit.sub ?? ""}·${hit.titleKey}`}
                      title={hit.title}
                      hint={t(`settings.tabs.${hit.tab}` as TranslationKey)}
                      chevron
                      onClick={() => goToHit(hit)}
                    ></SettingRow>
                  ))
                )}
              </div>
            ) : (
              <Pane key={paneKey} />
            )}
          </div>
        </div>
      </SettingsProvider>
    </div>
  );
}
