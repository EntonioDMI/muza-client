/** Индекс поиска по настройкам (спека 19.07 §4.2): при ~130 рядах и росте к
 *  200 ни одна структура не живёт без поиска — это ответ на «где искать».
 *
 *  Каждая запись — один ряд SettingsView: в каком табе и суб-панели живёт,
 *  i18n-ключи названия/подсказки и синонимы (оба языка — человек пишет
 *  «фон», «background» или «обои», не зная наших названий).
 *
 *  Дисциплина: НОВЫЙ SettingRow в SettingsView = НОВАЯ запись здесь (волны
 *  3а-3д добавляют свои). Поиск ищет по переведённым названию + подсказке +
 *  синонимам, так что запись без syn — уже находимая.
 *
 *  Прокрутка к ряду — по data-rowtitle, который SettingRow вешает сам из
 *  пропа title: ручной разметки 130 рядов нет и не нужно. */

export interface SettingsIndexEntry {
  /** Ключ таба из SETTINGS_TAB_KEYS (SettingsView). */
  tab: string;
  /** Суб-панель внутри таба (setSub) либо null — ряд лежит прямо в табе. */
  sub: string | null;
  /** i18n-ключ названия ряда. */
  titleKey: string;
  /** i18n-ключ подсказки; отсутствующий в словаре ключ просто не ищется. */
  hintKey: string;
  /** Синонимы на обоих языках, нижний регистр. */
  syn?: string[];
}

