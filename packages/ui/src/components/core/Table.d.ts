/** Описание колонки таблицы. */
export interface TableColumn<Row> {
  /** Ключ колонки: и поле строки по умолчанию, и идентификатор сортировки. */
  key: string;
  /** Подпись в шапке. */
  label?: React.ReactNode;
  /** CSS-ширина колонки ("40%", "120px"). Хоть одна width — раскладка
   *  фиксированная: колонки стоят на месте, длинный текст обрезается. */
  width?: string;
  /** Выравнивание; по умолчанию числовые вправо, остальные влево. */
  align?: "left" | "right" | "center";
  /** Числовая колонка: табличные цифры, выравнивание вправо, первый клик по
   *  заголовку — по убыванию. */
  numeric?: boolean;
  /** Заголовок кликается и сортирует таблицу. */
  sortable?: boolean;
  /** Содержимое ячейки; без него берётся row[key]. */
  render?: (row: Row) => React.ReactNode;
  /** Значение для сортировки; без него берётся row[key]. */
  sortValue?: (row: Row) => string | number;
  /** Разрешить перенос строк в ячейке (по умолчанию — одна строка с обрезкой). */
  wrap?: boolean;
}

/** Направление сортировки колонки. */
export interface TableSort {
  key: string;
  dir: "asc" | "desc";
}

/** Таблица данных: <table> с ролями, сортировкой по клику и aria-sort. */
export interface TableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  /** Стабильный ключ строки. */
  rowKey: (row: Row, index: number) => string;
  /** Что показать вместо строк, когда данных нет. */
  empty?: React.ReactNode;
  /** Имя таблицы для скринридера. */
  ariaLabel?: string;
  /** Сортировка при первом показе; дальше её меняет пользователь. */
  defaultSort?: TableSort | null;
  /** Строк на страницу; 0 — без страниц.
   *
   *  ⚠️ Резать список ДО передачи сюда нельзя: сортировка живёт внутри
   *  таблицы, и отсортированная страница выдаёт «пятьдесят случайных строк» за
   *  верхние. Отдавай ВЕСЬ массив и pageSize — таблица режет после сортировки. */
  pageSize?: number;
  /** Подпись счётчика страниц; по умолчанию «N / M». */
  pageLabel?: (page: number, pages: number, total: number) => string;
  /** Подписи кнопок листалки для скринридера. */
  prevLabel?: string;
  nextLabel?: string;
  /** Что таблица показывает сейчас. Нужен счётчику снаружи: страницы живут
   *  внутри таблицы, и вызывающий текущую страницу больше не знает. */
  onView?: (info: { page: number; pages: number; shown: number; total: number }) => void;
  style?: React.CSSProperties;
}
