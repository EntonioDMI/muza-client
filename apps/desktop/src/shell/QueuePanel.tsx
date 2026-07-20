/** Очередь (UX-доводка 2026-07-11): секции «История / Сейчас / Далее»,
 *  удаление/перестановка/очистка хвоста, «Сохранить как плейлист»,
 *  «К текущему». Закрытая панель НЕ живёт в DOM (unmount) — Tab не попадает
 *  в невидимые кнопки; фокус при открытии — в панель, при закрытии App
 *  возвращает его на кнопку очереди. */

import { useEffect, useRef, useState } from "react";
import { Cover, Icon, IconButton } from "@muza/ui";
import { toCatalog, type PlayerTrack } from "../player/types";
import { fmtTime } from "../lib/format";
import { useContextMenu } from "./ContextMenu";
import { SelectionBar } from "./SelectionBar";
import { useMultiSelect } from "../lib/useMultiSelect";
import { useT } from "../i18n";

function QueueRow({
  track,
  position,
  current,
  playing,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
  onMenu,
  selected = false,
  onClickCapture,
}: {
  track: PlayerTrack;
  position: number;
  current: boolean;
  playing: boolean;
  onPlay: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** ПКМ по строке (2026-07-20) — контекстное меню очереди. */
  onMenu?: (e: React.MouseEvent) => void;
  /** Строка в множественном выделении (2026-07-20). */
  selected?: boolean;
  /** Capture-перехват клика для выделения (Ctrl/Shift/режим). */
  onClickCapture?: (e: React.MouseEvent) => void;
}) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  // кнопки видимы при наведении И при клавиатурном фокусе внутри ряда
  const showActions = hover || focused;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      }}
      onContextMenu={onMenu}
      onClickCapture={onClickCapture}
      aria-selected={selected || undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        padding: "var(--sp-2)",
        borderRadius: "var(--r-sm)",
        // выделение сильнее «текущего» — как в TrackRow ДС
        background: selected ? "var(--surface-4)" : current ? "var(--surface-3)" : hover ? "var(--surface-2)" : "transparent",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
      data-queue-current={current || undefined}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={t("dialogs.queue.playAria", { artist: track.artist, title: track.title })}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          flex: 1,
          minWidth: 0,
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ width: 22, flex: "none", textAlign: "right", fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
          {current ? <Icon name={playing ? "volume-2" : "pause"} size={14} color="var(--accent-text)" /> : position}
        </span>
        <Cover src={track.cover} size={36} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "block",
              fontSize: "var(--fs-body)",
              fontWeight: current ? 600 : 500,
              color: current ? "var(--accent-text)" : "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.title}
          </span>
          <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {track.artist}
          </span>
        </span>
      </button>
      {showActions && (onMoveUp || onMoveDown || onRemove) ? (
        <span style={{ display: "flex", gap: 2, flex: "none" }}>
          {onMoveUp ? <IconButton icon="chevron-up" size="sm" label={t("dialogs.queue.moveUp")} onClick={onMoveUp} style={{ width: 28, height: 28 }} iconSize={15} /> : null}
          {onMoveDown ? <IconButton icon="chevron-down" size="sm" label={t("dialogs.queue.moveDown")} onClick={onMoveDown} style={{ width: 28, height: 28 }} iconSize={15} /> : null}
          {onRemove ? <IconButton icon="x" size="sm" label={t("dialogs.queue.remove")} onClick={onRemove} style={{ width: 28, height: 28 }} iconSize={15} /> : null}
        </span>
      ) : (
        <span style={{ flex: "none", fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
          {fmtTime(track.duration)}
        </span>
      )}
    </div>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--sp-2) var(--sp-2) 0" }}>
      <span
        style={{
          fontSize: "var(--fs-caption)",
          fontWeight: 600,
          letterSpacing: "var(--ls-caps)",
          textTransform: "uppercase",
          color: "var(--text-3)",
        }}
      >
        {children}
      </span>
      {action}
    </div>
  );
}

