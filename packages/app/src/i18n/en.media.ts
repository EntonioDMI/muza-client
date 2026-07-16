/** i18n-фрагмент: строки player/* и lib/* (зона media, эпик W5 i18n) —
 *  тосты движка/очереди, метки навигации/хоткеев, jam и т.п. Отдельный файл
 *  для ПАРАЛЛЕЛЬНОГО извлечения без конфликта на en.ts. Ключи → `en.media.*`;
 *  форму зеркалит ru.media.ts. Наполняется задачей извлечения player+lib.
 *
 *  Английский вокабуляр сверен с en.ts (Home/Search/Favorites/Library/Stats/
 *  Shuffle/Repeat/Queue/Radio/Jam) — синонимы намеренно не вводились.
 *
 *  Подход к non-React/вне-провайдера модулям (audioEngine.ts, lib/*.ts —
 *  T31 использовал `translate(prefs.language, key, params)` напрямую, см.
 *  App.tsx): здесь то же самое, плюс для чистых классов/функций без доступа
 *  к prefs (AudioEngine, lib/engine.ts, lib/themes.ts, lib/shareCard.ts,
 *  lib/localFiles.ts, lib/dragOut.ts, lib/hourLabel.ts, lib/searchGrouping.ts)
 *  добавлен ОПЦИОНАЛЬНЫЙ параметр `lang: Lang = DEFAULT_LANG` — потребители
 *  внутри этого набора файлов (usePlayback.ts, useJam.ts) передают реальный
 *  язык из prefs; потребители ВНЕ этого набора (shell/Sidebar.tsx,
 *  views/SettingsView.tsx, views/StatsView.tsx, views/SearchView.tsx,
 *  views/WrappedOverlay.tsx, shell/ShareDialog.tsx — все вне зоны этой
 *  правки) пока зовут эти функции/читают эти константы БЕЗ lang и получают
 *  дефолт EN — было бы захардкожено RU, стало захардкожено EN плюс готовый
 *  параметр, которым может воспользоваться следующая правка в shell/views.
 *  NAV_ITEM_META/BAR_BUTTON_META/STATS_BLOCK_META/HOTKEY_ACTIONS остаются
 *  статичными Record (потребители читают `.label` как плоское поле, не
 *  вызывают функцию) — их дефолтные значения вычислены через
 *  `translate(DEFAULT_LANG, key)` при импорте модуля.
 *
 *  UPD (T32b, живое переключение доведено): потребители переведены на
 *  хелперы с lang — navItemLabel/barButtonLabel/statsBlockLabel/
 *  hotkeyActionLabel(key, lang) и hourLabel/variantLabel/pluralVersions(n,
 *  lang). Прошито: shell/Sidebar (nav), views/SettingsView (bar/nav/stats/
 *  hotkeys-панели), views/StatsView (stats-панели+hourLabel), views/
 *  SearchGroupCard (variant/plural), views/WrappedOverlay (hourLabel),
 *  App.tsx (hotkeysDialog + useJam lang + resolvePlayable lang), usePlayback
 *  (читает prefs напрямую). Статичные *_META по-прежнему держат EN-дефолт как
 *  фолбэк для не-локализованных вызовов. shell/ShareDialog доводится в T34
 *  (там ещё и захардкоженные тосты — пропуск T31). */
