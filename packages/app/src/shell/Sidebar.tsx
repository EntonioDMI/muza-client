/** Боковая панель — ОДНА на приложение и веб (Э3 веб-паритета, 2026-08-02).
 *
 *  Что здесь важно понимать про переезд из apps/desktop/src/shell/Sidebar.tsx:
 *  разметка и стили перенесены БЕЗ ЕДИНОЙ ПРАВКИ (у приложения не должно быть
 *  дифференции ни на пиксель), а наружу вынесено ровно то, что знает про свою
 *  площадку:
 *
 *  - логотип приходит пропом `logoSrc`. `import glyph from ".../glyph.svg"` в
 *    общем пакете запрещён: Vite отдаёт строку, а Next — объект StaticImageData,
 *    и в вебе получилось бы <img src="[object Object]"> (про это же — шапка
 *    packages/app/tsconfig.json);
 *  - состав вкладок считает ВЫЗЫВАЮЩИЙ и отдаёт готовым списком `nav`. У
 *    приложения это компоновка из настроек + плагинные вкладки (lib/navItems.ts,
 *    lib/pluginSlots.ts — знание десктопа), у веба — четыре ссылки роутера.
 *    Сюда приходят уже только {key, icon, label};
 *  - `view: View` превратился в `activeNavKey: string`: тип экрана — словарь
 *    приложения, панели от него нужна только подсветка совпавшего ключа;
 *  - приём трека умеет ДВА механизма. Родной — pointer-слой (DragLayer, тот же
 *    жест, что внутри приложения). Плюс `externalDrop` — мост к старому HTML5
 *    DnD, которым веб пока таскает строки треков из списков; приложение его не
 *    передаёт, и тогда никаких onDragOver/onDrop в разметке не появляется.
 *
 *  Реордер плейлистов — ЛОКАЛЬНЫЙ жест панели (useLocalReorder): плашка едет за
 *  курсором в пределах списка, соседи разъезжаются, между областями ничего не
 *  переносится. Он же работает пальцем: движок на Pointer Events, у ручки-⠿
 *  стоит touchAction:"none". */

import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon, IconButton } from "@muza/ui";
import { useCoverArt } from "../lib/coverArt";
import { insertionIndex } from "../lib/dragEngine";
import { useLocalReorder } from "../lib/useLocalReorder";
import { useDropZone } from "./DragLayer";
import { useT } from "../i18n";

/** Вкладка панели: только то, что нужно нарисовать. Откуда взялся состав
 *  (настройки, плагины, маршруты роутера) — дело вызывающего. */
export interface SidebarNavItem {
  key: string;
  icon: string;
  label: string;
}

/** Мост к HTML5-перетаскиванию (веб таскает треки им, пока списки не переехали
 *  на общий pointer-слой). Две функции, а не одна: на dragover данных в
 *  событии ещё нет — доступны только ТИПЫ, — а на drop уже есть. */
export interface SidebarExternalDrop {
  /** Событие несёт трек (проверка по типам — для подсветки цели). */
  accepts: (e: React.DragEvent) => boolean;
  /** id трека из отпущенного события; null — это был не трек. */
  trackId: (e: React.DragEvent) => string | null;
}

/** Пункт списка плейлистов (серверный) — T47b: с
 *  cover, если у плейлиста есть валидная иконка манифеста @muza/core;
 *  иначе (или нет иконки) — плейсхолдер (users/list-music по shared). */
export interface SidebarPlaylist {
  id: string;
  name: string;
  meta: string;
  cover?: string;
  /** Stage 7: совместный плейлист — иконка «люди» вместо нот. */
  shared?: boolean;
  /** 2026-07-17: подписка (follower) — в реордер не входит. 2026-07-20:
   *  закреплённые тоже fixed («случайно не сдвинуть/не добавить»). */
  fixed?: boolean;
  /** 2026-07-17: скрытая владельцем подписка — строка гаснет. */
  dimmed?: boolean;
  /** 2026-07-20: закреплён — булавка-индикатор, всегда сверху (под «Любимым»). */
  pinned?: boolean;
}

const NAV_H = 48;
const NAV_GAP = 4;

