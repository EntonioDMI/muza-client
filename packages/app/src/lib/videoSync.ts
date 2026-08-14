/** Слейв <video> к аудио (2026-07-21, «Сейчас играет»): аудио — МАСТЕР часов,
 *  видео догоняет. Точных часов у слоя UI нет — pos приходит из timeupdate
 *  (~4 Гц), поэтому между тиками время ЭКСТРАПОЛИРУЕТСЯ: est = pos + (now −
 *  моменту тика) × speed. rAF-цикл сравнивает video.currentTime с est и при
 *  дрейфе больше допуска жёстко перематывает (без плавной подстройки
 *  playbackRate — для фонового видео в узкой панели рывок раз в минуты
 *  незаметнее, чем вечно «плывущая» скорость).
 *
 *  Кроссфейд аудио видео сознательно не зеркалит: на смене трека url меняется,
 *  <video> просто перезагружается — это визуальный сахар, не вторая дорожка.
 *
 *  ⚠️ ЦЕНА КАДРОВ (жалоба владельца 02.08: плеер роняет ФПС в играх). Дорого
 *  здесь не сравнение времён, а ДЕКОДИРОВАНИЕ видео — оно идёт, пока элемент
 *  не на паузе, даже если кадр никто не видит. Отсюда два правила:
 *  1) при document.hidden кадр ставится на паузу и уезжает с видеодекодера;
 *     вернулись — играем дальше. ⚠️ Это правило работает ТОЛЬКО В ВЕБЕ. В
 *     приложении оно мёртвое: WebView2 не сообщает странице о свёрнутом окне
 *     (visibilityState вечно "visible", событие не приходит ни разу — замер
 *     03.08, см. apps/desktop/src/lib/windowVisible.ts). Строки оставлены
 *     ради вкладки браузера, а НЕ как защита десктопа;
 *  2) «панель перекрыта чем-то непрозрачным» отсюда не видно (CSS-видимость у
 *     элемента честная), и «окна не видно» — тоже (это вопрос к системе, а не
 *     к документу). Поэтому решает ХОЗЯИН и передаёт playing=false: App —
 *     когда поверх лежит караоке-оверлей, NowPlayingPanel — когда пришёл
 *     нативный сигнал «окно свёрнуто/накрыто».
 *  Сам rAF-цикл догона тоже гейтится по playing: на паузе часы аудио стоят,
 *  гнаться не за чем — хватает одного выравнивания. Тем же пропом его гасит и
 *  «окна не видно».
 *
 *  Э7 веб-паритета: переехал из apps/desktop/src/player/useVideoSync.ts (там
 *  пенёк-ре-экспорт и прежние тесты). Ничего платформенного внутри нет —
 *  только React и <video>, поэтому в вебе хук работает как есть; видео-URL в
 *  вебе пока не откуда взять, и панель просто передаёт url=null (хук спит).
 *
 *  ⚠️ ХУК ОТДАЁТ НАРУЖУ ОДНО ЗНАЧЕНИЕ: «у кадра есть ЧТО показать» (14.08,
 *  жалоба владельца «экран моргает, когда справа включается видео»). Само
 *  наличие url этого не значит: <video> без единого декодированного кадра по
 *  спеке HTML рисует ПРОЗРАЧНУЮ ЧЕРНОТУ (см. «represents its poster frame, if
 *  any, or else transparent black»), а постера у нас нет. Показать такой
 *  элемент — значит показать дыру. Кто спрашивает про кадр — см. шапку
 *  NowPlayingPanel. */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** rVFC есть в WebView2 и во всех живых браузерах, но НЕ в jsdom тестов и не в
 *  старых lib.dom. Своё объявление — чтобы не тянуть в проект новый lib и не
 *  писать `as any` в трёх местах. */
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** Допуск дрейфа, сек: меньше — дёргаем перемотку слишком часто (сеть!),
 *  больше — заметно на губах в кадре. 0.35с с экстраполяцией достаточно. */
const DRIFT_TOL_SEC = 0.35;

/** Не чаще одной жёсткой перемотки в секунду.
 *
 *  ⚠️ ЭТО ЛЕЧЕНИЕ ЗАВИСАНИЯ ПАНЕЛИ (жалоба 12.08: «мини-плеер зависает
 *  примерно через десять секунд после начала»). Кадр в панели — это УДАЛЁННЫЙ
 *  googlevideo-URL, и каждая перемотка требует добуферизации. Цикл догона
 *  крутится 60 раз в секунду; пока перемотка идёт, дрейф не уменьшается, и
 *  следующий кадр присваивал currentTime заново — отменяя незавершённую
 *  перемотку и начиная новую. Стоит сети один раз не успеть за реальным
 *  временем, и выйти из этой петли уже нельзя: перемотка не завершается
 *  НИКОГДА, кадр застывает навсегда, звук при этом идёт дальше.
 *  Отсюда же и «примерно через десять секунд»: видео резолвится лениво
 *  (useTrackVideo), и появляется оно через секунды после старта трека. */
const SEEK_COOLDOWN_MS = 1000;

