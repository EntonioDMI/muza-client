import React from "react";
import { Icon } from "../core/Icon.jsx";

/** Пустое состояние, которое учит интерфейсу: иконка в мягком акцентном
 *  круге, заголовок, подсказка и (опционально) действие. Не «здесь пусто»,
 *  а «вот что сделать, чтобы стало не пусто». */
export function EmptyState({ icon = "music-2", title, hint, action, style }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-8, 48px) var(--sp-5)",
        textAlign: "center",
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "var(--accent-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={28} color="var(--accent-text)" />
      </span>
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 17,
          fontWeight: 700,
          color: "var(--text-1)",
          textWrap: "balance",
        }}
      >
        {title}
      </span>
      {hint ? (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-body)",
            color: "var(--text-2)",
            maxWidth: 420,
            textWrap: "pretty",
          }}
        >
          {hint}
        </span>
      ) : null}
      {action ? <div style={{ marginTop: "var(--sp-2)" }}>{action}</div> : null}
    </div>
  );
}
