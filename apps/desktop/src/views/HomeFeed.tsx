/** Пенёк-обёртка: сама главная переехала в @muza/app/views/HomeFeed (волна
 *  экранов веб-паритета, 2026-08-02) — веб рисовал свою, и экраны разъехались
 *  (у веба не было ни полок «В тренде»/«Новое в каталоге», ни стрелок-
 *  листалок, ни дисплейных заголовков).
 *
 *  Почему не голый `export *`, как у i18n или DragLayer: общему экрану нужны
 *  ТРИ умения, которых у браузера нет и в общий пакет им нельзя —
 *  оффлайн-копия ленты (localStorage приложения), прогрев добычи (Tauri) и
 *  словарь имён источников. Обёртка их подставляет и НИЧЕГО больше не делает:
 *  App.tsx зовёт HomeFeed ровно теми же пропсами, что и раньше, картинка
 *  прежняя до пикселя.
 *
 *  Новый код (внутри приложения) может звать общий экран напрямую — но тогда
 *  обязан подставить эти три пропса сам. */

import { withSnapshot } from "../lib/offlineSnapshot";
import { primarySourceLabel } from "../lib/format";
import { useWarmRow } from "../player/useWarmer";
import { useT } from "../i18n";
import { HomeFeed as SharedHomeFeed } from "@muza/app/views/HomeFeed";
import type { View } from "../types";

type SharedProps = React.ComponentProps<typeof SharedHomeFeed>;
/** Наружу — прежний контракт: `onOpen` в терминах экранов приложения. */
type Props = Omit<SharedProps, "onOpen" | "withSnapshot" | "warmRow" | "sourceLabel" | "onSections" | "padding"> & {
  onOpen: (v: View) => void;
};

export function HomeFeed(props: Props) {
  const warmRow = useWarmRow();
  const { lang } = useT();
  return (
    <SharedHomeFeed
      {...props}
      withSnapshot={withSnapshot}
      warmRow={warmRow}
      sourceLabel={(sources) => primarySourceLabel(sources, lang)}
    />
  );
}
