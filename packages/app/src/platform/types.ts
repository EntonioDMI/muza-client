/** РОЗЕТКА ПЛАТФОРМЫ (Э2 веб-паритета, 2026-08-02).
 *
 *  Зачем. Общий код (@muza/app) обязан собираться и работать в двух местах:
 *  в приложении (Tauri, есть диск, окна, значок у часов) и в браузере (ничего
 *  этого нет). Прямой импорт `@tauri-apps/*` в общем пакете — билет в один
 *  конец: веб такой модуль не соберёт. Поэтому общий код зовёт РОЗЕТКУ —
 *  набор портов с обычными JS-сигнатурами, — а приложение и браузер вставляют
 *  в неё свою ВИЛКУ (apps/desktop/src/platform/desktopAdapter.ts,
 *  apps/web/src/platform/webAdapter.ts).
 *
 *  Главный принцип — ПОЛЯ НЕОБЯЗАТЕЛЬНЫ. Общий код спрашивает «умеешь?»
 *  наличием поля, а НЕ «ты десктоп?»:
 *
 *      const dragOut = useDragOut();
 *      if (!dragOut) return null;      // ← пункта меню просто нет
 *
 *  Поэтому здесь НЕТ поля вроде `kind: "desktop" | "web"` — оно сразу
 *  породило бы `if (platform.kind === "web")`, а это ровно та развилка, от
 *  которой мы уходим: завтра появится третья площадка (мобильный клиент,
 *  чужая оболочка), и каждая такая развилка станет враньём. Умение = наличие
 *  порта, точка.
 *
 *  Что рисовать вместо отсутствующего умения — решает вью, а не розетка:
 *  где-то пункт просто пропадает, где-то (веб, решение владельца 21.07)
 *  показывается витриной за стеклом — components/DesktopOnly.tsx.
 *
 *  ⚠️ В этом файле не должно появиться ни одного импорта из `@tauri-apps/*`,
 *  `next/*` или `import.meta.env` — он живёт в ОБЩЕМ пакете и попадает в оба
 *  бандла. Здесь только типы. */

/** Единственный импорт файла — и он типовой: манифест расширения разбирает
 *  @muza/core, розетка его только переносит от площадки к экрану согласия. */
import type { PluginManifest } from "@muza/core";

/** Трек в терминах выноса файла — ровно то, из чего собирается человеческое
 *  имя файла «Артист - Название.ext». */
export interface TrackFileRef {
  id: string;
  artist: string;
  title: string;
}

/** ВЫНОС ТРЕКА НА РАБОЧИЙ СТОЛ (Alt+перетаскивание строки, перетаскивание
 *  обложки из плеер-бара). Единственный порт этой волны, который РЕАЛЬНО
 *  реализован: у приложения он есть, у браузера — нет и быть не может
 *  (страница не умеет ни отдать файл в проводник, ни узнать путь). */
export interface DragOutPort {
  /** Подготовить файл трека и вернуть путь к нему.
   *  Бросает ЧЕЛОВЕЧЕСКОЕ сообщение (напр. «Трека нет на устройстве…») —
   *  вызывающий показывает его тостом как есть. */
  exportTrackFile(track: TrackFileRef): Promise<string>;
  /** Начать перетаскивание готового файла средствами системы.
   *  Зовётся, пока кнопка мыши ещё зажата — иначе система не подхватит курсор. */
  startFileDrag(path: string): Promise<void>;
}

/** Запись о файле с диска устройства. Форма — как её отдаёт приложение
 *  (`duration_sec` в змеином регистре: это payload из Rust, переименовывать
 *  его без нужды = чинить в двух местах). */
export interface LocalFileEntry {
  hash: string;
  path: string;
  artist: string;
  title: string;
  duration_sec: number;
  available: boolean;
}

/** МУЗЫКА С ДИСКА УСТРОЙСТВА (вкладка «Локальные» медиатеки).
 *
 *  Форма зафиксирована волной экранов 2026-08-02, когда «Медиатека» переехала
 *  в общий пакет и стала первым потребителем. У браузера порта НЕТ и не будет:
 *  страница не знает путей к файлам и не держит их между заходами — поэтому в
 *  вебе вкладки «Локальные» просто нет, а не серая. */
