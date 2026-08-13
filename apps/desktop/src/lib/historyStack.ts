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
  /** view="scPlaylist": id плейлиста SoundCloud (с префиксом sc:, 2026-07-20). */
  scPlaylistId?: string;
  /** view="settings": выбранный раздел («Внешний вид», «Воспроизведение»…).
   *
   *  ⚠️ ЗАЧЕМ ЭТО ЗДЕСЬ (13.08). Раздел настроек жил только в useState внутри
   *  SettingsView и историю не трогал вовсе. Человек заходил Настройки →
   *  Внешний вид, жал «назад» боковой кнопкой мыши — и оказывался на Главной,
   *  потому что предыдущей ЗАПИСЬЮ была Главная: вход в раздел записи не
   *  создавал. Владелец: «таких моментов стало довольно много». */
  settingsTab?: string;
  /** view="settings": под-экран внутри раздела (эквалайзер, диагностика…).
   *  Второй уровень той же вложенности — без него «назад» из под-экрана
   *  выбрасывал бы из настроек целиком, ровно как раньше из раздела. */
  settingsSub?: string;
}

/** Поля payload, по которым записи считаются разными. Список ЯВНЫЙ, а не
 *  перебор ключей: забытое поле здесь не ломает сборку, а тихо склеивает две
 *  разные записи в одну — и «назад» молча перескакивает через экран. Так уже
 *  было со `scPlaylistId`: его добавили в payload 20.07, а в сравнение нет, и
 *  два разных плейлиста SoundCloud подряд считались одной записью. */
const PAYLOAD_KEYS = ["playlistId", "scPlaylistId", "settingsTab", "settingsSub"] as const;

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
  if (a.view !== b.view) return false;
  return PAYLOAD_KEYS.every((k) => (a.payload?.[k] ?? null) === (b.payload?.[k] ?? null));
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