/** Столько миллисекунд неподвижного кадра при идущем звуке — и мы признаём,
 *  что видео не тянет. Ловит застревание НЕЗАВИСИМО от причины: буфер пуст,
 *  адрес протух, декодер захлебнулся. Пять секунд — заведомо больше любой
 *  штатной подгрузки и заведомо меньше, чем «человек смотрит на труп». */
const FROZEN_LIMIT_MS = 5000;

/** Кадру нужно не просто «что-то есть» (readyState 1), а возможность играть
 *  ВПЕРЁД: HAVE_FUTURE_DATA. Перемотка в непрогруженное место — это ещё одна
 *  добуферизация поверх той, что уже идёт. */
const HAVE_FUTURE_DATA = 3;

export function useVideoSync(
  videoRef: RefObject<HTMLVideoElement | null>,
  opts: {
    url: string | null;
    pos: number;
    playing: boolean;
    speed: number;
    /** Видео не тянет: кадр стоит, догон не помогает. Хозяин решает, что
     *  делать — перерезолвить адрес или показать обложку. Панель ведёт сюда
     *  тот же обработчик, что и onError элемента. */
    onStuck?: () => void;
  },
): boolean {
  const { url, pos, playing, speed, onStuck } = opts;
  const onStuckRef = useRef(onStuck);
  onStuckRef.current = onStuck;
  /** Момент последней жёсткой перемотки — троттл выше. */
  const lastSeekRef = useRef(0);
  /** Наблюдение за неподвижностью кадра: время кадра и когда оно менялось. */
  const frozenRef = useRef({ at: 0, time: -1 });
  // тик pos + момент его прихода: база экстраполяции для rAF ниже.
  // Обновляется ТОЛЬКО на смене значения (мутация в рендере, приём ctxRef):
  // рендер без тика pos не должен сдвигать базу — est занижался бы на
  // возраст устаревшего pos
  const posRef = useRef({ pos: 0, atMs: 0 });
  if (posRef.current.pos !== pos) posRef.current = { pos, atMs: performance.now() };
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // «Кадр есть» — единственное, что хук говорит наружу.
  //
  // ⚠️ СБРОС ИДЁТ В РЕНДЕРЕ, А НЕ ЭФФЕКТОМ, и это не стилистика. Эффект React
  // выполняет ПОСЛЕ отрисовки — значит на новый url успел бы уехать один
  // нарисованный кадр со старым ответом «кадр есть», то есть панель показала бы
  // пустой <video> ровно на то время, ради которого всё и затевалось. Тем же
  // самым обожглись на обложке (lib/coverArt.ts, правка 13.08). Обновление
  // состояния прямо в рендере СВОЕГО компонента — законный приём React: он
  // применяется до коммита, лишней краски не рождает.
  const [live, setLive] = useState(false);
  const liveUrlRef = useRef<string | null>(null);
  if (liveUrlRef.current !== url) {
    liveUrlRef.current = url;
    if (live) setLive(false);
  }

  // ЧТО СЧИТАЕТСЯ КАДРОМ. Не `loadeddata` (это «байты доехали», кадр в этот
  // момент ещё может быть не скомпонован) и тем более не `play()`, а
  // requestVideoFrameCallback — он зовётся ровно тогда, когда кадр ОТДАН
  // компоновщику. Замер 14.08 (Playwright, WebView2-движок): rVFC срабатывает
  // одинаково у видимого элемента, у opacity:0 и даже у visibility:hidden —
  // то есть греть кадр невидимым можно, никакой «фоновой оптимизации» это не
  // включает (та живёт на уровне скрытой ВКЛАДКИ, а не элемента).
  // Фолбэк на loadeddata нужен только там, где rVFC нет вовсе (jsdom тестов):
  // без него «кадр» не наступил бы никогда и панель навсегда осталась бы с
  // обложкой.
  useEffect(() => {
    const el = videoRef.current as VideoWithFrameCallback | null;
    if (!el || !url) return;
    let dead = false;
    const mark = () => {
      if (!dead) setLive(true);
    };
    if (typeof el.requestVideoFrameCallback === "function") {
      const handle = el.requestVideoFrameCallback(mark);
      return () => {
        dead = true;
        el.cancelVideoFrameCallback?.(handle);
      };
    }
    el.addEventListener("loadeddata", mark);
    return () => {
      dead = true;
      el.removeEventListener("loadeddata", mark);
    };
  }, [videoRef, url]);

  // play/pause зеркалится событием, не rAF (пауза должна быть мгновенной)
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    // Скрытая вкладка — тот же «не играем»: декодер видео стоит денег даже
    // когда кадр физически некому показать. Возврат вкладки поднимает кадр
    // обратно (позиция при этом свежая: аудио тикало и в фоне).
    // ⚠️ В приложении эта проверка не срабатывает НИКОГДА (WebView2 не
    // сообщает странице о свёрнутом окне) — там ту же работу делает проп
    // playing, в который хозяин заводит нативный сигнал видимости.
    const hidden = typeof document !== "undefined" && document.hidden;
    if (playing && !hidden) {
      // Пока стояла пауза, тиков pos не было, поэтому atMs остался в прошлом, а
      // экстраполяция ниже считает от него как от «только что». Без этой строки
      // видео при возобновлении прыгало вперёд ровно на длительность паузы и
      // уходило в подгрузку — правильное значение возвращалось только со
      // следующим тиком аудио. Сдвигаем момент отсчёта, значение позиции при
      // этом то же самое, что и было.
      posRef.current = { pos: posRef.current.pos, atMs: performance.now() };
      // отказ play (URL протух и т.п.) глотаем: onError элемента поднимет
      // refresh, а до тех пор кадр просто стоит
      el.play().catch(() => undefined);
    } else {
      el.pause();
    }
    const onVisibility = () => {
      if (document.hidden) el.pause();
      else if (playingRef.current) el.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [videoRef, url, playing]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    el.playbackRate = speed;
  }, [videoRef, url, speed]);

  /** Одно сравнение «где видео» против «где аудио» с жёсткой перемоткой.
   *
   *  Порядок проверок здесь — не стилистика, а условие невозвращения к
   *  зависанию: сначала убеждаемся, что кадр вообще жив, потом — что прошлая
   *  перемотка закончилась, и только потом трогаем время. */
  const align = useCallback((force = false) => {
    const el = videoRef.current;
    if (!el) return;
    const now = performance.now();
    const { pos: base, atMs } = posRef.current;
    const est = playingRef.current ? base + ((now - atMs) / 1000) * speedRef.current : base;

    // РАЗОВОЕ ВЫРАВНИВАНИЕ после перемотки ползунком — это НЕ догон. Человек
    // выразил намерение один раз, и ни троттл, ни готовность буфера к нему не
    // относятся: ждать секунду после клика по полосе — это лаг, а не защита.
    if (force) {
      if (el.readyState > 0 && Math.abs(el.currentTime - est) > DRIFT_TOL_SEC) {
        lastSeekRef.current = now;
        el.currentTime = Math.max(0, est);
      }
      return;
    }

    // 1. Кадр стоит, пока звук идёт. Это и есть наблюдаемое «зависло»: причина
    //    неважна (пустой буфер, протухший адрес, захлебнувшийся декодер),
    //    важен факт. Догон тут бессилен — зовём хозяина.
    if (el.currentTime !== frozenRef.current.time) {
      frozenRef.current = { at: now, time: el.currentTime };
    } else if (playingRef.current && now - frozenRef.current.at > FROZEN_LIMIT_MS) {
      frozenRef.current = { at: now, time: el.currentTime }; // отсчёт заново — иначе позовём каждый кадр
      onStuckRef.current?.();
      return;
    }

    // 2. Перемотка ещё в полёте. Присвоить currentTime сейчас — значит
    //    ОТМЕНИТЬ её и начать новую; на 60 кадрах в секунду она не завершится
    //    никогда. Ровно этой строки не хватало до 12.08.
    if (el.seeking) return;
    // 3. Играть вперёд нечем — перемотка только добавит подгрузки.
    if (el.readyState < HAVE_FUTURE_DATA) return;

    if (Math.abs(el.currentTime - est) <= DRIFT_TOL_SEC) return;
    // 4. Троттл: одна жёсткая перемотка в секунду, а не шестьдесят.
    if (now - lastSeekRef.current < SEEK_COOLDOWN_MS) return;
    lastSeekRef.current = now;
    el.currentTime = Math.max(0, est);
  }, [videoRef]);

  // Догон — 60 раз в секунду, но ТОЛЬКО пока идёт звук: на паузе часы аудио
  // стоят, est не растёт, и весь цикл сравнивал одно и то же число с самим
  // собой до конца сессии (02.08). Пауза здесь приезжает и от хозяина: App
  // передаёт playing=false, когда панель накрыта караоке-оверлеем.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url || !playing) return;
    let raf = 0;
    const step = () => {
      align();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, url, playing, align]);

  // На паузе двигать позицию может только сик, а он приезжает НОВЫМ pos —
  // то есть перезапуском этого эффекта. Разового выравнивания хватает,
  // кадры для этого не нужны.
  useEffect(() => {
    if (!videoRef.current || !url || playing) return;
    align(true);
  }, [videoRef, url, playing, pos, align]);

  // ПЕРВЫЙ КАДР ДОЛЖЕН БЫТЬ СРАЗУ ТЕМ, ГДЕ ЗВУК (14.08). Свежий элемент грузится
  // с нуля, а догон выше ждёт HAVE_FUTURE_DATA — значит без этой строки первым
  // нарисованным кадром было бы НАЧАЛО клипа, и панель, открыв его, тут же
  // прыгнула бы на минуту вперёд: вторая смена картинки там, где договорились
  // не иметь ни одной. Момент `loadedmetadata` — самый ранний, когда перемотка
  // вообще возможна (длительность известна, readyState > 0), и он же самый
  // дешёвый: голову клипа качать уже не придётся.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    const onMeta = () => align(true);
    el.addEventListener("loadedmetadata", onMeta);
    return () => el.removeEventListener("loadedmetadata", onMeta);
  }, [videoRef, url, align]);

  return live;
}