/** Глифы, которые ОСМЫСЛЕННО заливаются в активной вкладке (Icon.filled →
 *  `fill=color`). lucide рисует штрихом и солид-вариантов не поставляет, а
 *  заливка идёт по ВСЕМ подпутям глифа — годится только замкнутым силуэтам:
 *
 *  - `heart`, `home`, `library-big` — замкнутые фигуры, заливка даёт ровно тот
 *    солид-силуэт, что рисуют Spotify/Apple Music;
 *  - `search` (окружность + ручка) — заливка превращает линзу в глухой диск;
 *  - `chart-line` (оси + ломаная) — заливка ломаной даёт кляксу под линией.
 *
 *  Незалитый глиф активной вкладки не «ломается»: он остаётся штриховым и всё
 *  равно подсвечен акцентом, фоном surface-4 и полужирным весом. Плагинные
 *  вкладки сюда не попадают: иконку выбирает автор плагина, заранее судить о
 *  её форме нельзя.
 *
 *  Список живёт ЗДЕСЬ, а не у вызывающего: это правило отрисовки панели, и
 *  третья копия (у десктопа — lib/navItems.ts, у веба была своя в AppShell)
 *  ровно так и заводилась. */
const NAV_FILLABLE: ReadonlySet<string> = new Set(["heart", "home", "house", "library-big", "library"]);

export function isFillableNavIcon(icon: string): boolean {
  return NAV_FILLABLE.has(icon);
}

function NavItem({
  icon,
  label,
  active,
  quiet,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  quiet?: boolean;
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: NAV_H,
        width: "100%",
        boxSizing: "border-box",
        padding: "0 var(--sp-4)",
        border: "none",
        borderRadius: "var(--r-sm)",
        background: quiet
          ? !active && hover
            ? "var(--surface-2)"
            : "transparent"
          : active
            ? "var(--surface-4)"
            : hover
              ? "var(--surface-2)"
              : "transparent",
        color: active ? "var(--text-1)" : hover ? "var(--text-1)" : "var(--text-2)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body)",
        fontWeight: active ? "var(--fw-semibold)" : ("var(--fw-medium)" as never),
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-fast) var(--ease-out), color var(--dur-base) var(--ease-out)",
      }}
    >
      {/* Активная вкладка — ЗАЛИТАЯ иконка (как в Spotify/Apple Music): цвета
          мало, силуэт читается с периферии. lucide рисует штрихом, солид-
          вариантов не поставляет, поэтому заливка — fill тем же цветом
          (Icon.filled). Годится не всякому глифу: см. NAV_FILLABLE выше. */}
      <Icon
        name={icon}
        size={20}
        color={active ? "var(--accent-text)" : "currentColor"}
        filled={Boolean(active) && isFillableNavIcon(icon)}
        style={{ transition: "color var(--dur-base) var(--ease-out)" }}
      />
      {label}
    </button>
  );
}

/** Подсветка «сюда можно» от HTML5-моста: своё состояние, потому что pointer-
 *  слой про эти события ничего не знает. Возвращает пропсы и признак «висит над
 *  зоной»; моста нет → пропсов нет, и разметка ровно та же, что была. */
type ExternalDropProps = Pick<React.DOMAttributes<HTMLElement>, "onDragOver" | "onDragLeave" | "onDrop">;

function useExternalDropZone(
  externalDrop: SidebarExternalDrop | undefined,
  onDropTrack: ((trackId: string) => void) | undefined,
): { lit: boolean; props: ExternalDropProps } {
  const [lit, setLit] = useState(false);
  if (!externalDrop || !onDropTrack) return { lit: false, props: {} };
  return {
    lit,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!externalDrop.accepts(e)) return;
        e.preventDefault(); // без этого браузер не разрешит бросок
        e.dataTransfer.dropEffect = "copy";
        setLit(true);
      },
      onDragLeave: () => setLit(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setLit(false);
        const id = externalDrop.trackId(e);
        if (id) onDropTrack(id);
      },
    },
  };
}

