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
 *  треку не платит ни за yt-dlp-резолв, ни за RTT getTrackSources.
 *
 *  Отсюда же (2026-08-06) подаётся сигнал ПРЕДГРЕВА графа Web Audio —
 *  audioEngine.noteUserGesture(). Модуль уже держит самые ранние сигналы
 *  намерения, а первый жест человека — ещё и самая ранняя точка, где политика
 *  автовоспроизведения вообще разрешает создать AudioContext. */

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { MuzaApi } from "@muza/api-client";
import type { Prefs } from "../types";
import { noteUserGesture } from "./audioEngine";
import { engineAvailable, engineWarm } from "../lib/engine";
import { applySourcePolicy } from "../lib/sources";
import { ensureSources } from "./sourcesCache";
import type { PlayerTrack } from "./types";
import { WarmQueue, type WarmOutcome } from "./warmQueue";

/** Сколько ближайших треков очереди держим прогретыми (после текущего).
 *  Дальние успеют прогреться, когда до них доедет index; лимит 30/мин важнее
 *  охвата хвоста. При шаффле порядок всё равно неизвестен — греется голова.
 *  С 19.07 значение — prefs.warmAhead (зона 3 спеки настроек); кламп 0–30
 *  держит лимит прогрева 30/мин.
 *
 *  Фаза 2 «мгновенность» (2026-07-21, отчёт пре-резолва): вместо широкого
 *  окна (дефолт был 10) — предсказание. Дефолт 3 («предсказывать 1–3»), а
 *  ПЕРВЫЙ предстоящий remote-трек идёт срочной заявкой (обгоняет visible-шум
 *  скролла): он сыграет почти наверняка — либо авто-переходом, либо скипом.
 *  Каждый сдвиг index заново прогревает горизонт, так что узкое окно не
 *  оставляет холодных скипов, а бюджет 30/мин перестаёт выгорать на хвосте
 *  очереди, который пользователь может никогда не дослушать. */
const QUEUE_WARM_AHEAD_MAX = 30;

/** Потолок карты пропсов строк (rowPropsById ниже). Записи нужны только ради
 *  СТАБИЛЬНОСТИ ссылок между рендерами — то есть живут ровно столько, сколько
 *  строка на экране; но клались на каждый когда-либо отрендеренный id и не
 *  убирались никогда (аудит 2026-08-03: за долгую сессию прокрутки поиска и
 *  медиатеки это тысячи записей по три замыкания в каждой). Потолок с запасом
 *  больше любого экрана: вытесняются только НЕвидимые сейчас строки, так что
 *  на стабильность видимого списка это не влияет. */
const ROW_PROPS_MAX = 512;

export interface WarmRowProps {
  /** React 19 ref-cleanup: наблюдение снимается возвратом, ref(null) не ждём. */
  ref: (el: HTMLElement | null) => (() => void) | undefined;
  onMouseEnter: () => void;
  /** Палец/кнопка легли на строку — клик почти неизбежен и прилетит через
   *  ~100 мс. Мгновенно тянем ИСТОЧНИКИ (single-flight: клик подхватит этот
   *  же промис — И3 2026-07-22, срез RTT с критического пути) и подаём
   *  срочную заявку прогрева. Байты не качаем — это всё ещё дёшево. */
  onPointerDown: () => void;
}

export interface Warmer {
  /** Пропсы для СУЩЕСТВУЮЩЕЙ обёртки строки трека: {...warmRow(tr.id)}. */
  warmRow: (id: string) => WarmRowProps;
  /** Очередь/позиция сменились — прогреть ближайшие предстоящие треки. */
  noteQueue: (queue: PlayerTrack[], index: number) => void;
  dispose: () => void;
}

