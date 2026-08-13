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
import type { MuzaApi } from "@muza/api-client";
import { usePlatform } from "@muza/app/platform";
import { type SettingsTabKey } from "@muza/app/views/settings/SettingsNav";
import { SettingsScreen } from "@muza/app/views/settings/SettingsScreen";
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
import { useT } from "../i18n";
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

/** Содержимое разделов. Порядок объекта роли не играет — канонический держит
 *  SETTINGS_TAB_KEYS внутри каркаса.
 *
 *  УЗЛЫ, А НЕ КОМПОНЕНТЫ: каркас принимает готовую разметку (тот же контракт,
 *  что у веба). Элементы создаются на модуле один раз и ничего не стоят —
 *  React не рисует то, что не вставлено в дерево. */
const PANE_NODES = {
  account: <AccountPane />,
  appearance: <AppearancePane />,
  playback: <PlaybackPane />,
  sources: <SourcesPane />,
  lyrics: <LyricsPane />,
  library: <LibraryPane />,
  integrations: <IntegrationsPane />,
  hotkeys: <HotkeysPane />,
  extensions: <ExtensionsPane />,
  system: <SystemPane />,
} satisfies Record<SettingsTabKey, React.ReactNode>;

/** Содержимое под-экранов. Открытый под-экран подменяет раздел целиком. */
const SUB_NODES = {
  customize: <CustomizeSub />,
  equalizer: <EqualizerSub />,
  outputs: <OutputsSub />,
  discord: <DiscordSub />,
  market: <MarketSub />,
  data: <DataSub />,
  stats: <StatsSub />,
  licenses: <LicensesSub />,
  bar: <BarSub />,
  nav: <NavSub />,
  sessions: <SessionsSub />,
  privacy: <PrivacySub />,
  stage0: <DiagnosticsSub />,
} satisfies Record<SettingsSubKey, React.ReactNode>;

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
  placeTab,
  placeSub,
  onPlaceChange,
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
  /** Куда встать по записи истории (после «назад»/«вперёд»). undefined —
   *  площадка историей не управляет, экран живёт сам (так делает веб). */
  placeTab?: string | null;
  placeSub?: string | null;
  /** Человек сменил раздел или под-экран — записать это в историю. */
  onPlaceChange?: (tab: string | null, sub: string | null) => void;
}) {
  const { t } = useT();
  const platform = usePlatform();
  // null — ВХОД в настройки: сетка карточек разделов (SettingsHub.tsx), а не
  // сразу раздел. Второй навигационный рельс убран 04.08 по жалобе владельца
  // «два одинаковых сайдбара стоят рядом».
  const [tab, setTab] = useState<SettingsTabKey | null>(null);
  const [sub, setSub] = useState<SettingsSubKey | null>(null);

  // ── МЕСТО В НАСТРОЙКАХ ЖИВЁТ В ИСТОРИИ (13.08) ─────────────────────────
  // Жалоба владельца: «нахожусь в настройках, перехожу в раздел „Внешний
  // вид“, хочу вернуться назад, нажимаю кнопку — и меня выбрасывает на
  // главную». Причина: раздел и под-экран были ЧИСТО ЛОКАЛЬНЫМ состоянием
  // этого файла, и стек истории о них не знал вовсе. Предыдущей ЗАПИСЬЮ
  // оставалась Главная, туда «назад» и вело — стек работал правильно, просто
  // ему не сообщали о половине переходов.
  //
  // Состояние остаётся ЗДЕСЬ, а наверх уходит уведомление: экран продолжает
  // работать и без App (веб-каркас зовёт его без этих пропов), а история
  // получает недостающие записи. Обратный ход — placeTab/placeSub: их App
  // выставляет после «назад»/«вперёд», и эффект ниже приводит экран к записи.
  useEffect(() => {
    if (placeTab === undefined && placeSub === undefined) return;
    const wantTab = (placeTab ?? null) as SettingsTabKey | null;
    const wantSub = (placeSub ?? null) as SettingsSubKey | null;
    if (wantTab !== tab) setTab(wantTab);
    if (wantSub !== sub) setSub(wantSub);
    // tab/sub НЕ в зависимостях намеренно: эффект отвечает на смену ЗАПИСИ
    // ИСТОРИИ, а не на собственный результат. С ними он повторно приводил бы
    // экран к записи после каждого щелчка человека и запирал бы навигацию.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeTab, placeSub]);

  // Сообщаем наверх о КАЖДОЙ смене места, включая первую. Первая — это вход в
  // корень настроек, и она законна: стек дедупит запись, совпавшую с текущей
  // (historyStack.entriesEqual), поэтому лишней записи не появится ни на
  // монтировании, ни при возврате «назад» — там значения ровно те же, что в
  // записи, к которой вернулись.
  useEffect(() => {
    onPlaceChange?.(tab, sub);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sub]);

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

  // ⚠️ ПОИСК, ПОДСВЕТКА НАЙДЕННОГО РЯДА, ВОЗВРАТ ПРОКРУТКИ, КНОПКА «НАЗАД» И
  // ВЫБОР ПАНЕЛИ ЖИВУТ В ОБЩЕМ КАРКАСЕ (@muza/app SettingsScreen). Здесь они
  // были своей копией — ровно тем вторым способом собрать один экран, из-за
  // которого редизайн 04.08 доехал только до приложения, а веб остался с
  // рельсом разделов (жалоба владельца 11.08 «в веб-версии интерфейс до сих
  // пор старый»). Копии больше нет.

  return (
    // ⚠️ СВОЕЙ ОБЁРТКИ .muza-settings ЗДЕСЬ БОЛЬШЕ НЕТ: корень приносит общий
    // каркас (SettingsScreen), и второй такой же div давал бы вложенные
    // контейнеры запросов, а селекторы SettingsView.layout.css с комбинатором
    // `>` переставали бы попадать. Геометрия приложения (высота во всю зону,
    // потолки ширины) как жила в SettingsView.layout.css, так и живёт —
    // она цепляется за тот же класс, кто бы его ни нарисовал.
    // SettingsProvider своей разметки не добавляет.
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
        {/* ОДНА КОМПОЗИЦИЯ НА ОБЕ ПРОГРАММЫ. Здесь лежала своя разметка
            каркаса — колонки, шапка с «назад» и поиском, сетка карточек,
            результаты поиска — повторявшая @muza/app SettingsScreen «один в
            один», как и обещала шапка этого файла. Обещание исполнено
            2026-08-11: каркас научился под-экранам и управляемому разделу, и
            файл схлопнулся до вызова.

            Раздел и под-экран остаются ЗДЕСЬ состоянием: в настройки
            проваливают снаружи (кнопка эквалайзера в полосе плеера), а
            заявку исполняет эффект выше. Каркас в этом случае управляемый —
            он только просит сменить раздел. */}
        <SettingsScreen
          panes={PANE_NODES}
          subPanes={SUB_NODES}
          caps={[...caps]}
          tab={tab}
          onTabChange={setTab}
          sub={sub}
          onSubChange={setSub}
        />
    </SettingsProvider>
  );
}
