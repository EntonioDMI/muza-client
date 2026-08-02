"use client";

import { useCallback, useMemo, useState } from "react";
import { ChipGroup, Fader, Switch, Tabs } from "@muza/ui";
import { LANGS, useT, type Lang, type TranslationKey } from "@muza/app";
import { usePlatform } from "@muza/app/platform";
import { SettingsScreen } from "@muza/app/views/settings/SettingsScreen";
import { AccountPane } from "@muza/app/views/settings/AccountPane";
import { IntegrationsPane } from "@muza/app/views/settings/IntegrationsPane";
import { LibraryPane } from "@muza/app/views/settings/LibraryPane";
import { SystemPane } from "@muza/app/views/settings/SystemPane";
import { SessionsSub } from "@muza/app/views/settings/SessionsSub";
import { DataSub } from "@muza/app/views/settings/DataSub";
import { PrivacySub } from "@muza/app/views/settings/PrivacySub";
import { StatsSub } from "@muza/app/views/settings/StatsSub";
import { LicensesSub } from "@muza/app/views/settings/LicensesSub";
import { RecsTuning } from "@muza/app/views/settings/PlaybackPane";
import { paneRows, SettingsProvider, settingsCaps, type SettingsSubKey } from "@muza/app/views/settings/settingsContext";
import type { SettingsTabKey } from "@muza/app/views/settings/SettingsNav";
import {
  AccentSwatch,
  CustomAccentSwatch,
  GLASS_MIN,
  GroupTitle,
  LiveSlider,
  PresetRow,
  PresetTile,
  RowValue,
  SettingRow,
  StepsEditor,
} from "@muza/app/views/settings/primitives";
import { matchPreset, PRESETS_WARM } from "@muza/app/prefs/presets";
import { DEFAULT_PREFS } from "@muza/app/prefs/types";
import { getApi } from "../../../src/api";
import { EQ_PRESETS } from "../../../src/audioFx";
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
  // Внешний вид
  "settings.appearance.language.title": null,
  "settings.appearance.theme.title": null,
  "settings.appearance.accent.title": null,
  "settings.appearance.radius.title": null,
  "settings.customize.typography.fontUi.title": null,
  "settings.appearance.glass.title": null,
  "settings.customize.glass.panelBlur.title": null,
  "settings.customize.colors.textDim.title": null,
  "settings.appearance.background.title": null,
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
const WEB_SUBS = ["sessions", "data", "privacy", "stats", "licenses"] as const;

/** Пресеты оформления — те же три, что на первом экране «Внешнего вида» в
 *  приложении (пара «акцент + углы» одним нажатием). */
const APPEARANCE_PRESETS = [
  { key: "muza", accent: "blue", accentColor: "#3b82f6", radius: "soft" },
  { key: "flame", accent: "red", accentColor: "#f76967", radius: "round" },
  { key: "graphite", accent: "bolt", accentColor: "#327ad9", radius: "mild" },
] as const;

/** Границы ползунков оформления — те же числа, что в приложении: одна тема
 *  обязана настраиваться одинаково на обеих площадках. */
const BLUR_MAX = 64;
const TEXT_DIM_MIN = 40;
const TEXT_DIM_MAX = 80;
/** Размер караоке-строки, px: те же 36..72, что у ползунка в приложении
 *  (@muza/app/views/settings/LyricsPane.tsx). */
const KARAOKE_SIZE_MIN = 36;
const KARAOKE_SIZE_MAX = 72;

/** Golos/Unbounded — имена шрифтов, не переводятся ни в одном языке;
 *  «Системный» — единственная переводимая подпись этого выбора. */
const FONT_KEYS = ["golos", "unbounded", "system"] as const;

const EQ_LABELS = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];

