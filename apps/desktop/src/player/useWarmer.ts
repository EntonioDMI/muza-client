/** Прогрев метаданных добычи (Фаза 1, спека 2026-07-16-прогрев-и-стрим-дизайн):
 *  сигналы UI → WarmQueue → getTrackSources + engine_warm.
 *
 *  Решение владельца: греть ТО, ЧТО ПОЛЬЗОВАТЕЛЬ ВИДИТ (+ очередь), а не всю
 *  выдачу; только метаданные, без байтов (вариант «греть байты верхних строк»
 *  отклонён: ~10 МБ трафика на каждый открытый экран ради ~0.1с).
 *
 *  Сигналы:
 *  - hover по строке — самый ценный (курсор приходит раньше клика);
 *  - видимость строк — IntersectionObserver, появившиеся подаются сверху вниз;
 *  - очередь воспроизведения — App дёргает noteQueue на смену queue/index.
 *
 *  Интеграция в строки НЕ трогает дизайн-систему: у каждого TrackRow во
 *  вьюхах уже есть обёртка-div (DnD), warmRow(id) вешает на неё ref (React 19
 *  ref-cleanup) и onMouseEnter. Паттерн доступа — контекст-хук, как useDrag.
 *
 *  Прогрев греет и кэш ИСТОЧНИКОВ (sourcesCache, T1b): клик по прогретому
 *  треку не платит ни за yt-dlp-резолв, ни за RTT getTrackSources. */

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { MuzaApi } from "@muza/api-client";
import type { Prefs } from "../types";
import { engineAvailable, engineWarm } from "../lib/engine";
import { applySourcePolicy } from "../lib/sources";
import { getCachedSources, putCachedSources } from "./sourcesCache";
import type { PlayerTrack } from "./types";
import { WarmQueue, type WarmOutcome } from "./warmQueue";

/** Сколько ближайших треков очереди держим прогретыми (после текущего).
 *  Дальние успеют прогреться, когда до них доедет index; лимит 30/мин важнее
 *  охвата хвоста. При шаффле порядок всё равно неизвестен — греется голова. */
const QUEUE_WARM_AHEAD = 10;

export interface WarmRowProps {
  /** React 19 ref-cleanup: наблюдение снимается возвратом, ref(null) не ждём. */
  ref: (el: HTMLElement | null) => (() => void) | undefined;
  onMouseEnter: () => void;
}

export interface Warmer {
  /** Пропсы для СУЩЕСТВУЮЩЕЙ обёртки строки трека: {...warmRow(tr.id)}. */
  warmRow: (id: string) => WarmRowProps;
  /** Очередь/позиция сменились — прогреть ближайшие предстоящие треки. */
  noteQueue: (queue: PlayerTrack[], index: number) => void;
  dispose: () => void;
}

const NOOP_ROW: WarmRowProps = { ref: () => undefined, onMouseEnter: () => {} };
/** Вне Tauri (web-сборка, тесты без провайдера) прогрев — честный no-op. */
const NOOP_WARMER: Warmer = { warmRow: () => NOOP_ROW, noteQueue: () => {}, dispose: () => {} };

const WarmerContext = createContext<Warmer>(NOOP_WARMER);
export const WarmerProvider = WarmerContext.Provider;

/** Хук для вьюх (паттерн useDrag): warmRow(id) → пропсы на обёртку строки. */
export function useWarmRow(): (id: string) => WarmRowProps {
  return useContext(WarmerContext).warmRow;
}

/** Владелец очереди прогрева — один на приложение (App). */
export function useWarmer({ api, prefs }: { api: MuzaApi; prefs: Prefs }): Warmer {
  // как в usePlayback: колбэки читают свежие prefs/api через ref, без
  // пересоздания очереди на каждый рендер
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const apiRef = useRef(api);
  apiRef.current = api;

  const warmer = useMemo<Warmer>(() => {
    if (!engineAvailable() || typeof IntersectionObserver === "undefined") return NOOP_WARMER;

    const queue = new WarmQueue(async (id): Promise<WarmOutcome> => {
      let sources = getCachedSources(id);
      if (sources === null) {
        sources = await apiRef.current.getTrackSources(id);
        putCachedSources(id, sources);
      }
      const policy = applySourcePolicy(sources, prefsRef.current);
      const remotes = policy.filter((s) => s.provider !== "local");
      // сыграет с диска (local первым — так решит и resolvePlayable) или
      // греть нечего — помечаем как готовое, не дёргаем повторно
      if (remotes.length === 0 || policy[0]?.provider === "local") return "cached";
      const out = await engineWarm(id, remotes, prefsRef.current.streamQuality);
      return out.cached ? "cached" : "warmed";
    });

    // элемент → id (строк с одним треком может быть несколько: поиск + очередь)
    const idForEl = new Map<Element, string>();
    // id → его видимые элементы; сигнал «видим» на первом, cancel — на нуле
    const visibleEls = new Map<string, Set<Element>>();
    const io = new IntersectionObserver((entries) => {
      const appeared: { id: string; top: number }[] = [];
      for (const e of entries) {
        const id = idForEl.get(e.target);
        if (!id) continue;
        if (e.isIntersecting) {
          let set = visibleEls.get(id);
          if (!set) {
            set = new Set();
            visibleEls.set(id, set);
          }
          if (set.size === 0) appeared.push({ id, top: e.boundingClientRect.top });
          set.add(e.target);
        } else {
          const set = visibleEls.get(id);
          if (set?.delete(e.target) && set.size === 0) {
            visibleEls.delete(id);
            // ушёл с экрана — ждущая заявка снимается (спека)
            queue.cancel(id);
          }
        }
      }
      // появившиеся — сверху вниз: порядок прогрева важнее охвата
      appeared.sort((a, b) => a.top - b.top);
      for (const { id } of appeared) queue.request(id, "visible");
    });

    // стабильные пропсы на id: ref не меняется между рендерами — React не
    // передёргивает наблюдение на каждый рендер списка
    const rowPropsById = new Map<string, WarmRowProps>();
    const warmRow = (id: string): WarmRowProps => {
      let props = rowPropsById.get(id);
      if (!props) {
        props = {
          ref: (el) => {
            if (!el) return undefined;
            idForEl.set(el, id);
            io.observe(el);
            return () => {
              io.unobserve(el);
              idForEl.delete(el);
              const set = visibleEls.get(id);
              if (set?.delete(el) && set.size === 0) {
                visibleEls.delete(id);
                queue.cancel(id);
              }
            };
          },
          onMouseEnter: () => queue.request(id, "hover"),
        };
        rowPropsById.set(id, props);
      }
      return props;
    };

    return {
      warmRow,
      noteQueue: (q, index) => {
        for (const t of q.slice(index + 1, index + 1 + QUEUE_WARM_AHEAD)) {
          if (t.kind === "local") continue;
          queue.request(t.id, "queue");
        }
      },
      dispose: () => {
        queue.dispose();
        io.disconnect();
      },
    };
  }, []);

  useEffect(() => () => warmer.dispose(), [warmer]);
  return warmer;
}
