/** Розетка платформы: контекст + хуки (Э2 веб-паритета, 2026-08-02).
 *  Смысл и правила порта — в types.ts (читать сначала его).
 *
 *  Почему контекст, а не глобальная переменная-синглтон: вилку вставляет
 *  ПРИЛОЖЕНИЕ в своём корне (apps/desktop/src/App.tsx,
 *  apps/web/src/providers.tsx), а общий код её только читает. Тест общего
 *  компонента может подсунуть свою вилку одной обёрткой, ничего не мокая, —
 *  с глобальной переменной пришлось бы мокать модуль.
 *
 *  ⚠️ Без директивы "use client" — намеренно (правило пакета, см. index.ts):
 *  клиентскую границу держат приложения. Веб втягивает этот модуль из
 *  providers.tsx, у которого "use client" уже стоит. */

import { createContext, useCallback, useContext, useMemo, type DragEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import type { DragOutPort, PlatformAdapter, TrackFileRef } from "./types";

/** Вилка не вставлена — площадка не умеет НИЧЕГО из портов. Это честное
 *  значение по умолчанию (юнит-тест общего компонента, площадка, где
 *  провайдер ещё не подключён): общий код и так обязан переживать отсутствие
 *  любого порта. Константа одна на всех — ссылка стабильна, лишних
 *  перерисовок не даёт. */
const NO_PLATFORM: PlatformAdapter = Object.freeze({});

const PlatformContext = createContext<PlatformAdapter>(NO_PLATFORM);

/** Вставляет вилку площадки. Ставится ВЫШЕ всего видимого дерева, включая
 *  экран входа: умения площадки от входа не зависят. */
export function PlatformProvider({ adapter, children }: { adapter: PlatformAdapter; children: ReactNode }) {
  return <PlatformContext.Provider value={adapter}>{children}</PlatformContext.Provider>;
}

/** Вся вилка целиком. Проверять надо ПОЛЕ (`if (!platform.offline) …`), а не
 *  площадку — поля `kind` тут нет намеренно (см. types.ts). */
export function usePlatform(): PlatformAdapter {
  return useContext(PlatformContext);
}

/** Порт выноса файла на рабочий стол; undefined — площадка так не умеет
 *  (браузер), и пункт/жест не показываем вовсе. */
export function useDragOut(): DragOutPort | undefined {
  return useContext(PlatformContext).dragOut;
}

/** Обычное перетаскивание строки = в плейлист (перенос на pointer-событиях,
 *  свой DragLayer), Alt+перетаскивание = файл на рабочий стол.
 *
 *  Зовётся ПЕРВЫМ в onDragStart draggable-обёртки. Если Alt зажат и площадка
 *  умеет выносить файл — системное перетаскивание страницы отменяется
 *  (preventDefault) и стартует перетаскивание файла (кнопка мыши ещё зажата,
 *  система подхватывает курсор).
 *  Вернул false — ВЫЗЫВАЮЩИЙ ОБЯЗАН погасить перетаскивание сам
 *  (e.preventDefault()): внутренний перенос идёт на pointer-событиях, а
 *  стартовавший HTML5-drag убил бы его через pointercancel.
 *
 *  Точная копия поведения apps/desktop/src/lib/dragOut.ts::maybeAltFileDrag —
 *  включая порядок проверок и текст запасного сообщения об ошибке. Отличий
 *  два, оба намеренные:
 *  1) вместо `dragOutAvailable()` — наличие порта;
 *  2) язык сообщения берётся из LanguageProvider (useT), а не приезжает
 *     параметром: общий код и так внутри провайдера.
 *
 *  `exportFile` ПОЛУЧАЕТ ПОРТ аргументом — чтобы у вызывающего не было ни
 *  проверки на null, ни восклицательного знака: колбэк вызывается только
 *  тогда, когда порт точно есть.
 *
 *      const altFileDrag = useAltFileDrag();
 *      onDragStart={(e) => {
 *        if (altFileDrag(e, (d) => d.exportTrackFile(tr), (m) => onNotify(m, "x"))) return;
 *        e.preventDefault();
 *      }} */
export function useAltFileDrag(): (
  e: DragEvent,
  exportFile: (dragOut: DragOutPort) => Promise<string>,
  onError: (message: string) => void,
) => boolean {
  const dragOut = useDragOut();
  const { t } = useT();
  return useCallback(
    (e, exportFile, onError) => {
      if (!e.altKey || !dragOut) return false;
      e.preventDefault();
      exportFile(dragOut)
        .then((path) => dragOut.startFileDrag(path))
        // Ошибка подготовки файла — честный тост, перетаскивание просто не
        // начинается. Сообщение из ошибки идёт как есть: оно уже человеческое.
        .catch((err) => onError(err instanceof Error ? err.message : t("media.dragOut.errors.prepareFailed")));
      return true;
    },
    [dragOut, t],
  );
}

/** Готовый обработчик выноса ОДНОГО трека — для мест, где файл получается
 *  прямо из трека (строки списков, обложка в плеер-баре). undefined, если
 *  площадка не умеет: удобно подставлять в необязательный проп
 *  (`onCoverDragOut={useTrackDragOut(track)}`) — «нет умения» и «нет трека»
 *  выглядят одинаково, лишних развилок во вью не заводится. */
export function useTrackDragOut(
  track: TrackFileRef | null | undefined,
  onError?: (message: string) => void,
): (() => Promise<string | null>) | undefined {
  const dragOut = useDragOut();
  const { t } = useT();
  return useMemo(() => {
    if (!dragOut || !track) return undefined;
    return async () => {
      try {
        return await dragOut.exportTrackFile(track);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : t("media.dragOut.errors.prepareFailed"));
        return null;
      }
    };
    // onError пересоздаётся вызывающим на каждый рендер (стрелка в JSX) —
    // в зависимостях его держать нельзя, иначе memo бессмысленна; свежесть
    // не нужна: колбэк только показывает тост.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragOut, track?.id, track?.artist, track?.title, t]);
}
