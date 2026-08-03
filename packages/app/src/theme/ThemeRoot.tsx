"use client";

/** Корень темы веба (Э1): вешает data-атрибуты и CSS-переменные темы на
 *  обёртку всего приложения — как rootStyle-див десктопа (App.tsx).
 *  Светлая тема красит и <html> (background за пределами обёртки — резинка
 *  скролла iOS, safe-area), поэтому data-theme дублируется на documentElement.
 *
 *  Передавать сюда стоит ВЕСЬ профиль настроек, а не срез: движок (themeVars)
 *  считает переменные для всех ключей оформления, и чем меньше срез — тем
 *  больше рядов настроек в браузере ничего не делают. Недостающие ключи
 *  берутся из DEFAULT_PREFS, поэтому неполный срез не ломается, а просто
 *  выглядит дефолтом. */

import { useEffect, type ReactNode } from "react";
import { buildThemeVars, themeAttrs, type ThemeInput } from "./themeVars";

export function ThemeRoot({ theme, children }: { theme: ThemeInput; children: ReactNode }) {
  const attrs = themeAttrs(theme);

  // <html> должен знать тему тоже: фон за вьюпортом (overscroll) и
  // color-scheme форм-контролов живут на корне документа
  useEffect(() => {
    const el = document.documentElement;
    if (attrs["data-theme"]) el.dataset.theme = attrs["data-theme"];
    else delete el.dataset.theme;
  }, [attrs["data-theme"]]);

  return (
    // data-muza-layer-root — цель портала плавающих слоёв (меню, диалоги,
    // выпадашки, палитра), тот же уговор, что у theme-div десктопа. Порталить
    // их в body нельзя: переменные темы лежат ИНЛАЙНОМ здесь, а не на :root —
    // в body слой взял бы дефолты дизайн-системы. Зачем портал вообще —
    // packages/ui/src/lib/layerRoot.js (стеклянный предок ломает position: fixed).
    <div
      {...attrs}
      data-muza-layer-root=""
      style={{ ...buildThemeVars(theme), minHeight: "100dvh", background: "var(--bg-0)" }}
    >
      {children}
    </div>
  );
}
