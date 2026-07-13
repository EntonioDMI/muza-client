/** Стек истории вкладок (T16): чистая логика без React — навигация назад/
 *  вперёд двигает индекс, обычные переходы срезают forward-хвост и дедупят
 *  подряд идущую одинаковую запись. Кап на длину — не растёт бесконечно.
 *
 *  Generic по V (обычно App'ный `View`), чтобы модуль не тянул типы
 *  приложения и тестировался изолированно. Payload — для параметрических
 *  вью (сейчас только view="playlist": id открытого плейлиста), чтобы
 *  «назад» в плейлист возвращал ТОТ ЖЕ, а не последний открытый. */

export interface HistoryPayload {
  /** view="playlist": id открытого плейлиста. */
  playlistId?: string;
}

export interface HistoryEntry<V extends string = string> {
  view: V;
  payload?: HistoryPayload;
}

export interface HistoryState<V extends string = string> {
  entries: HistoryEntry<V>[];
  index: number;
}

const DEFAULT_CAP = 50;

function entriesEqual<V extends string>(a: HistoryEntry<V>, b: HistoryEntry<V>): boolean {
  return a.view === b.view && (a.payload?.playlistId ?? null) === (b.payload?.playlistId ?? null);
}

/** Начальный стек из одной записи (текущий экран на момент старта). */
export function createHistory<V extends string>(initial: HistoryEntry<V>): HistoryState<V> {
  return { entries: [initial], index: 0 };
}

/** Обычный переход (НЕ назад/вперёд): если стояли не в конце стека — форвард-
 *  хвост срезается; если новая запись совпадает с текущей — без-оп (не
 *  пушим дубликат, ссылка на state не меняется); при переполнении cap
 *  голова стека обрезается, index указывает на последнюю запись. */
export function pushHistory<V extends string>(
  state: HistoryState<V>,
  entry: HistoryEntry<V>,
  cap: number = DEFAULT_CAP,
): HistoryState<V> {
  const current = state.entries[state.index];
  if (current && entriesEqual(current, entry)) return state;
  const trimmed = state.entries.slice(0, state.index + 1);
  let entries = [...trimmed, entry];
  let index = entries.length - 1;
  if (entries.length > cap) {
    entries = entries.slice(entries.length - cap);
    index = entries.length - 1;
  }
  return { entries, index };
}

export function canGoBack(state: HistoryState<string>): boolean {
  return state.index > 0;
}

export function canGoForward(state: HistoryState<string>): boolean {
  return state.index < state.entries.length - 1;
}

/** Назад/вперёд двигают индекс БЕЗ пуша новой записи; на границе — без-оп
 *  (та же ссылка на state, чтобы вызывающий код мог отличить «не сработало»). */
export function goBack<V extends string>(state: HistoryState<V>): HistoryState<V> {
  if (!canGoBack(state)) return state;
  return { ...state, index: state.index - 1 };
}

export function goForward<V extends string>(state: HistoryState<V>): HistoryState<V> {
  if (!canGoForward(state)) return state;
  return { ...state, index: state.index + 1 };
}

export function currentEntry<V extends string>(state: HistoryState<V>): HistoryEntry<V> {
  return state.entries[state.index];
}
