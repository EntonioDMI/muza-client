/** i18n-фрагмент: строки views/* (зона views, эпик W5 i18n).
 *  Вынесен в отдельный файл, чтобы зоны словаря извлекались ПАРАЛЛЕЛЬНО без
 *  конфликта на общем en.ts. Ключи попадают в `en.views.*`; форму зеркалит
 *  ru.views.ts (`typeof viewsEn`). Наполнено извлечением views/* (T31, кроме
 *  SettingsView.tsx — уже переведён отдельно).
 *
 *  Известные остаточные утечки кириллицы (НЕ строки этого файла, а вывод
 *  чужих lib/*-функций, вызываемых из views/* — вне зоны этой задачи, см.
 *  T32 в docs/notes/2026-07-14-i18n-план.md):
 *  - `lib/hourLabel.ts` (hourLabel()) — подписи любимого часа («полуночник» и
 *    т.п.) захардкожены по-русски, используются в StatsView/WrappedOverlay.
 *  - `lib/searchGrouping.ts` (variantLabel()/pluralVersions()) — подписи
 *    категорий версий («Ремикс», «версия/версии/версий») захардкожены,
 *    используются в SearchGroupCard. */
export const viewsEn = {
  home: {
    greeting: {
      night: "Good night",
      morning: "Good morning",
      day: "Good afternoon",
      evening: "Good evening",
    },
    wrappedBanner: {
      title: "Your {year} Wrapped",
      hint: "Minutes, tracks, and artists of the year — plus a card worth sharing",
    },
    notice: {
      offlineText: "Offline copy of the feed: the server is unavailable right now, showing the last loaded version.",
      refresh: "Refresh",
      errorText:
        "The server is unavailable, and there's no offline copy of the feed yet. Pinned offline tracks still play from the cache.",
      retry: "Retry",
      emptyText: "The feed fills up as you listen: play something via Search and recommendations will start building.",
      openSearch: "Open search",
    },
    skeletonAria: "Loading the feed",
    demo: {
      banner: "Demo: sample content to get familiar with the interface, not real trends or recommendations.",
      continueListening: "Continue listening",
      pickedForYou: "Picked for you",
      newReleases: "New releases",
      selection: "Selection",
    },
  },

  search: {
    placeholder: "Track, artist, album",
    searching: "Searching…",
    searchSources: "Search in sources",
    needsAccount: "Catalog search is available after signing in — an anonymous account only lives on this device.",
    results: "Results",
    trending: "Trending searches",
    catalogEmpty: 'The catalog is empty for now. Press "Search in sources" — we\'ll look on YouTube Music and SoundCloud.',
    searchingSources: "Searching in sources — this takes a few seconds…",
    loadingMore: "Loading…",
    loadMore: "Load more",
    nothingFound: "Nothing found. Try something shorter — an artist's name, for example.",
    somethingWrong: "Something went wrong",
    loadMoreFailed: "Couldn't load more",
    groupCard: {
      expand: "expand",
      collapse: "collapse",
      noOriginal: "Original not found in the results — showing the best match ({label})",
    },
  },

  library: {
    chips: {
      playlists: "Playlists",
      local: "Local",
      albums: "Albums",
      artists: "Artists",
    },
    title: "Your Library",
    addLink: "By link",
    importPlaylist: "Import playlist",
    byCode: "By code",
    artistsPlaceholder: "Artists you follow will show up here.",
    scanning: "Scanning…",
    addFiles: "Add files",
    addFolder: "Add folder",
    localFilesHintLocal: "Files stay on this device — only the title and a fingerprint are sent to the server.",
    localFilesHintSynced:
      "Files stay on this device — only the title and a fingerprint are sent to the server (in playlists on other devices, these tracks will appear greyed out).",
    fileNotOnDevice: "The file isn't on this device",
    artistFileMissing: "{artist} · file not on this device",
    localFilesEmpty:
      "Nothing here yet. Add files or a folder of music — they'll play alongside catalog tracks, including in the same playlist.",
    playlistSubtitle: "{count} tr. · syncing",
    playlistsEmpty:
      'No playlists yet. Create your first one with the "+" button in the sidebar, import from Spotify/YouTube/Apple Music, or add tracks by link.',
    removeFromMuza: "Remove from Muza (file stays)",
    removedFromLocal: "Removed from local files",
  },

  playlist: {
    loadFailed: "Couldn't load the playlist",
    renameFailed: "Couldn't rename",
    deleteFailed: "Couldn't delete",
    removeTrackFailed: "Couldn't remove the track",
    removedFromPlaylist: "Removed from the playlist",
    trackCount: "{count} tr.",
    sharedCount: "shared · {count} member(s)",
    sharedFrom: "shared · from {owner}",
    offlineCopy: "offline copy",
    syncing: "syncing",
    loadingLabel: "loading",
    collabAccess: "Shared access",
    share: "Share",
    localMissingSuffix: "local, not on this device",
    addedBy: "added by {name}",
    fileNotOnDevice: "The file isn't on this device",
    localTrackNotOnDevice: "Local track: the file isn't on this device",
    empty: 'Empty. Add tracks from Search: "⋯ → Add to playlist".',
    changePlaylistIcon: "Change playlist icon",
    removeFromPlaylist: "Remove from playlist",
  },

  favorites: {
    title: "Favorites",
    trackCount: "{count} tr.",
    demoSectionTitle: "From the demo catalog (local)",
    empty: "Nothing here yet. Tap the heart on a track and it'll show up here.",
  },

  stats: {
    title: "Statistics",
    skeletonAria: "Crunching the numbers",
    summary: {
      minutesLabel: "minutes of music",
      playsLabel: "plays",
      tracksLabel: "tracks",
      artistsLabel: "artists",
    },
    activity: {
      ariaByDay: "Plays by day",
      ariaByMonth: "Plays by month",
    },
    rhythm: {
      aria: "Plays by hour of day",
      topHour: "Favorite hour — {hour}:00 ({label})",
      noTopHour: "No favorite hour yet",
    },
    topArtists: {
      minSuffix: "min",
    },
    streaks: {
      current: "current streak",
      longest: "longest streak",
      activeDays: "days with music this period",
      daysSuffix: "d.",
    },
    likes: {
      addedThisPeriod: "added to Favorites this period",
    },
    customizeBlocksTooltip: "Customize blocks",
    customizeBlocksLabel: "Customize statistics blocks",
    notice: {
      needsAccount:
        "Statistics are calculated on the server from your account history. Sign in and you'll see minutes, tops, and streaks here.",
      errorText: "The server is unavailable, and there's no offline copy of the statistics yet.",
      retry: "Retry",
      offlineText: "Offline copy: the server is unavailable right now, showing the last loaded version.",
      refresh: "Refresh",
      emptyText: "No plays in this period yet. Play something and statistics will start building.",
      updateFailedText: "Couldn't refresh — showing the previous data.",
    },
    wrappedPanel: {
      title: "{year} Wrapped",
      hint: "Story slides for your year: minutes, tracks, artists — and a shareable card",
    },
  },

  wrapped: {
    ariaLabel: "{year} Wrapped",
    brandFallback: "WRAPPED",
    close: "Close Wrapped",
    slideProgress: "Slide {position} of {total}",
    loading: {
      kicker: "Muza · {year}",
      title: "Putting your year together",
      hint: "Gathering tracks, minutes, and moments.",
    },
    error: {
      kicker: "Something threw off the rhythm",
      title: "Wrapped didn't load yet",
    },
    empty: {
      kicker: "{year} Wrapped",
      title: "This year is still waiting for its first track",
      hint: "Play something and your music story will start taking shape here.",
    },
    intro: {
      kicker: "Your year in music",
      line1: "This was your year.",
      line2: "Listen to how it sounded.",
      firstSoundLabel: "First sound of the year",
      firstTrackTitle: '"{title}"',
      historyStarts: "Your story starts here",
    },
    minutes: {
      kicker: "Time that was all yours",
      unit: "minutes",
      headline: "That's how much music fit into your year.",
      playsLabel: "plays",
      uniqueTracksLabel: "different tracks",
    },
    tracks: {
      kicker: "Track of the year",
      playsPrefix: "You came back to it",
    },
    artists: {
      kicker: "Starring",
      minutesSuffix: "minutes with you",
      minAbbrev: "min",
    },
    rhythm: {
      kicker: "Your year, hour by hour",
      favoriteHour: "Your favorite hour · {label}",
      daysWithMusic: "days with music",
      longestStreak: "longest streak",
      mostMusicalDay: "most musical day",
      favoritesThisYear: "likes this year",
      daysSuffix: "d.",
    },
    final: {
      kicker: "Final track",
      headlinePart1: "This was",
      headlinePart2: "your",
      subtext: "Not just numbers. Music you kept coming back to.",
      minutesOfMusic: "minutes of music",
      artistsLabel: "artists",
      tracksLabel: "tracks",
      artistOfYear: "Artist of the year",
      shareButton: "Share your Wrapped",
    },
    footer: {
      savePoster: "Save your music poster",
      clickHint: "Click anywhere, or press →",
    },
    errors: {
      fetchFailed: "Couldn't load your Wrapped",
    },
  },

  admin: {
    title: "Admin",
    tabs: {
      overview: "Overview",
      content: "Content",
      health: "Extraction health",
      users: "Users",
    },
    sections: {
      listeners: "Listeners",
      plays: "Plays",
      users: "Users",
      catalog: "Catalog",
      catalogCoverage: "Catalog coverage",
      sources: "Sources",
      topTracks: "Top tracks (14 days)",
      topArtists: "Top artists (14 days)",
      newInCatalog: "New in catalog",
      extraction: "Extraction (anonymous client aggregates)",
      errorsByClass: "Errors by class (KPI SABR/403)",
      byRecipeVersion: "By recipe version",
      byAppVersion: "By app version",
    },
    stats: {
      dauHint: "listened in the last day",
      wauHint: "in the last week",
      mauHint: "in the last month",
      today: "Today",
      thisWeek: "This week",
      completedSuffix: "{count} completed",
      total: "Total",
      withEmailSuffix: "{count} with email",
      newThisWeek: "New this week",
      admins: "Admins",
      tracks: "Tracks",
      sourcesLabel: "Sources",
      deadSuffix: "{count} dead",
      inServerCache: "In server cache",
      withLyrics: "With lyrics",
      syncedSuffix: "{count} synced",
      withAnnotations: "With annotations",
    },
    rows: {
      providerKind: "Provider · kind",
      total: "Total",
      dead: "Dead",
      track: "Track",
      plays: "Plays",
      artist: "Artist",
      noSources: "no sources",
    },
    health: {
      day: "Day",
      week: "Week",
      month30: "30 days",
      cacheHits: "Cache hits",
      hitsSuffix: "{count} hits",
      reports: "Reports",
      attemptsSuffix: "{count} extraction attempts",
      formatsLabel: "Formats (SABR/DRM)",
      other: "Other",
      recipeCol: "Recipe",
      currentSuffix: " (current)",
      recipeNote: "Server recipe: v{version}. Rolling out a recipe = a server deploy; canaries and feature flags are backlog.",
      versionCol: "Version",
    },
    users: {
      piiNote:
        "Total {count}. PII minimum: email isn't shown — only whether one exists. Admin rights are granted manually on the server.",
      userCol: "User",
      createdCol: "Created",
      plays30dCol: "Plays (30d)",
      lastCol: "Last seen",
      adminSuffix: " · admin",
    },
  },
};
