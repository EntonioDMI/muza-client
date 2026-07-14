# apps/desktop/src/i18n/en.ts

Английский словарь (эпик W5 i18n) — ДЕФОЛТНЫЙ язык интерфейса. Корневой объект `en`, структура которого типизирует `ru.ts` (`ru: typeof en` — расхождение ключей ловит tsc). Подмешивает `en.views` (`en.views.ts`) и `en.media` (`en.media.ts`).

---

Зоны верхнего уровня (не все перечислены — см. сам файл, он большой):
`common`, `settings.*` (все вкладки настроек, T28-T30), `app`, `menu`,
`toast`, `player`, `sidebar`, `nowPlaying`, `listeningMode`, `auth`,
`dialogs`, `mini`, `plugins`, `views` (из en.views.ts), `media` (из
en.media.ts).

**T34a (2026-07-14, эпик W5):** добавлены три новые зоны — shell-диалоги и
мини-плеер остались с захардкоженной русской строкой после T31 (T31 покрыл
только App.tsx + shell-хром: Sidebar/PlayerBar/NowPlayingPanel).

- `dialogs.*` — строки 10 shell-диалогов: `collab` (`shell/CollabDialog.tsx`),
  `jam` (`shell/JamDialog.tsx`), `versions` (`shell/VersionsDialog.tsx`),
  `queue` (`shell/QueuePanel.tsx`), `share` (`shell/ShareDialog.tsx`),
  `meaning` (`shell/MeaningDialog.tsx`), `importPlaylist`
  (`shell/ImportDialog.tsx`), `addLink` (`shell/AddLinkDialog.tsx`),
  `joinPlaylist` (`shell/JoinPlaylistDialog.tsx`), `iconPicker`
  (`shell/PlaylistIconPicker.tsx`). Плюс общие для нескольких диалогов ключи
  прямо в `dialogs.*`: `close` («Закрыть» — Collab/Jam/Share/Versions/
  Meaning), `copyFailed` («Не удалось скопировать» — Collab/Jam/Share),
  `copyCode` («Скопировать код» — Collab/Jam), `codeTooShort` (Jam/
  JoinPlaylist). Где строка уже была в словаре дословно — переиспользована:
  `dialogs.versions.titleWithTrack` строит хвост из `menu.catalog.versions`,
  заголовок `ShareDialog` = `menu.catalog.share`, кнопка «Свернуть» в
  `JamDialog` = `listeningMode.minimize`, aria-label очереди = `player.queue`.
- `mini.*` — `mini/MiniPlayer.tsx` (отдельный webview, ВНЕ
  `LanguageProvider` — потребитель зовёт `translate(lang, key)`, не
  `useT()`). `waitingForMusic`/`closeMiniPlayer` — свои; play/pause/prev/
  next/like переиспользуют `player.play`/`player.pause`/`player.previous`/
  `player.next`/`common.like`.
- `plugins.*` — попутно найдены при общем свипе (`plugins/PluginFrames.tsx` —
  3 кнопки закрытия поверхностей плагина; `plugins/install.ts` — non-React
  модуль, получил `lang: Lang = DEFAULT_LANG` параметром в
  `pickAndStagePlugin`/`stagePluginFromMarket`, потребитель — `SettingsView.tsx`
  передаёт свой `lang` из `useT()`).

Осознанно НЕ тронуто (документированный трейд-офф, не относится к T34a):
`settings.customize.equalizer` `EQ_PRESETS` (`SettingsView.tsx`) и
`types.ts::DEFAULT_PREFS.discordBtnLabel` — это персистентные значения
преференсов (общая схема с `apps/web`, редактируются пользователем), а не
статичный UI-текст; перевод сломал бы совместимость сохранённых профилей.
