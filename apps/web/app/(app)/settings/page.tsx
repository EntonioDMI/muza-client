"use client";

import { useCallback, useMemo, useState } from "react";
import { ChipGroup, Switch } from "@muza/ui";
import { useT } from "@muza/app";
import { usePlatform } from "@muza/app/platform";
import { SettingsScreen } from "@muza/app/views/settings/SettingsScreen";
import { AccountPane } from "@muza/app/views/settings/AccountPane";
import { AppearancePane } from "@muza/app/views/settings/AppearancePane";
import { CustomizeSub } from "@muza/app/views/settings/CustomizeSub";
import { NavSub } from "@muza/app/views/settings/NavSub";
import { BarSub } from "@muza/app/views/settings/BarSub";
import { IntegrationsPane } from "@muza/app/views/settings/IntegrationsPane";
import { LibraryPane } from "@muza/app/views/settings/LibraryPane";
import { SystemPane } from "@muza/app/views/settings/SystemPane";
import { SessionsSub } from "@muza/app/views/settings/SessionsSub";
import { DataSub } from "@muza/app/views/settings/DataSub";
import { PrivacySub } from "@muza/app/views/settings/PrivacySub";
import { StatsSub } from "@muza/app/views/settings/StatsSub";
import { LicensesSub } from "@muza/app/views/settings/LicensesSub";
/** Профили эквалайзера берутся ОТТУДА ЖЕ, откуда их рисуют чипы: копия в
 *  apps/web/src/audioFx.ts совпадала цифра в цифру, но два списка в двух
 *  файлах разъезжаются на первой же правке — а значение prefs.eqPreset
 *  персистентно и общее с приложением. */
import { EqualizerControls, EQ_PRESETS } from "@muza/app/views/settings/EqualizerSub";
import { RecsTuning } from "@muza/app/views/settings/PlaybackPane";
import { paneRows, SettingsProvider, settingsCaps, type SettingsSubKey } from "@muza/app/views/settings/settingsContext";
import type { SettingsTabKey } from "@muza/app/views/settings/SettingsNav";
import {
  GroupTitle,
  LiveSlider,
  PresetRow,
  RowValue,
  SettingRow,
  SettingsPane,
  StepsEditor,
} from "@muza/app/views/settings/primitives";
import { matchPreset, PRESETS_WARM } from "@muza/app/prefs/presets";
import { DEFAULT_PREFS } from "@muza/app/prefs/types";
import { getApi } from "../../../src/api";
import { usePlayer } from "../../../src/player";
import { usePrefs, type WebPrefs } from "../../../src/prefs";
import { useSession } from "../../../src/session";
import { useToast } from "../../../src/toast";
import { useRouter } from "next/navigation";

/** Настройки веба (волна веб-паритета «настройки», 2026-08-02).
 *
 *  Каркас, рельс разделов, ряды-плашки и поиск по настройкам — ОБЩИЕ с
 *  приложением (@muza/app/views/settings): до этой волны у веба был свой
 *  экран со своим Row, своим списком категорий и без поиска — он уже
 *  разъехался с приложением (другие отступы, другой порядок разделов, свои
 *  ползунки). Теперь одна и та же настройка выглядит одинаково в обеих
 *  программах, потому что рисует её один и тот же код.
 *
 *  ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Разделы и ряды, которых во вкладке браузера не
 *  бывает, ОТСУТСТВУЮТ — не серые, не «только в приложении»: значок у часов,
 *  запуск вместе с системой, обновление программы, журнал «почему включалось
 *  долго», расширения, музыка с диска. Их нет ни в рельсе, ни в результатах
 *  поиска: умения площадки страница НЕ пишет руками, а спрашивает у розетки
 *  (settingsCaps(platform) в теле страницы) — того, чего браузер не умеет, в
 *  розетке просто нет.
 *
 *  ⚠️ Ряд появляется здесь только тогда, когда он РАБОТАЕТ. Переключатель,
 *  который никуда не приезжает, хуже отсутствующего: человек считает, что
 *  настроил. По этому правилу «Тексты песен» появились только вместе с тем,
 *  что панель текста веба научилась читать настройки (src/components/
 *  LyricsPanel.tsx), и в них НЕТ ряда «Видео вместо обложки»: видео-дорожку
 *  добывает движок приложения, страница так не умеет. Поиск такого ряда тоже
 *  не найдёт — каркас настроек показывает результат, только если ряд есть в
 *  ОПИСИ страницы (`WEB_OWN_ROWS` ниже + `paneRows` в теле — они собираются в
 *  проп `rows` каркаса). */

