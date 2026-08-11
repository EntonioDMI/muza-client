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
import { applyVisibleOrder, insertionIndex, pickByOrder } from "../lib/dragEngine";
import { useLocalReorder } from "../lib/useLocalReorder";
import { useDropZone } from "./DragLayer";
import { useLookReorder, type LookItemProps } from "./lookReorder";
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
  /** Число треков — тихой цифрой у правого края строки (набросок владельца
   *  04.08). У обычного плейлиста meta при этом пустая: количество больше не
   *  дублируется словами. */
  count?: number;
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
  look,
}: {
  icon: string;
  label: string;
  active?: boolean;
  quiet?: boolean;
  onClick?: () => void;
  /** Режим правки вида: пункт становится хватаемым (shell/lookReorder.tsx).
   *  Спред идёт ПЕРЕД style — свой стиль пункта остаётся главным, а сдвиг
   *  перестановки подмешивается в него ниже. */
  look?: LookItemProps;
}) {
  return (
    <button
      type="button"
      // Подсветка — каналом CSS (.muza-nav в @muza/ui/interactions.css), а не
      // useState: вкладок с десяток, но перерисовка каждой стоила ещё и
      // пересчёта пропсов реордера (look) на проход курсора.
      className="muza-nav"
      onClick={onClick}
      {...look}
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
        // quiet-вкладка активной не красится сама: под ней едет ПИЛЮЛЯ слота
        // (см. nav ниже), и собственный фон закрыл бы её собой.
        background: active ? (quiet ? "transparent" : "var(--surface-4)") : "var(--nav-bg)",
        color: active ? "var(--text-1)" : "var(--nav-fg)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body)",
        /* ⚠️ ВЕС ВКЛАДКИ НЕ МЕНЯЕТСЯ С СОСТОЯНИЕМ (11.08.2026, жалоба владельца
           «жирный шрифт в сайдбаре нечёткий, а в настройках ложится идеально»).
           Причина разницы — материал зоны: <aside> несёт backdrop-filter, и весь
           её текст растрируется в отдельный композиторский слой; 600-й вес Golos
           в нём замыливается, тогда как панель настроек фильтра не носит и тот же
           вес там чистый. Плюс смена веса переверстывала подпись прямо под
           курсором — вкладка «дёргалась» на переключении.
           Активность отмечают ТРИ признака и без веса: переезжающая пилюля,
           залитая акцентная иконка и подъём цвета до --text-1. */
        fontWeight: "var(--fw-medium)" as never,
        cursor: "pointer",
        textAlign: "left",
        /* Фон и подпись — одним законом: раньше они разъезжались 150/220 мс. */
        transition: "background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)",
        // Сдвиг перестановки — последним: он подмешивает transform и свой
        // transition поверх собственных стилей пункта, а не вместо них.
        ...look?.style,
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
        style={{ transition: "color var(--dur-state) var(--ease-standard)" }}
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
  count,
  shared,
  onClick,
  onMenu,
  onDropTrack,
  externalDrop,
  grip,
  rowRef,
  dragged = false,
  reordering = false,
  dimmed = false,
  pinned = false,
}: {
  playlistId: string;
  cover?: string;
  name: string;
  meta: string;
  /** Число треков тихой цифрой у правого края (см. SidebarPlaylist.count). */
  count?: number;
  shared?: boolean;
  onClick?: () => void;
  /** ПКМ по строке — контекст-меню плейлиста (Открыть/Переименовать/Удалить). */
  onMenu?: (e: React.MouseEvent) => void;
  /** Дроп перетаскиваемого трека на этот плейлист (undefined = не таргет). */
  onDropTrack?: (trackId: string) => void;
  /** Мост к HTML5-перетаскиванию; нет — в разметке нет и обработчиков. */
  externalDrop?: SidebarExternalDrop;
  /** Реордер (useLocalReorder, живёт в Sidebar): обработчик жеста — вешается на
   *  ВСЮ строку; нет — строка не переставляется и точек у неё нет. */
  grip?: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void };
  rowRef?: (el: HTMLElement | null) => void;
  /** Тащат ИМЕННО эту строку — курсор «grabbing», точки в полную яркость. */
  dragged?: boolean;
  /** Идёт реордер списка — точки видны на всех строках (читаются цели). */
  reordering?: boolean;
  /** 2026-07-17: скрытая владельцем подписка — строка гаснет. */
  dimmed?: boolean;
  /** 2026-07-20: закреплён — булавка в слоте ручки (у fixed-строк ручки нет). */
  pinned?: boolean;
}) {
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
      // ХВАТАЕТСЯ ВЕСЬ БЛОК, а не шесть точек (владелец 04.08: «было бы удобнее
      // хвататься за весь блок»). Точки остаются подсказкой «это переставляется»,
      // но своего обработчика больше не несут.
      //
      // touchAction здесь НЕ снимаем сознательно: список плейлистов
      // прокручивается, и запрет на всю строку отобрал бы у пальца прокрутку.
      // Граница получается честная: мышь тянет за что угодно, палец — за точки
      // (только у них touchAction: none).
      {...(grip ?? {})}
      ref={rowRef}
      // Подсветка строки и проявление ручки-⠿ — каналами CSS (.muza-row в
      // @muza/ui/interactions.css), а не useState. Класс висит на ВНЕШНЕМ узле,
      // потому что ручка живёт снаружи кнопки: наведение на неё обязано держать
      // строку подсвеченной, иначе ручка гасит сама себя из-под курсора.
      className="muza-row"
      style={{
        position: "relative",
        opacity: dimmed ? 0.45 : undefined,
        // ⚠️ transform/transition/zIndex здесь НЕТ намеренно: движение
        // перестановки пишет в DOM сам движок (lib/useLocalReorder.ts), и любая
        // запись отсюда стирала бы его через кадр.
        cursor: grip && dragged ? "grabbing" : undefined,
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
        background: dropLit ? "var(--accent-soft)" : "var(--row-bg)",
        outline: dropLit ? "var(--focus-ring)" : undefined,
        outlineOffset: -2,
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-state) var(--ease-standard)",
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
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "block",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-body)",
            fontWeight: 400,
            color: "var(--text-1)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        {/* Пустая meta не рисуется вовсе: у обычного плейлиста число уехало
            цифрой вправо (набросок 04.08), и держать под ним пустую строку —
            значит ровнять все строки по самой многословной. */}
        {meta ? (
          <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
            {meta}
          </span>
        ) : null}
      </span>
      {count !== undefined ? (
        <span
          style={{
            flex: "none",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-caption)",
            color: "var(--text-3)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      ) : null}
    </button>
    {grip ? (
      // Проявляется по наведению на строку (в узком сайдбаре постоянные точки
      // на каждой строке — шум); пока список реордерится — видна везде.
      <span
        aria-hidden="true"
        data-testid="reorder-grip"
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
          // Пока список реордерится — ручки видны везде (читаются цели), иначе
          // ручка проявляется по наведению на строку: --row-aff/--row-aff-pe.
          opacity: reordering ? 1 : "var(--row-aff)",
          // csstype перечисляет ключевые слова pointer-events и var() в них не
          // пускает; для CSS подстановка здесь так же законна, как везде
          pointerEvents: (reordering ? "auto" : "var(--row-aff-pe)") as CSSProperties["pointerEvents"],
          transition: "opacity var(--dur-state) var(--ease-standard)",
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
      // тот же канал подсветки, что у строк плейлистов (.muza-row)
      className="muza-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-2)",
        border: "none",
        borderRadius: "var(--r-sm)",
        // подсветка приёма — как у строк плейлистов
        background: dropLit ? "var(--accent-soft)" : active ? "var(--surface-4)" : "var(--row-bg)",
        outline: dropLit ? "var(--focus-ring)" : undefined,
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-state) var(--ease-standard)",
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
            fontWeight: 400,
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

/** Состояние обновления для пункта в сайдбаре.
 *
 *  Двух фаз достаточно: пока установщик качается — видно, что идёт работа, но
 *  нажать нельзя; скачался — кнопка становится живой. Промежуточных состояний
 *  («проверяем», «обновлений нет») в интерфейсе нет намеренно: они появлялись
 *  бы и исчезали сами по себе и только мельтешили бы в панели. */
export interface SidebarUpdate {
  phase: "downloading" | "ready";
  version: string;
  /** Закрыть приложение и поставить новую версию. */
  onInstall: () => void;
}

/** Строка обновления — ЕДИНСТВЕННОЕ цветное пятно в сайдбаре.
 *
 *  Что было не так (владелец, 11.08.2026: «не нравится абсолютно всё»):
 *  мягкая подложка --accent-soft под подписью --accent-text красила фон и текст
 *  ОДНИМ тоном с разницей в прозрачность — блок читался размытым пятном, а не
 *  кнопкой, и вытягивал себя полужирным, который в этой зоне непригоден (см.
 *  шапку NavItem: под backdrop-filter 600-й вес Golos замыливается). Ещё и
 *  opacity гасила строку целиком, из-за чего «скачиваем» выглядело как
 *  сломанная кнопка.
 *
 *  Что вместо: заметность даёт СПЛОШНОЙ акцент, а не вес и не размер. Подпись
 *  идёт по --text-on-accent — токен ровно для контента поверх заливки, его
 *  контраст замерян (tokens/colors.css), и обычного --fw-medium там хватает с
 *  запасом. Ни тени, ни свечения, ни градиента — правило материала не нарушено
 *  (tokens/effects.css), заметность взята одним цветом.
 *
 *  Геометрия — ровно вкладочная (NAV_H, --r-sm, --sp-4, иконка 20): строка
 *  обязана читаться как ПУНКТ панели, вставший рядом с «Настройками», а не как
 *  баннер, вклеенный снизу. Прежний блок был другой высоты, без иконки и с
 *  собственными отступами — потому и выпадал из столбца.
 *
 *  Две фазы разведены СМЫСЛОМ, а не яркостью: пока идёт загрузка, строка тихая
 *  (кликать нечего) и крутит ту же «занято»-иконку, что плеер при подготовке
 *  трека; готовность — это МОМЕНТ, когда строка загорается акцентом. Переход
 *  между ними и есть то, что ловит глаз. */
function UpdateRow({ update }: { update: SidebarUpdate }) {
  const { t } = useT();
  const ready = update.phase === "ready";
  return (
    <button
      type="button"
      // Заливка и наведение — каналом CSS (.muza-update в
      // @muza/ui/interactions.css); там же базовый transition, без которого
      // .muza-press:active не смог бы сбить длительность нажатия.
      className={ready ? "muza-update muza-press" : "muza-update"}
      // Нажать можно только когда установщик уже на диске. Пока он качается,
      // строка видна, но неактивна: человек знает, что обновление идёт, и не
      // жмёт впустую.
      disabled={!ready}
      onClick={ready ? update.onInstall : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: NAV_H,
        width: "100%",
        boxSizing: "border-box",
        marginBottom: NAV_GAP,
        padding: "0 var(--sp-4)",
        border: "none",
        borderRadius: "var(--r-sm)",
        background: "var(--update-bg)",
        color: ready ? "var(--text-on-accent)" : "var(--text-3)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body)",
        fontWeight: "var(--fw-medium)" as never,
        textAlign: "left",
        cursor: ready ? "pointer" : "default",
      }}
    >
      {ready ? (
        <Icon name="circle-arrow-up" size={20} />
      ) : (
        // Тот же глиф и тот же класс, что у «готовлю трек» в полосе плеера:
        // «занято» в приложении выглядит одинаково везде. Вращение снимается
        // системным «меньше движения» (animations.css).
        <span className="muza-spin-icon" style={{ display: "flex" }}>
          <Icon name="loader-circle" size={20} />
        </span>
      )}
      {/* Версия в подписи может быть какой угодно длины, а панель узкая:
          строка обязана обрезаться, а не переноситься на второй ряд. */}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ready ? t("sidebar.update.ready", { version: update.version }) : t("sidebar.update.downloading")}
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
  onReorderNav,
  externalDrop,
  emptyHint,
  onOpenAdmin,
  adminActive = false,
  onOpenSettings,
  settingsActive = false,
  onOpenHotkeys,
  update,
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
  /** Перестановка ВКЛАДОК в режиме правки вида (Ctrl+E): новый порядок ключей
   *  целиком. Порядок хранится не здесь, а в компоновке сайдбара
   *  (prefs.navItems), и панель о ней не знает — поэтому колбэк, а не запись.
   *  Нет обработчика (веб) — вкладки не хватаются вовсе. */
  onReorderNav?: (keys: string[]) => void;
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
  /** Найденное обновление. Нет — пункта нет вовсе. */
  update?: SidebarUpdate;
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
  // Вкладки переставляются ТОЛЬКО в режиме правки вида (Ctrl+E): вне его
  // pointerdown на пункте никем не перехватывается и клик, как и прежде,
  // просто уводит на экран.
  const navReorder = useLookReorder({
    ids: nav.map((n) => n.key),
    axis: "column",
    onReorder: onReorderNav,
    labelOf: (key) => t("lookEdit.group.navItem", { name: nav.find((n) => n.key === key)?.label ?? key }),
  });
  const idx = nav.findIndex((n) => n.key === activeNavKey);
  return (
    <aside
      // Маркер зоны для режима правки вида (shell/LookEditLayer.tsx).
      data-zone="sidebar"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        padding: "var(--pad-zone)",
        // Скругление зоны решает тема (--r-zone): у флет-вида зона прижата к
        // краям окна и скруглять ей нечего, у «воздушного» — var(--r-lg).
        borderRadius: "var(--r-zone, var(--r-lg))",
        // Материал зоны: общая плотность из ползунка «Плотность стекла»
        // (--glass-zone), поверх неё — точная подстройка --glass-sidebar, если
        // включено «стекло по зонам». Размытие у зоны есть: под сайдбаром лежит
        // фон-сценография, и без blur заливка читается как краска, а не стекло.
        background: "var(--glass-sidebar, var(--glass-zone))",
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
            // Пилюля гаснет на время перестановки: она отмечает СЛОТ активной
            // вкладки, а вкладка в этот момент едет за пальцем — оставшись на
            // месте, пилюля читалась бы как «подсветка съехала».
            opacity: idx >= 0 && !navReorder.draggingId ? 1 : 0,
            /* Пилюля активной вкладки ПЕРЕЕЗЖАЕТ — тот же закон, что у пилюль
               Tabs и ChipGroup: симметричная кривая, оба конца хода на виду. */
            transition: "transform var(--dur-state-move) var(--ease-in-out), opacity var(--dur-state-move) var(--ease-in-out)",
          }}
        ></div>
        {pickByOrder(nav, (n) => n.key, navReorder.order).map((n) => (
          <NavItem
            key={n.key}
            icon={n.icon}
            label={n.label}
            quiet
            active={activeNavKey === n.key}
            onClick={() => onSelectNav(n.key)}
            look={navReorder.active ? navReorder.itemProps(n.key) : undefined}
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
        {/* Живой порядок жеста накладывается на СЛОТЫ подвижных строк:
            закреплённые и «Любимое» в перестановку не входят и остаются на
            своих местах (applyVisibleOrder — ровно про это). */}
        {applyVisibleOrder(playlists, (p) => p.id, reorder.order).map((p) => (
          <PlaylistRow
            key={p.id}
            playlistId={p.id}
            cover={p.cover}
            name={p.name}
            meta={p.meta}
            count={p.count}
            shared={p.shared}
            dimmed={p.dimmed}
            pinned={p.pinned}
            onClick={() => onOpenPlaylist(p.id)}
            onMenu={onPlaylistMenu ? (e) => onPlaylistMenu(p, e) : undefined}
            onDropTrack={onDropTrack && !p.fixed ? (trackId) => onDropTrack(p.id, trackId) : undefined}
            externalDrop={externalDrop}
            grip={onReorderPlaylists && !p.fixed ? reorder.grip(p.id) : undefined}
            rowRef={p.fixed ? undefined : reorder.itemRef(p.id)}
            dragged={!p.fixed && reorder.draggingId === p.id}
            reordering={reorder.draggingId !== null}
          />
        ))}
      </div>
      <div style={{ marginTop: "auto" }}>
        {onOpenAdmin ? <NavItem icon="shield" label={t("sidebar.admin")} active={adminActive} onClick={onOpenAdmin} /> : null}
        {update ? <UpdateRow update={update} /> : null}
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
