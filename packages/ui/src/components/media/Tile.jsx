import React from "react";
import { Icon } from "../core/Icon.jsx";
import { IconButton } from "../core/IconButton.jsx";
import { Cover } from "./Cover.jsx";

/** Media tile — soft rounded card with square cover; play pill appears on
 *  hover AND keyboard focus. The tile itself is a keyboard target
 *  (role=button, Enter/Space = onClick).
 *  Обложка — через Cover: нет картинки → плейсхолдер, а не дыра в плитке.
 *  width: дефолт — var(--w-tile, 176px), а не число: приложение крутит размер
 *  плиток одной переменной (настройка «Размер плитки», зона 4 спеки 19.07);
 *  явный width ("auto" в сетках) по-прежнему сильнее.
 *
 *  ⚠️ ПОДСВЕТКА — БЕЗ СОСТОЯНИЯ REACT (2026-08-05). Фон плитки и появление
 *  play-пилюли красит канал .muza-tile (interactions.css); ручной разбор
 *  e.relatedTarget в onBlur заменил :focus-within — он не оставляет плитку
 *  подсвеченной, когда сетка уехала из-под неподвижного курсора (прокрутка,
 *  смена фильтра). Пилюля и раньше была смонтирована всегда, так что здесь
 *  переезд ничего не стоил: ушли два useState и две перерисовки на проход. */
export function Tile({ cover, title, subtitle, width = "var(--w-tile, 176px)", playing = false, selected = false, onPlay, onClick, onMenu, playLabel = "Play", pauseLabel = "Pause" }) {
  return (
    <div
      // Отклик на нажатие — плитка жмётся под пальцем (animations.css).
      // Только кликабельная: у декоративной плитки жать нечего.
      // muza-tile — канал подсветки, и он же несёт transition плитки: инлайном
      // тот перекрывал .muza-press целиком (interactions.css).
      className={onClick ? "muza-press muza-tile" : "muza-tile"}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? title : undefined}
      // ПКМ = то же меню, что «⋯» у TrackRow (нативное браузерное меню в плеере — мусор)
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(e);
            }
          : undefined
      }
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onClick && e.target === e.currentTarget) {
          e.preventDefault();
          onClick();
        }
      }}
      onClick={onClick}
      aria-selected={selected || undefined}
      style={{
        width,
        flex: "none",
        padding: "var(--pad-tile)",
        borderRadius: "var(--r-md)",
        background: selected ? "var(--surface-4)" : "var(--tile-bg)",
        cursor: "pointer",
      }}
    >
      <div style={{ position: "relative", marginBottom: "var(--sp-3)" }}>
        <Cover src={cover} />
        {/* галочка выделения — ЛЕВЫЙ верх: правый низ занят play-пилюлей */}
        {selected ? (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 8,
              top: 8,
              width: 24,
              height: 24,
              borderRadius: "var(--r-pill)",
              background: "var(--accent)",
              display: "grid",
              placeItems: "center",
              color: "var(--text-1)",
            }}
          >
            <Icon name="check" size={16} color="currentColor" />
          </div>
        ) : null}
        <div
          style={{
            position: "absolute",
            right: 8,
            bottom: 8,
            // играющая плитка держит пилюлю показанной и без наведения: это
            // ответ на «что сейчас звучит», а не аффорданс
            opacity: playing ? 1 : "var(--tile-pill)",
            transform: playing ? "translateY(0)" : "var(--tile-pill-y)",
            /* Пилюля ЕДЕТ — значит это --dur-state-move, а не --dur-state:
               единственная часть плитки с ненулевым путём, и именно она даёт
               то «медленно и правильно», о котором говорил владелец. */
            transition: "opacity var(--dur-state-move) var(--ease-out), transform var(--dur-state-move) var(--ease-out)",
          }}
        >
          <IconButton
            icon={playing ? "pause" : "play"}
            variant="accent"
            label={playing ? pauseLabel : playLabel}
            onClick={(e) => { if (e) e.stopPropagation(); if (onPlay) onPlay(); }}
          />
        </div>
      </div>
      <div
        style={{
          fontSize: "var(--fs-body)",
          fontWeight: "var(--fw-semibold)",
          color: "var(--text-1)",
          lineHeight: "var(--lh-ui)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {title}
      </div>
      {subtitle ? (
        <div
          style={{
            fontSize: "var(--fs-caption)",
            color: "var(--text-2)",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}
