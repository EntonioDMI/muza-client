/** Правая панель «Сейчас играет» — общая для приложения и веба (Э7
 *  веб-паритета). Переехала из apps/desktop/src/shell/NowPlayingPanel.tsx, на
 *  старом месте пенёк-обёртка (он же приносит ПКМ по тексту — см. ниже).
 *
 *  ЧТО ЗДЕСЬ ПЛАТФОРМЕННОГО: ничего. Видео — обычный <video>, текст — Lyrics
 *  дизайн-системы, часы видео — общий хук lib/videoSync. Всё, чего у веба нет
 *  (видео трека, контекстное меню, «Смысл строки»), приезжает НЕОБЯЗАТЕЛЬНЫМИ
 *  пропами: не передал — соответствующего поведения просто нет, заглушек
 *  внутри панель не держит.
 *
 *  ⚠️ ПРАВИЛО ПРИ ЛЮБОЙ ПРАВКЕ: ни одна из двух программ не должна измениться
 *  ни на пиксель от чужой надобности. Новое поведение вводится только пропом
 *  со значением по умолчанию, при котором DOM ровно тот же, что был (пример —
 *  onAnimationEnd: пропа нет, React не вешает обработчик, разметка прежняя).
 *
 *  Про onClose: раньше десктоп его НЕ передавал, и «голый заголовок» был
 *  именно его видом. С 04.08 приложение передаёт крестик всегда (панель там
 *  теперь всегда плавающая, и закрывать её надо с неё же), а голая шапка
 *  осталась видом веба. */

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Cover, EmptyState, IconButton, Lyrics } from "@muza/ui";
import { useT } from "../i18n";
import { useVideoSync } from "../lib/videoSync";
import type { NowPlayingTrack, SharedLyricLine } from "./mediaTypes";

/** Растворение кромок окошка текста: вверху — в кадр или обложку над ним,
 *  внизу — в край панели. Восемь ступеней, а не две, по той же причине, что и
 *  у маски видео: линейная интерполяция на контрастном тексте даёт видимые
 *  полосы (Мах-банды), частые ступени по косинусоиде — ровный спад. */
const LYRICS_FADE =
  "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.35) 4%, rgba(0,0,0,0.8) 9%, black 15%, black 85%, rgba(0,0,0,0.8) 91%, rgba(0,0,0,0.35) 96%, transparent 100%)";

/** «Строк не помещается ни одной» — текст не рисуется вовсе. */
export const HIDE_LYRICS = -1;

/** ЛЕСТНИЦА «ВЫСОТА ОКОШКА → СКОЛЬКО СТРОК ПОКАЗЫВАТЬ» для режима «Авто».
 *
 *  Дословная заявка владельца 04.08: «маленький — текст скрыт, больше — одна
 *  строка, ещё больше — три или пять». Панель тянут за край (Ctrl+E) и
 *  сворачивают вместе с окном, поэтому фиксированное число строк в ней всегда
 *  либо не влезает, либо оставляет пустоту.
 *
 *  Число строк — это не обрезка, а ПОДГОНКА КЕГЛЯ: Lyrics подбирает размер
 *  строки так, чтобы ровно столько строк заполнили окошко (см. panelLines
 *  там же). Отсюда и порядок ступеней: чем ниже окно, тем МЕНЬШЕ строк и тем
 *  они крупнее — иначе текст в узкой щели становится нечитаемым бисером.
 *  Ноль на верхней ступени — «не подгонять вовсе»: места достаточно, и обычный
 *  прокручиваемый список своим кеглем читается лучше любой подгонки.
 *
 *  Порог сверяется по УБЫВАНИЮ — берётся первая подошедшая ступень. */
const LYRIC_LINE_LADDER: ReadonlyArray<readonly [minHeight: number, lines: number]> = [
  [260, 0],
  [170, 5],
  [96, 3],
  [40, 1],
  [0, HIDE_LYRICS],
];

export function lyricLinesForHeight(h: number): number {
  for (const [min, lines] of LYRIC_LINE_LADDER) if (h >= min) return lines;
  return HIDE_LYRICS;
}

/** Число строк по живой высоте окошка. Меряем сам DOM, а не считаем из ширины
 *  панели: высота окошка — это остаток после кадра, названия и полей, и
 *  повторять эту арифметику здесь значило бы завести вторую формулу раскладки,
 *  которая разойдётся с первой на ближайшей правке. */