const e = (
  tab: string,
  sub: string | null,
  base: string,
  syn?: string[],
  keys: { title?: string; hint?: string } = {},
): SettingsIndexEntry => ({
  tab,
  sub,
  titleKey: keys.title ?? `${base}.title`,
  hintKey: keys.hint ?? `${base}.hint`,
  ...(syn ? { syn } : {}),
});

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  // ── Аккаунт ────────────────────────────────────────────────────────────
  e("account", null, "settings.account.profile", ["ник", "имя", "аватар", "профиль", "nickname", "avatar"]),
  e("account", null, "settings.account.email", ["почта", "email", "мыло"]),
  e("account", null, "settings.account.password", ["пароль", "password"]),
  e("account", null, "settings.account.sessions", ["сессии", "устройства", "devices"], { title: "settings.account.sessions.rowTitle", hint: "settings.account.sessions.rowHint" }),
  e("account", null, "settings.account.telemetry", ["статистика", "телеметрия", "анонимно", "privacy"]),
  e("account", null, "settings.account.dataDoc", ["данные", "хранение"]),
  e("account", null, "settings.account.exportOrDelete", ["экспорт", "удалить аккаунт", "delete account"]),
  e("account", "privacy", "settings.privacy.export", ["экспорт", "выгрузка", "export"]),
  e("account", "privacy", "settings.privacy.deleteAccount", ["удалить аккаунт", "delete account"]),
  e("account", "privacy", "settings.privacy.privacyDoc", ["приватность", "privacy"]),
  // ── Внешний вид ───────────────────────────────────────────────────────
  e("appearance", null, "settings.appearance.language", ["язык", "language", "русский", "english"]),
  e("appearance", null, "settings.appearance.theme", ["тема", "светлая", "тёмная", "dark", "light"]),
  e("appearance", null, "settings.appearance.accent", ["акцент", "цвет", "color", "accent"]),
  e("appearance", null, "settings.appearance.radius", ["углы", "скругление", "радиус", "corners"]),
  e("appearance", null, "settings.appearance.glass", ["стекло", "прозрачность", "блюр", "glass", "blur"]),
  e("appearance", null, "settings.appearance.background", ["фон", "обои", "background", "wallpaper"]),
  e("appearance", null, "settings.appearance.scale", ["масштаб", "зум", "scale", "zoom"]),
  e("appearance", null, "settings.appearance.customize", ["кастомизация", "тонкая настройка", "customize"]),
  e("appearance", "customize", "settings.customize.glass.panelBlur", ["блюр", "размытие", "blur"]),
  e("appearance", "customize", "settings.customize.glass.bgBlur", ["размытие фона", "blur"]),
  e("appearance", "customize", "settings.customize.glass.zones", ["зоны", "стекло"]),
  e("appearance", "customize", "settings.customize.glass.zonePlayer"),
  e("appearance", "customize", "settings.customize.glass.zoneMenu"),
  e("appearance", "customize", "settings.customize.glass.zoneDialog"),
  e("appearance", "customize", "settings.customize.glass.zoneSidebar"),
  e("appearance", "customize", "settings.customize.glass.zoneNowPlaying"),
  e("appearance", "customize", "settings.customize.colors.baseBg", ["фон", "подложка", "amoled"]),
  e("appearance", "customize", "settings.customize.colors.accentRoles", ["акцент", "роли"]),
  e("appearance", "customize", "settings.customize.colors.accentPlay"),
  e("appearance", "customize", "settings.customize.colors.accentSlider"),
  e("appearance", "customize", "settings.customize.colors.accentActive"),
  e("appearance", "customize", "settings.customize.colors.textDim", ["тусклость", "яркость текста", "контраст"]),
  e("appearance", "customize", "settings.customize.shape.tiles", ["плитки", "углы", "tiles"]),
  e("appearance", "customize", "settings.customize.shape.buttons", ["кнопки", "углы"]),
  e("appearance", "customize", "settings.customize.shape.tabs", ["переключатели", "углы"]),
  e("appearance", "customize", "settings.customize.shape.fields", ["поля", "углы"]),
  e("appearance", "customize", "settings.customize.shape.panels", ["панели", "углы"]),
  e("appearance", "customize", "settings.customize.shape.density", ["плотность", "density", "компактно"]),
  e("appearance", "customize", "settings.customize.shape.sidebarWidth", ["сайдбар", "ширина", "sidebar"]),
  e("appearance", "customize", "settings.customize.shape.nowPlayingWidth", ["сейчас играет", "ширина"]),
  e("appearance", "customize", "settings.customize.typography.fontScale", ["шрифт", "размер текста", "font"]),
  e("appearance", "customize", "settings.customize.typography.lineSpacing", ["межстрочный", "интервал"]),
  e("appearance", "customize", "settings.customize.typography.karaokeSize", ["караоке", "текст песни"]),
  e("appearance", "customize", "settings.customize.motion.anims", ["анимации", "движение", "animations"]),
  e("appearance", "customize", "settings.customize.motion.animSpeed", ["скорость анимаций", "speed"]),
  e("appearance", "customize", "settings.customize.layout.barButtons", ["кнопки плеера", "бар"]),
  e("appearance", "customize", "settings.customize.layout.navTabs", ["навигация", "меню", "разделы"]),
  e("appearance", "customize", "settings.customize.layout.rowCover", ["обложка", "строка трека"]),
  e("appearance", "customize", "settings.customize.layout.rowDuration", ["длительность", "строка трека"]),
  e("appearance", "customize", "settings.customize.background.type", ["фон", "обои", "анимированный", "background", "градиент"]),
  e("appearance", "customize", "settings.customize.background.invert", ["направление", "вращение"]),
  e("appearance", "customize", "settings.customize.background.imageUrl", ["картинка", "изображение", "ссылка"]),
  e("appearance", "customize", "settings.customize.background.dim", ["затемнение", "dim"]),
  e("appearance", "customize", "settings.customize.background.tint", ["оттенок", "tint"]),
  e("appearance", "customize", "settings.customize.behavior.doubleClick", ["двойной клик", "дабл-клик"]),
  e("appearance", "customize", "settings.customize.behavior.startView", ["стартовый экран", "запуск"]),
  e("appearance", "customize", "settings.customize.themes.saveAs", ["тема", "сохранить тему", "theme"]),
  e("appearance", "customize", "settings.customize.themes.importRow", ["вставить тему", "импорт темы"]),
  e("appearance", "customize", "settings.customize.themes.marketRow", ["маркетплейс", "темы", "market"]),
  e("appearance", "customize", "settings.customize.css.toggle", ["css", "свои стили", "custom css"]),
  // ── Воспроизведение ───────────────────────────────────────────────────
  e("playback", null, "settings.playback.crossfade", ["кроссфейд", "плавный переход", "crossfade"]),
  e("playback", null, "settings.playback.crossfade.duration", ["кроссфейд", "секунды"]),
  e("playback", null, "settings.playback.gapless", ["без пауз", "gapless", "стык"]),
  e("playback", null, "settings.playback.equalizer", ["эквалайзер", "eq", "частоты", "басы"], { title: "settings.playback.equalizer.rowTitle", hint: "settings.playback.equalizer.rowHint" }),
  e("playback", "equalizer", "settings.equalizer.enable", ["эквалайзер", "eq"]),
  e("playback", null, "settings.playback.normalize", ["громкость", "выравнивание", "normalize"]),
  e("playback", null, "settings.playback.speedSteps", ["скорость", "1.5x", "2x", "speed"]),
  e("playback", null, "settings.playback.radioEndless", ["радио", "бесконечно", "radio"]),
  e("playback", null, "settings.playback.recs", ["рекомендации", "recs"]),
  e("playback", null, "settings.playback.recs.novelty", ["новизна", "рекомендации"]),
  e("playback", null, "settings.playback.recs.repeats", ["повторы", "рекомендации"]),
  e("playback", null, "settings.playback.resumePosition", ["продолжить", "позиция", "resume"]),
  e("playback", null, "settings.playback.streamQuality", ["качество", "трафик", "quality"]),
  e("playback", null, "settings.playback.sleepTimer", ["таймер сна", "sleep", "луна"]),
  // ── Источники ─────────────────────────────────────────────────────────
  e("sources", null, "settings.sources.policy", ["источники", "soundcloud", "youtube", "откуда"]),
  e("sources", null, "settings.sources.searchScope", ["поиск", "каталог", "где искать"]),
  e("sources", null, "settings.sources.instantSearch", ["мгновенный поиск", "instant"]),
  e("sources", null, "settings.sources.searchGrouping", ["группировка", "ремиксы", "версии"]),
  e("sources", null, "settings.sources.directLocal", ["локальные", "файлы", "ссылки", "local"]),
  // ── Тексты песен ──────────────────────────────────────────────────────
  e("lyrics", null, "settings.lyrics.synced", ["синхронный текст", "караоке", "lyrics"]),
  e("lyrics", null, "settings.lyrics.autoScroll", ["автоскролл", "прокрутка текста"]),
  e("lyrics", null, "settings.lyrics.endNote", ["нотка", "конец текста"]),
  e("lyrics", null, "settings.lyrics.karaokeSize", ["караоке", "размер строки"]),
  e("lyrics", null, "settings.lyrics.translation", ["перевод", "translation"]),
  e("lyrics", null, "settings.lyrics.meaningMode", ["смысл", "значение", "meaning"]),
  // ── Медиатека ─────────────────────────────────────────────────────────
  e("library", null, "settings.library.localFiles", ["локальные файлы", "папки", "folders"]),
  e("library", null, "settings.library.cache", ["скачанное", "кэш", "место", "диск", "cache"]),
  e("library", null, "settings.library.offline", ["оффлайн", "без интернета", "offline"]),
  e("library", null, "settings.library.importPlaylists", ["импорт", "spotify", "яндекс", "перенос"]),
  e("library", null, "settings.library.stats", ["статистика", "итоги", "wrapped"]),
  e("library", "stats", "settings.stats.period", ["период", "неделя", "месяц", "год"]),
  // ── Интеграции ────────────────────────────────────────────────────────
  e("integrations", null, "settings.integrations.discord", ["дискорд", "discord", "статус"], { title: "settings.integrations.discord.rowTitle", hint: "settings.integrations.discord.rowHint" }),
  e("integrations", "discord", "settings.integrations.discord.enable", ["дискорд", "discord"]),
  e("integrations", "discord", "settings.integrations.discord.cover", ["обложка", "discord"]),
  e("integrations", "discord", "settings.integrations.discord.line1"),
  e("integrations", "discord", "settings.integrations.discord.line2"),
  e("integrations", "discord", "settings.integrations.discord.btnOn", ["кнопка", "discord"]),
  e("integrations", "discord", "settings.integrations.discord.btnLabel"),
  e("integrations", "discord", "settings.integrations.discord.btnUrl"),
  e("integrations", null, "settings.integrations.lastfm", ["last.fm", "скробблинг", "scrobble"]),
  e("integrations", null, "settings.integrations.listenbrainz", ["listenbrainz", "скробблинг"]),
  e("integrations", null, "settings.integrations.mediaKeys", ["медиа-клавиши", "клавиатура", "media keys"]),
  // ── Горячие клавиши ───────────────────────────────────────────────────
  e("hotkeys", null, "settings.hotkeys.help", ["горячие клавиши", "хоткеи", "shortcuts", "hotkeys"]),
  // ── Расширения ────────────────────────────────────────────────────────
  e("extensions", null, "settings.extensions.visualizer", ["визуализатор", "волна", "бары", "visualizer"]),
  e("extensions", null, "settings.extensions.visualizerKind", ["визуализатор", "вид"]),
  e("extensions", null, "settings.extensions.visualizerMirror", ["зеркало", "визуализатор"]),
  e("extensions", null, "settings.extensions.bassShake", ["бас", "тряска", "пульсация", "bass"]),
  e("extensions", null, "settings.extensions.bassShakeStrength", ["бас", "сила"]),
  e("extensions", null, "settings.extensions.installFromFile", ["установить плагин", "файл"]),
  e("extensions", null, "settings.extensions.installed", ["плагины", "установленные", "plugins"]),
  e("extensions", null, "settings.extensions.errorLog", ["ошибки плагинов", "журнал"]),
  e("extensions", null, "settings.extensions.pluginMarket", ["маркетплейс", "плагины"]),
  e("extensions", null, "settings.extensions.themeMarket", ["маркетплейс", "темы"]),
  // ── Система ───────────────────────────────────────────────────────────
  e("system", null, "settings.system.autostart", ["автозапуск", "старт с windows", "autostart"]),
  e("system", null, "settings.system.tray", ["трей", "область уведомлений", "tray"]),
  e("system", null, "settings.system.closeAction", ["закрытие", "крестик", "свернуть"]),
  e("system", null, "settings.system.update", ["обновление", "версия", "update"]),
  e("system", null, "settings.system.miniPlayer", ["мини-плеер", "маленькое окно", "miniplayer"]),
  e("system", null, "settings.system.version", ["версия", "version"]),
  e("system", null, "settings.system.licenses", ["лицензии", "licenses"], { title: "settings.system.licenses.rowTitle", hint: "settings.system.licenses.rowHint" }),
  e("system", null, "settings.system.website", ["сайт", "website"]),
  e("system", null, "settings.system.sourceCode", ["исходный код", "github", "source"]),
];

export interface SettingsSearchHit {
  tab: string;
  sub: string | null;
  titleKey: string;
  /** Переведённое название — для рендера результата и data-rowtitle-прокрутки. */
  title: string;
}

/** Поиск: все слова запроса должны найтись в «название + подсказка + синонимы».
 *  t обязан возвращать ключ при отсутствии перевода (конвенция translate) —
 *  такой результат не индексируется. */
export function searchSettings(query: string, t: (key: string) => string): SettingsSearchHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: SettingsSearchHit[] = [];
  for (const entry of SETTINGS_INDEX) {
    const title = t(entry.titleKey);
    if (title === entry.titleKey) continue; // ключа нет в словаре — ряда нет
    const hint = t(entry.hintKey);
    const hay = [title, hint === entry.hintKey ? "" : hint, ...(entry.syn ?? [])].join(" ").toLowerCase();
    if (words.every((w) => hay.includes(w))) hits.push({ tab: entry.tab, sub: entry.sub, titleKey: entry.titleKey, title });
  }
  return hits.slice(0, 20);
}
