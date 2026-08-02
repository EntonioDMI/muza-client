/** ТОНКАЯ ОБЁРТКА. Сам экран переехал в @muza/app/views/PlaylistView (волна
 *  экранов веб-паритета, 2026-08-02) — страницу плейлиста рисует теперь один
 *  и тот же код в приложении и в браузере.
 *
 *  Обёртка, а не голый ре-экспорт, потому что у приложения есть три умения,
 *  которых у браузера нет, и общий экран спрашивает их пропами (правило
 *  розетки: нет умения — нет поведения, а не серая заглушка):
 *   - `readWithSnapshot` — читать плейлист через оффлайн-копию устройства;
 *   - `warmRow` — прогревать строки, на которые смотрит человек;
 *   - `localFiles` — музыка с диска этого устройства (что здесь есть и где
 *     лежит). Проп временный: как только вилка приложения начнёт отдавать
 *     порт localFiles целиком (его заводит зона медиатеки), строку можно
 *     снять — общий экран сам возьмёт порт из розетки.
 *  App.tsx импорта не менял и передаёт ровно те же пропы, что раньше.
 *
 *  ⚠️ withSnapshot передаётся МОДУЛЬНОЙ ссылкой, не стрелкой: общий экран
 *  держит её в зависимостях загрузчика, и новая функция на каждый рендер
 *  отправила бы страницу в вечную перезагрузку. */
import type { ComponentProps } from "react";
import { PlaylistView as SharedPlaylistView } from "@muza/app/views/PlaylistView";
import { localList, localResolve } from "../lib/localFiles";
import { withSnapshot } from "../lib/offlineSnapshot";
import { useWarmRow } from "../player/useWarmer";

/** Приложенческие умения — одним объектом на модуль: ссылка стабильна. */
const DESKTOP_LOCAL_FILES = { list: localList, resolvePath: localResolve };

type SharedProps = ComponentProps<typeof SharedPlaylistView>;

export function PlaylistView(props: Omit<SharedProps, "readWithSnapshot" | "warmRow" | "localFiles">) {
  const warmRow = useWarmRow();
  return (
    <SharedPlaylistView
      {...props}
      readWithSnapshot={withSnapshot}
      warmRow={warmRow}
      localFiles={DESKTOP_LOCAL_FILES}
    />
  );
}