export interface LocalFilesPort {
  /** Что уже знает устройство (вкладка «Локальные»). */
  list(): Promise<LocalFileEntry[]>;
  /** Системный выбор файлов/папки + разбор; null — человек передумал. */
  pickAndScan(kind: "files" | "folder"): Promise<LocalFileEntry[] | null>;
  /** Разбор готового списка путей (файлы бросили в окно). */
  scanPaths(paths: string[]): Promise<LocalFileEntry[]>;
  /** Путь к файлу по его отпечатку; null — на этом устройстве файла нет. */
  resolvePath(hash: string): Promise<string | null>;
  /** Забыть файл (из списка устройства, сам файл на диске остаётся). */
  forget(hash: string): Promise<void>;
  /** Отпечаток файла → id того же трека на сервере. Карта живёт НА УСТРОЙСТВЕ
   *  (файлы device-bound), поэтому она часть порта, а не общего кода: без неё
   *  файл нельзя ни сыграть общим путём, ни положить в плейлист. */
  serverIds(): Record<string, string>;
  /** Запомнить серверный id — после того, как теги файла ушли на сервер. */
  rememberServerId(hash: string, trackId: string): void;
  /** Показать файл в системном обозревателе. Метода нет — пункта «Показать в
   *  папке» нет вовсе (в браузере такого действия не существует). */
  reveal?(path: string): Promise<void>;
  /** Подписка на файлы, брошенные В окно. Возвращает отписку.
   *  Веб этого поля не получит: страница видит содержимое, но не пути. */
  onFilesDropped?(handler: (paths: string[]) => void): () => void;
}

/** ЧЕРНОВИК. СЛУШАТЬ БЕЗ СЕТИ (закреплённые треки лежат на устройстве). */
export interface OfflinePort {
  /** Идентификаторы закреплённых треков. */
  pinnedTrackIds(): Promise<string[]>;
  /** Закрепить/открепить трек на этом устройстве. */
  setPinned(trackId: string, pinned: boolean): Promise<void>;
  /** Сколько места занято, в байтах (для экрана «Хранилище»). */
  storageUsedBytes?(): Promise<number>;
}

/** ЧЕРНОВИК. УПРАВЛЕНИЕ ОКНОМ. Вкладке браузера почти ничего из этого не
 *  доступно, поэтому у веба порта не будет вовсе. */
export interface WindowPort {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  /** Держать поверх других окон. */
  setAlwaysOnTop?(on: boolean): Promise<void>;
  /** Маленькое окно плеера поверх всего. */
  showMiniPlayer?(): Promise<void>;
  hideMiniPlayer?(): Promise<void>;
}

/** СОХРАНИТЬ КАРТИНКУ ФАЙЛОМ (карточка «Поделиться» → «Сохранить PNG»).
 *  Приложение спрашивает системным окном «куда сохранить» и пишет файл на
 *  диск. У браузера порта нет: страница не выбирает место на диске, поэтому
 *  кнопки «Сохранить PNG» там просто не появляется (картинку можно
 *  скопировать — это умеют обе площадки).
 *
 *  Заведён волной «экраны» (2026-08-02) вместе с первым потребителем —
 *  packages/app/src/shell/ShareDialog.tsx: до неё диалог звал Tauri напрямую
 *  и потому не мог переехать в общий пакет. */
export interface SaveImagePort {
  /** Спросить место и сохранить картинку. false — человек закрыл выбор
   *  места (это не ошибка, сообщать не о чем). Бросает ЧЕЛОВЕЧЕСКОЕ
   *  сообщение, если записать не удалось. */
  savePng(suggestedName: string, png: Blob): Promise<boolean>;
}

/** ЧТО УСТРОЙСТВО УЖЕ ПОДГОТОВИЛО ДЛЯ ТРЕКА (готовый файл, разобранные
 *  источники). Нужен ровно там, где выбор другой версии делает
 *  подготовленное неверным: без этого дальше играло бы старое.
 *  Браузер ничего заранее не готовит — порта у него нет, и шаг пропускается. */
