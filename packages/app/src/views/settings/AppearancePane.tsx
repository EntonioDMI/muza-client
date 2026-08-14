/** РАЗДЕЛ «ВНЕШНИЙ ВИД» — то, что человек меняет чаще всего: язык, три
 *  готовых облика, тема, акцент, углы, стекло, фон, масштаб. Всё тонкое
 *  живёт за строкой «Кастомизация» отдельным под-экраном: держать сто
 *  ползунков на первом же экране настроек — это ровно та простыня, за
 *  которую настройки уже критиковали.
 *
 *  Приехало как есть из apps/desktop/src/views/SettingsView.tsx (волна
 *  «настройки», 2026-08-02): разметка, стили и порядок рядов не тронуты —
 *  приложение после переезда обязано выглядеть ровно как до него. */

import { useEffect, useMemo, useRef } from "react";
import { Kbd, Switch, Tabs } from "@muza/ui";
import { useT } from "../../i18n";
import type { Prefs } from "../../prefs/types";
import { PREF_RANGES } from "../../prefs/legacyPrefs";
import {
  AccentSwatch,
  CustomAccentSwatch,
  GLASS_MIN,
  LiveSlider,
  paneStyle,
  PresetRow,
  PresetTile,
  SampleChoice,
  SampleGlass,
  ScaleSlider,
  SettingRow,
} from "./primitives";
import { appearancePresets, currentWindowLayout, RADIUS_CHIPS, WINDOW_LAYOUTS, type WindowLayout } from "./appearancePresets";
import { useSettingsScreen } from "./settingsContext";

/** Ключ псевдо-сегмента «Своя» в ряду раскладок. Не WindowLayout: применить
 *  его нечего — он описывает состояние, а не задаёт его. */
const CUSTOM = "custom";

/** Потолок ползунка «Скругление» — из той же таблицы, что клампит чужие темы
 *  и старые сохранения (prefs/legacyPrefs.ts). Своя копия числа в интерфейсе
 *  означала бы ряд, умеющий выставить значение, которое фильтр тем зарежет. */
const RADIUS_MAX = PREF_RANGES.radius.max;

/** Три плотности стекла образцами. Средняя РАВНА значению по умолчанию (62) —
 *  тот, кто настройку не трогал, видит выбранной именно её, а не «Своё». */
const GLASS_SAMPLES = [
  { key: "light", value: 35 },
  { key: "normal", value: 62 },
  { key: "dense", value: 88 },
] as const;