export default function SettingsPage() {
  const { prefs, set } = usePrefs();
  const { session, logout } = useSession();
  const router = useRouter();
  const { t, lang } = useT();
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
  const caps = useMemo(() => settingsCaps(platform), [platform]);
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
      ...paneRows("library", caps),
      ...paneRows("integrations", caps),
      ...paneRows("system", caps),
      ...paneRows("hotkeys", caps),
      ...WEB_OWN_ROWS,
    }),
    [caps],
  );

  /** Строка, которой может ещё не быть в словарях (их правит отдельный ход
   *  волны). Нет перевода — ряд остаётся без подсказки: пустая строка честнее,
   *  чем `web.settings.speed.hint` буквами на экране.
   *
   *  ⚠️ Это ЗАГЛУШКА НА ВРЕМЯ, а не приём. Два ключа — `web.settings.speed.hint`
   *  и `web.settings.speedSteps.hint` — заявлены в словари этой же волной;
   *  как только они там появятся, подсказки встанут сами (`t` перестанет
   *  возвращать ключ), а этот хелпер можно снимать вместе с двумя `tOpt` ниже.
   *  Новые ряды через него заводить НЕ НАДО: строка добавляется вместе с
   *  рядом, и ряд без подсказки — это недоделанный ряд. */
  const tOpt = (key: string): string | undefined => {
    const s = t(key as TranslationKey);
    return s === key ? undefined : s;
  };

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
    // Значение — персистентный ключ prefs.eqPreset (см. EQ_PRESETS в audioFx.ts),
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

  const appearancePane = (
    <>
      {/* Язык — первым, как в приложении: живой, без перезагрузки страницы. */}
      <SettingRow title={t("settings.appearance.language.title")} hint={t("settings.appearance.language.hint")}>
        <Tabs
          items={LANGS.map((l) => ({
            key: l,
            label: l === "ru" ? t("settings.appearance.language.optionRu") : t("settings.appearance.language.optionEn"),
          }))}
          value={lang}
          onChange={(k: string) => set({ language: k as Lang })}
        />
      </SettingRow>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--sp-3)" }}>
        {APPEARANCE_PRESETS.map((p) => (
          <PresetTile
            key={p.key}
            name={t(`settings.appearance.presets.${p.key}.name`)}
            hint={t(`settings.appearance.presets.${p.key}.hint`)}
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
          onChange={(k: string) => set({ theme: k as WebPrefs["theme"] })}
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
          onChange={(radius: string) => set({ radius: radius as WebPrefs["radius"] })}
        />
      </SettingRow>
      <SettingRow title={t("settings.customize.typography.fontUi.title")} hint={t("settings.customize.typography.fontUi.hint")}>
        <Tabs
          items={FONT_KEYS.map((k) => ({
            key: k,
            // Имена шрифтов не переводятся; переводится только «Системный».
            label: k === "system" ? t("web.settings.fontSystem") : k === "golos" ? "Golos" : "Unbounded",
          }))}
          value={prefs.fontUi}
          onChange={(k: string) => set({ fontUi: k as WebPrefs["fontUi"] })}
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
      <SettingRow title={t("settings.customize.glass.panelBlur.title")} hint={t("settings.customize.glass.panelBlur.hint")}>
        <LiveSlider
          value={prefs.blur}
          max={BLUR_MAX}
          label={t("settings.customize.glass.panelBlur.title")}
          suffix={`${prefs.blur} px`}
          onChange={(v) => set({ blur: Math.round(v) })}
        />
      </SettingRow>
      <SettingRow title={t("settings.customize.colors.textDim.title")} hint={t("settings.customize.colors.textDim.hint")}>
        <LiveSlider
          value={prefs.textDim - TEXT_DIM_MIN}
          max={TEXT_DIM_MAX - TEXT_DIM_MIN}
          label={t("settings.customize.colors.textDim.title")}
          suffix={`${prefs.textDim} %`}
          onChange={(v) => set({ textDim: TEXT_DIM_MIN + Math.round(v) })}
        />
      </SettingRow>
      <SettingRow title={t("settings.appearance.background.title")} hint={t("settings.appearance.background.hint")}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
          {/* Общая модель хранит вид фона перечислением (bgType), а вкладка
              умеет ровно один — «из обложки». Тумблер переключает между ним
              и «выкл»; выбранный в программе цвет/градиент/картинку веб
              бережёт в профиле, но не рисует (слияние моделей 2026-08-02). */}
          <RowValue>{prefs.bgType === "cover" ? t("settings.appearance.background.fromCover") : t("common.off")}</RowValue>
          <Switch
            checked={prefs.bgType === "cover"}
            onChange={(on: boolean) => set({ bgType: on ? "cover" : "none" })}
            label={t("settings.appearance.background.ariaLabel")}
          />
        </div>
      </SettingRow>
      <SettingRow title={t("web.settings.npPanelRow.title")} hint={t("web.settings.npPanelRow.hint")}>
        <Switch checked={prefs.npOpen} onChange={(npOpen: boolean) => set({ npOpen })} label={t("web.settings.npPanelRow.title")} />
      </SettingRow>
    </>
  );

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
    <>
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
          лишним переходом ради симметрии — хуже, чем показать их сразу. */}
      <div style={prefs.eqOn ? undefined : { opacity: 0.4, pointerEvents: "none" }}>
        <div className="eq-faders" style={{ margin: "var(--sp-2) 0 var(--sp-3)", padding: 0 }}>
          {/* Ключи EQ_PRESETS (рус. слова) — персистентные значения prefs.eqPreset,
              как и "Свой": сознательно не переведены, та же договорённость, что в
              приложении (иначе сохранённая настройка разъедется между клиентами). */}
          <ChipGroup items={[...Object.keys(EQ_PRESETS), "Свой"]} value={prefs.eqPreset} onChange={applyEqPreset} />
        </div>
        <div className="eq-faders">
          {prefs.eqBands.map((v, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-1)" }}>
              <Fader
                value={v}
                min={-12}
                max={12}
                height={120}
                onChange={(nv: number) => setBand(i, nv)}
                ariaLabel={t("settings.equalizer.bandAria", { freq: EQ_LABELS[i] })}
              />
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--text-3)" }}>{EQ_LABELS[i]}</span>
            </div>
          ))}
        </div>
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
      <SettingRow title={t("player.speedTooltip")} hint={tOpt("web.settings.speed.hint")}>
        <ChipGroup
          items={prefs.speedSteps.map((v) => ({ key: String(v), label: `${v}×` }))}
          value={String(player.speed)}
          onChange={(k: string) => player.setSpeed(Number(k))}
        />
      </SettingRow>
      <SettingRow title={t("settings.playback.speedSteps.title")} hint={tOpt("web.settings.speedSteps.hint")}>
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
    </>
  );

  const sourcesPane = (
    <>
      <GroupTitle>{t("settings.sources.searchGroup")}</GroupTitle>
      <SettingRow title={t("settings.sources.searchGrouping.title")} hint={t("settings.sources.searchGrouping.hint")}>
        <Switch
          checked={prefs.searchGrouping}
          onChange={(searchGrouping: boolean) => set({ searchGrouping })}
          label={t("settings.sources.searchGrouping.title")}
        />
      </SettingRow>
    </>
  );

  /** «Тексты песен». Ряды — те же, что в приложении (@muza/app/views/settings/
   *  LyricsPane.tsx), кроме «Видео вместо обложки»: см. шапку файла. Копия, а
   *  не переиспользование того файла, — по той же причине, что у соседних
   *  разделов: LyricsPane читает контекст экрана настроек (SettingsProvider с
   *  портами площадки), а страница веба ведёт настройки своим usePrefs. */
  const lyricsPane = (
    <>
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
    </>
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
    </SettingsProvider>
  );
}
