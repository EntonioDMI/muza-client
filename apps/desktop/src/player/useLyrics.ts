/** Тексты текущего трека (Stage 3, слайс 4): цепочка источников на сервере
 *  (synced → караоке-строки, plain — без таймкодов, актив не подсвечивается).
 *  Кэш на сессию по id трека.
 *
 *  ⚠️ ЗАПРОС ЗДЕСЬ ПРИВЯЗАН К ТРЕКУ, А НЕ К ОТКРЫТОМУ КАРАОКЕ — и это главное,
 *  что нужно знать про этот файл. Хук живёт в App и стреляет на СМЕНУ ТРЕКА,
 *  поэтому к моменту, когда человек открывает текст у играющей песни, ответ
 *  почти всегда уже лежит в кэше. Не «оптимизация на будущее»: серверная
 *  цепочка на песне БЕЗ текста стоит 2–4.4с живьём (замер 14.08), и показывать
 *  их по клику было бы ровно тем ожиданием, которого здесь нет.
 *
 *  УПРЕЖДАЮЩАЯ ЗАГРУЗКА СЛЕДУЮЩЕГО (14.08). Оставался один случай, где
 *  ожидание всё-таки видно: караоке открыто, трек ДОИГРАЛ, и на переходе текст
 *  пропадает на те же 2–4.4с. Лечится тем же приёмом на шаг вперёд — сосед по
 *  очереди подтягивается заранее и на переходе достаётся из кэша (0 мс).
 *  Замер 14.08 полным путём: 2593 мс среднее → 0 мс.
 *
 *  Почему у текста своя упреждающая загрузка, а не заявка в WarmQueue: та
 *  очередь охраняет ЧУЖОЙ ресурс (yt-dlp/YouTube с бот-детектом по IP
 *  владельца) и потому жёстко лимитирована. Текст же идёт в НАШ сервер, где
 *  запрос дешёвый, коалесится по треку и оседает в БД. Разные ресурсы — разные
 *  правила; смешивать их значило бы тратить дефицитные слоты добычи на то, что
 *  в них не нуждается.
 *
 *  ⚠️ ВЫДЕРЖКА ОБЯЗАТЕЛЬНА (PREFETCH_DWELL_MS). У серверной ручки есть бюджет
 *  на промахи кэша (20 за минуту на пользователя, tracks.controller.ts), а
 *  перещёлкивание очереди кнопкой «дальше» меняет «следующего» по разу на
 *  каждое нажатие. Без выдержки десяток скипов сжигал бы бюджет упреждающими
 *  запросами — и следующий НАСТОЯЩИЙ текст получил бы 429. Выдержка делает
 *  быструю перемотку очереди бесплатной, ровно как WARM_VISIBLE_DWELL_MS
 *  делает бесплатным быстрый скролл поиска. */

import { useEffect, useRef, useState } from "react";
import type { MuzaApi } from "@muza/api-client";
import type { LyricLine, PlayerTrack } from "./types";

export interface TrackLyrics {
  lines: LyricLine[];
  /** id трека, которому принадлежат lines; защищает соседние хуки от гонки при смене трека. */
  trackId: string | null;
  /** true — строки с таймкодами (LRC): активная строка и сик по строке живут. */
  synced: boolean;
  loading: boolean;
}

const EMPTY: TrackLyrics = { lines: [], trackId: null, synced: false, loading: false };

/** Сколько «следующий» должен продержаться неизменным, прежде чем мы полезем
 *  за его текстом. 2.5с — заметно дольше серии скипов и заметно короче самой
 *  короткой песни, так что к настоящему переходу ответ успевает приехать. */
export const PREFETCH_DWELL_MS = 2500;

export function useLyrics(
  api: MuzaApi,
  track: PlayerTrack | null,
  canFetch: boolean,
  /** Предсказанный следующий трек очереди (index+1, та же ставка, что у
   *  useWarmer.noteQueue). null — очередь кончилась, греть нечего. */
  nextTrack?: PlayerTrack | null,
): TrackLyrics {
  const [state, setState] = useState<TrackLyrics>(EMPTY);
  // Кэш на сессию: переключение треков туда-сюда не дёргает сервер
  const cacheRef = useRef(new Map<string, TrackLyrics>());
  // Запросы в полёте — общие для показа и упреждающей загрузки. Без этой карты
  // переход на трек, текст которого УЖЕ едет, заводил бы второй такой же
  // запрос: сервер его склеит (inflight в tracks.controller), но свой бюджет
  // промахов он потратит, а экран всё равно ждал бы с нуля.
  const inflightRef = useRef(new Map<string, Promise<TrackLyrics>>());

  // Один путь к серверу для обоих потребителей: и показ, и упреждающая
  // загрузка кладут результат в один кэш и делят один промис.
  const loadRef = useRef((trackId: string): Promise<TrackLyrics> => Promise.resolve(EMPTY));
  loadRef.current = (trackId: string): Promise<TrackLyrics> => {
    const cached = cacheRef.current.get(trackId);
    if (cached) return Promise.resolve(cached);
    const flying = inflightRef.current.get(trackId);
    if (flying) return flying;
    const p = api
      .getLyrics(trackId)
      .then((lyrics) => {
        let out: TrackLyrics;
        if (lyrics.synced && lyrics.synced.length > 0) {
          out = { lines: lyrics.synced.map((l) => ({ t: l.t, text: l.line })), trackId, synced: true, loading: false };
        } else if (lyrics.plain) {
          out = {
            lines: lyrics.plain.split("\n").map((text) => ({ t: 0, text })),
            trackId,
            synced: false,
            loading: false,
          };
        } else {
          out = EMPTY;
        }
        cacheRef.current.set(trackId, out);
        return out;
      })
      .finally(() => {
        // снимаем из полёта в любом исходе; сбой НЕ кэшируем — следующий заход
        // попробует снова (сервер тоже не пишет кэш на временном сбое)
        inflightRef.current.delete(trackId);
      });
    inflightRef.current.set(trackId, p);
    return p;
  };

  useEffect(() => {
    // Ничего не играет (пустая очередь) или нет серверной сессии — текстов нет
    if (!track || !canFetch) {
      setState(EMPTY);
      return;
    }
    // id в локальную константу: замыкания .then() ниже переживают смену трека,
    // а сужение типа параметра внутрь них не протекает
    const trackId = track.id;
    const cached = cacheRef.current.get(trackId);
    if (cached) {
      setState(cached);
      return;
    }
    let alive = true;
    setState({ lines: [], trackId: null, synced: false, loading: true });
    loadRef.current(trackId)
      .then((out) => {
        if (alive) setState(out);
      })
      .catch(() => {
        if (alive) setState(EMPTY);
      });
    return () => {
      alive = false;
    };
  }, [api, track?.id, canFetch]);

  // Упреждающая загрузка соседа по очереди — см. шапку. Ошибка молчит: это
  // best-effort, настоящий заход за текстом повторит запрос своим путём.
  const nextId = nextTrack?.kind === "catalog" ? nextTrack.id : null;
  useEffect(() => {
    if (!canFetch || !nextId) return;
    // уже знаем ответ или он и так едет — выдержку заводить незачем
    if (cacheRef.current.has(nextId) || inflightRef.current.has(nextId)) return;
    const timer = setTimeout(() => {
      void loadRef.current(nextId).catch(() => {});
    }, PREFETCH_DWELL_MS);
    return () => clearTimeout(timer);
  }, [api, nextId, canFetch]);

  return state;
}
