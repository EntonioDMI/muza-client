/** Track list row: queue, playlist and search results. No divider lines. */
export interface TrackRowProps {
  /** Position number shown at rest. */
  index?: number;
  /** URL обложки 42px. null/нет — рисуется плейсхолдер: слот остаётся, и строка
   *  трека без арта не разъезжается относительно соседних. */
  cover?: string | null;
  /** false — скрыть слот обложки целиком (настройка «Строка трека»). Это НЕ то
   *  же, что cover=null: там обложки нет у трека, здесь её прячет пользователь. */
  showCover?: boolean;
  title: string;
  artist: string;
  /** Название альбома — рисуется после артиста через « · », приглушённее
   *  (настройка «Строка трека: альбом»); нет/пусто — не показывается. */
  album?: string;
  /** "3:47" */
  duration?: string;
  /** false — скрыть колонку длительности (настройка «Строка трека»). */
  showDuration?: boolean;
  /** Compact source-provider badge (e.g. "SoundCloud"); omit to hide. */
  source?: string;
  /** Сколько ДРУГИХ версий песни (ремиксы/спидапы) свёрнуто под этой строкой.
   *  0/не задан — строка обычная, слот занимает распорка. */
  versionCount?: number;
  /** Резервировать слот версий во ВСЕХ строках списка. Свойство СПИСКА, а не
   *  строки: в grouped-выдаче группы и одиночки идут вперемешку, и без общего
   *  резерва правый кластер разъезжается между ними. Default false. */
  showVersions?: boolean;
  /** Версии развёрнуты — шеврон повёрнут, слот подсвечен. */
  versionsExpanded?: boolean;
  /** Клик по слоту версий (свернуть/развернуть). */
  onVersions?: () => void;
  /** Доступное имя слота версий («2 версии — развернуть»); задаёт приложение. */
  versionsLabel?: string;
  /** This row is the current track (accent title). */
  active?: boolean;
  /** Строка в множественном выделении (--surface-4). Сильнее active по фону:
   *  выделенный играющий трек не должен выпадать из выделения. */
  selected?: boolean;
  /** Playback running (equalizer glyph instead of index). */
  playing?: boolean;
  liked?: boolean;
  /** Quiet "E" mark — lyrics themselves are never censored. */
  explicit?: boolean;
  onPlay?: () => void;
  /** Двойной клик по строке (не по кнопке play); не задан — dblclick = onPlay. */
  onRowDoubleClick?: () => void;
  onLike?: () => void;
  /** Shows an ellipsis button on hover — open a <Menu /> from it. */
  onMore?: (e: React.MouseEvent) => void;
  /** Play button aria label. Default "Play" (app passes a localized value). */
  playLabel?: string;
  /** Pause button aria label. Default "Pause". */
  pauseLabel?: string;
  /** Like button aria label. Default "Like". */
  likeLabel?: string;
  /** More (ellipsis) button aria label. Default "More". */
  moreLabel?: string;
}
