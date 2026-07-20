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
    forward: "Forward",
    more: "More",
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
    // Поиск по настройкам (спека 19.07 §4.2) + общие строки рядов-пресетов (§4.1).
    search: {
      placeholder: "Search settings",
      empty: "Nothing found. Try other words: \"background\", \"font\", \"hotkeys\".",
    },
    presetRow: {
      customChip: "Custom",
      tune: "Tune",
    },
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
        hint: "Needed to recover your password. A change is confirmed by an email to the new address.",
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
        hint: "After the change, every other device gets signed out.",
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
        rowHint: "A list of devices signed into your account. You can sign out any device you don't recognize.",
        title: "Sessions and devices",
        hint: "Each row is a device signed into your account. The date is when it signed in. Don't recognize a device — sign it out and change your password.",
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
        hint: "Helps us notice tracks that stopped playing and fix them faster. Your name, email and the list of what you listen to are never sent.",
      },
      dataDoc: {
        title: "Data document",
        hint: "What stays on the device, what we store, and what goes into statistics.",
      },
      exportOrDelete: {
        title: "Export or delete data",
        hint: "Download all your data as one file, or delete the account entirely.",
      },
      needsAccount: "Needs an account — anonymous users don't have email",
      needsAccountPassword: "Needs an account — anonymous users don't have a password",
      needsAccountShort: "Needs an account",
      needsAccountServer: "Needs an account — nothing of an anonymous user is stored with us",
    },

    // ── Внешний вид ──────────────────────────────────────────────────
    appearance: {
      language: {
        title: "Interface language",
        hint: "The language switches right away, no restart.",
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
        hint: "Light makes the background light and the text dark.",
        dark: "Dark",
        light: "Light",
      },
      accent: {
        title: "Accent color",
        hint: "Pick a ready-made color or any of your own — the square on the right opens a palette.",
        blue: "Blue",
        red: "Red",
        bolt: "Bolt",
        customLabel: "Custom accent color",
      },
      radius: {
        title: "Corner radius",
        hint: "How round the tile corners are.",
        mild: "Less",
        soft: "Standard",
        round: "More",
      },
      glass: {
        title: "Glass",
        hint: "How dense the frosted glass of the panels is.",
      },
      background: {
        title: "Background",
        hint: "Quickly turns on a background made from the track cover. Other background types live in Customize.",
        fromCover: "From cover",
        custom: "Custom",
        ariaLabel: "Background from cover",
      },
      scale: {
        title: "Interface scale",
        hint: "Makes the whole interface bigger or smaller.",
      },
      customize: {
        title: "Customize",
        hint: "Fine-tune the look: colors, transparency, shape, fonts, themes.",
      },
      plugin: {
        genericLabel: "Plugin",
        hint: "Plugin: {name}",
      },
    },

    // ── Кастомизация (под-экран) ─────────────────────────────────────
    customize: {
      title: "Customize",
      units: { seconds: "{n} s" },
      glass: {
        groupTitle: "Glass and effects",
        panelBlur: { title: "Panel blur", hint: "How blurred things look through the frosted panels." },
        bgBlur: { title: "Background blur", hint: "How blurred the cover or image behind the interface is." },
        zones: { title: "Per-zone transparency", hint: "The player, menus, dialogs, sidebar and Now Playing each get their own background density." },
        zonePlayer: { title: "Player", hint: "Glass density on the player bar and queue.", ariaLabel: "Player glass density" },
        zoneMenu: { title: "Menus", hint: "Glass density on menus and dropdown lists.", ariaLabel: "Menu glass density" },
        zoneDialog: { title: "Dialogs", hint: "At 100% the dialog window is opaque, lower — it shows through like glass.", ariaLabel: "Dialog window density" },
        zoneSidebar: { title: "Sidebar", hint: "Density of the left panel. It's nearly transparent by default.", ariaLabel: "Sidebar surface density" },
        zoneNowPlaying: { title: "\"Now Playing\"", hint: "Density of the right panel with lyrics.", ariaLabel: "\"Now Playing\" panel density" },
      },
      colors: {
        groupTitle: "Colors and layers",
        baseBg: {
          title: "Base background",
          hint: "The overall tone of the backdrop — darker, warmer, colder or pure black.",
          graphite: "Graphite",
          warm: "Warm",
          cold: "Cold",
          amoled: "AMOLED",
        },
        accentRoles: { title: "Accent roles", hint: "Separate colors of your own for play buttons, sliders and the playing track." },
        accentPlay: { title: "Play buttons", hint: "Color of the play buttons — in the player, on tiles and in listening mode.", pickerLabel: "Play button color" },
        accentSlider: { title: "Sliders", hint: "Color of the sliders — progress, volume, equalizer.", pickerLabel: "Slider color" },
        accentActive: { title: "Playing track", hint: "Which color highlights the playing track in lists.", pickerLabel: "Playing track color" },
        textDim: { title: "Text dimming", hint: "How bright the secondary text is — labels and hints." },
      },
      shape: {
        groupTitle: "Shape and sizes",
        tiles: { title: "Tiles and rows", hint: "How round the corners of covers, cards and track rows are — from square to oval." },
        buttons: { title: "Buttons", hint: "How round the button corners are — from square to oval." },
        tabs: { title: "Mode toggles", hint: "How round the corners of the mode toggles are — from square to oval." },
        fields: { title: "Input fields", hint: "How round the corners of search, lists and text fields are." },
        panels: { title: "Panels and zones", hint: "How round the corners of the large panels are — sidebar, player, dialogs." },
        density: { title: "Interface density", hint: "Left — the interface gets tighter, right — roomier." },
        tileSize: { title: "Tile size", hint: "How large the album and playlist tiles are. Where tiles stretch to fit, this sets the column width." },
        padTile: { title: "Tile padding", hint: "The air between a tile's edge and the cover inside it." },
        gapZone: { title: "Zone gap", hint: "The distance between the window's zones — sidebar, main area and player." },
        sidebarWidth: { title: "Sidebar width", hint: "How wide the left panel is. On a narrow window it still shrinks." },
        nowPlayingWidth: { title: "\"Now Playing\" width", hint: "How wide the right panel with lyrics is." },
        pill: "pill",
        preset: "preset",
      },
      typography: {
        groupTitle: "Typography",
        fontUi: { title: "Text font", hint: "The typeface of all interface text. Every name in the list is drawn in its own font." },
        fontDisplay: { title: "Heading font", hint: "The typeface of large titles — like the greeting on the home screen." },
        fontScale: { title: "Text size", hint: "Changes only the text size. \"Interface scale\" enlarges the whole interface instead." },
        headingScale: { title: "Heading size", hint: "Makes titles bigger or smaller. Regular text stays as is." },
        lineSpacing: { title: "Line spacing", hint: "The distance between lines of text in the interface." },
        spaceScale: { title: "Interface air", hint: "All the spacing at once: left — everything sits tighter, right — roomier." },
      },
      // Заголовок группы визуализатора: ряды переехали сюда из «Расширений»
      // 19.07 (спека §7), их ключи остались в settings.extensions.*.
      visualizerGroup: "Visualizer",
      motion: {
        groupTitle: "Motion",
        anims: { title: "Animations", hint: "The interface moves smoothly. Turn this off and everything switches instantly." },
        animSpeed: { title: "Animation speed", hint: "Left — animations get faster, right — slower and softer." },
        durMenu: { title: "Responses", hint: "How long menus, tooltips and small touches take to appear. Left — snappier." },
        durDialog: { title: "Windows", hint: "How long dialogs and panels take to open. Left — snappier." },
        durPage: { title: "Screen changes", hint: "How long switching between screens takes. Left — snappier." },
        ease: {
          title: "Motion character",
          hint: "How movement feels: \"Soft\" glides to a stop, \"Crisp\" lands quickly, \"Even\" moves at one pace.",
          soft: "Soft",
          crisp: "Crisp",
          linear: "Even",
        },
        scrollSpeed: { title: "Scroll speed", hint: "How far a list moves per mouse-wheel notch." },
        scrollSmooth: { title: "Smooth scrolling", hint: "The list glides with the wheel instead of jumping in steps." },
      },
      layout: {
        groupTitle: "Layout and elements",
        barButtons: { title: "Player bar buttons", hint: "Which buttons show in the player bar, and in what order." },
        navTabs: { title: "Sidebar tabs", hint: "Which tabs show in the sidebar, their order and custom names." },
        rowCover: { title: "Track row: cover", hint: "Show a small cover on the left in track lists." },
        rowDuration: { title: "Track row: duration", hint: "Show the track duration on the right in lists." },
        rowAlbum: { title: "Track row: album", hint: "The album name appears after the artist — for tracks where it is known." },
        rowSource: { title: "Track row: source", hint: "A small label shows where the track plays from — like SoundCloud. In search it is always visible." },
        playerHeight: { title: "Player bar height", hint: "How tall the player bar at the bottom is." },
        playerCover: { title: "Player cover", hint: "The size of the track cover in the player bar." },
      },
      background: {
        groupTitle: "Background",
        type: {
          title: "Background type",
          hint: "What shows behind the interface.",
          cover: "Track cover",
          color: "Color",
          gradient: "Gradient",
          image: "Image by link",
          animated: "Animated",
        },
        invert: { title: "Invert direction", hint: "The left and right background circles swap their spin direction.", ariaLabel: "Invert rotation direction" },
        anim: {
          title: "Animated background",
          hint: "Two circles in the cover's colors slowly spin behind the interface.",
          disabledHint: "Turns on when the background is \"Animated\".",
          presets: { calm: "Calm", lively: "Lively", bright: "Vivid" },
        },
        animSpeed: { title: "Spin speed", hint: "How many seconds one full turn takes. Further right — the circles turn more slowly." },
        animOpacity: { title: "Visibility", hint: "How noticeable the circles are: lower — barely there, higher — brighter." },
        animScale: { title: "Circle size", hint: "How large the circles are compared to the window." },
        animEdge: { title: "Behind the edge", hint: "How far the circles hide behind the window edge." },
        color: {
          title: "Background color",
          gradientTitle: "Gradient colors",
          hint: "The square next to it opens a color picker.",
          secondGradientColor: "Second gradient color",
        },
        imageUrl: { title: "Image by link", hint: "Paste a link to an image — it becomes the background. Blur is set with the slider above." },
        dim: { title: "Background dimming", hint: "Darkens the background so text and covers stay readable on top of it." },
        tint: { title: "React to cover", hint: "The background gets a light tint from the playing track's cover." },
      },
      behavior: {
        groupTitle: "Behavior",
        doubleClick: {
          title: "Double-click action",
          hint: "What double-clicking a track row does. Clicking the track number always starts playback.",
          play: "Play",
          queue: "Add to queue",
        },
        startView: {
          title: "Start screen",
          hint: "Which screen opens when the app starts.",
          home: "Home",
          search: "Search",
          favorites: "Favorites",
          library: "Library",
        },
      },
      themes: {
        groupTitle: "Themes",
        saveAs: { title: "Save as theme", hint: "Saves the whole current look as a theme — bring it back in one click or pass it to someone else." },
        copyJson: "Copy theme as text",
        deleteTheme: "Delete theme",
        importRow: { title: "Import theme", hint: "Paste a copied theme — from the clipboard or the marketplace.", button: "Paste" },
        marketRow: { title: "Theme marketplace", hint: "Install other people's themes, or publish your own." },
        namePlaceholder: "Theme name",
        saved: "Theme saved",
        applied: "Theme \"{name}\" applied",
        removed: "Theme removed",
        copied: "Theme copied — share away",
        imported: "Theme \"{name}\" imported and applied",
        saveDialog: {
          title: "Save theme",
          hint: "A theme holds only the appearance — colors, background, shape and custom styles. Behavior and sound aren't carried over.",
        },
        importDialog: {
          title: "Import theme",
          submit: "Import",
          ariaLabel: "Theme text",
          hint: "The theme applies immediately and shows up in the theme list.",
        },
        errors: {
          clipboardUnavailable: "Clipboard unavailable",
          notMuzaJson: "This doesn't look like a Muza theme",
        },
      },
      css: {
        groupTitle: "Custom styles (CSS)",
        toggle: { title: "Custom CSS", hint: "Changes how the app looks in any way you like — colors, sizes, spacing. If something breaks, turn this toggle off or press \"Reset appearance\" — everything goes back to normal." },
        apply: "Apply CSS",
        appliesHint: "Applied on top of all app styles; included in saved themes. Settings like a custom accent live inline — only !important overrides them.",
      },
      resetAppearance: "Reset appearance",
    },

    // ── Эквалайзер (под-экран) ────────────────────────────────────────
    equalizer: {
      title: "Equalizer",
      enable: { title: "Enable", hint: "Ten bands change the sound right as it plays." },
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
        rowHint: "Your Discord friends will see what you're listening to: status, cover and a button.",
        enable: {
          title: "Show in Discord",
          ariaLabel: "Discord RPC",
          hint: "A \"Listening to Muza\" status appears in your Discord profile. Discord needs to be running.",
          hintNoAppId: "Doesn't work yet — a setting on our side is missing. Your choice is saved and will start working on its own once we add it.",
        },
        whatToShow: "What to show",
        cover: { title: "Track cover", hint: "The playing track's cover shows next to the status.", ariaLabel: "Cover" },
        line1: { title: "First line", hint: "Template for the first status line. Placeholders: {track}, {artist}, {album}." },
        line2: { title: "Second line", hint: "Empty placeholders disappear along with their separators." },
        buttonGroup: "Activity button",
        btnOn: { title: "Show button", hint: "A link button appears under the status in your profile.", ariaLabel: "Activity button" },
        btnLabel: { title: "Button text", hint: "The label on the button. Discord limits it to 32 characters.", placeholder: "Open in Muza" },
        btnUrl: { title: "Button link", hint: "Where the button takes people — for example, to the Muza website." },
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
        noApiKeys: "Last.fm scrobbling isn't set up on this build of Muza: we haven't been given access keys (last.fm/api).",
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
        hint: "The play, pause and next keys on your keyboard control Muza. The Windows system playback panel works too.",
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
        body: "The author's styles can change the interface's look in any way. It's safe for your data, but if the look breaks — turn off \"Custom CSS\" in Customize or press \"Reset appearance\".",
        installAnyway: "Install anyway",
      },
      errors: {
        unpublishThemeFailed: "Couldn't unpublish the theme",
        reportFailed: "Couldn't send the report",
        nameTooShort: "Name — at least 2 characters",
        publishFailed: "Couldn't publish",
        corruptPayload: "The plugin file is damaged — try installing later",
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
        item1: "— Music saved while listening, and offline downloads. The audio files themselves never reach us: the app downloads them directly.",
        item2: "— Local files and their paths on disk.",
        item3: "— Settings, theme, current session keys.",
      },
      serverStored: {
        title: "Stored with us — needed for your own features, visible only to you",
        item1: "— Account: username and an encrypted password; email only if you provided one (for password recovery).",
        item2: "— Likes, dislikes, playlists, chosen track versions.",
        item3: "— Listening history — your statistics (and later recommendations) are built from it.",
        item4: "— For local files — only the title, artist and a file fingerprint, not the file itself or its path.",
      },
      anonymousStats: {
        title: "Anonymous statistics (checkbox in \"Account\")",
        item1: "— Every few minutes, summary counters go out: how many tracks started playing, how many couldn't, and how many plays happened. They let us fix playback without waiting for an app update.",
        item2: "— Not tied to your account: no username or track names are in these counters.",
      },
      whatWeDontDo: {
        title: "What we don't do",
        item1: "— We don't sell or share your data.",
        item2: "— We don't collect a listening history with names attached — only anonymized summary numbers.",
        item3: "— We don't send emails without a reason: only address confirmation and password recovery.",
      },
      deletionNote: "Deleting your account removes everything stored with us. The button is in \"Account\" → \"Export or delete data\".",
    },

    // ── Компоновка плеер-бара (под-экран) ─────────────────────────────
    bar: {
      title: "Player bar buttons",
      hint: "The order affects the right side of the player bar, while \"Shuffle\" and \"Repeat\" sit around the playback buttons. The cover, like, track switching and the progress bar are fixed — they can't be removed.",
      moveUp: "Move up: {name}",
      moveDown: "Move down: {name}",
      reset: "Reset bar layout",
    },

    // ── Вкладки сайдбара (под-экран) ──────────────────────────────────
    nav: {
      title: "Sidebar tabs",
      hint: "Hiding a tab doesn't remove it from the app — its screen still opens from the start screen and with hotkeys. An empty name restores the default. \"Settings\" and \"Admin\" live separately, at the bottom.",
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
        hint: "Which period the statistics page opens with.",
        week: "Week",
        month: "Month",
        year: "Year",
        allTime: "All time",
      },
    },

    // ── Воспроизведение ──────────────────────────────────────────────
    playback: {
      transitionsGroup: "Transitions",
      crossfade: {
        title: "Crossfade",
        hint: "Tracks flow smoothly into one another.",
        duration: { title: "Crossfade length", hint: "How long both tracks sound at once during the transition.", seconds: "{n} s" },
      },
      gapless: {
        title: "No pause between tracks",
        hint: "The next track starts right away, with no silence at the seam. The very tail of the current track — a fraction of a second — goes unheard, which is usually unnoticeable. If the window is minimized, the transition sometimes ends up as a regular switch.",
        hintCrossfadeOn: "While \"Crossfade\" above is on, it takes over — this setting doesn't apply.",
      },
      soundGroup: "Sound",
      equalizer: {
        rowTitle: "Equalizer",
        rowHint: "Ready-made profiles and your own bands. The sound changes right away, as it plays.",
        kiloSuffix: "k",
      },
      normalize: { title: "Volume leveling", hint: "Quiet and loud tracks play at roughly the same volume." },
      speedSteps: { title: "Speed steps", hint: "The \"1×\" button in the player cycles through these values. List your own steps comma-separated, from 0.25 to 4." },
      queueGroup: "Queue",
      radioEndless: { title: "Endless radio", hint: "When the queue runs out, the music keeps going with similar tracks." },
      recsGroup: "Recommendations",
      recs: {
        title: "Novelty and repeats",
        needsAccount: "Recommendation sliders are available after signing in",
        saveFailed: "Couldn't save the recommendation settings",
        novelty: { title: "Novelty", hint: "How much unfamiliar music gets mixed into the feed and radio. Further right — more new finds." },
        repeats: { title: "Favorite repeats", hint: "Left — favorites come back more often, right — less often." },
      },
      resumePosition: { title: "Remember track position", hint: "The track picks up from where you stopped.", ariaLabel: "Remember position" },
      streamGroup: "Music over the network",
      streamQuality: {
        title: "Sound quality",
        hint: "\"Economy\" downloads smaller files: less traffic and disk space, slightly lower quality. Already-downloaded tracks play as they are.",
        auto: "Auto",
        econom: "Economy",
      },
      sleepTimer: { title: "Sleep timer", hint: "The moon button in the player cycles through: off, these minutes, end of track.", minSuffix: "min" },
      units: { seconds: "{n} s", tracks: "{n} tr." },
      queuePrep: {
        title: "Queue preparation",
        hint: "How many upcoming tracks get ready before their turn. More — instant starts, but more traffic.",
        presets: { eco: "Economy", normal: "Normal", max: "Maximum" },
        warm: { title: "Tracks made ready", hint: "How many next tracks in the queue are prepared ahead of time." },
        preload: { title: "Next track prep", hint: "How many seconds before a track ends the next one starts loading." },
      },
      seekStep: {
        title: "Seek step",
        hint: "How far one press of the arrow keys jumps through the track.",
        fine: { title: "Own step", hint: "Any value from 1 to 60 seconds." },
      },
    },

    // ── Источники ────────────────────────────────────────────────────
    sources: {
      policy: {
        title: "Where the sound comes from",
        hint: "One rule for the whole app. \"Official platforms\" — steadier quality, but rare tracks may not be found. \"SoundCloud\" — more remixes, mixes and rarities, quality varies. A source picked by hand for a track (\"⋯ → Sources\") outweighs this rule.",
        official: "Official platforms",
        soundcloudFirst: "SoundCloud",
      },
      priorityGroup: "Sources by priority",
      youtube: { hint: "Official platforms. This is where the sound comes from first." },
      soundcloud: { hint: "The backup option. The rule above can put it first." },
      bandcamp: { hint: "Already works via a direct link. Search will come later." },
      searchGroup: "Search",
      searchScope: {
        title: "What search shows",
        hint: "\"Everything\" — we search both our own base and the platforms: more results, longer wait. \"Our base only\" — instant results, but not everything will be found. Local files are searched in the Library.",
        all: "Everything",
        catalogOnly: "Our base only",
      },
      instantSearch: { title: "Instant search", hint: "Results appear as you type. Turn this off and search runs only when you press Enter." },
      searchGrouping: {
        title: "Group remixes and versions",
        hint: "Remixes, sped-up edits and covers gather under the original's card. Liking that card likes the original, and the versions unfold separately.",
      },
      directLocal: {
        title: "Direct and local sources",
        hint: "Files, folders and links are added in the Library.",
        value: "Library → Local / By link",
      },
    },

    // ── Тексты ───────────────────────────────────────────────────────
    lyrics: {
      displayGroup: "Display",
      synced: { title: "Synced lyrics", hint: "Lines light up in time with the music. Turn this off and the lyrics become a plain list." },
      autoScroll: { title: "Auto-scroll", hint: "The lyrics follow the current line on their own. Turn this off to scroll freely." },
      endNote: { title: "End note", hint: "A decorative music note at the very bottom of the lyrics." },
      karaokeSize: { title: "Karaoke text size", hint: "Size of the lyrics line in listening mode." },
      understandingGroup: "Understanding",
      translation: { title: "Translation", hint: "Translates lines into a chosen language. Coming later." },
      meaningMode: { title: "Meaning mode", hint: "Lines with explanations get a dotted underline — a click opens the meaning card." },
    },

    // ── Библиотека ───────────────────────────────────────────────────
    library: {
      localFiles: { title: "Local files", hint: "Files and folders are added in the Library, on the \"Local\" tab.", value: "Library → Local" },
      cache: {
        title: "Saved while listening",
        hintFilled: "Using {size} — {files} file(s). Clearing doesn't touch offline downloads.",
        hintEmpty: "Tracks are saved to disk as you listen and later play without loading. When space runs out, the oldest are removed automatically.",
        limitLabel: "Space limit",
        clear: "Clear",
      },
      offline: {
        title: "Offline downloads",
        hint: "Tracks saved with the \"Save offline\" button. They stay until you remove them yourself, and survive clearing.",
        value: "{n} tr. · {size}",
        empty: "0 tracks",
      },
      importPlaylists: { title: "Import playlists", hint: "Playlists from Spotify, YouTube Music and Apple Music are brought over with a button in the Library.", value: "Library → Import" },
      stats: { title: "Statistics", hint: "Which blocks show on the statistics page, their order, and the default period." },
      units: { gb: "{n} GB", mb: "{n} MB" },
    },

    // ── Интеграции (сама вкладка, помимо discord/lastfm/listenbrainz выше) ─
    // (остальные ключи самой вкладки — mediaKeys уже в integrations.mediaKeys)

    // ── Хоткеи ───────────────────────────────────────────────────────
    hotkeys: {
      conflictHint: "⚠ This combination is already taken by another action.",
      pressKey: "Press a key…",
      help: { title: "Help / close", hint: "These keys are fixed and can't be reassigned." },
      resetAll: "Reset all",
    },

    // ── Расширения ───────────────────────────────────────────────────
    extensions: {
      builtInGroup: "Built-in",
      // Строка-указатель: сами ряды переехали во Внешний вид → Кастомизация
      // (19.07, спека §7); подсказка говорит, где они теперь, а не почему.
      visualizerMoved: {
        title: "Visualizer and bass response",
        hint: "These settings now live in Appearance → Customize. This row takes you there.",
      },
      visualizer: { title: "Visualizer", hint: "A picture moving in time with the music, in listening mode." },
      visualizerKind: { title: "Visualizer style", hint: "Bars jump with the sound's frequencies, the wave follows its shape.", bars: "Bars", wave: "Wave" },
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
      visualizerBars: { title: "Bar density", hint: "Fewer bars — chunkier and calmer, more — finer detail." },
      visualizerBarFill: { title: "Bar width", hint: "How much of its row each bar takes: less — airier, 100% — a solid strip." },
      visualizerBarRound: { title: "Bar rounding", hint: "At 0% the bars are rectangles, at 100% — round like pills." },
      visualizerBarCalm: { title: "Fall smoothness", hint: "Hits land instantly, while the bars sink gently: the higher, the slower." },
      visualizerMirror: { title: "Mirrored spectrum", hint: "Bass in the centre, highs at the edges — symmetric both ways." },
      visualizerWaveSmooth: { title: "Wave softness", hint: "Smooths the line: at 0% it's sharp and jagged, higher — softer." },
      visualizerWaveThick: { title: "Wave thickness", hint: "From a thin stroke to a dense ribbon." },
      visualizerWaveCalm: { title: "Motion smoothness", hint: "At 0% the wave changes shape instantly, higher — it moves lazily, with inertia." },
      visualizerWaveFill: { title: "Fill", hint: "A translucent fill appears under the line — the wave looks denser." },
      visualizerWaveAmp: { title: "Swing", hint: "How high the wave rises." },
      visualizerOpacity: { title: "Intensity", hint: "How noticeable the visualizer is: lower — ambient, higher — vivid." },
      bassShake: { title: "Bass shake", hint: "In the fullscreen player, the screen gently pulses in time with the bass." },
      bassShakeStrength: { title: "Shake strength", hint: "At 100% — a gentle pulse, higher — a real shake, at 0% — no shaking." },
      bassSharp: { title: "Response sharpness", hint: "Left — the pulse swells gently, right — it snaps to every bass hit." },
      bassReach: { title: "Sway reach", hint: "How far the picture moves with the bass." },
      externalGroup: "External plugins",
      appOnly: "Only in the app (not in the browser)",
      installFromFile: {
        title: "Install from file",
        hint: "Choose a .muzaplugin file. Before installing, we'll show which permissions the plugin asks for.",
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
      errorLog: { title: "Error log", hint: "{n} entr(ies) — errors from full-access plugins.", clear: "Clear" },
      pluginMarket: { title: "Plugin marketplace", hint: "A catalog of ready-made plugins — installed in one click." },
      themeMarket: { title: "Theme marketplace", hint: "Install other people's themes, or publish your own." },
      pluginInstalled: "Plugin \"{name}\" installed",
      pluginRemoved: "Plugin \"{name}\" removed",
      installDialog: {
        title: "Install \"{name}\"?",
        titleGeneric: "Install plugin",
        wait: "Wait {n}s…",
        fullAccessWarning:
          "This plugin is requesting FULL ACCESS: it will be able to do anything in the app — read and change any data, including your session. It runs as part of Muza itself, with no limits. Only install it if you fully trust the author \"{author}\".",
        trustAuthor: "I understand the risk and trust the author",
        noPermissions: "This plugin doesn't request any special permissions.",
        permissionsAsk: "This plugin requests permissions:",
        network: "Network: {list}",
      },
      restartDialog: {
        title: "Restart Muza?",
        later: "Later",
        restart: "Restart",
        body: "\"{name}\" was turned off, but a full-access plugin keeps running until the app restarts.",
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
      autostart: { title: "Launch at Windows startup", hint: "Muza opens on its own when the computer starts." },
      tray: { title: "Tray icon", hint: "A Muza icon appears in the notification area — clicking it opens the window." },
      closeAction: {
        title: "On window close",
        hintTray: "\"Minimize\" hides the window to the tray — the music keeps playing.",
        hintNoTray: "While there's no tray icon, closing the window always exits the app.",
        minimize: "Minimize",
        exit: "Exit",
      },
      update: {
        title: "Auto-update",
        hint: "Muza checks for new versions and updates itself.",
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
      miniPlayer: { title: "Mini player", hint: "A small window on top of the others: cover, playback buttons and like. Drag it by the background." },
      stage0: {
        rowTitle: "Track loading diagnostics",
        rowHint: "Shows how tracks are being opened, with a log of recent hiccups.",
        statusOk: "all good",
        statusPaused: "slower than usual",
        title: "Track loading diagnostics",
        ok: "The fast path is working",
        okHint: "Tracks open directly, no delays in sight.",
        paused: "Fast path paused until {until}",
        pausedHint: "A few failures in a row — tracks temporarily open the backup way, which is slower. The pause lifts by itself.",
        refresh: "Refresh",
        empty: "No hiccups — the log is empty.",
      },
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
      website: { title: "Website", hint: "muza.lol — the Muza website and web player." },
      sourceCode: { title: "Client source code", hint: "github.com/EntonioDMI/muza-client" },
    },

    // ── Приватность / данные аккаунта (под-экран) ─────────────────────
    privacy: {
      title: "Account data",
      export: {
        title: "Export data",
        hint: "Profile, likes, history and playlists download as one file. No passwords in it.",
        busy: "Gathering…",
        button: "Export file",
      },
      exported: "Data exported",
      deleteAccount: {
        title: "Delete account",
        hint: "Permanently deletes likes, playlists, history and shared access. Local files and downloaded music stay on the device.",
        button: "Delete…",
      },
      accountDeleted: "Account deleted",
      privacyDoc: {
        title: "How Muza uses data",
        hint: "In plain terms: what we collect, why, and how to delete it.",
      },
      deleteDialog: {
        title: "Delete your account for good?",
        body: "We will delete everything: likes, playlists, history, shared access and published themes. This can't be undone. Local files and downloaded music stay on the device.",
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
      // мультивыбор (2026-07-20): в плейлист уезжает пачка
      titleWithCount: "Add to playlist: {count} tracks",
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
        "Reassign keys in Settings. You can drag a track out as a file once it's saved on this computer; another way — drag the cover off the player bar.",
    },
  },

  // ── Контекстные меню (App.tsx: трек/каталожный трек/плейлист) ───────
  menu: {
    addToPlaylist: "Add to playlist",
    catalog: {
      // ПКМ везде (2026-07-20): очередь-действия первыми — самые частые
      playNext: "Play next",
      queue: "Add to queue",
      radio: "Radio from this track",
      like: "Add to Favorites",
      unlike: "Remove from Favorites",
      addToJam: "Add to Jam",
      share: "Share",
      versions: "Sources",
      // «Заменить версию» (2026-07-18): плейлисты + Любимое, НЕ Поиск/Хоум
      replaceVersion: "Replace version",
      saveOffline: "Save offline",
      removeOffline: "Remove from offline",
    },
    playlist: {
      open: "Open",
      play: "Play",
      playNext: "Play next",
      queue: "Add to queue",
      rename: "Rename",
      changeIcon: "Change icon",
      delete: "Delete playlist",
      // Публичные плейлисты (2026-07-17): подписка follower-а
      unfollow: "Remove from library",
    },
    // Трек внутри плейлиста: перестановка без перетаскивания (2026-07-20)
    playlistTrack: {
      toStart: "To top of playlist",
      toEnd: "To bottom of playlist",
    },
    // ПКМ по строке очереди (2026-07-20)
    queue: {
      play: "Play",
      playNext: "Play next",
      remove: "Remove from queue",
      clearAfter: "Clear everything after this",
    },
    // ПКМ по пустому месту медиатеки (2026-07-20)
    library: {
      createPlaylist: "Create playlist",
      addLink: "Add track by link",
      importPlaylist: "Import playlist",
      joinCode: "Enter a code",
      showInFolder: "Show in folder",
    },
    // Множественное выделение (2026-07-20)
    selection: {
      count: "Selected: {count}",
      enter: "Select tracks",
      enterPlaylists: "Select playlists",
      all: "Select all",
      clear: "Clear selection",
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
      // «Играть следующим» из контекстного меню (2026-07-20)
      playNext: "Playing next: {title}",
      playlistNext: "Playlist will play next",
      playlistAdded: "Playlist added to the queue",
      selectionNext: "Playing next: {count} tracks",
      selectionAdded: "To queue: {count} tracks",
      removedMany: "Removed from queue: {count} tracks",
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
      likedMany: "Added to Favorites: {count} tracks",
      already: "This track is already in Favorites",
      removed: "Removed from Favorites",
      syncFailed: "Couldn't sync the like",
      versionReplaced: "Version replaced in Favorites",
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
      addedTracks: "Added to \"{name}\": {count} tracks",
      addFailed: "Couldn't add",
      joined: "You're in the playlist \"{name}\" (from {owner})",
      versionReplaced: "Version replaced",
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
    buffering: "Getting the track ready…",
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
      // Публичные плейлисты (2026-07-17): живая подписка / скрыт владельцем
      followedFrom: "{count} tr. · by {owner}",
      hiddenByOwner: "hidden by the owner",
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
    hideLyrics: "Hide lyrics",
    showLyrics: "Show lyrics",
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
    telemetry: {
      label: "Send anonymous statistics",
      more: "Details",
      title: "What gets sent",
      intro: "Only anonymized numbers — they can't be tied to you. Three things:",
      item1: "Player counters: how many tracks started fine vs failed, app version.",
      item2: "Error reports: the error text, scrubbed of paths and names. No stack traces or code.",
      item3: "An \"app was opened\" mark: once a day — date, version, OS (Windows/macOS/Linux).",
      never: "Never sent: your name, email, IP address, your tracks, playlists or listening history.",
      settingsNote: "You can turn this off anytime: Settings → Account.",
    },
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
    // Публичные плейлисты (2026-07-17): лесенка видимости + код PL_…
    shareVisibility: {
      title: "Share playlist",
      done: "Done",
      stepPrivate: "Private",
      stepPrivateHint: "only you (and co-authors) can see it",
      stepCode: "By code",
      stepCodeHint: "open to anyone you send the code to",
      stepPublic: "Public",
      stepPublicHint: "visible to everyone in Muza search, the code works too",
      codeLabel: "Access code",
      codeInactive: "the code is inactive while the playlist is private",
      codeHint: "The code goes right into the search bar",
      copy: "Copy code",
      copied: "Code copied",
      followers: "Listeners: {count}",
      changeFailed: "Couldn't change visibility",
      // @Адрес (2026-07-17): уникальное имя публичного плейлиста
      handleLabel: "@Address",
      handlePlaceholder: "e.g. fonk_v_tachku",
      handleSave: "Save",
      handleHint: "Unique name: tell a friend — they type @name into search",
      handleFormat: "Only latin letters, digits and _ (3–32 chars)",
      handleFrozen: "the address is frozen while the playlist isn't public",
      handleSaved: "Address saved",
      handleCopied: "Address copied",
    },
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
    // «Заменить версию» (2026-07-18): подмена трека на другую загрузку той же
    // песни (отдельный трек каталога) — не путать с versions (источники).
    replaceVersion: {
      titleWithTrack: "\"{title}\" — replace version",
      loading: "Looking for other uploads…",
      loadingHint: "Searching providers — up to ~10 seconds",
      loadFailed: "Couldn't find candidates",
      empty: "No other uploads of this song found.",
      matched: "likely the same song",
      replaceFailed: "Couldn't replace",
      preview: "Preview",
      secondsShort: "s",
      footerHint:
        "The same song uploaded by other channels — often under someone else's name. Length difference vs the current version is in brackets; use ▶ to check by ear. Replacing applies only here; likes and history stay with the old track.",
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
      preview: {
        trackCount: "{count} tr.",
        // Не «предупреждение об опасности»: импорт исправен и идёт как шёл.
        // Говорим ЧТО произойдёт и что это нормально — иначе человек примет
        // расхождение за баг (15.07 владелец потерял на этом полдня и подал
        // два ложных баг-репорта). Без «algotorial» и прочей кухни Spotify:
        // термин ничего не объясняет тому, кто просто импортирует плейлист.
        personalized:
          "Spotify tailors its own playlists to each listener. Muza imports the version everyone gets, so a few tracks may differ from what you see in Spotify. That's normal.",
      },
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
      coverTileAria: "This track's cover",
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
      manifestRejected: "Couldn't install the plugin: {reason}",
      scriptRejected: "Plugin code rejected: {reason}",
      cssRejected: "Plugin CSS rejected: {reason}",
    },
  },
  views: viewsEn,
  media: mediaEn,
};
