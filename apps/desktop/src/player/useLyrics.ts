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
 *  делает бесплатным быстрый скролл поиска.
 *
 *  ⚠️ ХУК ВЛАДЕЕТ И ОТКАЗОМ ОТ ТЕКСТА (14.08) — reject/restore внизу файла.
 *  Не потому, что им тут уютно, а потому, что здесь живёт сессионный кэш: он
 *  переживает смену трека, и обновить его обязан тот же ход, который меняет
 *  текст на сервере. Отказ, забывший про этот кэш, выглядел бы как неработающая
 *  кнопка — сервер помнит, а экран при возврате на трек показывает старое. */

import { useEffect, useRef, useState } from "react";
import type { Lyrics, MuzaApi } from "@muza/api-client";
import type { LyricLine, PlayerTrack } from "./types";

export interface TrackLyrics {
  lines: LyricLine[];
  /** id трека, которому принадлежат lines; защищает соседние хуки от гонки при смене трека. */
  trackId: string | null;
  /** true — строки с таймкодами (LRC): активная строка и сик по строке живут. */
  synced: boolean;
  loading: boolean;
  /** ЗАПИСЬ ИСТОЧНИКА, давшая этот текст («lrclib:17594385») — ею человек и
   *  отвергает чужой текст (см. reject ниже). null — отвергать нечего. */
  sourceKey: string | null;
  /** Сколько записей уже отвергнуто у этого трека: >0 — есть что вернуть. */
  rejected: number;
}

/** То же состояние плюс два действия — «текст не от этой песни» и отмена.
 *  Действия живут ЗДЕСЬ, а не у вызывающего, потому что у обоих один и тот же
 *  побочный эффект: сессионный кэш текстов этого хука обязан обновиться тем
 *  же ответом, иначе отвергнутый текст вернулся бы при следующем заходе на
 *  трек — из нашей же памяти, мимо сервера. */
export interface TrackLyricsView extends TrackLyrics {
  /** Отвергнуть показанную запись источника. Возвращает, нашёлся ли другой
   *  текст, — вызывающему это нужно, чтобы сказать человеку правду. */
  reject: () => Promise<boolean>;
  /** Вернуть отвергнутое. Возвращает, нашёлся ли текст после отмены. */
  restore: () => Promise<boolean>;
}

const EMPTY: TrackLyrics = { lines: [], trackId: null, synced: false, loading: false, sourceKey: null, rejected: 0 };

/** Сколько «следующий» должен продержаться неизменным, прежде чем мы полезем
 *  за его текстом. 2.5с — заметно дольше серии скипов и заметно короче самой
 *  короткой песни, так что к настоящему переходу ответ успевает приехать. */
export const PREFETCH_DWELL_MS = 2500;

/** Ответ сервера → состояние хука. Вынесено из loadRef, потому что тем же
 *  путём разбирается ответ на отказ и на его отмену: там текст приходит из
 *  других ручек, но означает ровно то же самое. */
function toTrackLyrics(lyrics: Lyrics, trackId: string): TrackLyrics {
  const head = { trackId, loading: false, sourceKey: lyrics.sourceKey, rejected: lyrics.rejected };
  if (lyrics.synced && lyrics.synced.length > 0) {
    return { ...head, lines: lyrics.synced.map((l) => ({ t: l.t, text: l.line })), synced: true };
  }
  if (lyrics.plain) {
    return { ...head, lines: lyrics.plain.split("\n").map((text) => ({ t: 0, text })), synced: false };
  }
  // Текста нет — но число отказов сохраняем: именно по нему появляется
  // «Вернуть текст». Потерять его здесь значило бы запереть человека в
  // состоянии «текста нет» без выхода назад.
  // trackId остаётся null, как было до 14.08: соседний хук аннотаций сверяет
  // его с играющим треком, и «строк нет» обязано читаться как «нечего
  // размечать», а не как «текст этого трека загружен».
  return { ...EMPTY, rejected: lyrics.rejected };
}

export function useLyrics(
  api: MuzaApi,
  track: PlayerTrack | null,
  canFetch: boolean,
  /** Предсказанный следующий трек очереди (index+1, та же ставка, что у
   *  useWarmer.noteQueue). null — очередь кончилась, греть нечего. */
  nextTrack?: PlayerTrack | null,
): TrackLyricsView {
  const [state, setState] = useState<TrackLyrics>(EMPTY);
  // Кто играет ПРЯМО СЕЙЧАС — ref, а не state: отказ и его отмена улетают в
  // сеть, и к возвращению ответа трек мог смениться. Замыкание с id времён
  // нажатия про это не знает, а ref знает.
  const playingIdRef = useRef<string | null>(null);
  playingIdRef.current = track?.kind === "catalog" ? track.id : null;
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
        const out = toTrackLyrics(lyrics, trackId);
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
    setState({ ...EMPTY, loading: true });
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

  // ⚠️ ОТКАЗ «ТЕКСТ НЕ ОТ ЭТОЙ ПЕСНИ» И ЕГО ОТМЕНА.
  //
  // Оба действия обязаны ПЕРЕЗАПИСАТЬ сессионный кэш этого хука, а не просто
  // показать новый ответ: кэш живёт до перезапуска, и без перезаписи человек
  // ушёл бы на другой трек, вернулся — и увидел отвергнутый текст снова, уже
  // из нашей памяти, мимо сервера. Со стороны это выглядело бы как «кнопка не
  // работает», хотя на сервере отказ записан навсегда.
  //
  // Ключ и id берутся из ТЕКУЩЕГО состояния (state), а не из props: отвергается
  // ровно то, что человек видит. Смена трека прямо во время запроса гасится
  // сверкой trackId при записи — чужой ответ на чужой трек на экран не попадёт.
  const apply = (trackId: string, lyrics: Lyrics): boolean => {
    const out = toTrackLyrics(lyrics, trackId);
    cacheRef.current.set(trackId, out);
    // Сверяем с ИГРАЮЩИМ треком, а не с state.trackId: у состояния «текста
    // нет» тот равен null, и по нему нельзя отличить «наш ответ» от чужого.
    // Успели переключить трек — на экран не лезем, но кэш уже верный: возврат
    // на этот трек покажет новый текст, а не отвергнутый.
    if (playingIdRef.current === trackId) setState(out);
    return out.lines.length > 0;
  };

  const reject = async (): Promise<boolean> => {
    const { trackId, sourceKey } = state;
    if (!trackId || !sourceKey) return false;
    setState((cur) => ({ ...cur, loading: true }));
    return apply(trackId, await api.rejectLyrics(trackId, sourceKey));
  };

  const restore = async (): Promise<boolean> => {
    // trackId у состояния «текста нет» равен null (см. toTrackLyrics), а
    // вернуть текст надо уметь именно оттуда — берём id играющего трека.
    const trackId = playingIdRef.current;
    if (!trackId) return false;
    setState((cur) => ({ ...cur, loading: true }));
    return apply(trackId, await api.restoreLyrics(trackId));
  };

  return { ...state, reject, restore };
}
