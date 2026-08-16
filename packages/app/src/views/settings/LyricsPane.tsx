/** РАЗДЕЛ «ТЕКСТЫ ПЕСЕН»: как показывать слова и караоке.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  ⚠️ ОДИН РАЗДЕЛ НА ОБЕ ПРОГРАММЫ с 2026-08-11. До этого у веба была своя
 *  копия, отличавшаяся ровно одним рядом, — и «ровно один» держался ровно до
 *  первой правки: копия, которая обязана совпадать, разъезжается сама (так за
 *  неделю разошёлся «Внешний вид»). Единственный площадочный ряд — «Видео
 *  вместо обложки» — закрыт умением `videoTrack`. */

import { Switch } from "@muza/ui";
import { useT } from "../../i18n";
import { GroupTitle, LiveSlider, paneStyle, RowValue, SampleChoice, SampleLines, SettingRow } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

/** Три привычных размера караоке-строки. Диапазон поля — 36..72; засечки взяты
 *  не «поровну», а по тому, как текст читается с дивана: 44 — с рабочего
 *  расстояния, 56 — через комнату, 68 — во весь экран на телевизоре. */
const KARAOKE_SIZES = [
  { key: "normal", px: 44 },
  { key: "large", px: 56 },
  { key: "huge", px: 68 },
] as const;

/** Окно караоке симметрично (активная строка ±N), поэтому значений ровно пять:
 *  3, 5, 7, 9, 11. Пять — это ВСЕ возможные значения, а не засечки, поэтому
 *  точного ползунка под ними нет: подстраивать нечего. */
const KARAOKE_LINES = [3, 5, 7, 9, 11];

/** Сколько строк текста в панели «Сейчас играет». 0 — особое значение «сколько
 *  влезет» (размер строки идёт от общего «Размера текста»), поэтому оно и стоит
 *  ОТДЕЛЬНОЙ плиткой, а не крайним положением ползунка. */
const PANEL_LINES = [6, 9, 12];

/** Плечо шкалы сдвига текста, мс. Три секунды в каждую сторону: этого хватает
 *  на кривую разметку источника (там расхождение бывает в пару секунд) и не
 *  хватает на «переехать на следующий куплет» — то есть шкала остаётся
 *  подстройкой, а не способом сломать себе текст. */
const LYRICS_OFFSET_MAX = 3000;

/** Мс → подпись у ползунка: «+0,25», «0», «−0,50». Знак показываем ВСЕГДА
 *  (кроме нуля): без него «0,25» не отвечает на вопрос «раньше или позже»,
 *  ради которого человек и трогает этот ряд. Минус — типографский, как во
 *  всём интерфейсе; запятая или точка — по языку, иначе подпись выглядит
 *  чужой ровно в той половине случаев, где её и читают. */
function formatOffset(ms: number, lang: string): string {
  if (ms === 0) return "0";
  const sec = (Math.abs(ms) / 1000).toFixed(2);
  return `${ms > 0 ? "+" : "−"}${lang === "ru" ? sec.replace(".", ",") : sec}`;
}

