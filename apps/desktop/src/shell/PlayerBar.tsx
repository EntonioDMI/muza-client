/** Пенёк-обёртка: полоса плеера переехала в @muza/app (Э3 веб-паритета,
 *  2026-08-02) — веб рисовал свою, «по памяти», и разъезжался с приложением.
 *  App.tsx зовёт этот файл ровно как раньше, теми же пропами.
 *
 *  Обёртка, а не голый ре-экспорт, ради ОДНОГО умения: перечисление устройств
 *  вывода. Оно живёт в player/outputDevices.ts (разовая разблокировка имён
 *  через getUserMedia + фильтрация виртуальных устройств) и в общий пакет не
 *  переезжает — знание про аргументы окна WebView2 приложенческое. Общая
 *  полоса просит список ПРОПОМ; браузер его не даёт, и меню вывода там не
 *  появляется вовсе.
 *
 *  Ни одного узла DOM обёртка не добавляет — рендер приложения прежний. */

import type { ComponentProps } from "react";
import { PlayerBar as SharedPlayerBar } from "@muza/app/shell/PlayerBar";
import { listOutputDevices } from "../player/outputDevices";

export type { PluginBarButtonView } from "@muza/app/shell/PlayerBar";

/** Пропы приложения = пропы общей полосы минус то, что подставляет обёртка,
 *  и минус вебовские крючки внешнего вида: приложение живёт на инлайновых
 *  стилях самой полосы и передавать их не должно. */
type DesktopPlayerBarProps = Omit<
  ComponentProps<typeof SharedPlayerBar>,
  "listOutputDevices" | "className" | "progressStyle" | "subtitle" | "extraButtons"
>;

export function PlayerBar(props: DesktopPlayerBarProps) {
  return <SharedPlayerBar {...props} listOutputDevices={listOutputDevices} />;
}
