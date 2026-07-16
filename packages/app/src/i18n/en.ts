/** Английский словарь (T28 + T29/T30, эпик W5 i18n) — ДЕФОЛТНЫЙ язык интерфейса.
 *  Источник структуры: `ru.ts` типизируется через `typeof en` (см. его файл),
 *  так что расхождение форм между словарями — ошибка типов, а не рантайма.
 *
 *  Конвенция ключей (см. docs/notes/2026-07-14-i18n-план.md):
 *  - Вложенные зоны через точку: `<зона>.<подзона>.<имя>`.
 *  - `common.*` — переиспользуемые общие строки (кнопки, статусы).
 *  - `settings.tabs.<tabKey>` — подписи вкладок настроек, `<tabKey>` = ключ
 *    из SettingsView TABS (совпадает буквально, чтобы t(`settings.tabs.${key}`)
 *    работал без ручного маппинга).
 *  - `settings.<tabKey>.<группа>.<имя>` — строки внутри конкретной вкладки.
 *  - `settings.<subScreen>.*` — под-экраны настроек (customize/equalizer/
 *    discord/market/data/sessions/privacy/licenses(→system.licenses)/bar/nav/
 *    stats) — своя зона верхнего уровня, аналогично вкладкам.
 *  - T28 завёл механику + переключатель; T29/T30 (эта правка) перевели
 *    SettingsView.tsx целиком — основная масса ключей ниже.
 *  - Зоны `views.*` (views/*) и `media.*` (player/* + lib/*) вынесены в
 *    отдельные файлы en.views.ts / en.media.ts и подмешиваются ниже — это
 *    позволяет извлекать их ПАРАЛЛЕЛЬНО, не конфликтуя на этом файле.
 */
import { viewsEn } from "./en.views";
import { mediaEn } from "./en.media";

