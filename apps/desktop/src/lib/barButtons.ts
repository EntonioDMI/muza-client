/** Пенёк: компоновка плеер-бара переехала в @muza/app (Э3 веб-паритета,
 *  2026-08-02) — раскладку разбирает общий плеер-бар, а он живёт в общем
 *  пакете. Потребители (shell/PlayerBar.tsx, views/SettingsView.tsx) импорта
 *  не меняли. Новый код импортирует из "@muza/app/lib/barButtons".
 *
 *  ⚠️ СТОРОЖ ЗЕРКАЛА. Список кнопок продублирован: здешний src/types.ts общий
 *  для всех зон приложения и в @muza/app не переезжает, поэтому у общего
 *  пакета свой BAR_BUTTON_KEYS. Присваивания ниже сверяют списки НА ЭТАПЕ
 *  КОМПИЛЯЦИИ: добавили кнопку только в одном месте — `pnpm typecheck` падает
 *  здесь с внятной ошибкой, а не молча теряет кнопку в рантайме (нормализатор
 *  выбрасывает незнакомые ключи). */

import { BAR_BUTTON_KEYS as SHARED_KEYS, type BarButtonKey as SharedBarButtonKey } from "@muza/app/lib/barButtons";
import { BAR_BUTTON_KEYS as LOCAL_KEYS, type BarButtonKey as LocalBarButtonKey } from "../types";

export * from "@muza/app/lib/barButtons";

/** Сторож зеркала: списки обязаны совпадать в обе стороны. Значения никем не
 *  читаются — смысл в самой проверке присваиваемости. */
export const BAR_BUTTON_KEYS_MIRROR: {
  sharedFitsLocal: readonly LocalBarButtonKey[];
  localFitsShared: readonly SharedBarButtonKey[];
} = { sharedFitsLocal: SHARED_KEYS, localFitsShared: LOCAL_KEYS };
