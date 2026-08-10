import React, { useState } from "react";
import { Icon } from "../core/Icon.jsx";
import { IconButton } from "../core/IconButton.jsx";
import { Cover } from "./Cover.jsx";
import { Tooltip } from "../feedback/Tooltip.jsx";

/** Track list row — no dividers; hover is a surface layer, active is accent title.
 *  Keyboard-reachable: the index cell is a real play button (number → play icon
 *  on hover/focus), like/more appear on focus-within as well as hover.
 *  Labels default to English (ДС строко-нейтральна, DEFAULT_LANG=en) — приложение
 *  может передать локализованные playLabel/pauseLabel/likeLabel/moreLabel.
 *
 *  ⚠️ ПОДСВЕТКА — БЕЗ СОСТОЯНИЯ REACT (2026-08-05). Наведение красит строку
 *  каналами CSS (.muza-row / .muza-row--track в interactions.css, там же весь
 *  разбор), а не useState: самый горячий список приложения платил перерисовкой
 *  за каждый проход курсора. Заодно ушёл ручной разбор e.relatedTarget в onBlur
 *  — :focus-within считает то же самое и не оставляет подсветку залипшей на
 *  строке, уехавшей из-под неподвижного курсора.
 *
 *  ⚠️ ЧТО ОСТАЛОСЬ СОСТОЯНИЕМ И ПОЧЕМУ ИМЕННО ЭТО. Лайк и «⋯» — две IconButton,
 *  каждая в Tooltip, и монтировать их у ВСЕХ строк нельзя: замер 2026-08-05 на
 *  240 строках (vitest+jsdom, медиана из 9 прогонов) — 329 мс список как есть,
 *  +470 мс за всегда-смонтированную пару (+143 %, то есть список дороже вдвое;
 *  Tooltip в этой цене всего ~7 %, остальное — сама кнопка), а списки НЕ
 *  виртуализированы. Поэтому монтируем ЛЕНИВО и НАВСЕГДА: `armed` взводится
 *  первым касанием строки (курсор или фокус) и больше не гаснет. Перерисовка
 *  строки становится однократной вместо двух на каждый проход курсора, а
 *  ОБЁРТКА аффорданса живёт всегда — именно поэтому фейд наконец играет: её
 *  прозрачность едет 0→1 обычным переходом, а кнопка появляется внутри уже
 *  начавшегося перехода. Раньше кнопка МОНТИРОВАЛАСЬ по наведению, и никакой
 *  фейд к ней не применялся в принципе.
 *
 *  Кружок-номер, наоборот, показывает ОБА слоя всегда (цифра и play гасят друг
 *  друга прозрачностью): лишняя иконка на строку стоит +17 мс на те же 240
 *  строк (+5 %) — за плавную подмену это честная цена. */
/** Ширина слота версий = ширине распорки, чтобы ряд с версиями и без были
 *  одинаковы до пикселя (число + шеврон помещаются с запасом). */
const VERSIONS_SLOT = 40;

/** ══ КОМПАКТНАЯ СТРОКА (телефон) ═════════════════════════════════════════
 *  Включается пропом `compact`; на десктопе и планшете ряд прежний.
 *
 *  ЗАЧЕМ. Замер 10.08 на iPhone 393pt: фиксированные слоты обычной строки —
 *  номер 28 + обложка 42 + лайк 36 + время 40 + «⋯» 36 = 182px, пять зазоров
 *  по 16 = 80px, поля 32px. Итого 294px из 345 доступных, и НАЗВАНИЮ
 *  ОСТАВАЛСЯ 51 ПИКСЕЛЬ — «Сваровски на моей шее» показывалось как «Сва…».
 *  Владелец описал это точно: «слева и справа от названия много свободного
 *  места». Свободным оно и было — под слотами, которые на телефоне не нужны.
 *
 *  ЧТО УБРАНО И ПОЧЕМУ ИМЕННО ЭТО.
 *  1. Номер. На телефоне он ничего не адресует (вслух «включи двадцать
 *     седьмой» не говорят), а роль кнопки играет вся строка — она и раньше
 *     запускала трек целиком. Играющий трек показывает значок поверх обложки.
 *  2. Слот версий и бейдж источника — служебная информация большого экрана.
 *  3. ЛАЙК И ВРЕМЯ БОЛЬШЕ НЕ СТОЯТ РЯДОМ — прямая просьба владельца («сделать
 *     так, чтобы они не отображались одновременно»). Слот один: у любимого
 *     трека в нём сердце, у остальных — длительность. Это не компромисс, а
 *     честная логика: сердце здесь и есть ответ на вопрос «а это любимое?»,
 *     ради которого на список и смотрят, а время у нелюбимого трека — всё,
 *     что о нём стоит знать одной цифрой. Снять лайк можно тем же сердцем,
 *     поставить — из меню «⋯» рядом.
 *
 *  ⚠️ АФФОРДАНСЫ В КОМПАКТЕ ВИДНЫ ВСЕГДА (--row-aff: 1), и это ПОЧИНКА, а не
 *  оформление. Прозрачность лайка и «⋯» едет от канала наведения
 *  (interactions.css), а у пальца наведения нет: на телефоне обе кнопки имели
 *  opacity 0 И pointer-events: none — то есть «⋯» на сайте с телефона нельзя
 *  было нажать вообще. Ленивый монтаж (`armed`) в компакте тоже не нужен: он
 *  экономил перерисовки на списке в 240 строк с курсором, а здесь кнопка
 *  обязана существовать с первого кадра. */