function PlaylistRow({
  playlistId,
  cover,
  name,
  meta,
  shared,
  onClick,
  onMenu,
  onDropTrack,
  externalDrop,
  grip,
  rowRef,
  shift,
  dragged = false,
  settling = false,
  reordering = false,
  dimmed = false,
  pinned = false,
}: {
  playlistId: string;
  cover?: string;
  name: string;
  meta: string;
  shared?: boolean;
  onClick?: () => void;
  /** ПКМ по строке — контекст-меню плейлиста (Открыть/Переименовать/Удалить). */
  onMenu?: (e: React.MouseEvent) => void;
  /** Дроп перетаскиваемого трека на этот плейлист (undefined = не таргет). */
  onDropTrack?: (trackId: string) => void;
  /** Мост к HTML5-перетаскиванию; нет — в разметке нет и обработчиков. */
  externalDrop?: SidebarExternalDrop;
  /** Реордер (useLocalReorder, живёт в Sidebar): пропсы ручки-⠿; нет — ручки нет. */
  grip?: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void };
  rowRef?: (el: HTMLElement | null) => void;
  /** Transform строки во время реордера (сама или сосед); null — покой. */
  shift?: { x: number; y: number } | null;
  /** Тащат ИМЕННО эту строку: едет за курсором, без transition, поверх соседей. */
  dragged?: boolean;
  /** Строку отпустили — она доезжает до слота, transition нужен и ей. */
  settling?: boolean;
  /** Идёт реордер списка — ручки видны на всех строках (читаются цели). */
  reordering?: boolean;
  /** 2026-07-17: скрытая владельцем подписка — строка гаснет. */
  dimmed?: boolean;
  /** 2026-07-20: закреплён — булавка в слоте ручки (у fixed-строк ручки нет). */
  pinned?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const { t } = useT();
  // Track-иконка плейлиста — сырой ytimg-URL: срезаем вшитые поля тем же
  // canvas-кропом, что у плеера (локальные/не-ytimg проходят как есть).
  const cleanCover = useCoverArt(cover ?? null);
  // id зоны с префиксом места: тот же плейлист бывает целью и здесь, и плиткой
  // медиатеки, и своей страницей — а реестр зон в DragLayer это плоская Map,
  // и одинаковые id затирали бы колбэк друг друга. Зона принимает ТОЛЬКО треки:
  // реордер плейлистов — локальный жест, между областями не ходит (2026-07-16).
  const { over: pointerLit, props: dropProps } = useDropZone(
    onDropTrack ? `sidebar-playlist:${playlistId}` : null,
    (p) => onDropTrack?.(p.id),
  );
  const ext = useExternalDropZone(externalDrop, onDropTrack);
  const dropLit = pointerLit || ext.lit;
  return (
    <div
      {...dropProps}
      {...ext.props}
      ref={rowRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        opacity: dimmed ? 0.45 : undefined,
        transform: shift ? `translate(${shift.x}px, ${shift.y}px)` : undefined,
        // тащимая строка липнет к курсору без сглаживания; соседи разъезжаются
        // мягко; при посадке transition получает и она — доезжает до слота.
        // Вне реордера transition не держим — не мешать layout'у списка.
        transition: shift && (!dragged || settling) ? "transform 160ms var(--ease-out)" : undefined,
        zIndex: dragged ? 2 : undefined,
      }}
    >
    <button
      type="button"
      onClick={onClick}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(e);
            }
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        boxSizing: "border-box",
        gap: "var(--sp-3)",
        padding: "var(--sp-2)",
        // не дать длинному имени лечь под ручку-⠿ (или булавку закрепа)
        paddingRight: grip ? 30 : pinned ? 26 : "var(--sp-2)",
        border: "none",
        borderRadius: "var(--r-sm)",
        background: dropLit ? "var(--accent-soft)" : hover ? "var(--surface-2)" : "transparent",
        outline: dropLit ? "var(--focus-ring)" : undefined,
        outlineOffset: -2,
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      {cleanCover ? (
        // objectFit обязателен: без него дефолтный fill плющил неквадратную
        // обложку. Не Cover — у пустой ветки ниже свой осмысленный плейсхолдер
        // (совместный плейлист vs обычный), а не общий значок ноты.
        <img
          src={cleanCover}
          alt=""
          style={{ width: 40, height: 40, borderRadius: "var(--r-xs)", flex: "none", objectFit: "cover" }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--r-xs)",
            flex: "none",
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={shared ? "users" : "list-music"} size={18} color="var(--accent-text)" />
        </span>
      )}
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-body)",
            fontWeight: 500,
            color: "var(--text-1)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
          {meta}
        </span>
      </span>
    </button>
    {grip ? (
      // Появляется на hover строки (в узком сайдбаре постоянные точки на каждой
      // строке — шум); пока список реордерится — видна везде (читается механика).
      <span
        {...grip}
        role="button"
        aria-label={t("views.library.reorderHandle")}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "50%",
          right: 4,
          transform: "translateY(-50%)",
          display: "grid",
          placeItems: "center",
          width: 26,
          height: 30,
          color: "var(--text-3)",
          cursor: dragged ? "grabbing" : "grab",
          opacity: hover || reordering ? 1 : 0,
          pointerEvents: hover || reordering ? "auto" : "none",
          transition: "opacity var(--dur-fast) var(--ease-out)",
          touchAction: "none",
        }}
      >
        <Icon name="grip-vertical" size={16} />
      </span>
    ) : null}
    {pinned ? (
      // булавка закрепа: строка не тащится и не принимает случайный дроп —
      // индикатор объясняет, почему (место ручки свободно: fixed → grip нет)
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          right: 8,
          transform: "translateY(-50%)",
          display: "grid",
          placeItems: "center",
          color: "var(--text-3)",
        }}
      >
        <Icon name="pin" size={13} />
      </span>
    ) : null}
    </div>
  );
}