export interface PreparedTracksPort {
  /** Забыть всё, что было подготовлено для этого трека. */
  forget(trackId: string): Promise<void>;
}

/** СИСТЕМНОЕ ОКРУЖЕНИЕ. Единственный метод, который умеют ОБЕ площадки, —
 *  открыть ссылку снаружи; остальное необязательно ПОМЕТОДНО, потому что
 *  умения тут разной судьбы: браузер откроет вкладку, но никогда не заведёт
 *  запуск вместе с системой. */
export interface SystemPort {
  /** Открыть ссылку снаружи приложения (системный браузер / новая вкладка). */
  openExternal(url: string): Promise<void>;
  /** Запускать вместе с системой. */
  setAutostart?(on: boolean): Promise<void>;
  /** Реальное состояние автозапуска; null — узнать не удалось. */
  autostartEnabled?(): Promise<boolean | null>;
  /** Значок у часов + «закрыть = свернуть». */
  configureTray?(visible: boolean, closeToTray: boolean): Promise<void>;
}

/* ══ Порты экрана настроек (волна «настройки», 2026-08-02) ═══════════════
 *
 *  Экран настроек — самый «системный» экран продукта: он трогал Tauri в
 *  двенадцати местах (обновление, расширения, место на диске, диагностика,
 *  Discord, устройства вывода, версия, сохранение файла…). Из-за этого он
 *  единственный не мог переехать в общий пакет вместе с остальными экранами.
 *
 *  Порты ниже — ровно те двенадцать мест, ничего сверх. Правило прежнее и
 *  здесь особенно жёсткое: НЕТ ПОРТА — НЕТ РЯДА. Не серого, не «доступно
 *  только в приложении» — ряда нет вовсе, и поиск по настройкам его тоже не
 *  находит (индекс фильтруется тем же списком умений, lib/settingsIndex.ts).
 *  Причина: строка настройки, которая ничего не настраивает, — это обещание,
 *  которое интерфейс не выполнит. */

/** Найденное обновление программы. */
export interface UpdateFound {
  version: string;
  /** Что изменилось; null — сервер списка не прислал. */
  notes: string | null;
  /** Скачать, установить и перезапуститься. onProgress: 0..100 либо −1,
   *  когда размер заранее неизвестен. Дальше программа завершается сама —
   *  код после этого вызова не выполняется. */
  install(onProgress: (pct: number) => void): Promise<void>;
}

/** ОБНОВЛЕНИЕ ПРОГРАММЫ ИЗНУТРИ НЕЁ САМОЙ. У вкладки браузера порта нет и не
 *  будет: страница обновляется перезагрузкой, ряда «Обновление» там нет. */
export interface UpdatesPort {
  /** null — обновлений нет. Бросает, когда проверить не удалось (нет сети). */
  check(): Promise<UpdateFound | null>;
}

/** СВЕДЕНИЯ О САМОЙ ПРОГРАММЕ (ряд «Версия»). У страницы версии сборки нет —
 *  ряда тоже. */
export interface AppInfoPort {
  version(): Promise<string>;
}

/** Сколько места занято подготовленными файлами. */
export interface StoredMediaStats {
  bytes: number;
  files: number;
  /** Из них оставлено «слушать без сети». */
  pinnedBytes: number;
  pinnedFiles: number;
}

/** ФАЙЛЫ, ПОДГОТОВЛЕННЫЕ ЗАРАНЕЕ (ряды «Скачанное» и «Слушать без сети»).
 *  Отдельно от OfflinePort: тот про «закрепить трек», этот — про место на
 *  диске и кнопку «очистить». */
export interface StoredMediaPort {
  stats(): Promise<StoredMediaStats>;
  clear(): Promise<void>;
}

/** Событие журнала подготовки — текст УЖЕ человеческий, показывается как есть. */
export interface EngineHealthEvent {
  at_ms: number;
  text: string;
}

