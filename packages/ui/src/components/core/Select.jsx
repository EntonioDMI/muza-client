import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";

/** Выпадающий список — поле в стиле инпутов ДС + морозная панель опций.
 *  position: fixed — не режется overflow-контейнерами (панели настроек
 *  скроллятся); при нехватке места снизу раскрывается вверх.
 *  Клавиатура: Enter/Space/↓ открывают, ↑↓/Home/End ходят, Enter выбирает,
 *  Escape/клик-мимо закрывают, фокус возвращается на поле. */
export function Select({ items = [], value, onChange, ariaLabel, width = 220, disabled = false, style }) {
  const norm = items.map((it) => (typeof it === "string" ? { key: it, label: it } : it));
  const selected = norm.find((it) => it.key === value) ?? null;

  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [hover, setHover] = useState(false);

  // позиция панели от поля; переворот вверх у нижнего края окна
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const panelH = Math.min(norm.length * 44 + 12, 292);
    const below = window.innerHeight - r.bottom;
    setPanelPos({
      left: r.left,
      width: r.width,
      ...(below < panelH + 8 && r.top > panelH
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
    });
  }, [open, norm.length]);

  // фокус в выбранную опцию на открытии, возврат на поле при закрытии
  useEffect(() => {
    if (!open) return;
    const nodes = panelRef.current?.querySelectorAll('[role="option"]') ?? [];
    const idx = Math.max(norm.findIndex((it) => it.key === value), 0);
    nodes[idx]?.focus();
    return () => triggerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const moveFocus = (delta, edge) => {
    const nodes = [...(panelRef.current?.querySelectorAll('[role="option"]') ?? [])];
    if (nodes.length === 0) return;
    if (edge === "first") return nodes[0].focus();
    if (edge === "last") return nodes[nodes.length - 1].focus();
    const i = nodes.indexOf(document.activeElement);
    nodes[(i + delta + nodes.length) % nodes.length].focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--sp-3)",
          width,
          height: 40,
          padding: "0 var(--sp-3) 0 var(--sp-4)",
          border: "none",
          /* «скругление по типам»: поле селекта — поле; дефолт — md */
          borderRadius: "var(--r-field, var(--r-md))",
          background: open || hover ? "var(--surface-4)" : "var(--surface-3)",
          color: "var(--text-1)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-body)",
          fontWeight: 500,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.4 : 1,
          transition: "background var(--dur-fast) var(--ease-out)",
          boxSizing: "border-box",
          ...style,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", minWidth: 0 }}>
          {selected?.icon ? <Icon name={selected.icon} size={16} color="var(--text-2)" /> : null}
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {selected ? selected.label : "—"}
          </span>
        </span>
        <Icon
          name="chevron-down"
          size={16}
          color="var(--text-3)"
          style={{
            flex: "none",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform var(--dur-base) var(--ease-out)",
          }}
        />
      </button>

      {open && panelPos ? (
        <div
          onClick={() => setOpen(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 150 }}
        >
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            className="muza-view"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
              else if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
              else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
              else if (e.key === "Home") { e.preventDefault(); moveFocus(0, "first"); }
              else if (e.key === "End") { e.preventDefault(); moveFocus(0, "last"); }
              else if (e.key === "Tab") { e.preventDefault(); moveFocus(e.shiftKey ? -1 : 1); }
            }}
            style={{
              position: "fixed",
              ...panelPos,
              maxHeight: 292,
              overflowY: "auto",
              padding: "var(--sp-2)",
              borderRadius: "var(--r-md)",
              /* выпадающая панель — то же стекло, что у меню */
              background: "var(--glass-menu, var(--glass-panel))",
              backdropFilter: "blur(var(--blur-glass))",
              WebkitBackdropFilter: "blur(var(--blur-glass))",
              boxSizing: "border-box",
              scrollbarWidth: "thin",
            }}
          >
            {norm.map((it) => {
              const active = it.key === value;
              return (
                <button
                  key={it.key}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setOpen(false);
                    if (onChange) onChange(it.key);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpen(false);
                      if (onChange) onChange(it.key);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-3)",
                    width: "100%",
                    minHeight: 40,
                    padding: "0 var(--sp-3)",
                    border: "none",
                    borderRadius: "var(--r-sm)",
                    background: active ? "var(--surface-4)" : "transparent",
                    color: "var(--text-1)",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--fs-body)",
                    fontWeight: active ? 600 : 500,
                    textAlign: "left",
                    cursor: "pointer",
                    boxSizing: "border-box",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "var(--surface-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {it.icon ? <Icon name={it.icon} size={16} color={active ? "var(--accent-text)" : "var(--text-2)"} /> : null}
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {it.label}
                  </span>
                  {active ? <Icon name="check" size={16} color="var(--accent-text)" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