export function LyricsPane() {
  const { t, lang } = useT();
  const { prefs, set, caps, paneClass } = useSettingsScreen();
  return (
    <div className={paneClass} style={paneStyle}>
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
      {/* СДВИГ ТЕКСТА — ползунок с нулём ПОСРЕДИНЕ, а не с края (16.08, жалоба
          «текст сильно отстаёт»). Наша задержка показа лечится константой в
          коде (LYRICS_LEAD_MS), а этот ряд — про чужую разметку: в LRCLIB
          попадаются тексты, размеченные ровной сеткой «строка каждые две
          секунды», и одна разметка, разложенная на издания разной длины.
          Такое можно поправить только рукой и только на слух, поэтому шкала
          двусторонняя: «раньше» нужно чаще, но «позже» — тоже настоящий
          случай. Шаг 50 мс: мельче человек не слышит, а ползунок в 240 px
          иначе не даёт попасть в круглое число. */}
      <SettingRow title={t("settings.lyrics.offset.title")} hint={t("settings.lyrics.offset.hint")}>
        <LiveSlider
          value={prefs.lyricsOffsetMs + LYRICS_OFFSET_MAX}
          max={LYRICS_OFFSET_MAX * 2}
          label={t("settings.lyrics.offset.title")}
          suffix={t("settings.lyrics.offset.value", { n: formatOffset(prefs.lyricsOffsetMs, lang) })}
          onChange={(v) => set({ lyricsOffsetMs: Math.round((v - LYRICS_OFFSET_MAX) / 50) * 50 })}
        />
      </SettingRow>
      {/* Видео-дорожку добывает движок на устройстве; площадке, которой сервер
          отдаёт только звук, показывать вместо обложки нечего. */}
      {caps.has("videoTrack") ? (
        <SettingRow title={t("settings.lyrics.videoNowPlaying.title")} hint={t("settings.lyrics.videoNowPlaying.hint")}>
          <Switch
            checked={prefs.videoNowPlaying}
            onChange={(videoNowPlaying: boolean) => set({ videoNowPlaying })}
            label={t("settings.lyrics.videoNowPlaying.title")}
          />
        </SettingRow>
      ) : null}
      {/* РАЗМЕР КАРАОКЕ-СТРОКИ — образцами, а не пикселями (правка 2026-08-14).
          Ползунок «36…72 px» просил вообразить размер по числу, да ещё в
          единице, которой человек не мыслит, и вдобавок показывал результат на
          ДРУГОМ экране: пока настраиваешь, караоке не видно вовсе. Плитки
          отвечают на тот же вопрос картинкой — слово нарисовано каждым из трёх
          размеров, и разница видна до применения. Точные пиксели остались под
          стрелкой: обещание «ничего не заперто» держится. */}
      <SampleChoice
        title={t("settings.lyrics.karaokeSize.title")}
        hint={t("settings.lyrics.karaokeSize.hint")}
        minTile={104}
        items={KARAOKE_SIZES.map((s) => ({
          key: s.key,
          label: t(`settings.lyrics.karaokeSize.${s.key}`),
          sample: (
            // Пропорция образца честная (все три уменьшены одним
            // коэффициентом), абсолютный размер — нет: 68 px в плитку высотой
            // 54 не влезет. Точное число показывает ползунок под стрелкой.
            <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: Math.round(s.px * 0.4), color: "var(--text-1)", lineHeight: 1 }}>
              {t("settings.lyrics.karaokeSize.sample")}
            </span>
          ),
        }))}
        value={KARAOKE_SIZES.find((s) => s.px === prefs.karaokeSize)?.key ?? "custom"}
        onPick={(k) => {
          const s = KARAOKE_SIZES.find((x) => x.key === k);
          if (s) set({ karaokeSize: s.px });
        }}
      >
        <SettingRow title={t("settings.lyrics.karaokeSize.exact.title")} hint={t("settings.lyrics.karaokeSize.exact.hint")}>
          <LiveSlider
            value={prefs.karaokeSize - 36}
            max={36}
            label={t("settings.lyrics.karaokeSize.exact.title")}
            suffix={`${prefs.karaokeSize} px`}
            onChange={(v) => set({ karaokeSize: 36 + Math.round(v) })}
          />
        </SettingRow>
      </SampleChoice>
      {/* СКОЛЬКО СТРОК ВИДНО — ровно пять возможных значений, и каждое
          нарисовано столбиком полосок с подсвеченной серединой. Ползунок с
          пятью остановками был худшим из миров: попасть точно трудно (закон
          Фиттса на узкой дорожке), а прочитать результат нельзя вовсе. Точного
          ползунка тут НЕТ намеренно — подстраивать нечего, плитки покрывают
          весь диапазон. */}
      <SampleChoice
        title={t("settings.lyrics.karaokeLines.title")}
        hint={t("settings.lyrics.karaokeLines.hint")}
        minTile={82}
        items={KARAOKE_LINES.map((n) => ({
          key: String(n),
          label: t("settings.lyrics.linesSuffix", { count: n }),
          sample: <SampleLines count={n} />,
        }))}
        value={String(prefs.karaokeLines)}
        onPick={(k) => set({ karaokeLines: Number(k) })}
      />
      {/* СТРОК В ПАНЕЛИ. «Сколько влезет» (поле = 0) было НУЛЕВЫМ ПОЛОЖЕНИЕМ
          ползунка — то есть особый режим прятался в крайней точке шкалы и
          отличался от «4 строки» одним пикселем хода. Теперь это отдельная
          плитка: она не про число строк, она про другой способ решать, и
          выбирается отдельно. */}
      <SampleChoice
        title={t("settings.lyrics.panelLines.title")}
        hint={t("settings.lyrics.panelLines.hint")}
        minTile={96}
        items={[
          {
            key: "auto",
            label: t("settings.lyrics.panelLines.auto"),
            // Образец «сколько влезет» — полоски во всю высоту плитки, без
            // выделенной середины: числа тут нет, есть «заполним, чем есть».
            sample: <SampleLines count={11} accent={false} />,
          },
          ...PANEL_LINES.map((n) => ({
            key: String(n),
            label: t("settings.lyrics.linesSuffix", { count: n }),
            sample: <SampleLines count={n} />,
          })),
        ]}
        value={prefs.lyricsPanelLines === 0 ? "auto" : String(prefs.lyricsPanelLines)}
        onPick={(k) => set({ lyricsPanelLines: k === "auto" ? 0 : Number(k) })}
      >
        <SettingRow title={t("settings.lyrics.panelLines.exact.title")} hint={t("settings.lyrics.panelLines.exact.hint")}>
          <LiveSlider
            value={Math.max(0, prefs.lyricsPanelLines - 4)}
            max={10}
            label={t("settings.lyrics.panelLines.exact.title")}
            suffix={t("settings.lyrics.linesSuffix", { count: Math.max(4, prefs.lyricsPanelLines) })}
            onChange={(v) => set({ lyricsPanelLines: 4 + Math.round(v) })}
          />
        </SettingRow>
      </SampleChoice>
      <GroupTitle>{t("settings.lyrics.understandingGroup")}</GroupTitle>
      {/* «Скоро», а не «Выкл»: рядом с невключаемой функцией «Выкл»
          подразумевал несуществующий переключатель. */}
      <SettingRow title={t("settings.lyrics.translation.title")} hint={t("settings.lyrics.translation.hint")}>
        <RowValue>{t("settings.lyrics.translation.soon")}</RowValue>
      </SettingRow>
      <SettingRow title={t("settings.lyrics.meaningMode.title")} hint={t("settings.lyrics.meaningMode.hint")}>
        <Switch checked={prefs.meaningMode} onChange={(meaningMode: boolean) => set({ meaningMode })} label={t("settings.lyrics.meaningMode.title")} />
      </SettingRow>
    </div>
  );
}
