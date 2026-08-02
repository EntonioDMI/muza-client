/** Пенёк-обёртка: панель очереди переехала в @muza/app (Э3 веб-паритета,
 *  2026-08-02). App.tsx зовёт этот файл ровно как раньше, теми же пропами;
 *  ни одного узла DOM обёртка не добавляет.
 *
 *  Обёртка доставляет общей панели два приложенческих умения:
 *  1) контекстное меню — его механика (один <Menu> на приложение, сборка
 *     пунктов по роли) в общий пакет пока не переезжала, а хук useContextMenu
 *     обязан вызываться внутри провайдера — потому он здесь, а не там;
 *  2) toCatalog — как из трека очереди сделать каталожную форму. У приложения
 *     в очереди бывают файлы с диска, у которых её нет; веб отдаёт свою.
 *
 *  ⚠️ Счётчик выделения в меню берёт multi.count (полное число), а НЕ длину
 *  каталожного списка: файлы с диска в каталожную форму не превращаются, и в
 *  меню стояло «Выбрано: 2», когда убиралось 3 (разбор 2026-08-02). Инвариант
 *  живёт в общей панели — здесь про него помнить нечего, но менять форму
 *  QueueSelectionTarget, не перечитав его, нельзя. */

import { QueuePanel as SharedQueuePanel } from "@muza/app/shell/QueuePanel";
import { toCatalog, type PlayerTrack } from "../player/types";
import { useContextMenu } from "./ContextMenu";

export function QueuePanel(props: {
  open: boolean;
  tracks: PlayerTrack[];
  /** Индекс текущего трека в очереди (секции режутся по нему). */
  currentIndex: number;
  playing: boolean;
  /** Серверная сессия: «Сохранить как плейлист» доступно. */
  canSave: boolean;
  onPlayTrack: (id: string) => void;
  onClose: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: 1 | -1) => void;
  onClearUpNext: () => void;
  onSaveAsPlaylist: () => void;
  /** ПКМ по строке (2026-07-20); index — АБСОЛЮТНЫЙ в tracks, не в секции. */
  onRowMenu?: (track: PlayerTrack, index: number, e: React.MouseEvent) => void;
  /** Убрать пачку выделенных (2026-07-20): один суммарный тост, не N undo. */
  onRemoveMany?: (ids: string[]) => void;
}) {
  const { openMenu, menuCtxRef } = useContextMenu();
  return (
    <SharedQueuePanel<PlayerTrack>
      {...props}
      menu={{ openMenu, ctx: menuCtxRef }}
      toCatalog={toCatalog}
    />
  );
}
