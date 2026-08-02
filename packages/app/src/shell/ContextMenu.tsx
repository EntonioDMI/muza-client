import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@muza/ui";
import { useT } from "../i18n";
import type { ContextTarget } from "./contextTargets";
import { buildMenuItems, type MenuAbilities, type MenuContext } from "./menuActions";
import { installNativeMenuSuppressor } from "../lib/nativeContextMenu";

/** Транспорт контекстного меню: ОДИН <Menu> на всё приложение.
 *
 *  Переехал из apps/desktop/src/shell/ContextMenu.tsx 2026-08-02 — тем же
 *  меню теперь живёт и веб; на старом месте пенёк-ре-экспорт.
 *
 *  До 2026-07-20 транспорт был скопирован четырежды (App.tsx catMenu/plMenu,
 *  PlaylistView, LibraryView), каждый со своим ручным клампингом
 *  `Math.min(clientX, innerWidth - 250)` — по выдуманной ширине и без учёта
 *  uiScale, то есть МЕШАВШИМ правильному клампингу самого Menu (тот с
 *  2026-07-17 клампит сам, с учётом cssZoom). Сюда координаты кладутся
 *  сырыми.
 *
 *  Вызыватели: вью внутри провайдера — хук useContextMenu(); колбэки App
 *  (он СНАРУЖИ провайдера, потому что сам его рендерит) — через apiRef.
 *
 *  ⚠️ Ре-экспорт целей и сборки пунктов внизу файла — НЕ украшение: подпути
 *  пакета объявлены как "./shell/*": "./src/shell/*.tsx", то есть соседние
 *  .ts-модули снаружи пакета не резолвятся. Пока ведущий не заведёт им
 *  подпути, единственный вход для приложений — "@muza/app/shell/ContextMenu". */

export interface ContextMenuApi<C extends MenuAbilities = MenuContext> {
  openMenu: (
    e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void },
    target: ContextTarget,
  ) => void;
  closeMenu: () => void;
  /** Живой набор умений — для панелей массовых действий (SelectionBar): те же
   *  действия, что в меню выделения. Читать в ОБРАБОТЧИКАХ, не в рендере:
   *  ссылка стабильна, содержимое обновляется каждым рендером App.
   *
   *  ⚠️ По умолчанию типизирован ПОЛНЫМ набором (десктоп): хук не знает, что
   *  положил провайдер. Площадка с неполным набором обязана указать свой тип —
   *  useContextMenu<МойНабор>() — иначе поле окажется undefined в рантайме. */
  menuCtxRef: { readonly current: C };
}

const Ctx = createContext<ContextMenuApi<MenuAbilities> | null>(null);

export function useContextMenu<C extends MenuAbilities = MenuContext>(): ContextMenuApi<C> {
  const v = useContext(Ctx);
  if (!v) throw new Error("useContextMenu вне <ContextMenuProvider>");
  return v as ContextMenuApi<C>;
}

export function ContextMenuProvider<C extends MenuAbilities>({
  ctx,
  apiRef,
  suppressNativeMenu = true,
  children,
}: {
  ctx: C;
  /** App снаружи провайдера — его колбэки открывают меню через этот ref. */
  apiRef?: React.RefObject<ContextMenuApi<C> | null>;
  /** false — нативное меню площадки НЕ давится глобально (веб: у браузера своё
   *  меню со «Открыть в новой вкладке»/«Назад», отбирать его на сайте нельзя).
   *  На строках это ничего не меняет: openMenu сам зовёт preventDefault. */
  suppressNativeMenu?: boolean;
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

  const openMenu = useCallback<ContextMenuApi<C>["openMenu"]>((e, target) => {
    e.preventDefault(); // гасит нативное меню WebView2 при ПКМ
    e.stopPropagation();
    setState({ open: true, x: e.clientX, y: e.clientY, target });
  }, []);
  const closeMenu = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const api = useMemo<ContextMenuApi<C>>(
    () => ({ openMenu, closeMenu, menuCtxRef: ctxRef }),
    [openMenu, closeMenu],
  );

  useEffect(() => {
    if (apiRef) apiRef.current = api;
  }, [api, apiRef]);

  // Тема ПКМ целиком живёт здесь: подавитель нативного меню WebView2 (кроме
  // текстовых полей) ставится вместе с провайдером — lib/nativeContextMenu.ts
  useEffect(() => {
    if (!suppressNativeMenu) return;
    return installNativeMenuSuppressor();
  }, [suppressNativeMenu]);

  // target сохраняется при закрытии (open:false), чтобы exit-анимация Menu
  // дорисовала те же пункты, а не пустую панель
  const items = useMemo(() => (state.target ? buildMenuItems(state.target, ctx, t) : []), [state.target, ctx, t]);

  return (
    <Ctx.Provider value={api as ContextMenuApi<MenuAbilities>}>
      {children}
      <Menu open={state.open} x={state.x} y={state.y} items={items} onClose={closeMenu} />
    </Ctx.Provider>
  );
}

// — единая точка входа для приложений (см. шапку про подпути пакета) —
export type { ContextTarget, TrackPlace, LocalFileEntry, QueueTrackData } from "./contextTargets";
export { buildMenuItems } from "./menuActions";
export type { MenuAbilities, MenuContext, MenuItem, MenuPluginItem, MenuPluginSlot } from "./menuActions";
