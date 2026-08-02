"use client";

/** Плашка «доступно в приложении» (Э1 веб-паритета, 2026-07-21).
 *  Решение-разворот: раньше недоступное на вебе ПРЯТАЛОСЬ (decisions.md
 *  2026-07-15 «отсутствие поля, а не заглушка»); владелец 2026-07-21 решил
 *  наоборот — показывать возможности десктопа витриной: посмотреть можно,
 *  изменить нельзя, рядом путь к полной версии. Запись — decisions.md.
 *
 *  Использование: рядом с заголовком секции — <DesktopOnly compact/>;
 *  блоком под перечень возможностей — <DesktopOnly>описание</DesktopOnly>. */

import type { ReactNode } from "react";
import { useT } from "../i18n";

const LANDING_URL = "https://muza.lol";

/** Оверлей-вариант (по слову владельца, утро 21.07): функция ОТРИСОВАНА —
 *  видно, что это и как выглядит, — но перекрыта стеклом: менять нельзя,
 *  на плашке путь к полной версии. Таких плашек на вебе много — это норма,
 *  не исключение.
 *
 *  И5-веб (2026-07-22): "Скачать Muza"/дефолтная подсказка переведены через
 *  useT() (web.desktopOnly.*) — единственный потребитель компонента (web),
 *  который к этому моменту уже обёрнут в LanguageProvider (providers.tsx).
 *
 *  ⚠️ ПОЧЕМУ ЗДЕСЬ ЗАКОННО ЧИТАТЬ web.* (проверка волны 8, 2026-08-02).
 *  Общему коду ходить в раздел словаря одной площадки нельзя — приложение
 *  показывало бы «веб»-строки (так поймали LibraryView с вкладкой «История»,
 *  её строки уехали в views.library.*). Эта плашка — исключение по смыслу, а
 *  не по недосмотру: она СУЩЕСТВУЕТ только на вебе и говорит «скачай
 *  приложение для Windows». В самом приложении её нельзя показать в принципе,
 *  поэтому дом её строк — web.desktopOnly.*, а не views.*. Лежит она в общем
 *  пакете лишь потому, что делит с ним стили и useT(). */
export function DesktopOnlyOverlay({ children, hint }: { children: ReactNode; hint?: string }) {
  const { t } = useT();
  return (
    <div style={{ position: "relative" }}>
      <div aria-hidden="true" style={{ opacity: 0.45, pointerEvents: "none", userSelect: "none" }}>
        {children}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--sp-4, 16px)",
        }}
      >
        <div
          role="note"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--sp-3, 12px)",
            padding: "var(--sp-4, 16px) var(--sp-5, 20px)",
            borderRadius: "var(--r-md)",
            background: "var(--glass-deep)",
            backdropFilter: "blur(var(--blur-glass))",
            WebkitBackdropFilter: "blur(var(--blur-glass))",
            textAlign: "center",
            maxWidth: 360,
          }}
        >
          <span style={{ color: "var(--text-1)", fontSize: "var(--fs-body)", fontWeight: 600 }}>
            {hint ?? t("web.desktopOnly.defaultHint")}
          </span>
          <a
            href={LANDING_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 40,
              padding: "0 var(--sp-5, 20px)",
              borderRadius: "var(--r-pill)",
              background: "var(--accent)",
              color: "var(--text-on-accent, #fff)",
              fontWeight: 600,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {t("web.desktopOnly.download")}
          </a>
        </div>
      </div>
    </div>
  );
}

export function DesktopOnly({ children, compact = false }: { children?: ReactNode; compact?: boolean }) {
  const { t } = useT();
  if (compact) {
    return (
      <a
        href={LANDING_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={t("web.desktopOnly.downloadTitle")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 10px",
          borderRadius: "var(--r-pill)",
          background: "var(--accent-soft)",
          color: "var(--accent-text)",
          fontSize: "var(--fs-caption)",
          fontWeight: 600,
          whiteSpace: "nowrap",
          textDecoration: "none",
        }}
      >
        {t("web.desktopOnly.inApp")}
      </a>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--sp-3, 12px)",
        padding: "var(--sp-4, 16px)",
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
      }}
    >
      <div style={{ flex: 1, minWidth: 200, color: "var(--text-2)", fontSize: "var(--fs-body)" }}>
        {children ?? t("web.desktopOnly.childrenFallback")}
      </div>
      <a
        href={LANDING_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 40,
          padding: "0 var(--sp-5, 20px)",
          borderRadius: "var(--r-pill)",
          background: "var(--accent)",
          color: "var(--text-on-accent, #fff)",
          fontWeight: 600,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        {t("web.desktopOnly.download")}
      </a>
    </div>
  );
}
