import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@muza/ui";
import { useT } from "@muza/app/i18n";
import type { ContextTarget } from "./contextTargets";
import { buildMenuItems, type MenuContext } from "./menuActions";
import { installNativeMenuSuppressor } from "../lib/nativeContextMenu";

/** Транспорт контекстного меню: ОДИН <Menu> на всё приложение.
 *
 *  До 2026-07-20 транспорт был скопирован четырежды (App.tsx catMenu/plMenu,
 *  PlaylistView, LibraryView), каждый со своим ручным клампингом
 *  `Math.min(clientX, innerWidth - 250)` — по выдуманной ширине и без учёта
 *  uiScale, то есть МЕШАВШИМ правильному клампингу самого Menu (тот с
 *  2026-07-17 клампит сам, с учётом cssZoom). Сюда координаты кладутся
 *  сырыми.
 *
 *  Вызыватели: вью внутри провайдера — хук useContextMenu(); колбэки App
 *  (он СНАРУЖИ провайдера, потому что сам его рендерит) — через apiRef. */

export interface ContextMenuApi {
  openMenu: (
    e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void },
    target: ContextTarget,
  ) => void;
  closeMenu: () => void;
  /** Живой MenuContext — для панелей массовых действий (SelectionBar): те же
   *  действия, что в меню выделения. Читать в ОБРАБОТЧИКАХ, не в рендере:
   *  ссылка стабильна, содержимое обновляется каждым рендером App. */
  menuCtxRef: { readonly current: MenuContext };
}

const Ctx = createContext<ContextMenuApi | null>(null);

export function useContextMenu(): ContextMenuApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useContextMenu вне <ContextMenuProvider>");
  return v;
}

export function ContextMenuProvider({
  ctx,
  apiRef,
  children,
}: {
  ctx: MenuContext;
  /** App снаружи провайдера — его колбэки открывают меню через этот ref. */
  apiRef?: React.RefObject<ContextMenuApi | null>;
  children: React.ReactNode;
}) {
  const { t } = useT();
  const [state, setState] = useState<{ open: boolean; x: number; y: number; target: ContextTarget | null }>({
    open: false,
    x: 0,
    y: 0,
    target: null,
  });
  // тот же приём, что pluginLiveRef в App: мутация ref в рендере, замыкания
  // потребителей читают .current и не устаревают
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const openMenu = useCallback<ContextMenuApi["openMenu"]>((e, target) => {
    e.preventDefault(); // гасит нативное меню WebView2 при ПКМ
    e.stopPropagation();
    setState({ open: true, x: e.clientX, y: e.clientY, target });
  }, []);
  const closeMenu = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const api = useMemo(() => ({ openMenu, closeMenu, menuCtxRef: ctxRef }), [openMenu, closeMenu]);

  useEffect(() => {
    if (apiRef) apiRef.current = api;
  }, [api, apiRef]);

  // Тема ПКМ целиком живёт здесь: подавитель нативного меню WebView2 (кроме
  // текстовых полей) ставится вместе с провайдером — lib/nativeContextMenu.ts
  useEffect(() => installNativeMenuSuppressor(), []);

  // target сохраняется при закрытии (open:false), чтобы exit-анимация Menu
  // дорисовала те же пункты, а не пустую панель
  const items = useMemo(() => (state.target ? buildMenuItems(state.target, ctx, t) : []), [state.target, ctx, t]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Menu open={state.open} x={state.x} y={state.y} items={items} onClose={closeMenu} />
    </Ctx.Provider>
  );
}