export function AppearancePane() {
  const { t } = useT();
  const { prefs, set, paneClass, openSub, caps } = useSettingsScreen();
  const presets = appearancePresets(t);
  const layout = currentWindowLayout(prefs);
  // ТУМБЛЕР ФОНА = «фон включён», а не «фон из обложки». Раньше он стоял
  // checked={bgType === "cover"} и писал "cover"/"none": человек собирал в
  // «Кастомизации» градиент или анимированный фон, возвращался сюда — тумблер
  // выключен, а ряд рядом честно пишет «Свой», — один клик, и настройка фона
  // молча заменялась обложкой; обратный клик давал "none", а не прежний тип.
  // Прошлый тип помним здесь, чтобы возврат вернул ЕГО, а не обложку. Поле
  // настроек ради этого не заводим: память нужна только на время, пока человек
  // щёлкает тумблером, — после перезахода вернётся "cover", как и раньше.
  const lastBgType = useRef<Exclude<Prefs["bgType"], "none">>("cover");
  useEffect(() => {
    if (prefs.bgType !== "none") lastBgType.current = prefs.bgType;
  }, [prefs.bgType]);
  /** Как выглядит плитка «Свой»: настоящий цвет/градиент/картинка из
   *  Кастомизации, а не абстрактный образец. Ради этого плитка и заводилась —
   *  тумблер до неё не мог показать, ЧТО именно вернётся при включении.
   *  Тип берём из текущего, а если фон выключен — из запомненного: иначе,
   *  выключив фон, человек терял бы и картинку того, что выключил. */
  const customBg = useMemo(() => {
    const type = prefs.bgType === "none" ? lastBgType.current : prefs.bgType;
    if (type === "gradient") return { css: `linear-gradient(135deg, ${prefs.bgColor}, ${prefs.bgColor2})`, caption: t("settings.customize.background.type.gradient") };
    if (type === "color") return { css: prefs.bgColor, caption: t("settings.customize.background.type.color") };
    if (type === "image") {
      // Ссылка может быть пустой или битой — тогда под картинкой виден цвет, и
      // плитка не становится дырой. Кавычки, скобки и слеши вырезаем: ссылка
      // приезжает из поля ввода прямо в строку CSS, и без этого её можно было
      // бы закрыть и дописать своё правило.
      const url = prefs.bgImageUrl.trim().replace(/["'()\\]/g, "");
      return {
        css: url ? `${prefs.bgColor} center/cover no-repeat url("${url}")` : prefs.bgColor,
        caption: t("settings.customize.background.type.image"),
      };
    }
    if (type === "animated")
      return {
        css: `radial-gradient(60% 60% at 30% 35%, ${prefs.bgColor} 0%, transparent 60%), radial-gradient(60% 60% at 70% 70%, ${prefs.bgColor2} 0%, transparent 60%), var(--surface-1)`,
        caption: t("settings.customize.background.type.animated"),
      };
    // Своего фона ещё не собирали. Заготовленные цвета показывать НЕЛЬЗЯ: по
    // умолчанию это #1a1815 и #101418, то есть два почти чёрных — плитка
    // выходила неотличимой от соседней «Выкл» (замер скриншотом 14.08), и обе
    // читались как пустые. Пока собирать нечего, плитка обещает не конкретный
    // фон, а возможность: полоса от акцента к поверхности.
    return { css: "linear-gradient(135deg, var(--accent), var(--surface-4) 85%)", caption: t("settings.appearance.background.setUp") };
  }, [prefs.bgType, prefs.bgColor, prefs.bgColor2, prefs.bgImageUrl, t]);
  return (
    <div className={paneClass} style={paneStyle}>
      {/* Переключатель языка — первый элемент вкладки по требованию владельца.
          Живой, без перезагрузки: меняет prefs.language, и все места,
          спрашивающие перевод, перерисовываются сами. */}
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
            // «Классика» отличается от «Музы» не цветом и не углами, а
            // геометрией, поэтому по паре accent+radius её не отличить —
            // сверяем и остальные ключи облика, если пресет их несёт.
            selected={
              prefs.accent === p.accent &&
              prefs.radius === p.radius &&
              (!p.extra || (Object.keys(p.extra) as (keyof Prefs)[]).every((k) => prefs[k] === p.extra?.[k]))
            }
            onClick={() => set({ accent: p.accent, radius: p.radius, ...p.extra })}
          />
        ))}
      </div>
      {/* РАСКЛАДКА ОКНА — отдельная ось от обликов (решение владельца 04.08
          ночью: «не стоило добавлять воздух и классику в тему, это совсем не
          подходит»). Облик — цвет и углы; раскладка — геометрия. Каждый пункт
          задаёт ось ЦЕЛИКОМ (WINDOW_LAYOUTS): полумеры вроде «Классика +
          плоский тумблер» давали кентавра — плавающий плеер при прижатых
          зонах. Воздушная — дефолт (выбор сооснователя), плоскую включает,
          кому нравится (владелец), классика — вид до редизайна 04.08. */}
      <SettingRow title={t("settings.appearance.layout.title")} hint={t("settings.appearance.layout.hint")}>
        <Tabs
          items={[
            { key: "air", label: t("settings.appearance.layout.air") },
            { key: "flat", label: t("settings.appearance.layout.flat") },
            { key: "classic", label: t("settings.appearance.layout.classic") },
            // ЧЕТВЁРТЫЙ СЕГМЕНТ «Своя» появляется ТОЛЬКО когда он и выбран, и
            // нажать его нельзя (клик ниже игнорируется) — это не выбор, а
            // ответ на вопрос «а что стоит сейчас?».
            // Просто «ничего не выбрано» тут не годится: пилюля переползла бы
            // на первый сегмент или исчезла вовсе, и получилась бы та же немота,
            // с которой всё и началось, — вкладки уверенно показывали
            // «Воздушная», пока окно стояло не в ней.
            ...(layout === null ? [{ key: CUSTOM, label: t("settings.appearance.layout.custom") }] : []),
          ]}
          value={layout ?? CUSTOM}
          onChange={(k: string) => {
            if (k !== CUSTOM) set(WINDOW_LAYOUTS[k as WindowLayout]);
          }}
        />
      </SettingRow>
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
      {/* СКРУГЛЕНИЕ: три привычных значения чипами + свободный ползунок за
          стрелкой. До 2026-08-13 здесь были ровно три сегмента и ничего больше —
          «у пользователя есть три зашитых варианта, которые он не может
          изменить» (жалоба владельца). Чипы остались потому, что 99 % выборов
          это одно из трёх, и терять клик ради ползунка незачем; чип «Своё»
          появляется сам, когда число не совпало ни с одной засечкой. */}
      <PresetRow
        title={t("settings.appearance.radius.title")}
        hint={t("settings.appearance.radius.hint")}
        chips={RADIUS_CHIPS.map((c) => ({ key: c.key, label: t(`settings.appearance.radius.${c.key}`) }))}
        active={RADIUS_CHIPS.find((c) => c.value === prefs.radius)?.key ?? "custom"}
        onPick={(k) => {
          const chip = RADIUS_CHIPS.find((c) => c.key === k);
          if (chip) set({ radius: chip.value });
        }}
      >
        <SettingRow title={t("settings.appearance.radius.exact.title")} hint={t("settings.appearance.radius.exact.hint")}>
          <LiveSlider
            value={prefs.radius}
            max={RADIUS_MAX}
            label={t("settings.appearance.radius.exact.title")}
            suffix={prefs.radius === 0 ? t("settings.appearance.radius.sharp") : `${prefs.radius} px`}
            onChange={(v) => set({ radius: Math.round(v) })}
          />
        </SettingRow>
      </PresetRow>
      {/* СТЕКЛО ЦЕЛИКОМ. Тумблер стоит НАД ползунком плотности, а не рядом с
          ним: «сколько стекла» имеет смысл только после «стекло вообще». При
          выключенном ползунок гаснет — он честно показывает, что ему нечем
          управлять, и остаётся находимым поиском по настройкам. */}
      <SettingRow title={t("settings.appearance.glassOn.title")} hint={t("settings.appearance.glassOn.hint")}>
        <Switch checked={prefs.glassOn} onChange={(glassOn: boolean) => set({ glassOn })} label={t("settings.appearance.glassOn.title")} />
      </SettingRow>
      {/* ПЛОТНОСТЬ СТЕКЛА — образцами (правка 2026-08-14). Ползунок «0…100 %»
          просил вообразить материал по числу; хуже того, единственное место, где
          его видно прямо сейчас, — плашка самих настроек, то есть человек
          настраивал стекло, глядя на стекло, которое под ним же и меняется.
          Образцы показывают ТРИ материала рядом, и выбор становится сравнением,
          а не угадыванием. Точный процент — под стрелкой, как у скругления. */}
      <SampleChoice
        title={t("settings.appearance.glass.title")}
        hint={prefs.glassOn ? t("settings.appearance.glass.hint") : t("settings.appearance.glass.disabledHint")}
        disabled={!prefs.glassOn}
        minTile={104}
        items={GLASS_SAMPLES.map((g) => ({
          key: g.key,
          label: t(`settings.appearance.glass.${g.key}`),
          sample: <SampleGlass opacity={g.value} />,
        }))}
        value={GLASS_SAMPLES.find((g) => g.value === prefs.glassOpacity)?.key ?? "custom"}
        onPick={(k) => {
          const g = GLASS_SAMPLES.find((x) => x.key === k);
          if (g) set({ glassOpacity: g.value });
        }}
      >
        <SettingRow title={t("settings.appearance.glass.exact.title")} hint={t("settings.appearance.glass.exact.hint")}>
          <LiveSlider
            value={prefs.glassOpacity - GLASS_MIN}
            max={100 - GLASS_MIN}
            label={t("settings.appearance.glass.exact.title")}
            suffix={`${prefs.glassOpacity} %`}
            onChange={(v) => set({ glassOpacity: GLASS_MIN + Math.round(v) })}
          />
        </SettingRow>
      </SampleChoice>
      {/* ФОН — три образца вместо тумблера (правка 2026-08-14, ровно тот случай,
          который владелец назвал первым: «тумблер у того, что на деле имеет три
          состояния»). Величина здесь никогда не была двоичной: фон бывает из
          обложки, свой (цвет, градиент, картинка, анимация) и никакой. Тумблер
          умел показать только «какой-то есть / нет», а КАКОЙ именно — дописывала
          строчка слева от него. Значит, орган не справлялся и его подпирали
          текстом.
          Теперь три плитки рисуют результат: у «Своего» в плитке настоящий цвет
          или градиент, который человек собрал в Кастомизации, — по нему и видно,
          что там ждёт. Память прошлого типа (lastBgType) осталась: она нужна,
          чтобы «Свой» вернул именно ТОТ фон, а не обложку. */}
      <SampleChoice
        title={t("settings.appearance.background.title")}
        hint={t("settings.appearance.background.hint")}
        minTile={112}
        items={[
          {
            key: "cover",
            label: t("settings.appearance.background.fromCover"),
            // Обложки конкретного трека тут нет и быть не может (настройки не
            // знают, что играет) — образец показывает ПРИЁМ: размытое цветное
            // пятно под интерфейсом.
            sample: (
              <span
                style={{
                  display: "block",
                  width: "100%",
                  height: "100%",
                  background: "radial-gradient(120% 120% at 25% 20%, var(--accent) 0%, transparent 55%), radial-gradient(120% 120% at 80% 80%, var(--surface-4) 0%, var(--surface-1) 70%)",
                  filter: "blur(3px)",
                }}
              ></span>
            ),
          },
          {
            key: "custom",
            label: t("settings.appearance.background.custom"),
            caption: customBg.caption,
            sample: <span style={{ display: "block", width: "100%", height: "100%", background: customBg.css }}></span>,
          },
          {
            key: "none",
            label: t("common.off"),
            // «Без фона» — не пустая плитка, а честный образец: ровная
            // поверхность приложения. Пустота читалась бы как «не загрузилось»,
            // поэтому берём заметную ступень поверхности, а не прозрачную.
            sample: <span style={{ display: "block", width: "100%", height: "100%", background: "var(--surface-4)" }}></span>,
          },
        ]}
        value={prefs.bgType === "cover" || prefs.bgType === "none" ? prefs.bgType : "custom"}
        onPick={(k) => {
          if (k === "custom") {
            // Своего фона ещё нет — вести человека в пустую настройку нечестно,
            // ведём туда, где его собирают.
            if (lastBgType.current === "cover") openSub("customize");
            else set({ bgType: lastBgType.current });
            return;
          }
          set({ bgType: k as Prefs["bgType"] });
        }}
      />
      <SettingRow title={t("settings.appearance.scale.title")} hint={t("settings.appearance.scale.hint")}>
        <ScaleSlider value={prefs.uiScale} label={t("settings.appearance.scale.title")} onCommit={(uiScale) => set({ uiScale })} />
      </SettingRow>
      <SettingRow
        title={t("settings.appearance.customize.title")}
        hint={t("settings.appearance.customize.hint")}
        onClick={() => openSub("customize")}
        chevron
      ></SettingRow>
      {/* РЕЖИМ ПРАВКИ ВИДА — тут его и ищут. Владелец 04.08: «Как менять
          пропорции? Мы же закладывали фундамент, но я так и не понял, как это
          делать». Сочетание клавиш без единого упоминания в интерфейсе — это
          возможность, которой нет: узнать о ней неоткуда. Ряд ничего не
          переключает, он объясняет и показывает клавиши. */}
      {/* Нет умения — нет ряда (правило площадки). В браузере режима правки
          вида не существует: слой ручек, стек отмены и захват клавиш в веб не
          переносили (решение владельца 11.08). Рассказывать там про Ctrl+E
          значило бы обещать пустоту. */}
      {caps.has("lookEdit") ? (
        <SettingRow title={t("settings.appearance.lookEdit.title")} hint={t("settings.appearance.lookEdit.hint")}>
          <span style={{ display: "flex", gap: 4 }}>
            <Kbd>Ctrl</Kbd>
            <Kbd>E</Kbd>
          </span>
        </SettingRow>
      ) : null}
    </div>
  );
}