/** Снимок предохранителей подготовки: они срабатывают молча, и без этого
 *  снимка жалоба «стало медленно» неразбираема. Имена полей в змеином
 *  регистре — это payload с Rust-стороны, переименование чинилось бы в двух
 *  местах (тот же довод, что у LocalFileEntry.duration_sec выше). */
export interface EngineHealth {
  cooldown_until_ms: number | null;
  consecutive_fails: number;
  sc_key_ready: boolean;
  events: EngineHealthEvent[];
}

/** Как быстро прошёл путь «клик → звук». null у фазы = её не было.
 *  Поля-моменты считаются от клика; разности между ними — это фазы, и считает
 *  их площадка (см. startSummary), а не экран. */
export interface TrackStartRecord {
  trackId: string;
  title: string;
  reason: string;
  at: number;
  sourcesMs: number | null;
  urlMs: number | null;
  path: "stream" | "resolve" | "preloaded" | null;
  playCallMs: number | null;
  soundMs: number | null;
  error: string | null;
  /** Момент, когда старый трек заглушён. От него до soundMs — ТИШИНА, то есть
   *  та самая задержка, которую человек и слышит. */
  silenceMs?: number | null;
  /** Класс прогона (провайдер, холодный старт) — по нему складывается сводка. */
  cls?: string | null;
  /** Первый старт после запуска программы. */
  cold?: boolean;
  /** Отметки изнутри добычи: [метка, сколько заняла эта работа в мс].
   *  Поле НЕобязательное — записи без него обязаны читаться как есть. */
  timings?: readonly (readonly [string, number])[];
}

/** Медиана и p90 одной фазы. p90, а не среднее: жалоба звучит как «иногда
 *  долго», а «иногда» — это хвост распределения, среднее его размазывает. */
export interface StartPhaseStat {
  median: number;
  p90: number;
}

/** Сводка по классу прогонов: сколько их было и во что укладываются фазы.
 *  Ключи фаз: sources (сходили за источниками), url (добыли ссылку),
 *  engine (завели движок), bytes (от play() до звука), silence (окно тишины),
 *  total (клик → звук). Нет ключа — фазы не было ни в одном прогоне. */
export interface TrackStartSummary {
  cls: string;
  count: number;
  phases: Partial<Record<"sources" | "url" | "engine" | "bytes" | "silence" | "total", StartPhaseStat>>;
}

/** ЖУРНАЛ «ПОЧЕМУ ВКЛЮЧАЛОСЬ ДОЛГО». */
export interface DiagnosticsPort {
  health(): Promise<EngineHealth>;
  /** Последние старты (кольцо площадки; у приложения переживает перезапуск). */
  startLog(): TrackStartRecord[];
  /** Подписка на пополнение журнала; возвращает отписку. */
  subscribeStartLog(cb: () => void): () => void;
  /** Журнал таблицей (TSV) для буфера обмена. Нет метода — нет и кнопки
   *  «Скопировать журнал»: копировать нечего, а не «пока не умеем». */
  startLogTsv?(): string;
  /** Сводка по классам прогонов. Нет метода — сводки на экране нет. */
  startSummary?(): TrackStartSummary[];
}

/** СТАТУС «СЛУШАЕТ MUZA» В DISCORD. */
export interface DiscordStatusPort {
  /** Готова ли связка с Discord (площадка знает свой идентификатор). */
  configured(): Promise<boolean>;
}

/** Устройство звука в терминах экрана вывода. */
export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
}

/** ВЫВОД ЗВУКА НА НЕСКОЛЬКО УСТРОЙСТВ + ПОДМЕШИВАНИЕ ГОЛОСА. */
export interface AudioDevicesPort {
  listOutputs(): Promise<AudioDeviceInfo[]>;
  listInputs(): Promise<AudioDeviceInfo[]>;
  /** Разрешение спрашивали и не дали. Пустой список бывает по двум причинам,
   *  и человеку с запретом микрофона незачем идти проверять провода. */
  accessDenied(): boolean;
}

/** МАЛЕНЬКОЕ ОКНО ПЛЕЕРА ПОВЕРХ ДРУГИХ ОКОН. Отдельный порт, а не метод
 *  WindowPort: WindowPort — черновик без единой реализации, а это умение
 *  живое и нужно ряду настроек уже сейчас. */