export const en = {
  common: {
    ok: "OK",
    cancel: "Cancel",
    save: "Save",
    apply: "Apply",
    back: "Back",
    install: "Install",
    connect: "Connect",
    disconnect: "Disconnect",
    loading: "Loading…",
    on: "On",
    off: "Off",
    like: "Like",
    showAll: "Show all",
    namePlaceholder: "Name",
  },
  settings: {
    title: "Settings",
    tabs: {
      account: "Account",
      appearance: "Appearance",
      playback: "Playback",
      sources: "Sources",
      lyrics: "Lyrics",
      library: "Library",
      integrations: "Integrations",
      hotkeys: "Hotkeys",
      extensions: "Extensions",
      system: "System",
    },

    // ── Аккаунт ──────────────────────────────────────────────────────
    account: {
      profile: {
        title: "Profile",
        signOut: "Sign out",
      },
      email: {
        title: "Email",
        hint: "For password recovery; changing it is confirmed by an email to the new address",
        dialogTitle: "Change email",
        passwordPlaceholder: "Account password",
        newEmailPlaceholder: "New email",
        confirmNote: "A confirmation email will arrive at the new address — it takes effect once you click the link.",
        devNote: "Emails aren't actually sent in dev — open the confirmation link to finish changing your email.",
        openConfirmLink: "Open confirmation link",
        sending: "Sending…",
        submit: "Send email",
        done: "Done",
        sent: "Email sent — confirm it via the link",
        errors: {
          notAnEmail: "That doesn't look like an email",
          sendFailed: "Couldn't send the email",
          sendFailedDetail: "Couldn't send the email: {detail}",
        },
      },
      password: {
        title: "Change password",
        hint: "Old → new; other devices will be signed out",
        dialogTitle: "Change password",
        currentPlaceholder: "Current password",
        newPlaceholder: "New password (8+ characters)",
        repeatPlaceholder: "New password again",
        otherDevicesNote: "All other devices will be signed out after this change; this one stays signed in.",
        changing: "Changing…",
        submit: "Change",
        changed: "Password changed — other devices signed out",
        errors: {
          tooShort: "New password must be at least 8 characters",
          mismatch: "Passwords don't match",
          changeFailed: "Couldn't change the password",
        },
      },
      sessions: {
        rowTitle: "Sessions and devices",
        rowHint: "Where you're signed in; you can sign out other devices",
        title: "Sessions and devices",
        hint: "Each row is a device signed into your account. The date is its last activity. Don't recognize a device — sign it out and change your password.",
        loadFailed: "Couldn't load the session list.",
        currentSuffix: "current",
        thisDevice: "this device",
        signOut: "Sign out",
        revoked: "Device signed out",
        unknownDevice: "Unknown device",
        genericDevice: "Device",
        browser: "browser",
        unknownIp: "ip unknown",
        errors: {
          revokeFailed: "Couldn't revoke the session",
        },
      },
      privacyGroup: "Privacy",
      telemetry: {
        title: "Anonymous statistics",
        hint: "Anonymized extraction and playback aggregates — used to fix extraction issues; no username, id, or track names",
      },
      dataDoc: {
        title: "Data document",
        hint: "What stays on the device, what the server stores, and what goes into statistics",
      },
      exportOrDelete: {
        title: "Export or delete data",
        hint: "JSON export of everything, or full account deletion",
      },
      needsAccount: "Needs an account — anonymous users don't have email",
      needsAccountPassword: "Needs an account — anonymous users don't have a password",
      needsAccountShort: "Needs an account",
      needsAccountServer: "Needs an account — anonymous users have nothing stored on the server",
    },

    // ── Внешний вид ──────────────────────────────────────────────────
    appearance: {
      language: {
        title: "Interface language",
        hint: "Switches translated parts of the interface instantly, no restart",
        // Названия языков традиционно не переводятся (показываются на себе же).
        optionEn: "English",
        optionRu: "Русский",
      },
      presets: {
        muza: { name: "Muza", hint: "Blue · soft corners" },
        flame: { name: "Flame", hint: "Red · rounder" },
        graphite: { name: "Graphite", hint: "Bolt · sharper" },
      },
      theme: {
        title: "Theme",
        hint: "Light inverts the appearance layers — background, surfaces, text",
        dark: "Dark",
        light: "Light",
      },
      accent: {
        title: "Accent color",
        hint: "Pick a preset or any custom color — swatch on the right",
        blue: "Blue",
        red: "Red",
        bolt: "Bolt",
        customLabel: "Custom accent color",
      },
      radius: {
        title: "Corner radius",
        hint: "How soft the tile corners are",
        mild: "Less",
        soft: "Standard",
        round: "More",
      },
      glass: {
        title: "Glass",
        hint: "Overall density of the frosted panels",
      },
      background: {
        title: "Background",
        hint: "Quick \"from cover\" toggle; all background types live in Customize",
        fromCover: "From cover",
        custom: "Custom",
        ariaLabel: "Background from cover",
      },
      scale: {
        title: "Interface scale",
        hint: "Makes the whole interface bigger or smaller",
      },
      customize: {
        title: "Customize",
        hint: "Theme editor: layers, shape, typography, themes, CSS",
      },
      plugin: {
        genericLabel: "Plugin",
        hint: "Plugin: {name}",
      },
    },

    // ── Кастомизация (под-экран) ─────────────────────────────────────
    customize: {
      title: "Customize",
      glass: {
        groupTitle: "Glass and effects",
        panelBlur: { title: "Panel blur", hint: "Blur strength on the frosted glass" },
        bgBlur: { title: "Background blur", hint: "Blur on the cover or image behind the interface" },
        zones: { title: "Per-zone transparency", hint: "Separate background density for the player, menus, dialogs, sidebar and Now Playing" },
        zonePlayer: { title: "Player", hint: "Glass on the player bar and queue", ariaLabel: "Player glass density" },
        zoneMenu: { title: "Menus", hint: "Context menus and dropdowns", ariaLabel: "Menu glass density" },
        zoneDialog: { title: "Dialogs", hint: "100% — opaque panel, less — glass", ariaLabel: "Dialog window density" },
        zoneSidebar: { title: "Sidebar", hint: "Surface density on the left (light by default — 4%)", ariaLabel: "Sidebar surface density" },
        zoneNowPlaying: { title: "\"Now Playing\"", hint: "Right panel with lyrics", ariaLabel: "\"Now Playing\" panel density" },
      },
      colors: {
        groupTitle: "Colors and layers",
        baseBg: {
          title: "Base background",
          hint: "Tone and temperature of the bg layers",
          graphite: "Graphite",
          warm: "Warm",
          cold: "Cold",
          amoled: "AMOLED",
        },
        accentRoles: { title: "Accent roles", hint: "Separate colors for play buttons, sliders and the active track" },
        accentPlay: { title: "Play buttons", hint: "Play in the player, tiles and listening mode", pickerLabel: "Play button color" },
        accentSlider: { title: "Sliders", hint: "Progress, volume, equalizer", pickerLabel: "Slider color" },
        accentActive: { title: "Active track", hint: "Highlight for the playing track in lists", pickerLabel: "Active track color" },
        textDim: { title: "Text dimming", hint: "Brightness of secondary text (labels, hints)" },
      },
      shape: {
        groupTitle: "Shape and sizes",
        tiles: { title: "Tiles and rows", hint: "Covers, cards, track rows — percent of the \"Corner radius\" preset (0 = sharp, 200 = super round)" },
        buttons: { title: "Buttons", hint: "Button shape: from sharp corners (0px) to a pill (right edge, DS default)" },
        tabs: { title: "Bubbles (toggles)", hint: "Tabs segments: settings, mode toggles; from sharp corners (0px) to a pill (right edge, DS default)" },
        fields: { title: "Input fields", hint: "Search, selects, text fields; from sharp corners (0px) to the preset (right edge)" },
        panels: { title: "Panels and zones", hint: "Sidebar, player, dialogs — percent of the \"Corner radius\" preset (0 = sharp, 200 = super round)" },
        density: { title: "Interface density", hint: "Zone padding and track row height: tighter on the left, roomier on the right" },
        sidebarWidth: { title: "Sidebar width", hint: "The sidebar still shrinks on a narrow window" },
        nowPlayingWidth: { title: "\"Now Playing\" width", hint: "Right panel with lyrics" },
        pill: "pill",
        preset: "preset",
      },
      typography: {
        groupTitle: "Typography",
        fontScale: { title: "Text size", hint: "Text only (the \"Interface scale\" above scales everything)" },
        lineSpacing: { title: "Line spacing", hint: "Line density of the UI text" },
        karaokeSize: { title: "Karaoke text size", hint: "Line shown in listening mode" },
      },
      motion: {
        groupTitle: "Motion",
        anims: { title: "Animations", hint: "Smooth interface transitions" },
        animSpeed: { title: "Animation speed", hint: "Left is faster, right is gentler (percent of duration)" },
      },
      layout: {
        groupTitle: "Layout and elements",
        barButtons: { title: "Player bar buttons", hint: "Which bar buttons show, and their order" },
        navTabs: { title: "Sidebar tabs", hint: "Which tabs show, their order, and custom names" },
        rowCover: { title: "Track row: cover", hint: "Small cover art on the left in lists" },
        rowDuration: { title: "Track row: duration", hint: "Timestamp on the right; album and source will appear once catalog data supports them" },
      },
      background: {
        groupTitle: "Background",
        type: {
          title: "Background type",
          hint: "What's behind the interface",
          cover: "Track cover",
          color: "Color",
          gradient: "Gradient",
          image: "Image by URL",
          animated: "Animated",
        },
        invert: { title: "Invert direction", hint: "Swap which way the left and right disc spin", ariaLabel: "Invert rotation direction" },
        color: {
          title: "Background color",
          gradientTitle: "Gradient colors",
          hint: "The swatch opens a color picker",
          secondGradientColor: "Second gradient color",
        },
        imageUrl: { title: "Image URL", hint: "Link to an image; blur is the slider above (0 = no blur)" },
        dim: { title: "Background dimming", hint: "So content stays readable on top" },
        tint: { title: "React to cover", hint: "The base background tints with the track cover's dominant color" },
      },
      behavior: {
        groupTitle: "Behavior",
        doubleClick: {
          title: "Double-click action",
          hint: "Double-click on a track row; the track number button always plays",
          play: "Play",
          queue: "Add to queue",
        },
        startView: {
          title: "Start screen",
          hint: "What opens on launch",
          home: "Home",
          search: "Search",
          favorites: "Favorites",
          library: "Library",
        },
      },
      themes: {
        groupTitle: "Themes",
        saveAs: { title: "Save as theme", hint: "The whole current look, including the CSS tier" },
        copyJson: "Copy theme JSON",
        deleteTheme: "Delete theme",
        importRow: { title: "Import theme", hint: "Paste theme JSON (from clipboard or the marketplace)", button: "Paste" },
        marketRow: { title: "Theme marketplace", hint: "Install and share themes" },
        namePlaceholder: "Theme name",
        saved: "Theme saved",
        applied: "Theme \"{name}\" applied",
        removed: "Theme removed",
        copied: "Theme JSON copied — share away",
        imported: "Theme \"{name}\" imported and applied",
        saveDialog: {
          title: "Save theme",
          hint: "Only the appearance is saved into a theme (colors, background, shape, CSS) — behavior and sound aren't carried over.",
        },
        importDialog: {
          title: "Import theme",
          submit: "Import",
          ariaLabel: "Theme JSON",
          hint: "Applies immediately and shows up in the theme list. Unknown fields are discarded.",
        },
        errors: {
          clipboardUnavailable: "Clipboard unavailable",
          notMuzaJson: "This doesn't look like Muza theme JSON",
        },
      },
      css: {
        groupTitle: "CSS tier",
        toggle: { title: "Custom CSS", hint: "Danger zone: overrides any tokens and styles; a broken look can be fixed with the toggle or a reset" },
        apply: "Apply CSS",
        appliesHint: "Applied on top of every token; included in saved themes. Settings like a custom accent live inline — only !important overrides them.",
      },
      resetAppearance: "Reset appearance",
    },

    // ── Эквалайзер (под-экран) ────────────────────────────────────────
    equalizer: {
      title: "Equalizer",
      enable: { title: "Enable", hint: "A live ten-band equalizer — shapes the sound of catalog tracks" },
      resetBands: "Reset bands",
      dbRange: "dB, from −12 to +12",
      bandAria: "Band {freq} Hz",
    },

    // ── Discord Rich Presence (под-экран) ─────────────────────────────
    integrations: {
      needsAccount: "Needs a Muza account (anonymous users don't sync)",
      serverUnavailable: "Server unavailable — I'll check again once it's back",
      checkingStatus: "Checking status…",
      notConnected: "Not connected",
      unavailable: "Unavailable",
      discord: {
        title: "Discord Rich Presence",
        rowTitle: "Discord Rich Presence",
        rowHint: "Status, button, cover and line templates (needs an Application ID from the Dev Portal)",
        enable: {
          title: "Show in Discord",
          ariaLabel: "Discord RPC",
          hint: "\"Listening to Muza\" status; needs Discord running and a registered app (client id)",
          hintNoAppId: "Needs a Discord Application ID — RPC stays off until it's added; the setting will start working on its own once the owner supplies it",
        },
        whatToShow: "What to show",
        cover: { title: "Track cover", hint: "Discord fetches the cover via https itself", ariaLabel: "Cover" },
        line1: { title: "First line", hint: "Placeholders: {track}, {artist}, {album}; catalog tracks don't have an album yet" },
        line2: { title: "Second line", hint: "Empty placeholders get cleaned up along with their separators" },
        buttonGroup: "Activity button",
        btnOn: { title: "Show button", hint: "Button under the status in the Discord profile; works together with RPC", ariaLabel: "Activity button" },
        btnLabel: { title: "Button text", hint: "Up to 32 characters — Discord's limit", placeholder: "Open in Muza" },
        btnUrl: { title: "Button link", hint: "Where the click leads: website, profile, track" },
        previewGroup: "Preview",
        preview: {
          listeningTo: "Listening to Muza",
          track: "Comets Over the City",
          artist: "Northern Wind",
          album: "Midnight",
          caption: "Activity card preview",
        },
      },
      lastfm: {
        title: "Last.fm scrobbling",
        allowInBrowser: "Allow access in the browser — waiting for confirmation",
        connectedAs: "Connected as {username} — plays sync automatically",
        willSync: "Plays will sync to your Last.fm profile",
        noApiKeys: "The server has no Last.fm API keys — add LASTFM_API_KEY and LASTFM_API_SECRET to .env (last.fm/api)",
        waitingBrowser: "Waiting for browser…",
        disconnected: "Last.fm disconnected",
        connected: "Last.fm connected: {username}",
        errors: {
          timeout: "Didn't get Last.fm confirmation — try again",
          connectFailed: "Couldn't connect Last.fm",
          disconnectFailed: "Couldn't disconnect Last.fm",
        },
      },
      listenbrainz: {
        title: "ListenBrainz scrobbling",
        dialogTitle: "Connect ListenBrainz",
        dialogBody: "Copy the user token from the ListenBrainz settings page and paste it here — it will be verified and saved on the Muza server.",
        openSettings: "Open listenbrainz.org/settings",
        tokenPlaceholder: "User token",
        checking: "Checking…",
        hint: "An open alternative to Last.fm; only needs a user token",
        connectedAs: "Connected as {username} — plays sync automatically",
        connected: "ListenBrainz connected: {username}",
        disconnected: "ListenBrainz disconnected",
        errors: {
          pasteToken: "Paste the user token from listenbrainz.org/settings",
          connectFailed: "Couldn't connect ListenBrainz",
          disconnectFailed: "Couldn't disconnect ListenBrainz",
        },
      },
      mediaKeys: {
        title: "Media keys",
        hint: "Play/Pause/Next from the keyboard and the system media overlay (SMTC)",
      },
    },

    // ── Маркетплейс (под-экран) ────────────────────────────────────────
    market: {
      title: "Marketplace",
      filter: { all: "All", themes: "Themes", plugins: "Plugins" },
      publishTheme: "Publish theme",
      themesNeedAccount: "The theme marketplace is available after signing in — an anonymous account only lives on this device.",
      themesEmpty: "Nothing here yet. Build a look in Customize and be the first — \"Publish theme\".",
      pluginsNeedAccount: "The plugin marketplace is available after signing in — an anonymous account only lives on this device.",
      pluginsAppOnly: "Installing plugins only works in the app (not in the browser).",
      pluginsEmpty: "Nothing here yet. Build a plugin using PLUGINS.md and be the first to publish.",
      installsCount: "{n} installs",
      hasCss: "includes CSS",
      hiddenByModeration: "hidden by moderation",
      hiddenByModerationShort: "hidden by moderation",
      unpublish: "Unpublish",
      report: "Report",
      pendingBadge: "Pending review",
      installing: "Installing…",
      unhide: "Return to storefront",
      hide: "Hide (moderation)",
      approve: "Approve",
      themeInstalled: "Theme \"{name}\" installed and applied",
      themeUnpublished: "Theme unpublished",
      reportSent: "Report sent — thanks",
      themePublished: "Theme \"{name}\" published",
      pluginUnpublished: "Plugin unpublished",
      pluginUnhidden: "Plugin returned to the storefront",
      pluginHidden: "Plugin hidden",
      pluginApproved: "Plugin \"{name}\" approved",
      publishDialog: {
        title: "Publish appearance",
        hint: "Publishes your current appearance under your username. Publishing again with the same name updates the theme.",
        publishing: "Publishing…",
        submit: "Publish",
      },
      cssWarnDialog: {
        title: "Theme includes custom CSS",
        body: "The author's CSS can override any part of the interface's look. It's safe for your data, but if the look breaks — turn off \"Custom CSS\" in Customize or press \"Reset appearance\".",
        installAnyway: "Install anyway",
      },
      errors: {
        unpublishThemeFailed: "Couldn't unpublish the theme",
        reportFailed: "Couldn't send the report",
        nameTooShort: "Name — at least 2 characters",
        publishFailed: "Couldn't publish",
        corruptPayload: "Corrupt plugin payload — try reinstalling later",
        installPluginFailed: "Couldn't install the plugin",
        unpublishPluginFailed: "Couldn't unpublish the plugin",
        visibilityFailed: "Couldn't change visibility",
        approveFailed: "Couldn't approve",
      },
    },

    // ── Данные: документ (под-экран) ──────────────────────────────────
    data: {
      title: "Data: what lives where",
      deviceOnly: {
        title: "Stays only on this device",
        item1: "— Audio cache of what you've played, and offline downloads (the actual music bytes never touch the server: the client fetches them itself).",
        item2: "— Local files and their paths on disk.",
        item3: "— Settings, theme, current session keys.",
      },
      serverStored: {
        title: "Stored on the server — for your own features, visible only to you",
        item1: "— Account: username and password hash; email only if you provided one (for password recovery).",
        item2: "— Likes, dislikes, playlists, chosen track versions.",
        item3: "— Listening history — your statistics (and later recommendations) are built from it.",
        item4: "— For local files — only the title, artist and a file fingerprint (hash), not the file itself or its path.",
      },
      anonymousStats: {
        title: "Anonymous statistics (checkbox in \"Account\")",
        item1: "— Roughly every 10 minutes, aggregate counters go out: how many extractions succeeded and with what errors (used to fix extraction without an app update), and how many plays happened.",
        item2: "— Not tied to your account: no username, id, or track names are in these counters.",
      },
      whatWeDontDo: {
        title: "What we don't do",
        item1: "— We don't sell or share your data.",
        item2: "— We don't collect a named history for analytics — aggregates are anonymized.",
        item3: "— We don't send emails without a reason: only verification and password recovery.",
      },
      deletionNote: "Deleting your account removes everything server-side. A button will appear closer to release — for now it's done on request.",
    },

    // ── Компоновка плеер-бара (под-экран) ─────────────────────────────
    bar: {
      title: "Player bar buttons",
      hint: "Order affects the right side of the bar; \"Shuffle\" and \"Repeat\" live around the transport. Cover, like, prev/play/next and the progress bar are fixed.",
      moveUp: "Move up: {name}",
      moveDown: "Move down: {name}",
      reset: "Reset bar layout",
    },

    // ── Вкладки сайдбара (под-экран) ──────────────────────────────────
    nav: {
      title: "Sidebar tabs",
      hint: "Hiding a tab doesn't remove it from the app — its screen stays reachable (start screen, hotkeys). An empty name restores the default. \"Settings\" and \"Admin\" live separately, at the bottom.",
      homeCannotDisable: "Home can't be turned off",
      reset: "Reset tabs",
    },

    // ── Статистика (под-экран) ────────────────────────────────────────
    stats: {
      title: "Statistics",
      blocksGroup: "Page blocks",
      periodGroup: "Default period",
      period: {
        title: "Period",
        hint: "Which period the page opens with",
        week: "Week",
        month: "Month",
        year: "Year",
        allTime: "All time",
      },
    },

    // ── Воспроизведение ──────────────────────────────────────────────
    playback: {
      transitionsGroup: "Transitions",
      crossfade: { title: "Crossfade", hint: "Smooth transition between tracks (4 seconds)" },
      gapless: {
        title: "Gapless",
        hint: "The next track starts without a pause; the last ~50ms of the current track are skipped — usually unnoticeable. If the window is minimized, the transition sometimes falls back to a regular switch (no trimming — just not gapless that time)",
        hintCrossfadeOn: "Seamless transition instead of a regular switch. While \"Crossfade\" above is on, it takes over — Gapless doesn't apply",
      },
      soundGroup: "Sound",
      equalizer: {
        rowTitle: "Equalizer",
        rowHint: "Presets and custom bands — the sound is live",
        kiloSuffix: "k",
      },
      normalize: { title: "Volume normalization", hint: "Evens out loudness between tracks (−14 LUFS, when a track's loudness is measured)" },
      speedSteps: { title: "Speed steps", hint: "The \"1×\" bar button cycles through these values; custom steps — comma-separated (0.25–4)" },
      queueGroup: "Queue",
      radioEndless: { title: "Endless radio", hint: "Queue ran out — keep going with similar tracks (radio from the last one)" },
      recsGroup: "Recommendations",
      recs: {
        title: "Novelty and repeats",
        needsAccount: "Recommendation sliders are available after signing in",
        saveFailed: "Couldn't save the recommendation settings",
        novelty: { title: "Novelty", hint: "Share of unfamiliar tracks mixed with the best (ε-exploration in the feed and radio)" },
        repeats: { title: "Favorite repeats", hint: "Left — favorites come back more often, right — less often" },
      },
      resumePosition: { title: "Remember track position", hint: "Continue from where you stopped when replaying a track", ariaLabel: "Remember position" },
      streamGroup: "Streaming",
      streamQuality: {
        title: "Stream quality",
        hint: "Economy fetches smaller formats (less traffic and disk); already-downloaded tracks play as-is",
        auto: "Auto",
        econom: "Economy",
      },
      sleepTimer: { title: "Sleep timer", hint: "Moon presets in the bar: off → these minutes → end of track", minSuffix: "min" },
    },

    // ── Источники ────────────────────────────────────────────────────
    sources: {
      policy: {
        title: "What to prefer",
        hint: "Global extraction order; a track's chosen version (\"⋯ → Versions and sources\") takes priority",
        official: "Official",
        soundcloudFirst: "SoundCloud first",
      },
      priorityGroup: "Sources by priority",
      youtube: { hint: "Official catalog — the main extraction source" },
      soundcloud: { hint: "Fallback; the policy above can move it ahead" },
      bandcamp: { hint: "Already works via a direct link; search support is coming" },
      searchGroup: "Search",
      searchScope: {
        title: "Where to search",
        hint: "\"Catalog only\" doesn't run yt-dlp on the server; local files are in Library",
        all: "Catalog and sources",
        catalogOnly: "Catalog only",
      },
      instantSearch: { title: "Instant search", hint: "Searches the catalog as you type; off — search only on Enter" },
      searchGrouping: {
        title: "Group remixes and versions",
        hint: "Remixes/sped-up edits/covers — grouped under one original card; liking the card likes the original, versions expand separately",
      },
      directLocal: {
        title: "Direct and local sources",
        hint: "Already works: files, folders and links — in Library",
        value: "Library → Local / By link",
      },
    },

    // ── Тексты ───────────────────────────────────────────────────────
    lyrics: {
      displayGroup: "Display",
      synced: { title: "Synced lyrics", hint: "Karaoke-style lines in time with the music; off — a plain list without highlighting" },
      autoScroll: { title: "Auto-scroll", hint: "Follow the current line; off — free scrolling through the whole text" },
      karaokeSize: { title: "Karaoke text size", hint: "Line shown in listening mode (same slider as in Customize)" },
      understandingGroup: "Understanding",
      translation: { title: "Translation", hint: "Translate lines into a chosen language (coming later)" },
      meaningMode: { title: "Meaning mode", hint: "Dotted lines with Genius explanations — click opens a card" },
    },

    // ── Библиотека ───────────────────────────────────────────────────
    library: {
      localFiles: { title: "Local files", hint: "Add files and folders in Library, \"Local\" tab", value: "Library → Local" },
      cache: {
        title: "Playback cache",
        hintFilled: "Using {size} · {files} file(s); clearing doesn't touch offline downloads",
        hintEmpty: "LRU cache of fetched audio — live, evicted by limit",
        limitLabel: "Cache limit",
        clear: "Clear",
      },
      offline: {
        title: "Offline downloads",
        hint: "\"Save offline\" on a track or playlist; never evicted, survives clearing",
        value: "{n} tr. · {size}",
        empty: "0 tracks",
      },
      importPlaylists: { title: "Import playlists", hint: "Spotify, YouTube / YT Music, Apple Music — button in Library", value: "Library → Import" },
      stats: { title: "Statistics", hint: "Page blocks, their order, and the default period" },
      units: { gb: "{n} GB", mb: "{n} MB" },
    },

    // ── Интеграции (сама вкладка, помимо discord/lastfm/listenbrainz выше) ─
    // (остальные ключи самой вкладки — mediaKeys уже в integrations.mediaKeys)

    // ── Хоткеи ───────────────────────────────────────────────────────
    hotkeys: {
      conflictHint: "⚠ conflict: this combination is already taken by another action",
      pressKey: "Press a key…",
      help: { title: "Help / close", hint: "Fixed — can't be reassigned" },
      resetAll: "Reset all",
    },

    // ── Расширения ───────────────────────────────────────────────────
    extensions: {
      builtInGroup: "Built-in",
      visualizer: { title: "Visualizer", hint: "Spectrum or waveform in time with the music, in listening mode (catalog tracks)" },
      visualizerKind: { title: "Visualizer style", hint: "Bars — frequency spectrum, wave — signal shape", bars: "Bars", wave: "Wave" },
      visualizerStyle: {
        custom: "Custom",
        waveSoft: "Soft",
        waveRibbon: "Ribbon",
        waveThin: "Thin",
        waveLive: "Lively",
        barsClassic: "Classic",
        barsDense: "Dense",
        barsAiry: "Airy",
      },
      visualizerBars: { title: "Bar density", hint: "Fewer bars — chunkier and calmer, more — finer detail" },
      visualizerBarFill: { title: "Bar width", hint: "How much of its row each bar takes: less — airier, 100% — a solid strip" },
      visualizerBarRound: { title: "Bar rounding", hint: "0% — rectangles, 100% — pills" },
      visualizerBarCalm: { title: "Fall smoothness", hint: "Hits land instantly, bars sink gently: higher — slower" },
      visualizerMirror: { title: "Mirrored spectrum", hint: "Bass in the centre, highs at the edges — symmetric both ways" },
      visualizerWaveSmooth: { title: "Wave softness", hint: "Smooths the line: 0% — a hard sample-by-sample saw, higher — softer" },
      visualizerWaveThick: { title: "Wave thickness", hint: "From a thin stroke to a dense ribbon" },
      visualizerWaveCalm: { title: "Motion smoothness", hint: "Shape inertia between frames: 0% — instant and sharp, higher — languid" },
      visualizerWaveFill: { title: "Fill", hint: "A translucent body under the line — the wave gains mass" },
      visualizerWaveAmp: { title: "Swing", hint: "Wave height inside its band" },
      visualizerOpacity: { title: "Intensity", hint: "How present the visualizer is on stage: lower — ambient, higher — vivid" },
      bassShake: { title: "Bass shake", hint: "The screen gently pulses to the bass in fullscreen player" },
      bassShakeStrength: { title: "Shake strength", hint: "100% — a gentle pulse, higher — a real shake, 0% — no shake" },
      externalGroup: "External plugins",
      appOnly: "Only in the app (not in the browser)",
      installFromFile: {
        title: "Install from file",
        hint: "A .muzaplugin package — you'll be asked to approve its permissions during install",
        button: "Choose file",
      },
      installed: {
        title: "Installed",
        emptyHint: "Nothing installed yet",
        zero: "0 installed",
        hint: "v{version} · {author} · permissions: {n}",
        enableAria: "Enable {name}",
        deleteAria: "Delete {name}",
      },
      fullAccessBadge: "Full access",
      errorsGroup: "Full access errors",
      errorLog: { title: "Error log", hint: "{n} entr(ies) — from try/catch in full-access plugins", clear: "Clear" },
      pluginMarket: { title: "Plugin marketplace", hint: "Catalog of extensions — live" },
      themeMarket: { title: "Theme marketplace", hint: "Install and share themes — live" },
      pluginInstalled: "Plugin \"{name}\" installed",
      pluginRemoved: "Plugin \"{name}\" removed",
      installDialog: {
        title: "Install \"{name}\"?",
        titleGeneric: "Install plugin",
        wait: "Wait {n}s…",
        fullAccessWarning:
          "This plugin is requesting FULL ACCESS: it will be able to do ANYTHING in the app — read and change any data, including your session. Its code runs as part of Muza itself, with no sandbox. Only install it if you fully trust the author \"{author}\".",
        trustAuthor: "I understand the risk and trust the author",
        noPermissions: "This plugin doesn't request any special permissions.",
        permissionsAsk: "This plugin requests permissions:",
        network: "Network: {list}",
      },
      restartDialog: {
        title: "Restart Muza?",
        later: "Later",
        restart: "Restart",
        body: "\"{name}\" was turned off, but its full-access code is still running in this window and can't be unloaded on the fly — it stays active until the app restarts.",
      },
      errors: {
        readFailed: "Couldn't read the plugin",
        installFailed: "Couldn't install",
        toggleFailed: "Couldn't change",
        removeFailed: "Couldn't delete",
      },
    },

    // ── Система ──────────────────────────────────────────────────────
    system: {
      appOnly: "Only works in the app (not in the browser)",
      autostart: { title: "Launch at Windows startup", hint: "Muza starts together with the system" },
      tray: { title: "Tray icon", hint: "Muza in the notification area: click opens the window" },
      closeAction: {
        title: "On window close",
        hintTray: "\"Minimize\" hides to the tray — music keeps playing",
        hintNoTray: "Without a tray icon, the window always closes and exits",
        minimize: "Minimize",
        exit: "Exit",
      },
      update: {
        title: "Auto-update",
        hint: "GitHub Releases: signed builds, stable channel",
        checking: "Checking…",
        upToDate: "Up to date",
        available: "{version} available",
        downloadingPct: "Downloading… {pct}%",
        downloading: "Downloading…",
        checkFailed: "Couldn't check",
        stableChannel: "Stable channel",
        check: "Check",
        errors: { installFailed: "Couldn't install the update" },
      },
      miniPlayer: { title: "Mini player", hint: "A compact always-on-top window: cover, transport, like; follows the background" },
      aboutGroup: "About",
      version: { title: "Version", hint: "Muza · development build" },
      licenses: {
        title: "Open-source licenses",
        rowTitle: "Open-source licenses",
        rowHint: "What's inside and under which license",
        hint: "Muza is built on open-source software. Below are the client's key dependencies and their licenses; click to open the project's website.",
        items: {
          react: "React / React DOM",
          tauri: "Tauri (core and plugins)",
          vite: "Vite",
          typescript: "TypeScript",
          lucide: "lucide (icons)",
          golosText: "Golos Text (font)",
          unbounded: "Unbounded (font)",
          zod: "Zod",
          ytdlp: "yt-dlp (extraction sidecar)",
          deno: "Deno (extraction JS runtime)",
          serde: "serde (Rust)",
          ed25519Dalek: "ed25519-dalek (Rust)",
          lofty: "lofty (Rust, tags)",
          vitest: "vitest",
        },
      },
      website: { title: "Website", hint: "muza.lol — landing page and web player" },
      sourceCode: { title: "Client source code", hint: "github.com/EntonioDMI/muza-client" },
    },

    // ── Приватность / данные аккаунта (под-экран) ─────────────────────
    privacy: {
      title: "Account data",
      export: {
        title: "Export data",
        hint: "Profile, likes, history, playlists — one JSON, no passwords or tokens",
        busy: "Gathering…",
        button: "Export JSON",
      },
      exported: "Data exported",
      deleteAccount: {
        title: "Delete account",
        hint: "Permanent: likes, playlists, history and shared access. Local files and the on-device cache stay",
        button: "Delete…",
      },
      accountDeleted: "Account deleted",
      privacyDoc: {
        title: "How Muza uses data",
        hint: "In plain terms: what we collect, why, and how to delete it",
      },
      deleteDialog: {
        title: "Delete your account for good?",
        body: "The server will delete everything: likes, playlists, history, shared access and published themes. This can't be undone. Local files and the on-device cache stay.",
        passwordPlaceholder: "Password to confirm",
        deleting: "Deleting…",
        confirm: "Delete forever",
      },
      errors: {
        exportFailed: "Couldn't export the data",
        deleteFailed: "Couldn't delete the account",
      },
    },
  },

  // ── App.tsx (T31, эпик W5): каркас плеера — тосты, меню, диалоги ────
  app: {
    anonymousUsername: "Anonymous (no sync)",
    newPlaylistName: "New Playlist",
    unknownPlaylistName: "playlist",
    queuePlaylistName: "Queue {date}",
    dropOverlay: {
      title: "Drop it — we'll add it to Muza",
      hint: "Audio files and folders become local tracks",
    },
    errors: {
      pluginBridgeNotReady: "internal: plugin bridge isn't ready yet",
    },
    renamePlaylistDialog: {
      title: "Rename playlist",
    },
    deletePlaylistDialog: {
      title: "Delete playlist?",
      confirm: "Delete",
      bodyServer: "\"{name}\" will disappear from every device. Tracks stay in the catalog.",
      bodyLocal: "\"{name}\" will disappear from the sidebar.",
    },
    newPlaylistDialog: {
      create: "Create",
    },
    addToPlaylistDialog: {
      titleWithTrack: "\"{title}\" — add to playlist",
      empty: "No playlists yet — create the first one with the \"+\" button in the sidebar.",
    },
    hotkeysDialog: {
      title: "Hotkeys",
      rows: {
        searchOrClose: "Search / close overlay",
        thisHelp: "This help",
        dragTrackToPlaylist: "Track — to a sidebar playlist",
        dragRowCombo: "drag the row",
        dragFileToDesktop: "Track file — to the desktop",
        altDragCombo: "Alt + drag",
      },
      footerHint:
        "Reassign — Settings → Hotkeys. File-drag works for already-fetched (cached) tracks; another way — drag the cover off the player bar.",
    },
  },

  // ── Контекстные меню (App.tsx: трек/каталожный трек/плейлист) ───────
  menu: {
    addToPlaylist: "Add to playlist",
    catalog: {
      radio: "Radio from this track",
      addToJam: "Add to Jam",
      share: "Share",
      versions: "Sources",
      saveOffline: "Save offline",
      removeOffline: "Remove from offline",
    },
    playlist: {
      open: "Open",
      rename: "Rename",
      changeIcon: "Change icon",
      delete: "Delete playlist",
    },
  },

  // ── Тосты (App.tsx: onNotify/showToast по всему каркасу плеера) ─────
  toast: {
    undo: "Undo",
    radio: {
      continuing: "Radio: continuing with similar tracks",
      building: "Building a radio…",
      byTrack: "Radio from \"{title}\"",
      buildFailed: "Couldn't build the radio",
    },
    offline: {
      removed: "Removed from offline",
      saving: "Saving offline…",
      saved: "Saved offline",
      pinnedWillDownload: "Pinned — will download on first listen",
      savingPlaylist: "Saving {count} tr. offline — downloading in the background",
      playlistDone: "Offline ready: {ok} of {count} downloaded",
    },
    sleep: {
      track: "Falling asleep at the end of the track",
      inMinutes: "Falling asleep in {minutes} min",
      paused: "Sleep timer: paused",
    },
    queue: {
      added: "To queue: {title}",
      trackRemoved: "\"{title}\" removed from the queue",
      nothingToSave: "No catalog tracks in the queue — nothing to save",
      savedAsPlaylist: "Saved: \"{name}\" · {count} tr.",
      saveFailed: "Couldn't save the queue",
      tailCleared: "Up-next cleared",
    },
    files: {
      noneFound: "No audio files found in what was dropped",
      added: "Local tracks added: {count}",
      addFailed: "Couldn't add the files",
      prepareFailed: "Couldn't prepare the file",
    },
    update: {
      available: "Muza {version} available",
      downloading: "Downloading the update — Muza will restart itself…",
      installFailed: "Couldn't install the update",
    },
    favorites: {
      added: "Added to Favorites",
      removed: "Removed from Favorites",
      syncFailed: "Couldn't sync the like",
    },
    playlist: {
      renamed: "Playlist renamed",
      renameFailed: "Couldn't rename",
      deleteFailed: "Couldn't delete",
      deleted: "Playlist deleted",
      created: "Playlist created",
      createFailed: "Couldn't create the playlist",
      needsAccount: "Playlists are stored in your account — sign in to create one.",
      iconChanged: "Icon changed",
      iconChangeFailed: "Couldn't change the icon",
      addedTrack: "Added to \"{name}\"",
      addFailed: "Couldn't add",
      joined: "You're in the playlist \"{name}\" (from {owner})",
    },
    link: {
      trackAdded: "\"{title}\" added",
    },
  },

  // ── Плеер-бар/транспорт (T31): PlayerBar.tsx + ListeningMode.tsx +
  //    NowPlayingPanel.tsx + вычисления App.tsx, использующие тот же текст ─
  player: {
    /** Пустой плеер-бар: очередь пуста, играть нечего. */
    empty: {
      title: "Nothing playing",
      hint: "Find a track and press play",
    },
    speedTooltip: "Playback speed",
    speedAria: "Speed: {speed}",
    speedToast: "Speed: {speed}×",
    listeningModeTooltip: "Listening mode",
    listeningModeTooltipDrag: "Listening mode · drag to the desktop",
    shuffle: "Shuffle",
    previous: "Previous",
    next: "Next",
    buffering: "Fetching track…",
    pause: "Pause",
    play: "Listen",
    repeat: {
      off: "Repeat off",
      all: "Repeat queue",
      one: "Repeat track",
    },
    progress: "Progress",
    progressValueText: "{pos} of {duration}",
    sleep: {
      off: "Sleep timer off",
      track: "Sleep at the end of the track",
      inMinutes: "Sleep in {minutes} min",
    },
    lyrics: "Lyrics",
    jamTooltip: "Jam: listen together",
    jamActiveTooltip: "Jam in progress — open",
    queue: "Queue",
    unmute: "Unmute",
    mute: "Mute",
    volume: "Volume",
    fullscreen: "Fullscreen",
    lyricsSearching: "Looking for lyrics…",
    lyricsNotFound: "Lyrics not found",
  },

  // ── Sidebar.tsx (T31) ─────────────────────────────────────────────
  sidebar: {
    playlistsHeading: "Playlists",
    newPlaylistTooltip: "New playlist",
    createPlaylistAria: "Create playlist",
    admin: "Admin",
    hotkeysTooltip: "Hotkeys (?)",
    hotkeysAria: "Hotkeys",
    playlistMeta: {
      collabFrom: "{count} tr. · from {owner}",
      shared: "{count} tr. · shared",
      trackCount: "{count} tr.",
    },
  },

  // ── NowPlayingPanel.tsx (T31) ─────────────────────────────────────
  nowPlaying: {
    heading: "Now Playing",
    empty: {
      title: "Nothing playing",
      hint: "Pick a track — the cover, lyrics and meaning will show up here.",
    },
  },

  // ── ListeningMode.tsx (T31, строки помимо переиспользованных player.*) ─
  listeningMode: {
    minimize: "Minimize",
  },

  // ── Зоны-фрагменты (параллельное извлечение) ──
  auth: {
    tabs: { login: "Sign in", register: "Sign up", recover: "Recover" },
    fields: {
      username: "Username",
      emailAccount: "Account email",
      emailOptional: "Email (optional)",
      password: "Password",
    },
    submit: { login: "Sign in", register: "Create account", recover: "Send link" },
    continueAnon: "Continue anonymously",
    hint: {
      login: "No email needed. No personal listening history.",
      register: "Email is optional: everything works without it, but the password can't be recovered.",
      recover: "Only works if an email was set at sign-up.",
    },
    recoverySent: "If that email is linked to an account, a link is already on its way. It's valid for 30 minutes.",
    check: {
      title: "Check your email",
      sentToPrefix: "We sent an email to ",
      sentToSuffix: ". Open the link from the email — your account will be created automatically, you can leave this window open.",
      waiting: "Waiting for confirmation…",
      startOver: "Start over",
      resendIn: "Send again ({count}s)",
      resend: "Send the email again",
      back: "Back",
      resent: "Email sent again.",
    },
    anon: {
      title: "No sync",
      continue: "Continue",
      body: "An anonymous account lives only on this device: playlists and likes won't sync and won't be restored after a reinstall. You can create a full account later in settings.",
    },
    errors: {
      completeFailed: "Couldn't finish registration",
      expired: "Confirmation window expired — start over.",
      notFound: "Request not found — start over.",
      notEmail: "That doesn't look like an email.",
      somethingWrong: "Something went wrong",
      credsTooShort: "Username — 3+ characters, password — 8+.",
      resendFailed: "Couldn't send the email",
    },
  },

  // ── Диалоги каркала (T34a, эпик W5): shell/*Dialog.tsx + QueuePanel ──
  dialogs: {
    close: "Close",
    copyFailed: "Couldn't copy",
    copyCode: "Copy code",
    codeTooShort: "The code is shorter than 4 characters — check it",
    // Dev build only: codes live in one server's database and don't cross
    // between localhost and prod (docs/notes/2026-07-15-кросс-бэкенд-ловушка-коды.md)
    devBackend: "Dev build: only codes from {host} will work",
    collab: {
      title: "Shared access",
      done: "Done",
      confirmLeave: "Really leave",
      leavePlaylist: "Leave playlist",
      inviteCodeLabel: "Invite code",
      enterCodeHint: "A friend enters the code on their side: Library → \"By code\".",
      revoke: "Revoke",
      createCodeHint:
        "Create a code and send it to a friend — they'll be able to add and remove tracks together with you.",
      createCode: "Create code",
      sharedPrefix: "Shared playlist",
      sharedByUser: "by",
      sharedCanEdit: "You can add and remove tracks.",
      membersHeading: "Members · {count}",
      ownerFallback: "owner",
      onlyYou: "Just you for now.",
      createCodeAndInvite: "Create a code and invite someone.",
      removeFromPlaylist: "Remove from playlist",
      removeAria: "Remove {username}",
      memberRemoved: "{username} removed from the playlist",
      kickFailed: "Couldn't remove the member",
      left: "You left the playlist",
      leaveFailed: "Couldn't leave",
      createFailed: "Couldn't create the code",
      codeRevoked: "Code revoked — new people can't join",
      revokeFailed: "Couldn't revoke the code",
      codeCopied: "Code copied — send it to a friend",
      youSuffix: " (you)",
    },
    jam: {
      title: "Jam — listen together",
      endJam: "End jam",
      leaveJam: "Leave jam",
      needsAccount: "Jam lives on the server — needs signing in with an account (anonymous listens alone).",
      codeLabel: "Jam code",
      hostDescription:
        "You control playback. Friends join with the code and hear the same thing — each from their own account.",
      guestDescription: "{host} is in control. You can add tracks: \"⋯ → Add to Jam\" on any track.",
      hostUnavailable:
        "Host is listening to {track} — not available for streaming (a local file). Waiting for the next one.",
      genericTrack: "a track",
      listening: "Listening · {count}",
      hostBadge: "host",
      intro:
        "Listen to music in sync: the host controls playback, everyone else hears the same thing. Each person — from their own device and account.",
      create: "Create jam",
      orJoinByCode: "or join with a code",
      codePlaceholder: "Code, e.g. M7QK2W",
      join: "Join",
      joinFailed: "Couldn't join",
      codeCopied: "Code copied — invite your friends",
    },
    versions: {
      titleWithTrack: "\"{title}\" — sources",
      localFile: "Local file",
      kindDirect: "added via link",
      kindLocal: "file on device",
      loadFailed: "Couldn't load the sources",
      nowPlaying: "Now playing: {provider}",
      chooseFailed: "Couldn't choose the source",
      resetDone: "Choice reset — the best source plays now",
      resetFailed: "Couldn't reset",
      resetChoice: "Reset choice",
      loading: "Loading sources…",
      priority: "priority {n}",
      noSources: "No live sources — the track can't play yet.",
      footerHint:
        "These are places the SAME song is fetched from — remixes and sped-up edits are separate tracks, look for them in search. Your choice is remembered and won't be overridden by auto-matching. Likes and lyrics stay on the track itself.",
    },
    queue: {
      playAria: "Play: {artist} — {title}",
      moveUp: "Move up in queue",
      moveDown: "Move down in queue",
      remove: "Remove from queue",
      countSuffix: " · {count}",
      toCurrent: "To current track",
      saveAsPlaylist: "Save queue as playlist",
      closeQueue: "Close queue",
      empty:
        "Queue is empty. Play a track from search, a playlist or the feed — the list it played from becomes the queue.",
      collapse: "Collapse",
      showCount: "Show ({count})",
      history: "History",
      nowSection: "Now",
      clear: "Clear",
      upNext: "Up next · {count}",
      upNextEmpty: "Nothing next",
      upNextEmptyHint: " — turn on radio from a track or add from search",
    },
    share: {
      renderFailed: "Couldn't draw the card",
      imageCopied: "Image copied — paste it into a chat",
      imageCopyFailed: "Clipboard didn't accept the image — save it as a file",
      filesAppOnly: "Saving files — in the Muza app",
      saved: "Card saved",
      saveFailed: "Couldn't save",
      textCopied: "Text copied",
      previewAlt: "Share card",
      rendering: "Drawing the card…",
      copyImage: "Copy",
      savePng: "Save PNG",
      textButton: "Text",
    },
    meaning: {
      title: "Meaning of the line",
      verifiedSuffix: " · from the author",
      votesSuffix: " · ▲ {votes}",
      openOnGenius: "Open on Genius",
    },
    importPlaylist: {
      failed: "Import failed",
      titleDone: "Import complete",
      title: "Import playlist",
      great: "Great",
      importing: "Importing…",
      import: "Import",
      foundCount: "found {matched} of {total}",
      notFoundLabel: "Not found (you can add them by link manually):",
      allFound: "Everything's here.",
      urlPlaceholder: "Link to a playlist or album",
      hint:
        "YouTube / YouTube Music, Spotify, Apple Music. The playlist must be public. Tracks are matched to the catalog — anything missing, we'll look for in sources.",
      matching: "Matching tracks — large playlists take up to a couple of minutes…",
    },
    addLink: {
      failed: "Couldn't add by link",
      title: "Add by link",
      adding: "Adding…",
      add: "Add",
      hint:
        "YouTube, YouTube Music, SoundCloud, Bandcamp — added as-is. Spotify and Apple Music — we'll find a playable source automatically.",
      reading: "Reading metadata — up to half a minute…",
    },
    joinPlaylist: {
      joinFailed: "Couldn't join by code",
      title: "Shared playlist by code",
      joining: "Joining…",
      join: "Join",
      hint: "Enter the code the playlist owner sent you — and add tracks together.",
      codePlaceholder: "E.g.: 7WQK2M9T",
    },
    iconPicker: {
      title: "Change icon",
      iconAria: "Icon {id}",
    },
  },

  // ── Мини-плеер (T34a): mini/MiniPlayer.tsx — отдельный webview, вне
  //    LanguageProvider; строки читаются через translate(prefs.language, …) ─
  mini: {
    waitingForMusic: "waiting for music from the main window",
    closeMiniPlayer: "Close mini player",
  },

  // ── Плагины (T34a, общий свип): plugins/PluginFrames.tsx +
  //    plugins/install.ts (последний — вне React, translate(lang, …) с
  //    lang-параметром по умолчанию DEFAULT_LANG, зовущий — SettingsView.tsx) ─
  plugins: {
    closeOverlay: "Close overlay",
    closePanel: "Close panel",
    closeTab: "Close plugin tab",
    install: {
      fileOnlyInApp: "Installing from a file is only available in the app",
      marketOnlyInApp: "Installing a plugin is only available in the app",
      filePickerFilterName: "Muza plugin",
      filePickerTitle: "Choose a .muzaplugin file",
      manifestRejected: "Plugin manifest rejected: {reason}",
      scriptRejected: "Plugin code rejected: {reason}",
      cssRejected: "Plugin CSS rejected: {reason}",
    },
  },
  views: viewsEn,
  media: mediaEn,
};
