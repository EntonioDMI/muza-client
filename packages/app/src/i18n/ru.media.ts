/** i18n-фрагмент (русский): строки player/* и lib/* (зона media, эпик W5 i18n).
 *  Пара к en.media.ts. Тип `typeof mediaEn` держит форму 1:1 с английским. */
import { mediaEn } from "./en.media";

export const mediaRu: typeof mediaEn = {
  player: {
    errors: {
      playFailed: "Не удалось воспроизвести файл",
      playbackDidNotStart: "Воспроизведение не стартовало",
      localFileNotFound: "Локальный файл не найден на этом устройстве",
      desktopOnly: "Треки из каталога играют только в приложении Muza на компьютере",
      trackFetchFailed: "Не удалось включить трек",
    },
  },
  jam: {
    hostTrackFetchFailed: "Не удалось получить трек хоста",
    trackAdded: "{by} добавил «{title}» в jam",
    ended: "Jam завершён",
    hostEnded: "Хост завершил jam",
    createFailed: "Не удалось создать jam",
    joinedAs: "Ты в jam у {username}",
    joinFailed: "Не удалось войти в jam",
    left: "Ты вышел из jam",
    addFailed: "Не удалось добавить в jam",
  },
  nav: {
    home: "Главная",
    search: "Поиск",
    favorites: "Любимое",
    library: "Библиотека",
    stats: "Статистика",
  },
  hotkeys: {
    actions: {
      playPause: "Играть / пауза",
      next: "Следующий трек",
      prev: "Предыдущий трек",
      seekFwd: "Перемотка +5 с",
      seekBack: "Перемотка −5 с",
      like: "Лайк",
      mute: "Без звука",
      search: "Поиск",
      navBack: "Назад по вкладкам",
      navForward: "Вперёд по вкладкам",
    },
  },
  engine: {
    errors: {
      localTrackMissing: "Локальный трек: файла нет на этом устройстве",
    },
  },
  barButtons: {
    shuffle: { label: "Перемешать", hint: "Слева от транспорта" },
    repeat: { label: "Повтор", hint: "Справа от транспорта" },
    sleep: { label: "Таймер сна", hint: "Луна: выкл → пресеты → конец трека" },
    speed: { label: "Скорость", hint: "Кнопка «1×», циклит шаги из настроек" },
    equalizer: { label: "Эквалайзер", hint: "Открывает под-экран EQ" },
    lyrics: { label: "Текст", hint: "Панель «Сейчас играет»" },
    jam: { label: "Jam", hint: "Слушать вместе" },
    volume: { label: "Громкость", hint: "Кнопка-mute и слайдер" },
    queue: { label: "Очередь", hint: "Панель очереди" },
    fullscreen: { label: "Во весь экран", hint: "Режим прослушивания" },
  },
  statsBlocks: {
    summary: { label: "Сводка", hint: "Минуты, прослушивания, треки и артисты за период" },
    activity: { label: "Активность", hint: "График по дням или месяцам" },
    rhythm: { label: "Ритм дня", hint: "Распределение по часам суток" },
    top_tracks: { label: "Топ треков", hint: "До десяти самых прослушиваемых" },
    top_artists: { label: "Топ артистов", hint: "По наигранным минутам" },
    streaks: { label: "Серии", hint: "Дни с музыкой подряд" },
    likes: { label: "Лайки", hint: "Добавлено в любимое за период" },
  },
  search: {
    variants: {
      remix: "Ремикс",
      sped_up: "Спидап",
      slowed: "Замедленная",
      mashup: "Мэшап",
      cover: "Кавер",
      live: "Live",
      acoustic: "Acoustic",
      instrumental: "Instrumental",
      karaoke: "Караоке",
      "8d": "8D Audio",
      bass_boosted: "Бас-буст",
      tiktok: "TikTok-версия",
    },
    versions: {
      one: "версия",
      few: "версии",
      many: "версий",
    },
  },
  hour: {
    midnighty: "полуночник",
    earlyBird: "ранняя пташка",
    daytime: "дневной ритм",
    eveningListener: "вечерний слушатель",
  },
  shareCard: {
    // Редизайн 2026-07-17 (плоско, по ДС): карточка — «кадр из приложения»,
    // шапка «Итоги {year}», герой-минуты, пара BigStat артиста. См. shareCard.ts.
    minutesOfMusic: "минут музыки",
    wrappedTitle: "Итоги {year}",
    artistOfYear: "Артист года",
    trackCount: "{count} тр.",
    fromOwner: " · от {owner}",
    errors: {
      canvasBlobFailed: "canvas.toBlob вернул null",
      canvas2dUnavailable: "canvas 2d недоступен",
    },
  },
  share: {
    track: "«{title}» — {artist} · слушаю в Muza · https://muza.lol",
    playlist: "Плейлист «{name}» — {count} тр. · собран в Muza · https://muza.lol",
    wrapped: "Мой {year} в Muza: {minutes} минут музыки, {plays} прослушиваний.{top} · https://muza.lol",
    wrappedTopArtist: " Артист года — {topArtist}.",
  },
  themes: {
    myTheme: "Моя тема",
    theme: "Тема",
  },
  localFiles: {
    pickFilesTitle: "Выбери аудиофайлы",
    audioFilterName: "Аудио",
    pickFolderTitle: "Выбери папку с музыкой",
  },
  dragOut: {
    errors: {
      prepareFailed: "Не удалось подготовить файл",
    },
  },
};