export function QueuePanel({
  open,
  tracks,
  currentIndex,
  playing,
  canSave,
  onPlayTrack,
  onClose,
  onRemove,
  onMove,
  onClearUpNext,
  onSaveAsPlaylist,
  onRowMenu,
  onRemoveMany,
}: {
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
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── множественное выделение (2026-07-20) ──
  // ⚠️ ключ выделения — id трека; повторный трек в очереди (редкость) выделится
  // обеими строками — осознанный компромисс против позиционных ключей.
  // Диапазоны Shift — по ПЛОСКОМУ tracks, секции История/Сейчас/Далее не рвут их.
  const multi = useMultiSelect(tracks.map((tr) => tr.id));
  const { openMenu, menuCtxRef } = useContextMenu();
  const selectedCatalog = () =>
    tracks.filter((tr) => multi.has(tr.id)).flatMap((tr) => {
      const ct = toCatalog(tr);
      return ct ? [ct] : [];
    });
  // закрылась панель — выделение не должно пережить её (открыл заново — чисто)
  useEffect(() => {
    if (!open) multi.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rowSelection = (tr: PlayerTrack) => ({
    selected: multi.has(tr.id),
    onClickCapture: (e: React.MouseEvent) => {
      if (multi.onItemClick(tr.id, e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  });

  /** ПКМ: по выделенному — меню выделения, по невыделенному — сброс + меню строки. */
  const rowMenu = (tr: PlayerTrack, index: number) => (e: React.MouseEvent) => {
    if (multi.count > 0 && multi.has(tr.id)) {
      openMenu(e, {
        kind: "selection",
        tracks: selectedCatalog(),
        place: "queue",
        ctl: {
          remove: onRemoveMany ? { scope: "queue", run: () => onRemoveMany(multi.ids) } : undefined,
          clear: multi.clear,
        },
      });
      return;
    }
    if (multi.count > 0) multi.clear();
    onRowMenu?.(tr, index, e);
  };

  // ⚠️ НЕ scrollIntoView и НЕ focus() без preventScroll: оба прокручивают ВСЕХ
  // скроллируемых предков, а не только этот список. Корень приложения —
  // overflow:hidden, но программно он всё равно скроллится, а вернуть его нечем
  // (полосы нет) — поэтому при открытии длинной очереди весь интерфейс залипал
  // сдвинутым вверх (жалоба владельца 2026-07-19). Скроллим строго свой контейнер.
  const scrollToCurrent = (smooth: boolean) => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>("[data-queue-current]");
    if (!list || !el) return;
    const top =
      list.scrollTop +
      (el.getBoundingClientRect().top - list.getBoundingClientRect().top) -
      (list.clientHeight - el.offsetHeight) / 2;
    if (smooth && typeof list.scrollTo === "function") list.scrollTo({ top, behavior: "smooth" });
    else list.scrollTop = top;
  };

  // Открытие: фокус в панель (Esc из App работает) + текущий трек в видимости
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    scrollToCurrent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Закрытие по клику на пустое место (2026-07-20). Полноэкранный backdrop НЕ
  // годится: плеер-бар на zIndex 40 — НИЖЕ панели (50), слой съел бы клики по
  // всему бару. Вместо него точечный слушатель с тремя исключениями: свои
  // клики; кнопка-переключатель (иначе toggle схлопывался бы в «закрыл здесь —
  // открыл кликом» мигание); меню, открытое ИЗ очереди (клик по его ПУНКТУ не
  // должен ронять панель — а клик по его фону закрывает и меню, и очередь
  // одним движением, это сознательно).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest("[data-queue-toggle]")) return;
      if (target.closest('[role="menu"]')) return;
      onClose();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, onClose]);

  if (!open) return null; // unmount: закрытая панель не ловит Tab

  const history = tracks.slice(0, Math.max(currentIndex, 0));
  const current = tracks[currentIndex];
  const upNext = tracks.slice(currentIndex + 1);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("player.queue")}
      tabIndex={-1}
      style={{
        position: "absolute",
        right: "var(--gap-zone)",
        bottom: "calc(var(--h-playerbar) + 2 * var(--gap-zone))",
        width: 380,
        maxHeight: 460,
        borderRadius: "var(--r-lg)",
        // очередь визуально принадлежит плееру — то же зональное стекло
        background: "var(--glass-player, var(--glass-panel))",
        backdropFilter: "blur(var(--blur-glass))",
        WebkitBackdropFilter: "blur(var(--blur-glass))",
        padding: "var(--sp-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        zIndex: 50,
        outline: "none",
        animation: "muzaMenuIn var(--dur-base) var(--ease-out)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "0 var(--sp-2)" }}>
        <span
          style={{
            flex: 1,
            fontSize: "var(--fs-caption)",
            fontWeight: 600,
            letterSpacing: "var(--ls-caps)",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          {t("player.queue")}{tracks.length > 0 ? t("dialogs.queue.countSuffix", { count: tracks.length }) : ""}
        </span>
        {tracks.length > 0 ? (
          <IconButton icon="locate" size="sm" label={t("dialogs.queue.toCurrent")} onClick={() => scrollToCurrent(true)} style={{ width: 28, height: 28 }} iconSize={15} />
        ) : null}
        {canSave && tracks.length > 0 ? (
          <IconButton icon="save" size="sm" label={t("dialogs.queue.saveAsPlaylist")} onClick={onSaveAsPlaylist} style={{ width: 28, height: 28 }} iconSize={15} />
        ) : null}
        <IconButton icon="x" size="sm" label={t("dialogs.queue.closeQueue")} onClick={onClose} style={{ width: 28, height: 28 }} iconSize={16} />
      </div>

      {tracks.length === 0 ? (
        <div style={{ padding: "var(--sp-6) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.5 }}>
          {t("dialogs.queue.empty")}
        </div>
      ) : (
        // overflowX:hidden обязателен: overflow-y:auto переводит overflow-x из
        // visible в auto — снизу вылезала лишняя горизонтальная полоса (жалоба
        // владельца 2026-07-19; проявилось, когда полоса ДС стала 11px и контент
        // перестал влезать по ширине). Прятать нечего: заголовки строк и так
        // режутся ellipsis. Тот же паттерн — ReplaceVersionDialog,
        // PlaylistIconPicker, VersionsDialog.
        <div
          ref={listRef}
          style={{ overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 2 }}
        >
          {history.length > 0 ? (
            <>
              <SectionLabel
                action={
                  <button
                    type="button"
                    onClick={() => setHistoryOpen((v) => !v)}
                    style={{ border: "none", background: "none", color: "var(--text-3)", fontSize: "var(--fs-caption)", cursor: "pointer", padding: 0 }}
                  >
                    {historyOpen ? t("dialogs.queue.collapse") : t("dialogs.queue.showCount", { count: history.length })}
                  </button>
                }
              >
                {t("dialogs.queue.history")}
              </SectionLabel>
              {historyOpen
                ? history.map((t, i) => (
                    <QueueRow
                      key={`${t.id}:${i}`}
                      track={t}
                      position={i + 1}
                      current={false}
                      playing={false}
                      onPlay={() => onPlayTrack(t.id)}
                      onRemove={() => onRemove(t.id)}
                      onMenu={rowMenu(t, i)}
                      {...rowSelection(t)}
                    />
                  ))
                : null}
            </>
          ) : null}

          {current ? (
            <>
              <SectionLabel>{t("dialogs.queue.nowSection")}</SectionLabel>
              <QueueRow
                track={current}
                position={currentIndex + 1}
                current
                playing={playing}
                onPlay={() => onPlayTrack(current.id)}
                onRemove={() => onRemove(current.id)}
                onMenu={rowMenu(current, currentIndex)}
                {...rowSelection(current)}
              />
            </>
          ) : null}

          {upNext.length > 0 ? (
            <>
              <SectionLabel
                action={
                  <button
                    type="button"
                    onClick={onClearUpNext}
                    style={{ border: "none", background: "none", color: "var(--text-3)", fontSize: "var(--fs-caption)", cursor: "pointer", padding: 0 }}
                  >
                    {t("dialogs.queue.clear")}
                  </button>
                }
              >
                {t("dialogs.queue.upNext", { count: upNext.length })}
              </SectionLabel>
              {upNext.map((t, i) => (
                <QueueRow
                  key={`${t.id}:${currentIndex + 1 + i}`}
                  track={t}
                  position={currentIndex + 2 + i}
                  current={false}
                  playing={false}
                  onPlay={() => onPlayTrack(t.id)}
                  onRemove={() => onRemove(t.id)}
                  onMoveUp={i > 0 ? () => onMove(t.id, -1) : undefined}
                  onMoveDown={i < upNext.length - 1 ? () => onMove(t.id, 1) : undefined}
                  onMenu={rowMenu(t, currentIndex + 1 + i)}
                  {...rowSelection(t)}
                />
              ))}
            </>
          ) : (
            <div style={{ padding: "var(--sp-3) var(--sp-2)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
              {t("dialogs.queue.upNextEmpty")}{canSave ? t("dialogs.queue.upNextEmptyHint") : ""}.
            </div>
          )}
        </div>
      )}

      {/* Панель массовых действий выделения: без playNext/queue — они
          добавляли бы КОПИИ уже стоящих в очереди треков */}
      {multi.count > 0 ? (
        <SelectionBar
          label={t("menu.selection.count", { count: multi.count })}
          clearLabel={t("menu.selection.clear")}
          onClear={multi.clear}
          actions={[
            {
              icon: "plus",
              label: t("menu.addToPlaylist"),
              onClick: () => menuCtxRef.current.addManyToPlaylist(selectedCatalog()),
            },
            {
              icon: "heart",
              label: t("menu.catalog.like"),
              onClick: () => menuCtxRef.current.likeMany(selectedCatalog().map((x) => x.id)),
            },
            ...(onRemoveMany
              ? [
                  {
                    icon: "list-x",
                    label: t("menu.queue.remove"),
                    danger: true,
                    onClick: () => onRemoveMany(multi.ids),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
    </div>
  );
}
