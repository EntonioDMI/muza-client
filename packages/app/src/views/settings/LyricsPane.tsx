/** РАЗДЕЛ «ТЕКСТЫ ПЕСЕН»: как показывать слова и караоке.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  ГДЕ ЭТОТ РАЗДЕЛ В БРАУЗЕРЕ. Своей копией в apps/web/app/(app)/settings/
 *  page.tsx (`lyricsPane`) — как у соседних разделов: этот файл читает
 *  контекст экрана настроек (SettingsProvider с портами площадки), а страница
 *  веба ведёт настройки своим usePrefs. Копия отличается ровно одним рядом:
 *  «Видео вместо обложки» в браузере ОТСУТСТВУЕТ (не серое) — видео-дорожку
 *  добывает движок приложения, страница так не умеет. Правишь ряды здесь —
 *  загляни туда: остальные восемь обязаны совпадать. */

import { Switch } from "@muza/ui";
import { useT } from "../../i18n";
import { GroupTitle, LiveSlider, paneStyle, RowValue, SettingRow } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export function LyricsPane() {
  const { t } = useT();
  const { prefs, set, paneClass } = useSettingsScreen();
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
      <SettingRow title={t("settings.lyrics.videoNowPlaying.title")} hint={t("settings.lyrics.videoNowPlaying.hint")}>
        <Switch
          checked={prefs.videoNowPlaying}
          onChange={(videoNowPlaying: boolean) => set({ videoNowPlaying })}
          label={t("settings.lyrics.videoNowPlaying.title")}
        />
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
      {/* 0 — «Авто»: размер строки диктует общий «Размер текста», как было
          всегда. Дальше 4..14 — размер подбирается под число строк. */}
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
    </div>
  );
}