/** ОПИСЬ РЯДОВ, КОТОРЫЕ СТРАНИЦА РИСУЕТ СВОЕЙ РАЗМЕТКОЙ: «ключ индекса → где
 *  ряд нарисован». Значение везде null — под-экранов страница не рисует ни
 *  одного, все эти ряды лежат прямо в разделе.
 *
 *  Зачем опись вообще. Каркас настроек не читает разметку (он не может: четыре
 *  раздела приезжают сюда готовыми компонентами, их ряды лежат внутри) — он
 *  верит этому списку. Ключа нет в списке → результата поиска нет, даже если
 *  ряд на экране есть; поэтому список положительный, а не «чего у меня нет»:
 *  забытый ключ прячет существующий ряд (человек найдёт его глазами), а
 *  забытая строчка в списке отсутствующих привела бы в пустоту.
 *
 *  МЕСТО — часть описи, а не справка из индекса, потому что страница
 *  раскладывает ряды ИНАЧЕ: «Шрифт текста», «Размытие панелей» и «Приглушение
 *  текста» индекс числит в под-экране «Кастомизация», а страница рисует их
 *  прямо во «Внешнем виде» — и переход из результата обязан вести туда, где ряд
 *  на самом деле. То же с «Включить» эквалайзера.
 *
 *  ⚠️ Здесь перечислены ТОЛЬКО ряды собранных на странице разделов (оформление,
 *  воспроизведение, источники, тексты). Разделы, приехавшие готовыми
 *  компонентами, свою опись отдают сами — paneRows() в `rows` (тело страницы):
 *  список рядом с чужим компонентом разъехался бы с ним на первой же правке.
 *
 *  Ряды без записи в индексе («Панель Сейчас играет», «Скорость», «Перевод»)
 *  сюда не идут — поиск про них не знает вовсе. */
const WEB_OWN_ROWS: Readonly<Record<string, SettingsSubKey | null>> = {
  // «Внешний вид» здесь БОЛЬШЕ НЕТ (2026-08-10): раздел приезжает готовым
  // компонентом, и опись за него отдаёт paneRows("appearance") в теле
  // страницы — как у остальных общих разделов. Девять ключей, лежавших тут,
  // описывали самописную копию раздела и вместе с ней удалены.
  // Воспроизведение
  "settings.playback.crossfade.title": null,
  "settings.playback.crossfade.duration.title": null,
  "settings.playback.gapless.title": null,
  "settings.equalizer.enable.title": null,
  "settings.playback.speedSteps.title": null,
  "settings.playback.radioEndless.title": null,
  "settings.playback.recs.title": null,
  "settings.playback.recs.novelty.title": null,
  "settings.playback.recs.repeats.title": null,
  "settings.playback.resumePosition.title": null,
  "settings.playback.queuePrep.title": null,
  "settings.playback.queuePrep.warm.title": null,
  "settings.playback.queuePrep.preload.title": null,
  // Источники
  "settings.sources.searchGrouping.title": null,
  // Тексты песен
  "settings.lyrics.synced.title": null,
  "settings.lyrics.autoScroll.title": null,
  "settings.lyrics.endNote.title": null,
  "settings.lyrics.karaokeSize.title": null,
  "settings.lyrics.karaokeLines.title": null,
  "settings.lyrics.panelLines.title": null,
  "settings.lyrics.meaningMode.title": null,
};

/** Под-экраны, которые вкладка браузера умеет открыть. Список нужен поиску:
 *  результат, ведущий в под-экран, показывается, только если открыть его есть
 *  чем. Discord сюда не входит — статус в нём умеет ставить только программа
 *  на устройстве (см. «Интеграции» ниже). */
/** ⚠️ «customize», «nav» и «bar» приехали 2026-08-10 вместе с общим разделом
 *  «Внешний вид». До этого веб рисовал оформление СВОЕЙ разметкой образца до
 *  редизайна, и в ней не было ни «Раскладки» (Воздушная/Плоская/Классика), ни
 *  «Масштаба», ни входа в «Кастомизацию»: владелец видел воздушную раскладку и
 *  не мог её сменить, потому что органа управления в вебе не существовало.
 *  Движок при этом работал всегда — переменные раскладки globals.css читает
 *  наравне с приложением (--win-pad, --pad-under-bar, --r-zone,
 *  --player-inset). Не хватало ровно переключателя.
 *  Все три под-экрана браузеру по силам целиком: это чистые поля профиля. */
const WEB_SUBS = ["customize", "nav", "bar", "sessions", "data", "privacy", "stats", "licenses"] as const;