const NOOP_ROW: WarmRowProps = { ref: () => undefined, onMouseEnter: () => {}, onPointerDown: () => {} };
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
  const warmAheadNow = () => Math.max(0, Math.min(QUEUE_WARM_AHEAD_MAX, prefsRef.current.warmAhead));

  const warmer = useMemo<Warmer>(() => {
    if (!engineAvailable() || typeof IntersectionObserver === "undefined") return NOOP_WARMER;

    const queue = new WarmQueue(async (id, signal): Promise<WarmOutcome> => {
      // single-flight с pointerdown-префетчем и кликом (sourcesCache)
      const sources = await ensureSources(id, () => apiRef.current.getTrackSources(id));
      const policy = applySourcePolicy(sources, prefsRef.current);
      const remotes = policy.filter((s) => s.provider !== "local");
      // сыграет с диска (local первым — так решит и resolvePlayable) или
      // греть нечего — помечаем как готовое, не дёргаем повторно
      if (remotes.length === 0 || policy[0]?.provider === "local") return "cached";
      // сигнал уезжает в Rust: в кулдауне circuit-breaker'а visible-прогрев
      // не доваливается в yt-dlp simulate (CPU-лавина 2026-07-19)
      const out = await engineWarm(id, remotes, prefsRef.current.streamQuality, signal);
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
    /** Вытеснить самые старые записи сверх потолка, пропуская видимые сейчас
     *  строки: у них пересоздание пропсов передёрнуло бы ref (unobserve →
     *  observe) прямо под глазами. Порядок обхода Map = порядок вставки. */
    const pruneRowProps = (): void => {
      if (rowPropsById.size <= ROW_PROPS_MAX) return;
      for (const key of rowPropsById.keys()) {
        if (rowPropsById.size <= ROW_PROPS_MAX) break;
        if (!visibleEls.has(key)) rowPropsById.delete(key);
      }
    };
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
          onPointerDown: () => {
            // ⚠️ ПОРЯДОК ЗДЕСЬ — НЕ КОСМЕТИКА. Сеть первой: noteUserGesture()
            // синхронно строит контекст и полтора десятка узлов (десятки мс), и
            // стоя перед ensureSources он отодвигал сетевой запрос ровно на эту
            // цену — из той форы, ради которой префетч по pointerdown и сделан.
            //
            // источники — мимо очереди (наш сервер, не бот-лимиты YouTube);
            // ошибка молчит: клик повторит запрос своим путём и покажет свою
            void ensureSources(id, () => apiRef.current.getTrackSources(id)).catch(() => {});
            queue.request(id, "hover", true);
            // Предгрев графа Web Audio (audioEngine.ts, «Предгрев графа по
            // первому жесту»). Обычно к этому моменту он уже случился: оконный
            // слушатель ниже висит в фазе ЗАХВАТА на window и по определению
            // приходит раньше любого React-обработчика. Вызов здесь — не
            // «главный сигнал», а дубль на случай, если слушатель не встал
            // (окружение без window, снятый once).
            noteUserGesture();
          },
        };
        rowPropsById.set(id, props);
        pruneRowProps();
      }
      return props;
    };

    return {
      warmRow,
      noteQueue: (q, index) => {
        let first = true;
        for (const t of q.slice(index + 1, index + 1 + warmAheadNow())) {
          if (t.kind === "local") continue;
          // первый remote — предсказанный следующий: срочная заявка (Фаза 2)
          queue.request(t.id, "queue", first);
          first = false;
        }
      },
      dispose: () => {
        queue.dispose();
        io.disconnect();
      },
    };
  }, []);

  // ГЛАВНЫЙ (и практически единственный) сигнал предгрева графа. Он ловит любой
  // путь к звуку — строку трека, кнопку play в баре, обложку, «продолжить с
  // места», — и приходит РАНЬШЕ вызова из warmRow: захват на window стоит в
  // самом начале маршрута события, а React вешает свои обработчики на корневой
  // контейнер и в фазе всплытия. Слушатель одноразовый (once): дальше
  // noteUserGesture и сам ничего не делает, но лишний обработчик на каждом
  // клике окна не нужен. Он ВНЕ useMemo выше намеренно: тот отдаёт NOOP_WARMER
  // без Tauri-движка и без IntersectionObserver, а Web Audio в этих окружениях
  // как раз есть.
  // Окна «mini» это не касается: там рендерится MiniPlayer, а не App, — хук не
  // монтируется, движка в том окне нет, и греть нечего.
  useEffect(() => {
    const onDown = () => noteUserGesture();
    window.addEventListener("pointerdown", onDown, { capture: true, once: true });
    return () => window.removeEventListener("pointerdown", onDown, { capture: true });
  }, []);

  // Намеренно БЕЗ dispose на размонтировании. App живёт, пока жив документ, —
  // таймер очереди и IntersectionObserver умрут вместе с ним. А «аккуратный»
  // useEffect(() => () => warmer.dispose()) в dev убивал прогрев НАВСЕГДА:
  // StrictMode монтирует→размонтирует→монтирует, cleanup фейкового
  // размонтирования вызывал dispose() у мемоизированного (одного и того же!)
  // warmer, и очередь молча глотала все заявки. Найдено живым стендом
  // 2026-07-16: обработчики на строках стояли, а прогрев не шёл.
  return warmer;
}
