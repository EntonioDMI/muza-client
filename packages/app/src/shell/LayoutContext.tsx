/** Розетка режима раскладки: контекст поверх `lib/useLayoutMode.ts`.
 *
 *  Слушатель окна ставится РОВНО ОДИН на приложение — в провайдере. Экраны
 *  зовут `useLayout()` и получают готовый снимок; будь хук живым в каждом
 *  компоненте, длинный список платил бы подпиской на resize за каждую строку.
 *
 *  ⚠️ Провайдера нет — режим `desktop`. Так живёт приложение Tauri: общие
 *  экраны ведут себя ровно как до 10.08. Живой режим включает только веб.
 *
 *  ⚠️ Без директивы "use client" — намеренно (правило пакета, см. index.ts):
 *  клиентскую границу держат приложения. */

import { createContext, useContext, type ReactNode } from "react";
import { DESKTOP_LAYOUT, useLiveLayout, type Layout } from "../lib/useLayoutMode";

const LayoutCtx = createContext<Layout>(DESKTOP_LAYOUT);

/** Живой режим (веб). Ставится выше всего видимого дерева, включая вход:
 *  экран входа тоже обязан перестраиваться на телефоне. */
export function LayoutProvider({ children }: { children: ReactNode }) {
  const layout = useLiveLayout();
  return <LayoutCtx.Provider value={layout}>{children}</LayoutCtx.Provider>;
}

/** Режим раскладки для общего экрана.
 *
 *      const { phone, compact } = useLayout();
 *      <div style={{ gap: phone ? "var(--sp-2)" : "var(--sp-4)" }}>
 *
 *  Проверять надо ПРИЗНАК (`phone`, `compact`), а не строку режима: набор
 *  режимов ещё может вырасти, а «тесно» и «одна колонка» — устойчивые вопросы. */
export function useLayout(): Layout {
  return useContext(LayoutCtx);
}

export type { Layout, LayoutMode } from "../lib/useLayoutMode";
