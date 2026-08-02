/** ПЕНЁК. Сборка пунктов контекстного меню переехала в общий пакет 2026-08-02:
 *  packages/app/src/shell/menuActions.ts — тем же меню живёт веб.
 *
 *  Что изменилось для приложения: НИЧЕГО. Поля MenuContext остались
 *  обязательными (тип собран как Required<…>), а пункт по-прежнему рисуется
 *  для каждого умения — просто теперь умение может отсутствовать, и тогда
 *  пункта нет. Десктоп отдаёт полный набор, поэтому его меню то же самое;
 *  стережёт это матрица menuActions.test.ts рядом.
 *
 *  Новый код пусть импортирует прямо из "@muza/app/shell/ContextMenu". */
export { buildMenuItems } from "@muza/app/shell/ContextMenu";
export type { MenuAbilities, MenuContext, MenuItem } from "@muza/app/shell/ContextMenu";