/** ⚠️ Здесь лежали ТРИ КОПИИ чисел приложения — пресеты оформления, потолок
 *  размытия, границы приглушения текста и список шрифтов. Все они обслуживали
 *  самописный «Внешний вид» и удалены вместе с ним 2026-08-10: общий раздел
 *  берёт те же значения из своего источника (appearancePresets.ts, themeVars),
 *  и второго списка тех же чисел в дереве больше нет.
 *
 *  Размер караоке-строки, px: те же 36..72, что у ползунка в приложении
 *  (@muza/app/views/settings/LyricsPane.tsx). Раздел «Тексты» страница пока
 *  рисует своей разметкой, поэтому пара границ ещё нужна. */
const KARAOKE_SIZE_MIN = 36;
const KARAOKE_SIZE_MAX = 72;


export default function SettingsPage() {
  const { prefs, set } = usePrefs();
  const { session, logout } = useSession();
  const router = useRouter();
  const { t } = useT();
  const platform = usePlatform();
  const notify = useToast();
  /** Скорость воспроизведения — состояние плеера, а не профиля настроек:
   *  ряд «Скорость» ниже управляет тем, что звучит прямо сейчас. */
  const player = usePlayer();

  /** УМЕНИЯ ПЛОЩАДКИ — ВЫЧИСЛЯЮТСЯ ИЗ РОЗЕТКИ, а не пишутся здесь списком.
   *
   *  Раньше тут стоял ручной `WEB_CAPS = []`. Список из двух источников правды
   *  расходится молча: появится у браузера порт (первым напрашивается
   *  audioDevices — выбор вывода звука умеет и вкладка), розетка про него
   *  узнает, а забытый список — нет, и ряд останется невидимым для поиска без
   *  единого сообщения об ошибке. Теперь источник один: `settingsCaps` в
   *  @muza/app/views/settings/settingsContext — та же функция, что зовёт
   *  приложение.
   *
   *  Пересчёт по `platform`: вилка браузера — константа модуля
   *  (src/platform/webAdapter.ts), так что на деле это разовый расчёт. */
  /** ⚠️ `themeMarket` СНИМАЕТСЯ РУКАМИ, и это предусмотрено контрактом
   *  (`settingsCaps`: «площадка, которой они не нужны, передаёт свой список
   *  руками»). Витрину оформлений браузер потянул бы — она серверная, — но
   *  живёт она в под-экране `market`, а его дом по SUB_HOME_TAB — раздел
   *  «Расширения», которого у веба нет вовсе (плагины требуют Tauri). Ряд
   *  «Готовые оформления» в «Кастомизации» вёл бы в раздел, отсутствующий в
   *  рельсе: рельс подсветил бы пустоту, а «назад» возвращаться было бы
   *  некуда. Нет умения — нет ряда; это то же правило, по которому в вебе нет
   *  «Устройств вывода». Витрина тем в браузере — отдельная работа: ей нужен
   *  свой дом среди разделов веба. */
  const caps = useMemo(() => settingsCaps(platform).filter((c) => c !== "themeMarket"), [platform]);
  /** Тот же список множеством — его спрашивают сами ряды через контекст экрана
   *  (`caps.has("discord")` в «Интеграциях»). Отдельный memo нужен, чтобы новый
   *  Set на каждый рендер не пересобирал контекст настроек впустую. */
  const capsSet = useMemo(() => new Set(caps), [caps]);

  /** ПОЛНАЯ ОПИСЬ РЯДОВ СТРАНИЦЫ для поиска: что нарисовано и где.
   *
   *  Пять разделов приезжают сюда готовыми компонентами (@muza/app) и рисуют
   *  ровно то, что знает индекс, — их опись берётся из того же индекса
   *  функцией `paneRows`, иначе список рядом с чужим компонентом разъехался бы
   *  с ним на первой же правке. Умения передаются той же переменной, что и
   *  самим компонентам: раздел покажет ровно те ряды, которые попали в опись.
   *
   *  «Горячие клавиши» страница не рисует вовсе — раздел-справочник каркас
   *  собирает сам, но ряд-указатель в индексе есть, и он достижим. */
  const rows = useMemo(
    () => ({
      ...paneRows("account", caps),
      ...paneRows("appearance", caps),
      ...paneRows("library", caps),
      ...paneRows("integrations", caps),
      ...paneRows("system", caps),
      ...paneRows("hotkeys", caps),
      ...WEB_OWN_ROWS,
    }),
    [caps],
  );

  /** Открытый под-экран. Состояние держит страница (она же подменяет им
   *  содержимое раздела), но распоряжаются им ДВОЕ: сами ряды через контекст
   *  («Сессии и устройства →») и каркас — он закрывает под-экран при смене
   *  раздела и открывает нужный, когда туда ведёт результат поиска. Поэтому
   *  `setSub` уезжает в каркас пропом `onSubChange`. */
  const [sub, setSub] = useState<SettingsSubKey | null>(null);
  const closeSub = useCallback(() => setSub(null), []);
  /** «Перейти в раздел, при желании сразу в под-экран». Разделом здесь
   *  распоряжается каркас, поэтому странице остаётся под-экран. Единственный,
   *  кто зовёт это, — «Расширения» (уводят в «Кастомизацию»), а их во вкладке
   *  браузера нет вовсе. */
  const goTo = useCallback((_tab: SettingsTabKey, nextSub?: SettingsSubKey | null) => setSub(nextSub ?? null), []);
  const onLogout = useCallback(() => {
    void logout().then(() => router.replace("/login"));
  }, [logout, router]);

  const applyEqPreset = (name: string) => {
    const bands = EQ_PRESETS[name];
    set(bands ? { eqPreset: name, eqBands: bands } : { eqPreset: name });
  };

  const setBand = (i: number, v: number) => {
    const bands = [...prefs.eqBands];
    bands[i] = Math.round(v);
    // Значение — персистентный ключ prefs.eqPreset (см. EQ_PRESETS в EqualizerSub),
    // сознательно не переведён, как и в приложении.
    set({ eqBands: bands, eqPreset: "Свой" });
  };

  /** «Аккаунт» и его под-экраны — ТЕ ЖЕ файлы, что рисует приложение
   *  (@muza/app/views/settings/AccountPane и SessionsSub/DataSub/PrivacySub),
   *  а не копия рядов на странице. Так вышло не из любви к переиспользованию:
   *  за этими семью рядами стоят два диалога (смена пароля, смена почты),
   *  список устройств с отзывом входа, выгрузка данных и удаление аккаунта —
   *  это сотни строк логики, у которой ОДИН источник правды, сервер. Копия
   *  разъехалась бы с приложением на первой же правке текста ошибки.
   *
   *  Всё, что этим рядам нужно от площадки, они спрашивают у розетки: адрес
   *  подтверждения почты открывается `system.openExternal` (в браузере —
   *  новой вкладкой), а выгрузка данных без порта `saveDataFile` честно
   *  уезжает обычной загрузкой файла — так эта кнопка и задумана.
   *
   *  Под-экран рисуется ВМЕСТО рядов раздела: рельс слева остаётся на месте с
   *  подсвеченным «Аккаунтом», назад — стрелкой в шапке под-экрана. Закрывать
   *  под-экран при уходе в другой раздел странице не нужно — это делает сам
   *  каркас (onSubChange(null) при смене раздела). */
  const accountPane =
    sub === "sessions" ? <SessionsSub /> : sub === "data" ? <DataSub /> : sub === "privacy" ? <PrivacySub /> : <AccountPane />;

  /** «Интеграции»: отметки прослушиваний (Last.fm, ListenBrainz) и медиа-
   *  клавиши. Ряд «Статус в Discord» держится на умении `discord`, которого у
   *  вкладки браузера нет и быть не может: статус ставится через локальный
   *  сокет программы Discord на том же устройстве, страница до него не
   *  дотянется. Поэтому ряда нет ВОВСЕ — и поиск его тоже не находит
   *  (записи индекса помечены needs: "discord", а WEB_CAPS пуст).
   *
   *  Медиа-клавиши в браузере — это Media Session API: те же кнопки на
   *  клавиатуре и та же плашка проигрывателя в системе, что у приложения (оно
   *  тоже ходит через Media Session, apps/desktop useMediaSession). Ряд
   *  появился здесь вместе с тем, что веб-плеер начал спрашивать эту
   *  настройку (apps/web/src/player.tsx). */
  const integrationsPane = <IntegrationsPane />;

  /** «Медиатека» — тот же файл, что у приложения. Из пяти его рядов вкладка
   *  браузера показывает два: «Импорт плейлистов» (кнопка живёт на странице
   *  медиатеки — чистая работа сервера) и вход в «Статистику». Три остальных —
   *  музыка с диска, место под скачанным при прослушивании и оффлайн-загрузки
   *  — держатся на портах `localFiles` и `storedMedia`, которых у страницы нет:
   *  ряда нет вовсе, не серого.
   *
   *  Под-экран «Статистика» отдаёт БЛОКИ и ПЕРИОД страницы итогов. Оба поля
   *  страница итогов веба реально читает (app/(app)/stats/page.tsx: состав —
   *  через enabledStatsBlocks, период — пропом initialPeriod), иначе рядам
   *  здесь было бы нечего менять и им было бы не место. */
  const libraryPane = sub === "stats" ? <StatsSub /> : <LibraryPane />;

  /** «Система». Самый площадочный раздел: шесть его рядов из десяти — умения
   *  устройства (запуск вместе с системой, значок у часов, поведение при
   *  закрытии окна, обновление программы, маленькое окно поверх других,
   *  диагностика запуска). Вкладке браузера они недоступны не «пока», а
   *  никогда — поэтому рядов нет ВОВСЕ, и поиск их тоже не находит.
   *
   *  Остаётся «О приложении» — оно ни от чего не зависит: версия (у страницы
   *  её нет, и ряд честно это говорит вместо выдуманного числа), лицензии
   *  открытого кода под-экраном, сайт и исходники. Ссылки открывает розетка
   *  (`system.openExternal` — единственное, что умеют обе площадки; в браузере
   *  это новая вкладка с noopener). */
  const systemPane = sub === "licenses" ? <LicensesSub /> : <SystemPane />;

  /** РАЗДЕЛ «ВНЕШНИЙ ВИД» — ОБЩИЙ С ПРИЛОЖЕНИЕМ (2026-08-10).
   *
   *  Здесь лежала своя разметка на 130 строк: язык, три плитки-пресета, тема,
   *  акцент, углы, стекло, фон. Она была слепком раздела ДО редизайна и с тех
   *  пор отстала — в приложении добавились «Раскладка» (Воздушная / Плоская /
   *  Классика), «Масштаб», вход в «Кастомизацию» и подсказка про Ctrl+E.
   *  Владелец 10.08: «сейчас там установлена, кажется, воздушная тема, а
   *  поменять её нельзя, потому что настройки остались прежними» — ровно этот
   *  разрыв. Причём движок раскладки веб исполнял всегда: --win-pad,
   *  --pad-under-bar, --r-zone и --player-inset globals.css читает наравне с
   *  приложением. Не хватало переключателя, а не механизма.
   *
   *  Копию убрали целиком, а не дописали в неё недостающие ряды: два слепка
   *  одного раздела расходятся на первой же правке — этот разошёлся за неделю.
   *  Теперь раздел рисует тот же код, что и приложение, а под-экраны
   *  «Кастомизация», «Вкладки сайдбара» и «Кнопки полосы плеера» открываются
   *  из него (все три — чистые поля профиля, браузеру по силам целиком). */
  const appearancePane =
    sub === "customize" ? <CustomizeSub /> : sub === "nav" ? <NavSub /> : sub === "bar" ? <BarSub /> : <AppearancePane />;


  /** «Воспроизведение». До 2026-08-02 здесь был ОДИН ряд — эквалайзер, — хотя
   *  в приложении их пятнадцать. Разрыв закрыт не разметкой, а плеером:
   *  сначала вкладка научилась делать (apps/web/src/player.tsx — два слота,
   *  кроссфейд равной мощности, переход без паузы, выравнивание громкости,
   *  скорость с сохранением тона, продолжение с места, бесконечное радио,
   *  подготовка очереди), и только потом здесь появились ряды.
   *
   *  ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ (правило шапки файла — ряд без применения хуже
   *  отсутствующего):
   *   - «Устройства вывода» — умение audioOutputs, которого у страницы нет;
   *   - «Качество звука» — «Эконом» выбирает движок добычи на устройстве, у
   *     сетевого адреса потока такой ручки нет;
   *   - «Шаг перемотки» — шаг стрелок задан слушателем клавиш веба
   *     (src/providers.tsx), настройку он пока не спрашивает;
   *   - «Таймер сна» — кнопки-луны в полосе плеера веба не существует. */
  const playbackPane = (
    <SettingsPane>
      <GroupTitle>{t("settings.playback.transitionsGroup")}</GroupTitle>
      <SettingRow title={t("settings.playback.crossfade.title")} hint={t("settings.playback.crossfade.hint")}>
        <Switch checked={prefs.crossfade} onChange={(crossfade: boolean) => set({ crossfade })} label={t("settings.playback.crossfade.title")} />
      </SettingRow>
      {/* Длительность имеет смысл только при включённом плавном переходе —
          прячем ползунок целиком, а не гасим (правило приложения). */}
      {prefs.crossfade ? (
        <SettingRow title={t("settings.playback.crossfade.duration.title")} hint={t("settings.playback.crossfade.duration.hint")}>
          <LiveSlider
            value={prefs.crossfadeSec - 1}
            max={11}
            label={t("settings.playback.crossfade.duration.title")}
            suffix={t("settings.playback.crossfade.duration.seconds", { n: prefs.crossfadeSec })}
            onChange={(v) => set({ crossfadeSec: 1 + Math.round(v) })}
          />
        </SettingRow>
      ) : null}
      <SettingRow
        title={t("settings.playback.gapless.title")}
        hint={prefs.crossfade ? t("settings.playback.gapless.hintCrossfadeOn") : t("settings.playback.gapless.hint")}
      >
        <Switch checked={prefs.gapless} onChange={(gapless: boolean) => set({ gapless })} label={t("settings.playback.gapless.title")} />
      </SettingRow>
      <GroupTitle>{t("settings.playback.soundGroup")}</GroupTitle>
      <SettingRow title={t("settings.equalizer.enable.title")} hint={t("settings.equalizer.enable.hint")}>
        <Switch checked={prefs.eqOn} onChange={(eqOn: boolean) => set({ eqOn })} label={t("settings.equalizer.enable.title")} />
      </SettingRow>
      {/* Эквалайзер в вебе — прямо в разделе, а не отдельным под-экраном:
          под-экранов у этого каркаса пока нет, а прятать десять фейдеров за
          лишним переходом ради симметрии — хуже, чем показать их сразу.
          РИСУЕТ ЕГО ОБЩИЙ КОД (@muza/app/views/settings/EqualizerSub) — чипы
          профилей, панель полос со шкалой дБ и сброс те же, что в под-экране
          приложения. Своя копия ряда фейдеров жила здесь до волны 8 и успела
          разъехаться: полосы вдвое короче, без панели, без цифр дБ, без
          сброса и с латинской «1k» вместо словарной «1к». */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <EqualizerControls bands={prefs.eqBands} preset={prefs.eqPreset} disabled={!prefs.eqOn} onPreset={applyEqPreset} onBand={setBand} />
      </div>
      {/* «Выравнивание громкости» ряда ЗДЕСЬ НЕТ, хотя плеер веба его уже умеет
          (apps/web/src/audioFx.ts: normFactor приводит трек к −14 LUFS). Не
          хватает не умения, а данных: замер громкости трека сервер пока никому
          не отдаёт — поле `loudness` всегда пустое (muza-server, catalog/dto.ts
          отдаёт loudnessLufs, а заполнять его некому). Множитель выходит 1, и
          тумблер не менял бы ни одного децибела. Появится замер — вернуть ряд
          сюда одной строкой, плеер к нему готов. */}
      {/* Скорость — САМА настройка, а не только её шаги: кнопки «1×» в полосе
          плеера веба нет, и без этого ряда переключать скорость было бы нечем
          (а «Шаги скорости» ниже настраивали бы пустоту). Значение живёт в
          плеере и не сохраняется между заходами — как кнопка в приложении. */}
      <SettingRow title={t("player.speedTooltip")} hint={t("web.settings.speed.hint")}>
        <ChipGroup
          items={prefs.speedSteps.map((v) => ({ key: String(v), label: `${v}×` }))}
          value={String(player.speed)}
          onChange={(k: string) => player.setSpeed(Number(k))}
        />
      </SettingRow>
      {/* Подсказка своя, а не общая settings.playback.speedSteps.hint: та
          говорит про кнопку «1×» в плеере, которой у веба нет. */}
      <SettingRow title={t("settings.playback.speedSteps.title")} hint={t("web.settings.speedSteps.hint")}>
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
        <Switch checked={prefs.radioEndless} onChange={(radioEndless: boolean) => set({ radioEndless })} label={t("settings.playback.radioEndless.title")} />
      </SettingRow>
      <GroupTitle>{t("settings.playback.recsGroup")}</GroupTitle>
      {/* Те же два ползунка, что в приложении, и тем же файлом: подбор музыки
          делает сервер, и настройка у него одна на все устройства человека. */}
      <RecsTuning />
      <SettingRow title={t("settings.playback.resumePosition.title")} hint={t("settings.playback.resumePosition.hint")}>
        <Switch
          checked={prefs.resumePosition}
          onChange={(resumePosition: boolean) => set({ resumePosition })}
          label={t("settings.playback.resumePosition.ariaLabel")}
        />
      </SettingRow>
      <GroupTitle>{t("settings.playback.streamGroup")}</GroupTitle>
      {/* Подготовка очереди — одной строкой пресетов, точные числа под
          «Настроить» (конвенция приложения). */}
      <PresetRow
        title={t("settings.playback.queuePrep.title")}
        hint={t("settings.playback.queuePrep.hint")}
        chips={[
          { key: "eco", label: t("settings.playback.queuePrep.presets.eco") },
          { key: "normal", label: t("settings.playback.queuePrep.presets.normal") },
          { key: "max", label: t("settings.playback.queuePrep.presets.max") },
        ]}
        active={matchPreset(PRESETS_WARM, prefs)}
        onPick={(k) => set(PRESETS_WARM[k])}
      >
        <SettingRow title={t("settings.playback.queuePrep.warm.title")} hint={t("settings.playback.queuePrep.warm.hint")}>
          <LiveSlider
            value={prefs.warmAhead}
            max={30}
            label={t("settings.playback.queuePrep.warm.title")}
            suffix={t("settings.playback.units.tracks", { n: prefs.warmAhead })}
            onChange={(v) => set({ warmAhead: Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.playback.queuePrep.preload.title")} hint={t("settings.playback.queuePrep.preload.hint")}>
          <LiveSlider
            value={prefs.preloadAheadSec - 5}
            max={55}
            label={t("settings.playback.queuePrep.preload.title")}
            suffix={t("settings.playback.units.seconds", { n: prefs.preloadAheadSec })}
            onChange={(v) => set({ preloadAheadSec: 5 + Math.round(v) })}
          />
        </SettingRow>
      </PresetRow>
    </SettingsPane>
  );

  const sourcesPane = (
    <SettingsPane>
      <GroupTitle>{t("settings.sources.searchGroup")}</GroupTitle>
      <SettingRow title={t("settings.sources.searchGrouping.title")} hint={t("settings.sources.searchGrouping.hint")}>
        <Switch
          checked={prefs.searchGrouping}
          onChange={(searchGrouping: boolean) => set({ searchGrouping })}
          label={t("settings.sources.searchGrouping.title")}
        />
      </SettingRow>
    </SettingsPane>
  );

  /** «Тексты песен». Ряды — те же, что в приложении (@muza/app/views/settings/
   *  LyricsPane.tsx), кроме «Видео вместо обложки»: см. шапку файла. Копия, а
   *  не переиспользование того файла, — по той же причине, что у соседних
   *  разделов: LyricsPane читает контекст экрана настроек (SettingsProvider с
   *  портами площадки), а страница веба ведёт настройки своим usePrefs. */
  const lyricsPane = (
    <SettingsPane>
      <GroupTitle>{t("settings.lyrics.displayGroup")}</GroupTitle>
      <SettingRow title={t("settings.lyrics.synced.title")} hint={t("settings.lyrics.synced.hint")}>
        <Switch checked={prefs.syncedLyrics} onChange={(syncedLyrics: boolean) => set({ syncedLyrics })} label={t("settings.lyrics.synced.title")} />
      </SettingRow>
      <SettingRow title={t("settings.lyrics.autoScroll.title")} hint={t("settings.lyrics.autoScroll.hint")}>
        <Switch checked={prefs.lyricsAutoScroll} onChange={(lyricsAutoScroll: boolean) => set({ lyricsAutoScroll })} label={t("settings.lyrics.autoScroll.title")} />
      </SettingRow>
      <SettingRow title={t("settings.lyrics.endNote.title")} hint={t("settings.lyrics.endNote.hint")}>
        <Switch checked={prefs.lyricsEndNote} onChange={(lyricsEndNote: boolean) => set({ lyricsEndNote })} label={t("settings.lyrics.endNote.title")} />
      </SettingRow>
      <SettingRow title={t("settings.lyrics.karaokeSize.title")} hint={t("settings.lyrics.karaokeSize.hint")}>
        <LiveSlider
          value={prefs.karaokeSize - KARAOKE_SIZE_MIN}
          max={KARAOKE_SIZE_MAX - KARAOKE_SIZE_MIN}
          label={t("settings.lyrics.karaokeSize.title")}
          suffix={`${prefs.karaokeSize} px`}
          onChange={(v) => set({ karaokeSize: KARAOKE_SIZE_MIN + Math.round(v) })}
        />
      </SettingRow>
      {/* Окно караоке симметрично (активная ±N), поэтому число строк всегда
          нечётное: ползунок ходит по 3,5,7,9,11 — шаг 2 от тройки. */}
      <SettingRow title={t("settings.lyrics.karaokeLines.title")} hint={t("settings.lyrics.karaokeLines.hint")}>
        <LiveSlider
          value={(prefs.karaokeLines - 3) / 2}
          max={4}
          label={t("settings.lyrics.karaokeLines.title")}
          suffix={t("settings.lyrics.linesSuffix", { count: prefs.karaokeLines })}
          onChange={(v) => set({ karaokeLines: 3 + Math.round(v) * 2 })}
        />
      </SettingRow>
      {/* 0 — «Авто»: размер строки диктует общий «Размер текста». Дальше
          4..14 — размер подбирается под число строк. */}
      <SettingRow title={t("settings.lyrics.panelLines.title")} hint={t("settings.lyrics.panelLines.hint")}>
        <LiveSlider
          value={prefs.lyricsPanelLines === 0 ? 0 : prefs.lyricsPanelLines - 3}
          max={11}
          label={t("settings.lyrics.panelLines.title")}
          suffix={
            prefs.lyricsPanelLines === 0
              ? t("settings.lyrics.panelLines.auto")
              : t("settings.lyrics.linesSuffix", { count: prefs.lyricsPanelLines })
          }
          onChange={(v) => {
            const n = Math.round(v);
            set({ lyricsPanelLines: n === 0 ? 0 : n + 3 });
          }}
        />
      </SettingRow>
      <GroupTitle>{t("settings.lyrics.understandingGroup")}</GroupTitle>
      {/* «Скоро», а не «Выкл»: рядом с невключаемой функцией «Выкл»
          подразумевал несуществующий переключатель. */}
      <SettingRow title={t("settings.lyrics.translation.title")} hint={t("settings.lyrics.translation.hint")}>
        <RowValue>{t("settings.lyrics.translation.soon")}</RowValue>
      </SettingRow>
      <SettingRow title={t("settings.lyrics.meaningMode.title")} hint={t("settings.lyrics.meaningMode.hint")}>
        <Switch checked={prefs.meaningMode} onChange={(meaningMode: boolean) => set({ meaningMode })} label={t("settings.lyrics.meaningMode.title")} />
      </SettingRow>
    </SettingsPane>
  );

  return (
    /* Связующая ткань разделов, приехавших из приложения целиком: они берут
       отсюда настройки, сервер, кто вошёл, тосты и умения площадки. Разделы,
       собранные прямо на странице (оформление, звук, тексты), провайдер не
       трогают — они и дальше зовут `set` напрямую. */
    <SettingsProvider
      prefs={prefs}
      // Провайдер отдаёт рядам точечный `set(patch)`, а сам просит целый
      // профиль. Веб-хранилище принимает и то и другое: `set` подмешивает
      // переданное к предыдущему состоянию.
      setPrefs={set}
      api={getApi()}
      // В браузере анонимного режима нет вовсе: без входа страница уводит на
      // /login, поэтому «нужен аккаунт» здесь показать некому.
      serverSession={!!session}
      username={session?.user.username ?? ""}
      // Кнопки модератора живут только в витрине расширений, а её тут нет.
      isAdmin={false}
      onLogout={onLogout}
      onNotify={notify}
      // Диалога-справки по клавишам в вебе нет: раздел «Горячие клавиши»
      // показывает их списком.
      onOpenHotkeys={() => undefined}
      // Играющий трек нужен только предпросмотру статуса Discord, а его нет.
      nowPlaying={null}
      glyphSrc="/glyph.svg"
      caps={capsSet}
      platform={platform}
      openSub={setSub}
      closeSub={closeSub}
      goTo={goTo}
    >
      {/* shared-screen гасит поле зоны .main (globals.css): без него зона
          добавляла свои 20px, и рельс настроек уезжал на 20 вправо и вниз
          относительно главного сайдбара — зазор слева становился 32 против 12
          справа, а верх рельса не совпадал с верхом сайдбара (замечание
          владельца 02.08 со снимком). Экран настроек сам держит свои поля:
          контракт «раздел оборачивает себя сам». */}
      <div className="shared-screen" style={{ height: "100%", minHeight: 0 }}>
      <SettingsScreen
        caps={caps}
        rows={rows}
        subs={WEB_SUBS}
        sub={sub}
        onSubChange={setSub}
        initialTab="appearance"
        panes={{
          account: accountPane,
          appearance: appearancePane,
          playback: playbackPane,
          sources: sourcesPane,
          lyrics: lyricsPane,
          library: libraryPane,
          integrations: integrationsPane,
          system: systemPane,
        }}
      />
      </div>
    </SettingsProvider>
  );
}