/** «Любимое» — закреплённая ПЕРВАЯ строка списка плейлистов (Spotify-паттерн,
 *  2026-07-16): не вкладка сайдбара, а особый плейлист. Фирменный градиент
 *  логотипа Музы + сердце вместо обложки; подсвечивается, когда открыт её
 *  экран.
 *
 *  Принимает бросок трека (2026-07-20, жалоба владельца «DnD не работает для
 *  любимых»): раньше зоны не было намеренно («кладут кнопкой-сердцем»), но раз
 *  на обычные плейлисты трек бросается — жест ждут и здесь. Кладёт ТОЛЬКО
 *  добавление: бросок уже любимого трека безобиден (см. favoritesDrop.ts). */
function FavoritesRow({
  count,
  active,
  onOpen,
  onDropTrack,
  externalDrop,
}: {
  count: number;
  active: boolean;
  onOpen: () => void;
  onDropTrack?: (trackId: string) => void;
  externalDrop?: SidebarExternalDrop;
}) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  // id зоны с тем же префиксом места, что у строк плейлистов (реестр зон в
  // DragLayer — плоская Map, одинаковые id затирали бы колбэки друг друга)
  const { over: pointerLit, props: dropProps } = useDropZone(
    onDropTrack ? "sidebar-favorites" : null,
    (p) => onDropTrack?.(p.id),
  );
  const ext = useExternalDropZone(externalDrop, onDropTrack);
  const dropLit = pointerLit || ext.lit;
  return (
    <button
      {...dropProps}
      {...ext.props}
      type="button"
      onClick={onOpen}
      // имя — только «Любимое» (без счётчика в подписи): и скринридеру чище, и
      // это стабильный role-name для тестов навигации
      aria-label={t("views.favorites.title")}
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-2)",
        border: "none",
        borderRadius: "var(--r-sm)",
        // подсветка приёма — как у строк плейлистов
        background: dropLit ? "var(--accent-soft)" : active ? "var(--surface-4)" : hover ? "var(--surface-2)" : "transparent",
        outline: dropLit ? "var(--focus-ring)" : undefined,
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 40,
          height: 40,
          borderRadius: "var(--r-xs)",
          flex: "none",
          display: "grid",
          placeItems: "center",
          // тот же фирменный градиент, что у плитки библиотеки (glyph.svg)
          background: "var(--brand-gradient)",
        }}
      >
        <Icon name="heart" size={22} color="#fff" filled />
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-body)",
            fontWeight: 500,
            color: "var(--text-1)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {t("views.favorites.title")}
        </span>
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
          {t("views.library.playlistSubtitle", { count })}
        </span>
      </span>
    </button>
  );
}