function useAutoLyricLines(ref: React.RefObject<HTMLElement | null>, enabled: boolean): number {
  const [lines, setLines] = useState(0);
  useEffect(() => {
    const el = ref.current;
    // Выключено настройкой или нет ResizeObserver (jsdom тестов) — «Авто»
    // вырождается в прежнее поведение: обычный список без подгонки.
    if (!enabled || !el || typeof ResizeObserver === "undefined") {
      setLines(0);
      return;
    }
    const measure = () => setLines(lyricLinesForHeight(el.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);
  return lines;
}

export function NowPlayingPanel({
  track,
  lyrics,
  lyricsLoading = false,
  liked,
  onLike,
  activeLine,
  lyricsAutoScroll = true,
  lyricsEndNote = true,
  lyricsPanelLines = 0,
  onSeekLine,
  onExplain,
  onLineContextMenu,
  videoUrl = null,
  pos = 0,
  playing = false,
  speed = 1,
  windowVisible = true,
  onVideoError,
  onClose,
  onAnimationEnd,
  className,
  style,
}: {
  /** null — ничего не играет: панель не исчезает (иначе схлопывалась бы
   *  колонка сетки окна), а показывает честное пустое состояние. */
  track: NowPlayingTrack | null;
  /** Строки текста — LRCLIB с сервера (слайс 4). */
  lyrics: SharedLyricLine[];
  /** Текст ещё грузится — «Ищем текст…» вместо «Текст не найден». */
  lyricsLoading?: boolean;
  liked: boolean;
  onLike: () => void;
  activeLine: number;
  /** Настройка «Автоскролл» (Тексты): следовать ли за активной строкой. */
  lyricsAutoScroll?: boolean;
  /** Настройка «Нотка в конце» (Тексты): декоративный знак под текстом. */
  lyricsEndNote?: boolean;
  /** 0 — «Авто», N — подогнать размер строки под N строк (prefs.lyricsPanelLines). */
  lyricsPanelLines?: number;
  onSeekLine: (i: number) => void;
  /** Открыть общую модалку смысла для выделенной строки. Пропа нет — нет и
   *  аннотаций: у веба «смысл» ещё не сделан, и подчёркнутых строк там быть
   *  не должно. */
  onExplain?: (index: number) => void;
  /** ПКМ по тексту (копировать всё/строку, «Смысл строки»). Меню — целиком
   *  забота приложения: его пункты знают про плейлисты, буфер обмена и
   *  нативное меню WebView2, общему пакету это знание не нужно. Приложение
   *  подставляет обработчик пеньком apps/desktop/src/shell/NowPlayingPanel.tsx;
   *  у веба своего меню пока нет, и панель просто не вешает onContextMenu. */
  onLineContextMenu?: (e: React.MouseEvent, i: number | null) => void;
  /** Видео трека (2026-07-21, преф videoNowPlaying): удалённый googlevideo-URL
   *  из useTrackVideo; null — обложка (нет видео / тумблер выключен). */
  videoUrl?: string | null;
  /** Часы аудио для слейва видео (useVideoSync): позиция/игра/скорость. */
  pos?: number;
  playing?: boolean;
  speed?: number;
  /** Видно ли окно приложения. false (свёрнуто / накрыто чужим окном целиком)
   *  — видео уходит на паузу вместе с ДЕКОДЕРОМ, а цикл догона не крутится.
   *  Спрашивать это у документа нельзя: в WebView2 `document.hidden` про
   *  свёрнутое окно не знает (см. apps/desktop/src/lib/windowVisible.ts), а у
   *  веба, наоборот, окна нет вовсе — там значение по умолчанию true и
   *  штатное торможение фоновой вкладки. */
  windowVisible?: boolean;
  /** URL протух (googlevideo ~6ч) — хозяин ре-резолвит или гасит видео. */
  onVideoError?: () => void;
  /** Крестик в шапке. Без пропа шапка остаётся голым заголовком — так панель
   *  выглядит у веба; приложение крестик передаёт всегда. */
  onClose?: () => void;
  /** Конец CSS-анимации на корне панели. Нужен хозяину для отложенного
   *  размонтирования: приложение держит уезжающую панель в дереве, пока идёт
   *  анимация ухода, и снимает её здесь (App.tsx, блок npClosing). Пропа нет —
   *  React не вешает обработчик, DOM тот же. */
  onAnimationEnd?: React.AnimationEventHandler<HTMLElement>;
  /** Крючки раскладки для веба: там панель — колонка CSS-сетки шелла
   *  (класс .np-panel, им же её прячут брейкпоинты). Приложение ничего не
   *  передаёт — атрибута в DOM не появляется. */
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lyricsBoxRef = useRef<HTMLDivElement | null>(null);
  // `!!track` в enabled ОБЯЗАТЕЛЕН: без трека окошка текста нет в разметке
  // вовсе (ранний return), и эффект замера, отработавший по пустому ref, без
  // смены enabled не перезапустился бы никогда — «Авто» молча не включалось у
  // панели, смонтированной до первого трека (ревизия 04.08).
  const autoLines = useAutoLyricLines(lyricsBoxRef, lyricsPanelLines === 0 && track !== null);
  // «Авто» отдаёт число строк по РЕАЛЬНОЙ высоте окошка, заданное вручную —
  // ровно то, что попросили. HIDE_LYRICS означает «места нет вовсе».
  const shownLines = lyricsPanelLines > 0 ? lyricsPanelLines : autoLines;
  // видео — слейв к часам аудио; при videoUrl=null хук спит.
  // «Окна не видно» приходит сюда тем же входом, что и пауза: для хука это
  // одно и то же — снять кадр с видеодекодера (он стоит денег, даже когда
  // картинку физически некому показать) и не гнаться за часами аудио.
  // onStuck ведём в ТОТ ЖЕ обработчик, что и onError элемента: «кадр застыл» и
  // «кадр не открылся» лечатся одинаково — перерезолвом адреса, а на второй
  // раз хук отдачи видео сдаётся и панель показывает обложку (useTrackVideo).
  // Отдельная ветка не нужна, а без onStuck зависший кадр не лечился ВООБЩЕ:
  // <video> в этом случае не поднимает ни одного события (жалоба 12.08).
  useVideoSync(videoRef, {
    url: videoUrl,
    pos,
    playing: playing && windowVisible,
    speed,
    onStuck: onVideoError,
  });
  const zoneStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--sp-4)",
    padding: "var(--pad-zone)",
    // Скругление зоны решает тема (--r-zone): у флет-вида панель прижата к
    // краю окна, у «воздушного» вида — var(--r-lg). Кнопки окна у флета
    // ложатся ПОВЕРХ первых 22px панели — шапка ниже остаётся читаемой,
    // потому что заголовок прижат влево, а кнопки — вправо.
    borderRadius: "var(--r-zone, var(--r-lg))",
    // Материал зоны — как у сайдбара: общая плотность из ползунка стекла,
    // поверх неё точная подстройка --glass-nowplaying (см. themeVars.ts).
    background: "var(--glass-nowplaying, var(--glass-zone))",
    backdropFilter: "var(--bf-zone, none)",
    WebkitBackdropFilter: "var(--bf-zone, none)",
    overflow: "hidden",
    ...style,
  };
  const title = (
    <span
      style={{
        fontSize: "var(--fs-caption)",
        fontWeight: 600,
        letterSpacing: "var(--ls-caps)",
        textTransform: "uppercase",
        color: "var(--text-3)",
      }}
    >
      {t("nowPlaying.heading")}
    </span>
  );
  // Без onClose — тот же одинокий <span>, что был у десктопа: лишняя обёртка
  // добавила бы в колонку flex-строку и сместила бы всё, что под ней.
  const heading = onClose ? (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {title}
      <IconButton
        icon="x"
        size="sm"
        label={t("plugins.closePanel")}
        iconSize={16}
        // Подсказка ВНИЗ, а не вверх (жалоба владельца 04.08: «при наведении
        // на крестик подсказка вылезает за пределы окна»). Кнопка стоит в
        // 44px от верха окна, пузырёк высотой 27px рисуется над ней и на 19px
        // уходил выше кромки панели, где его срезал её overflow: hidden.
        // Tooltip намеренно не порталится (position:absolute от обёртки), сам
        // переворачиваться пока не умеет — направление задаём здесь.
        tooltipPlacement="bottom"
        style={{ width: 30, height: 30 }}
        onClick={onClose}
      />
    </div>
  ) : (
    title
  );

  if (!track) {
    return (
      <aside data-zone="nowplaying" className={className} style={zoneStyle} onAnimationEnd={onAnimationEnd}>
        {heading}
        <EmptyState
          icon="music-2"
          title={t("nowPlaying.empty.title")}
          hint={t("nowPlaying.empty.hint")}
          style={{ margin: "auto" }}
        />
      </aside>
    );
  }

  return (
    <aside data-zone="nowplaying" className={className} style={zoneStyle} onAnimationEnd={onAnimationEnd}>
      {heading}
      {videoUrl ? (
        // Видео вместо обложки (спека владельца 2026-07-21, «как в Spotify»):
        // на всю ширину плашки БЕЗ рамок (минус-отступы съедают pad-zone,
        // углы клипует сама панель), граница с текстом — блюр + затемнение,
        // а не линия. Клики не нужны — слой декоративный.
        <div
          aria-hidden
          data-testid="np-video"
          style={{
            margin: "0 calc(-1 * var(--pad-zone))",
            // низ видео растворяется ПОД блоком названия (правка владельца
            // 21.07: «переход плавнее» — не полоса на кромке, а перекрытие)
            marginBottom: "-52px",
            position: "relative",
            flex: "none",
          }}
        >
          {/* Переход = РАСТВОРЕНИЕ самого кадра в прозрачность (маска), а не
              закраска поверх: скрим цветом панели давал ступеньку на кромке —
              стекло панели полупрозрачно, оттенок не совпадает никогда
              (итерации владельца 21.07). Сквозь хвост кадра проступает
              настоящий фон панели — стыка не существует по построению. */}
          <video
            ref={videoRef}
            key={track.id}
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            onError={onVideoError}
            style={{
              width: "100%",
              // КВАДРАТ, КАК У ОБЛОЖКИ (заявка владельца 04.08: «сделать
              // „Сейчас играет“ квадратом»). Было 16/10 — и панель меняла
              // форму на каждом треке: у одного видео нашлось, у другого нет,
              // и блок сверху то приземистый, то квадратный, а вместе с ним
              // прыгал и текст под ним. Кадр кадрируется по центру ровно так
              // же, как кадрируется неквадратная обложка, — в панели остаётся
              // ОДНА форма независимо от того, что нашлось для трека.
              aspectRatio: "1 / 1",
              objectFit: "cover",
              display: "block",
              // S-кривая из 8 ступеней: CSS интерполирует линейно, и на ярком
              // кадре изломы скорости затухания читаются полосами (Мах-банды);
              // частые ступени по косинусоиде дают перцептивно ровный спад
              maskImage:
                "linear-gradient(to bottom, black 0%, black 38%, rgba(0,0,0,0.97) 48%, rgba(0,0,0,0.88) 58%, rgba(0,0,0,0.72) 68%, rgba(0,0,0,0.5) 78%, rgba(0,0,0,0.28) 86%, rgba(0,0,0,0.12) 93%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, black 0%, black 38%, rgba(0,0,0,0.97) 48%, rgba(0,0,0,0.88) 58%, rgba(0,0,0,0.72) 68%, rgba(0,0,0,0.5) 78%, rgba(0,0,0,0.28) 86%, rgba(0,0,0,0.12) 93%, transparent 100%)",
            }}
          />
          {/* мягкий блюр по растворяющемуся хвосту — «блюрится, будто
              затемняется» из спеки; сам тоже с маской, кромки не имеет */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "45%",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              maskImage:
                "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.6) 70%, black 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.6) 70%, black 100%)",
              pointerEvents: "none",
            }}
          />
        </div>
      ) : (
        <Cover key={track.id} src={track.cover} radius="var(--r-md)" className="muza-view" />
      )}
      {/* zIndex: при видео блок названия лежит НА затухающем низе кадра */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--fs-strong)",
              fontWeight: 400,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {track.title}
          </div>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
            {track.album ? `${track.artist} · ${track.album}` : track.artist}
          </div>
        </div>
        <IconButton icon="heart" active={liked} filled={liked} label={t("common.like")} onClick={onLike} />
      </div>
      <div
        ref={lyricsBoxRef}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          // Видео-режим: БЕЗ коробки — её скруглённый верх и был «острой
          // гранью» (итерация владельца 21.07). Текст лежит на фоне панели,
          // кадр перетекает в него сплошным полотном (как в караоке-оверлее).
          borderRadius: videoUrl ? 0 : "var(--r-md)",
          background: videoUrl ? "transparent" : "var(--surface-2)",
          padding: "0 var(--sp-4)",
          overflow: "hidden",
          // КРОМКИ ТЕКСТА РАСТВОРЯЮТСЯ, А НЕ ОБРЕЗАЮТСЯ (жалоба владельца
          // 04.08: «хотелось бы, чтобы текст песни плавно переходил в видео, а
          // не резко обрывался»). Строка, уезжающая под кадр, обрубалась ровно
          // по границе коробки — сплошное полотно, ради которого убирали фон и
          // скругление, ломалось об эту линию. Маска доводит замысел до конца:
          // тем же приёмом растворяется низ самого кадра (выше по файлу).
          maskImage: LYRICS_FADE,
          WebkitMaskImage: LYRICS_FADE,
        }}
      >
        {shownLines === HIDE_LYRICS ? null : lyrics.length > 0 ? (
          <Lyrics
            lines={lyrics}
            activeIndex={activeLine}
            autoScroll={lyricsAutoScroll}
            endNote={lyricsEndNote}
            panelLines={shownLines}
            onSeek={onSeekLine}
            onExplain={onExplain}
            onLineContextMenu={onLineContextMenu}
            style={{ height: "100%" }}
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-3)",
              fontSize: "var(--fs-caption)",
            }}
          >
            {lyricsLoading ? t("player.lyricsSearching") : t("player.lyricsNotFound")}
          </div>
        )}
      </div>
    </aside>
  );
}
