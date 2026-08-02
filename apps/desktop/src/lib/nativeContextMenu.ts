/** ПЕНЁК. Подавитель нативного контекстного меню переехал в общий пакет
 *  2026-08-02: packages/app/src/lib/nativeContextMenu.ts — он чисто DOM-ный и
 *  ставится вместе с провайдером меню, а провайдер теперь общий.
 *
 *  В браузере подавитель НЕ ставится (ContextMenuProvider suppressNativeMenu =
 *  false): своё меню строк там открывается через preventDefault самого
 *  события, а меню браузера остаётся человеку. */
export { NATIVE_MENU_SELECTOR, installNativeMenuSuppressor, isTextField } from "@muza/app/lib/nativeContextMenu";