export const mediaEn = {
  player: {
    errors: {
      playFailed: "Couldn't play the file",
      playbackDidNotStart: "Playback didn't start",
      localFileNotFound: "Local file not found on this device",
      desktopOnly: "Catalog tracks only play in the Muza app (extraction engine)",
      trackFetchFailed: "Couldn't fetch the track",
    },
  },
  jam: {
    hostTrackFetchFailed: "Couldn't get the host's track",
    trackAdded: '{by} added "{title}" to the jam',
    ended: "Jam ended",
    hostEnded: "Host ended the jam",
    createFailed: "Couldn't create the jam",
    joinedAs: "You're in {username}'s jam",
    joinFailed: "Couldn't join the jam",
    left: "You left the jam",
    addFailed: "Couldn't add to the jam",
  },
  nav: {
    home: "Home",
    search: "Search",
    favorites: "Favorites",
    library: "Library",
    stats: "Stats",
  },
  hotkeys: {
    actions: {
      playPause: "Play / pause",
      next: "Next track",
      prev: "Previous track",
      seekFwd: "Seek +5s",
      seekBack: "Seek −5s",
      like: "Like",
      mute: "Mute",
      search: "Search",
      navBack: "Back through tabs",
      navForward: "Forward through tabs",
    },
  },
  engine: {
    errors: {
      localTrackMissing: "Local track: the file isn't on this device",
    },
  },
  barButtons: {
    shuffle: { label: "Shuffle", hint: "Left of the transport" },
    repeat: { label: "Repeat", hint: "Right of the transport" },
    sleep: { label: "Sleep timer", hint: "Moon: off → presets → end of track" },
    speed: { label: "Speed", hint: '"1×" button; cycles the steps from settings' },
    equalizer: { label: "Equalizer", hint: "Opens the EQ sub-screen" },
    lyrics: { label: "Lyrics", hint: '"Now Playing" panel' },
    jam: { label: "Jam", hint: "Listen together" },
    volume: { label: "Volume", hint: "Mute button and slider" },
    queue: { label: "Queue", hint: "Queue panel" },
    fullscreen: { label: "Fullscreen", hint: "Listening mode" },
  },
  statsBlocks: {
    summary: { label: "Summary", hint: "Minutes, plays, tracks and artists for the period" },
    activity: { label: "Activity", hint: "Chart by day or month" },
    rhythm: { label: "Daily rhythm", hint: "Distribution across hours of the day" },
    top_tracks: { label: "Top tracks", hint: "Up to ten most played" },
    top_artists: { label: "Top artists", hint: "By minutes played" },
    streaks: { label: "Streaks", hint: "Consecutive days with music" },
    likes: { label: "Likes", hint: "Added to Favorites in the period" },
  },
  search: {
    variants: {
      remix: "Remix",
      sped_up: "Sped up",
      slowed: "Slowed",
      mashup: "Mashup",
      cover: "Cover",
      live: "Live",
      acoustic: "Acoustic",
      instrumental: "Instrumental",
      karaoke: "Karaoke",
      "8d": "8D Audio",
      bass_boosted: "Bass boosted",
      tiktok: "TikTok version",
    },
    versions: {
      one: "version",
      few: "versions",
      many: "versions",
    },
  },
  hour: {
    midnighty: "night owl",
    earlyBird: "early bird",
    daytime: "daytime rhythm",
    eveningListener: "evening listener",
  },
  shareCard: {
    // Wrapped-карточка (редизайн 2026-07-16, дистилляция): бледные подписи
    // «artist/track of the year» и строка plays·artists убраны — имена-браги
    // рисуются без подписей, год стал графикой. Осталась одна подпись под
    // героем-минутами. artistOfYear/trackOfYear/myYearRecap/playsAndArtists
    // удалены как мёртвые (карточка была единственным их потребителем).
    minutesOfMusic: "minutes of music",
    trackCount: "{count} tr.",
    fromOwner: " · from {owner}",
    errors: {
      canvasBlobFailed: "canvas.toBlob returned null",
      canvas2dUnavailable: "canvas 2d isn't available",
    },
  },
  share: {
    track: '"{title}" — {artist} · listening on Muza · https://muza.lol',
    playlist: 'Playlist "{name}" — {count} tr. · built in Muza · https://muza.lol',
    wrapped: "My {year} in Muza: {minutes} minutes of music, {plays} plays.{top} · https://muza.lol",
    wrappedTopArtist: " Artist of the year — {topArtist}.",
  },
  themes: {
    myTheme: "My theme",
    theme: "Theme",
  },
  localFiles: {
    pickFilesTitle: "Choose audio files",
    audioFilterName: "Audio",
    pickFolderTitle: "Choose a music folder",
  },
  dragOut: {
    errors: {
      prepareFailed: "Couldn't prepare the file",
    },
  },
};
