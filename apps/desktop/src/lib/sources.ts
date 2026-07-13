/** Клиентская политика источников (настройки → Источники): вкл/выкл
 *  провайдеров и порядок предпочтения ПЕРЕД добычей. Сервер отдаёт sources
 *  по своему приоритету (официальное первым) — здесь только пере-сортировка
 *  и фильтр на устройстве; per-track выбор версии (UserTrackSource, сервер
 *  ставит его первым) уважается: политика сортирует стабильно. */

import type { TrackSource } from "@muza/api-client";
import type { Prefs } from "../types";

export function applySourcePolicy(
  sources: TrackSource[],
  prefs: Pick<Prefs, "sourcesEnabled" | "sourcePolicy">,
): TrackSource[] {
  // фильтр по включённым провайдерам; local — файл пользователя, не фильтруем
  const enabled = sources.filter((s) => {
    if (s.provider === "local") return true;
    const key = s.provider as keyof Prefs["sourcesEnabled"];
    return prefs.sourcesEnabled[key] !== false; // неизвестный провайдер не режем
  });
  // всё отфильтровалось — воспроизведение важнее предпочтений
  const base = enabled.length > 0 ? enabled : sources;
  if (prefs.sourcePolicy === "soundcloudFirst") {
    // выбранная пользователем версия (is_chosen, сервер ставит первой) сильнее
    // глобальной политики — её не двигаем
    const pinned = base[0]?.isChosen ? 1 : 0;
    const head = base.slice(0, pinned);
    // стабильная сортировка: SoundCloud вперёд, остальной порядок сервера цел
    const tail = [...base.slice(pinned)].sort(
      (a, b) => Number(b.provider === "soundcloud") - Number(a.provider === "soundcloud"),
    );
    return [...head, ...tail];
  }
  return base;
}