const COMPACT_ROW_H = 64;

export function TrackRow({
  index,
  cover,
  showCover = true,
  title,
  artist,
  album,
  duration,
  showDuration = true,
  source,
  versionCount,
  showVersions = false,
  versionsExpanded = false,
  onVersions,
  versionsLabel,
  active = false,
  playing = false,
  liked = false,
  explicit = false,
  selected = false,
  compact = false,
  onPlay,
  onLike,
  onMore,
  playLabel = "Play",
  pauseLabel = "Pause",
  likeLabel = "Like",
  moreLabel = "More",
}) {
  // Единственное состояние строки — «строку уже трогали» (см. шапку файла).
  // Взводится один раз и не сбрасывается: сброс вернул бы вторую перерисовку на
  // каждый уход курсора, ради которой всё и затевалось.
  const [armed, setArmed] = useState(false);
  const arm = armed ? undefined : () => setArmed(true);
  return (
    <div
      // Отклик на нажатие — строка жмётся под пальцем (animations.css).
      // Строка трека кликается чаще всего в приложении, а путь от клика до
      // звука самый длинный: без мгновенной реакции палец успевает усомниться.
      // muza-row/--track — каналы подсветки (interactions.css); там же живёт и
      // transition строки: инлайном он перекрывал .muza-press целиком.
      className="muza-press muza-row muza-row--track"
      // Взводим и мышью, и фокусом: клавиатура обязана доставать лайк и «⋯»
      // ровно так же, как курсор. Обработчика нет вовсе, когда уже взведено —
      // ни одного вызова на проход курсора по прогретому списку.
      onPointerEnter={arm}
      onFocus={arm}
      /* ВСЯ ЛЕВАЯ ЧАСТЬ СТРОКИ ЗАПУСКАЕТ ТРЕК (заказ владельца 2026-08-05).
         Раньше играть можно было только по кружку-номеру 28×28 — самая частая
         цель в приложении была и самой мелкой, и владелец жаловался, что «трек
         не запускается с первого раза». Правый кластер (лайк, длительность,
         «⋯») клик НЕ пропускает — см. stopPropagation на нём ниже: «случайно
         не нажать» решается структурой, а не координатами.

         ⚠️ e.detail — СЧЁТЧИК КЛИКОВ БРАУЗЕРА, и он здесь обязателен. Второй
         клик двойного пришёл бы уже по ИГРАЮЩЕМУ треку, а повторный запуск
         того же трека в той же очереди — это пауза (usePlayback.playContext).
         То есть без этой строки любой случайный дабл-клик запускал бы песню и
         тут же её глушил. Осознанная пауза кликом при этом работает: после
         паузы двойного клика detail снова равен единице. */
      onClick={
        onPlay
          ? (e) => {
              if (e.detail > 1) return;
              onPlay();
            }
          : undefined
      }
      // ПКМ = то же меню, что «⋯» (нативное браузерное меню в плеере — мусор)
      onContextMenu={
        onMore
          ? (e) => {
              e.preventDefault();
              onMore(e);
            }
          : undefined
      }
      aria-selected={selected || undefined}
      // Каналу подсветки нужны АТРИБУТЫ, а не тернарники: «сильнее» решается
      // порядком правил в interactions.css (выделение > играет > наведение), и
      // это единственное место, где инвариант записан целиком.
      data-active={active || undefined}
      data-selected={selected || undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? "var(--sp-3)" : "var(--sp-4)",
        height: compact ? COMPACT_ROW_H : "var(--h-trackrow, 60px)",
        padding: compact ? "0 var(--sp-2)" : "0 var(--sp-4)",
        borderRadius: "var(--r-sm)",
        // строка запускает трек — курсор обязан об этом говорить
        cursor: onPlay ? "pointer" : "default",
        background: "var(--row-bg)",
        // см. «АФФОРДАНСЫ В КОМПАКТЕ» в шапке: у пальца нет наведения, и без
        // этой пары «⋯» была невидимой и не ловила касания.
        ...(compact ? { "--row-aff": 1, "--row-aff-pe": "auto" } : null),
      }}
    >
      {compact ? null : (
      <div style={{ width: 28, flex: "none", display: "flex", justifyContent: "center" }}>
        {/* всегда настоящая кнопка: клавиатура достаёт play без ховера */}
        <button
          type="button"
          aria-label={active && playing ? pauseLabel : `${playLabel}: ${title}`}
          /* ⚠️ stopPropagation обязателен с тех пор, как строка сама запускает
             трек: иначе клик по кнопке звал бы onPlay ДВАЖДЫ — сначала кнопкой,
             потом всплытием до строки, — то есть запускал и сразу ставил паузу. */
          onClick={
            onPlay
              ? (e) => {
                  e.stopPropagation();
                  onPlay();
                }
              : undefined
          }
          style={{
            position: "relative",
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRadius: "var(--r-pill)",
            background: "var(--row-slot-bg)",
            /* роль акцента «активный трек»: свой цвет, фолбэк — общий акцент */
            color: active ? "var(--accent-active-text, var(--accent-text))" : "var(--row-slot-fg)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-caption)",
            fontVariantNumeric: "tabular-nums",
            cursor: "pointer",
            padding: 0,
            /* ⚠️ ДО 2026-08-05 ЗДЕСЬ НЕ БЫЛО TRANSITION ВООБЩЕ. Кружок с номером
               менял фон и цвет ровно в один кадр, пока вся остальная строка
               плавно подсвечивалась — самый заметный источник «резкости», о
               котором говорил владелец: глаз ловит рассинхрон внутри ОДНОГО
               элемента больнее, чем быструю анимацию целиком. */
            transition: "background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)",
          }}
        >
          {/* ДВА СЛОЯ, А НЕ ПОДМЕНА. Пока содержимое кружка МОНТИРОВАЛОСЬ по
              наведению, оно и не могло гаснуть: у только что вставленного узла
              нет предыдущего значения, от которого едет переход. Слои лежат друг
              на друге (inset:0) и гасят друг друга каналом --row-aff: сумма их
              прозрачностей всегда равна единице, поэтому «между» кадрами нет ни
              пустоты, ни двойной жирноты. */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              opacity: "calc(1 - var(--row-aff))",
              transition: "opacity var(--dur-state) var(--ease-standard)",
            }}
          >
            {active && playing ? (
              <Icon name="audio-lines" size={18} color="var(--accent-active-text, var(--accent-text))" />
            ) : (
              <span>{index}</span>
            )}
          </span>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              opacity: "var(--row-aff)",
              transition: "opacity var(--dur-state) var(--ease-standard)",
            }}
          >
            <Icon name={active && playing ? "pause" : "play"} size={16} color="currentColor" />
          </span>
        </button>
      </div>
      )}
      {showCover ? (
        compact ? (
          /* Обложка + признак «играет»: в компакте кружка-номера нет, и о
             состоянии говорить больше нечему. Значок лежит ПОВЕРХ обложки на
             затемнении — не сдвигая ни одного пикселя раскладки, чтобы список
             не дёргался при смене трека. */
          <div style={{ position: "relative", flex: "none", lineHeight: 0 }}>
            <Cover src={cover} size={44} />
            {active ? (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "var(--r-sm)",
                  background: "rgba(0, 0, 0, 0.5)",
                }}
              >
                <Icon name={playing ? "audio-lines" : "pause"} size={18} color="var(--accent-active-text, var(--accent-text))" />
              </span>
            ) : null}
          </div>
        ) : (
          <Cover src={cover} size={42} />
        )
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <span
            style={{
              fontSize: "var(--fs-body)",
              fontWeight: "var(--fw-medium)",
              color: active ? "var(--accent-active-text, var(--accent-text))" : "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </span>
          {explicit ? (
            <span style={{ flex: "none", fontSize: 11, fontWeight: "var(--fw-semibold)", color: "var(--text-3)", background: "var(--surface-3)", borderRadius: 4, padding: "1px 5px" }}>E</span>
          ) : null}
        </div>
        {/* Альбом — в одной строке с артистом через « · », приглушённее
            (text-3): обрезку обеих частей делает общий ellipsis родителя. */}
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {artist}
          {album ? <span style={{ color: "var(--text-3)" }}> · {album}</span> : null}
        </div>
      </div>
      {/* Источник трека — тихий информ-бейдж (всегда виден, не по ховеру): откуда
          добывается. Нативного title нет: он дублировал видимый текст стоковой
          плашкой WebView2 (жалоба 2026-07-16). */}
      {source && !compact ? (
        <span
          style={{
            flex: "none",
            maxWidth: 132,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
            fontWeight: "var(--fw-medium)",
            lineHeight: 1.55,
            color: "var(--text-2)",
            background: "var(--surface-3)",
            borderRadius: "var(--r-sm)",
            padding: "2px 8px",
          }}
        >
          {source}
        </span>
      ) : null}
      {/* ПРАВЫЙ КЛАСТЕР — «ТИХАЯ» ЗОНА (заказ владельца 2026-08-05). Строка
          целиком запускает трек, но здесь живут лайк, цифры и «⋯»: клик обязан
          останавливаться, иначе промах мимо мелкого сердца запускал бы песню.
          Гасим на КОНТЕЙНЕРЕ, а не на каждой кнопке: любая новая кнопка в этом
          кластере получает защиту сама, и её не надо помнить. */}
      {compact ? (
        /* Компактный правый кластер: ОДИН информационный слот плюс меню.
           Что в слоте и почему — в шапке файла, пункт 3. Ширина слота
           фиксирована, чтобы «⋯» у всех строк стояла на одной вертикали и
           список не выглядел рваным при смешанных лайках. */
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", alignItems: "center", gap: 2, flex: "none" }}
        >
          <span style={{ width: 40, flex: "none", display: "inline-flex", justifyContent: "center" }}>
            {liked ? (
              <IconButton icon="heart" size="sm" active filled label={likeLabel} onClick={onLike} />
            ) : showDuration ? (
              <span style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", fontVariantNumeric: "tabular-nums" }}>{duration}</span>
            ) : null}
          </span>
          {onMore ? <IconButton icon="ellipsis" size="sm" label={moreLabel} onClick={onMore} /> : null}
        </div>
      ) : (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flex: "none" }}
      >
        {/* Версии (ремиксы/спидапы) — слот ряда, а не сосед строки снаружи.
            Раньше карточка группы вешала бейдж СБОКУ от TrackRow, тот ужимался
            на её ширину, и у трека с версиями таймкод уезжал влево относительно
            соседних строк. Слот резервируется распоркой у ВСЕХ строк списка
            (showVersions — свойство списка, versionCount — данные строки),
            поэтому правый кластер стоит на одном месте у всех. */}
        {showVersions ? (
          versionCount ? (
            <Tooltip label={versionsLabel} style={{ flex: "none" }}>
            <button
              type="button"
              onClick={onVersions}
              aria-expanded={versionsExpanded}
              aria-label={versionsLabel}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                width: VERSIONS_SLOT,
                height: 36,
                flex: "none",
                border: "none",
                borderRadius: "var(--r-sm)",
                background: versionsExpanded ? "var(--surface-3)" : "transparent",
                color: versionsExpanded ? "var(--text-1)" : "var(--text-2)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-caption)",
                fontWeight: "var(--fw-semibold)",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              {versionCount}
              <Icon
                name="chevron-down"
                size={14}
                color="currentColor"
                style={{
                  transform: versionsExpanded ? "rotate(180deg)" : undefined,
                  transition: "transform var(--dur-state-move) var(--ease-in-out)",
                }}
              />
            </button>
            </Tooltip>
          ) : (
            <span style={{ width: VERSIONS_SLOT, flex: "none" }}></span>
          )
        ) : null}
        {/* ОБЁРТКА ЖИВЁТ ВСЕГДА, КНОПКА — С ПЕРВОГО КАСАНИЯ (разбор и цифры
            замера — в шапке файла). Прозрачность едет на обёртке, которая
            никуда не пересоздаётся, поэтому переход стартует от честного нуля:
            кнопка появляется внутри уже начавшегося фейда, а не поверх него.
            Лайкнутый трек виден без наведения — это не аффорданс, а факт. */}
        <span
          style={{
            width: 36,
            flex: "none",
            display: "inline-flex",
            opacity: liked ? 1 : "var(--row-aff)",
            // невидимое не ловит клики; фокусу это не мешает — он сам зажигает
            // строку через :focus-within и возвращает pointer-events
            pointerEvents: liked ? undefined : "var(--row-aff-pe)",
            transition: "opacity var(--dur-state) var(--ease-standard)",
          }}
        >
          {armed || liked ? (
            <IconButton icon="heart" size="sm" active={liked} filled={liked} label={likeLabel} onClick={onLike} />
          ) : null}
        </span>
        {showDuration ? (
          <span style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", fontVariantNumeric: "tabular-nums", width: 40, textAlign: "right" }}>{duration}</span>
        ) : null}
        {onMore ? (
          <span
            style={{
              width: 36,
              flex: "none",
              display: "inline-flex",
              opacity: "var(--row-aff)",
              pointerEvents: "var(--row-aff-pe)",
              transition: "opacity var(--dur-state) var(--ease-standard)",
            }}
          >
            {armed ? <IconButton icon="ellipsis" size="sm" label={moreLabel} onClick={onMore} /> : null}
          </span>
        ) : null}
      </div>
      )}
    </div>
  );
}