export function Sidebar({
  logoSrc,
  badge,
  nav,
  activeNavKey,
  onSelectNav,
  playlists,
  favoritesCount,
  favoritesActive,
  onOpenFavorites,
  onCreatePlaylist,
  onOpenPlaylist,
  onPlaylistMenu,
  onDropTrack,
  onDropTrackOnFavorites,
  onReorderPlaylists,
  externalDrop,
  emptyHint,
  onOpenAdmin,
  adminActive = false,
  onOpenSettings,
  settingsActive = false,
  onOpenHotkeys,
  style,
}: {
  /** Готовый URL глифа: приложение отдаёт импорт Vite, веб — путь из public/.
   *  Импортировать .svg здесь нельзя — см. шапку файла. */
  logoSrc: string;
  /** Плашка рядом с названием («Web» в браузере — просил владелец). */
  badge?: ReactNode;
  /** Вкладки — уже собранным списком (состав считает вызывающий). */
  nav: SidebarNavItem[];
  /** Ключ активной вкладки; нет совпадения — индикатор гаснет. */
  activeNavKey: string | null;
  onSelectNav: (key: string) => void;
  playlists: SidebarPlaylist[];
  /** «Любимое» — закреплённая первая строка списка (счётчик лайков + переход). */
  favoritesCount: number;
  favoritesActive: boolean;
  onOpenFavorites: () => void;
  /** Бросок трека на «Любимое» (2026-07-20): только добавляет, повтор безобиден. */
  onDropTrackOnFavorites?: (trackId: string) => void;
  /** Кнопка «+» у заголовка; нет колбэка — нет кнопки. */
  onCreatePlaylist?: () => void;
  onOpenPlaylist: (id: string) => void;
  /** T17: ПКМ по плейлисту — контекст-меню (App: Открыть/Переименовать/Удалить). */
  onPlaylistMenu?: (p: SidebarPlaylist, e: React.MouseEvent) => void;
  /** DnD: трек уронили на плейлист (только серверные списки). */
  onDropTrack?: (playlistId: string, trackId: string) => void;
  /** Реордер за ручку-⠿ (локальный, только внутри сайдбара): id встаёт на
   *  toIndex (splice-индекс) — тот же контракт, что в Библиотеке.
   *
   *  ⚠️ toIndex — в координатах списка БЕЗ fixed-строк (подписки и закреплённые
   *  в перетаскивание не входят). Применять его к ПОЛНОМУ списку нельзя:
   *  промах равен числу исключённых строк, а закреплённые всегда сверху —
   *  значит промах гарантирован. Образец правильного применения —
   *  apps/desktop/src/App.tsx, reorderPlaylists (чинилось 2026-08-02). */
  onReorderPlaylists?: (draggedId: string, toIndex: number) => void;
  /** Мост к HTML5-перетаскиванию треков (веб); приложению не нужен. */
  externalDrop?: SidebarExternalDrop;
  /** Подсказка вместо пустого списка плейлистов (в приложении её нет). */
  emptyHint?: ReactNode;
  /** Пункт «Админка» (Stage 5); нет колбэка — нет пункта. */
  onOpenAdmin?: () => void;
  adminActive?: boolean;
  onOpenSettings: () => void;
  settingsActive?: boolean;
  /** Видимая кнопка «?» — диалог горячих клавиш; нет колбэка — нет кнопки. */
  onOpenHotkeys?: () => void;
  /** Довесок к стилям корневого <aside> (веб вписывает панель в свою сетку). */
  style?: CSSProperties;
}) {
  const { t } = useT();
  // Реордер плейлистов — локальный жест столбца: строка следует за курсором в
  // пределах списка, соседи разъезжаются (useLocalReorder). «Любимое» закреплено
  // и в ids не входит — на его место ничего не встанет.
  const reorder = useLocalReorder({
    // fixed (подписки, 2026-07-17) в реордер не входят — их позиций на сервере нет
    ids: playlists.filter((p) => !p.fixed).map((p) => p.id),
    resolveTo: (rects, from, _x, y) => insertionIndex(rects, from, y),
    onCommit: (id, to) => onReorderPlaylists?.(id, to),
  });
  const idx = nav.findIndex((n) => n.key === activeNavKey);
  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        padding: "var(--pad-zone)",
        borderRadius: "var(--r-lg)",
        // зональная прозрачность: своя плотность поверхности + blur (вкл. зонами)
        background: "var(--glass-sidebar, var(--surface-1))",
        backdropFilter: "var(--bf-zone, none)",
        WebkitBackdropFilter: "var(--bf-zone, none)",
        overflow: "hidden",
        // Запрет выделения — часть жеста, а не косметика: браузер начинает
        // выделять текст на pointerdown с первым же сдвигом, то есть РАНЬШЕ
        // подъёма плашки, и погасить начатое выделение потом уже нельзя
        // (владелец, 16.07.2026: «потащил и выделил весь экран разом»).
        // В приложении это стоит на :root (app.css), у веба такого правила
        // нет — панель обязана защищать свой жест сама. На десктопе значение
        // совпадает с унаследованным, поэтому не меняет ни пикселя.
        userSelect: "none",
        WebkitUserSelect: "none",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-1) var(--sp-3) var(--sp-5)" }}>
        <img src={logoSrc} alt="" style={{ width: 26, height: 30 }} />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 19,
            letterSpacing: "var(--ls-display)",
            color: "var(--text-1)",
          }}
        >
          Muza
        </span>
        {badge}
      </div>
      <nav style={{ position: "relative", display: "flex", flexDirection: "column", gap: NAV_GAP }}>
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: NAV_H,
            borderRadius: "var(--r-sm)",
            background: "var(--surface-4)",
            transform: `translateY(${Math.max(idx, 0) * (NAV_H + NAV_GAP)}px)`,
            opacity: idx >= 0 ? 1 : 0,
            transition: "transform var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)",
          }}
        ></div>
        {nav.map((n) => (
          <NavItem
            key={n.key}
            icon={n.icon}
            label={n.label}
            quiet
            active={activeNavKey === n.key}
            onClick={() => onSelectNav(n.key)}
          />
        ))}
      </nav>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--sp-5) var(--sp-3) var(--sp-2)",
        }}
      >
        <span
          style={{
            fontSize: "var(--fs-caption)",
            fontWeight: 600,
            letterSpacing: "var(--ls-caps)",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          {t("sidebar.playlistsHeading")}
        </span>
        {onCreatePlaylist ? (
          <IconButton
            icon="plus"
            size="sm"
            label={t("sidebar.newPlaylistTooltip")}
            style={{ width: 28, height: 28 }}
            iconSize={16}
            onClick={onCreatePlaylist}
          />
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", scrollbarWidth: "none" }}>
        {/* «Любимое» закреплено первым (2026-07-16) — над обычными плейлистами */}
        <FavoritesRow
          count={favoritesCount}
          active={favoritesActive}
          onOpen={onOpenFavorites}
          onDropTrack={onDropTrackOnFavorites}
          externalDrop={externalDrop}
        />
        {playlists.length === 0 ? emptyHint : null}
        {playlists.map((p) => (
          <PlaylistRow
            key={p.id}
            playlistId={p.id}
            cover={p.cover}
            name={p.name}
            meta={p.meta}
            shared={p.shared}
            dimmed={p.dimmed}
            pinned={p.pinned}
            onClick={() => onOpenPlaylist(p.id)}
            onMenu={onPlaylistMenu ? (e) => onPlaylistMenu(p, e) : undefined}
            onDropTrack={onDropTrack && !p.fixed ? (trackId) => onDropTrack(p.id, trackId) : undefined}
            externalDrop={externalDrop}
            grip={onReorderPlaylists && !p.fixed ? reorder.grip(p.id) : undefined}
            rowRef={p.fixed ? undefined : reorder.itemRef(p.id)}
            shift={p.fixed ? null : reorder.shiftFor(p.id)}
            dragged={!p.fixed && reorder.draggingId === p.id}
            settling={reorder.settling}
            reordering={reorder.draggingId !== null}
          />
        ))}
      </div>
      <div style={{ marginTop: "auto" }}>
        {onOpenAdmin ? <NavItem icon="shield" label={t("sidebar.admin")} active={adminActive} onClick={onOpenAdmin} /> : null}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NavItem icon="settings" label={t("settings.title")} active={settingsActive} onClick={onOpenSettings} />
          </div>
          {onOpenHotkeys ? (
            <IconButton
              icon="circle-help"
              size="sm"
              label={t("sidebar.hotkeysTooltip")}
              style={{ width: 28, height: 28 }}
              iconSize={16}
              onClick={onOpenHotkeys}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}