export interface MiniPlayerPort {
  show(): Promise<void>;
  hide(): Promise<void>;
}

/** Расширение, установленное на этом устройстве. `manifest` намеренно не
 *  типизирован жёстко: его разбирает @muza/core (isFullAccessManifest,
 *  PERMISSION_INFO), а розетка только переносит. */
export interface InstalledPluginRef {
  id: string;
  version: string;
  enabled: boolean;
  manifest: PluginManifest;
  granted: readonly string[];
}

/** Подготовленное к установке расширение. Для общего кода это НЕПРОЗРАЧНАЯ
 *  ручка: он показывает `manifest` на экране согласия и возвращает ту же
 *  ручку обратно в finalize/cancel, не заглядывая внутрь. */
export interface StagedPluginRef {
  manifest: PluginManifest;
}

/** Ошибка расширения с полным доступом. */
export interface PluginErrorRecord {
  pluginId: string;
  message: string;
  at: number;
}

/** РАСШИРЕНИЯ, УСТАНАВЛИВАЕМЫЕ ФАЙЛОМ. Целиком отсутствует у браузера:
 *  страница не берёт файл с диска в свою песочницу и не переживает
 *  перезапуск — раздел «Расширения» там не появляется вовсе. */
export interface PluginsPort {
  list(): Promise<InstalledPluginRef[]>;
  /** Системный выбор файла + проверка; null — человек передумал. */
  pickFile(): Promise<StagedPluginRef | null>;
  /** Подготовить из данных витрины — дальше ТОТ ЖЕ экран согласия. */
  stageFromMarket(payload: {
    manifest: Record<string, unknown>;
    code: string;
    css?: string;
    strings?: Record<string, string>;
  }): Promise<StagedPluginRef>;
  /** Согласие получено — установить с этими правами. */
  finalize(staged: StagedPluginRef, granted: readonly string[]): Promise<void>;
  /** Отказ — убрать подготовленное. */
  cancel(staged: StagedPluginRef): Promise<void>;
  setEnabled(id: string, on: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  errors(): PluginErrorRecord[];
  clearErrors(): void;
  /** Подписка на реестр ошибок; возвращает отписку. */
  subscribeErrors(cb: () => void): () => void;
  /** Версия реестра ошибок — для useSyncExternalStore. */
  errorsVersion(): number;
  /** Перезапустить программу: выключенное расширение с полным доступом
   *  живёт в памяти до перезапуска, и честнее предложить его сразу. */
  restart(): Promise<void>;
}

/** СОХРАНИТЬ ФАЙЛ ДАННЫХ («Выгрузить мои данные»). Порт НЕобязателен, и это
 *  единственное место, где его отсутствие не убирает ряд: без порта общий код
 *  отдаёт файл обычной загрузкой браузера — так эта кнопка и работала в
 *  окне без Tauri. Порт нужен там, где человек выбирает МЕСТО на диске. */
export interface SaveDataFilePort {
  /** Спросить место и сохранить. false — человек закрыл выбор места. */
  saveJson(suggestedName: string, json: string): Promise<boolean>;
}

/** Вилка площадки. Каждое поле — отдельное умение; НЕТ поля = площадка так
 *  не умеет, и общий код обязан вести себя так, будто такой возможности в
 *  продукте нет (не серая заглушка — отсутствие пункта). */
export interface PlatformAdapter {
  dragOut?: DragOutPort;
  localFiles?: LocalFilesPort;
  offline?: OfflinePort;
  window?: WindowPort;
  system?: SystemPort;
  saveImage?: SaveImagePort;
  preparedTracks?: PreparedTracksPort;
  // ── экран настроек ──
  updates?: UpdatesPort;
  appInfo?: AppInfoPort;
  storedMedia?: StoredMediaPort;
  diagnostics?: DiagnosticsPort;
  discordStatus?: DiscordStatusPort;
  audioDevices?: AudioDevicesPort;
  miniPlayer?: MiniPlayerPort;
  plugins?: PluginsPort;
  saveDataFile?: SaveDataFilePort;
}
