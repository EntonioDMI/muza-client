import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";
import { IconButton } from "./IconButton.jsx";

/** Таблица данных: настоящая <table> с <thead>/<tbody>, сортировкой по клику
 *  на заголовок и aria-sort.
 *
 *  ПОЧЕМУ НЕ СЕТКА ИЗ DIV. До этого компонента таблицы в приложении были
 *  CSS-grid из div и span: экран читался как таблица, но программе (скринридер,
 *  поиск по странице, тесты) не сообщалось ни про строки, ни про колонки, а
 *  сортировки не было НИГДЕ — данные лежали в том порядке, в каком их отдал
 *  сервер, и другого способа на них посмотреть не было. Настоящая разметка
 *  даёт роли даром, а сортировка появляется в одном месте на все экраны.
 *
 *  ПЕРВЫЙ КЛИК ПО ЧИСЛОВОЙ КОЛОНКЕ — УБЫВАНИЕ. По числам почти всегда ищут
 *  «где больше всего» (топ ошибок, установки, прослушивания), и возрастание
 *  первым кликом заставляло бы кликать дважды каждый раз. По тексту наоборот:
 *  первый клик — от А к Я. Третьего состояния «как пришло» нет намеренно:
 *  ловить мышью три состояния вместо двух — работа, а исходный порядок и так
 *  восстанавливается сортировкой по главной колонке.
 *
 *  РАСКЛАДКА. Если хоть у одной колонки задана width — раскладка становится
 *  фиксированной: колонки стоят на месте, длинный текст обрезается многоточием
 *  вместо того, чтобы разносить таблицу по ширине. Без единой width колонки
 *  делят место по содержимому (и тогда обрезания не будет — это нормально для
 *  коротких таблиц).
 *
 *  ⚠️ ФИКСИРОВАННАЯ РАСКЛАДКА СЪЕДАЕТ КОЛОНКУ БЕЗ ШИРИНЫ, если сумма заданных
 *  ширин не влезает в контейнер: браузер честно отдаёт пиксельным колонкам их
 *  пиксели, а оставшейся достаётся НОЛЬ. Замерено пиксельно на таблице
 *  публичных плейлистов (сумма 750px в поле 660px на минимальном окне
 *  приложения 1024): колонка с именем плейлиста получала ширину 0 — не
 *  многоточие, а пустоту, — и таблица торчала на 90px за карточку. Поэтому у
 *  таблицы есть НИЖНЯЯ граница ширины, а переполнение уезжает в собственную
 *  горизонтальную прокрутку обёртки: лучше проматывать, чем не видеть данные.
 *
 *  СТРАНИЦЫ ЖИВУТ ЗДЕСЬ ЖЕ, А НЕ У ВЫЗЫВАЮЩЕГО. Это не удобство, а корректность:
 *  сортировка живёт внутри таблицы, и если вызывающий отрежет страницу ДО неё,
 *  клик по заголовку отсортирует пятьдесят случайных строк и выдаст их за
 *  верхние. Ровно эту ложь в проекте уже запрещали в другом месте. Отдавай
 *  таблице ВЕСЬ массив и `pageSize` — режем после сортировки.
 *
 *  Строка — на ступень ВЫШЕ подложки: панель уже surface-2, и строка на том же
 *  слое не читалась бы как отдельная строка. */

/** Размер стрелки направления сортировки: рядом с подписью 13px иконка крупнее
 *  начинает спорить с текстом за внимание. */
const SORT_ICON = 14;

/** Сколько места нужно колонке без заданной ширины, чтобы в ней читалось хоть
 *  что-то. Ниже этого таблица предпочтёт прокрутку сжатию. */
const AUTO_COL_MIN = 160;

/** Сравнение значений одной колонки. Числа — как числа (иначе 10 < 9), всё
 *  остальное — как текст локали (кириллица и латиница в одном списке). */
function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export function Table({
  columns,
  rows,
  rowKey,
  empty,
  ariaLabel,
  defaultSort = null,
  pageSize = 0,
  pageLabel,
  prevLabel = "Назад",
  nextLabel = "Вперёд",
  onView,
  style,
}) {
  const [sort, setSort] = useState(defaultSort);
  const [hoverKey, setHoverKey] = useState(null);
  const [page, setPage] = useState(0);

  const active = sort ? columns.find((c) => c.key === sort.key && c.sortable) : null;
  const dir = sort ? sort.dir : "asc";
  const sorted = useMemo(() => {
    if (!active) return rows;
    const valueOf = active.sortValue || ((row) => row[active.key]);
    const sign = dir === "desc" ? -1 : 1;
    // копия: сортировка на месте перетасовала бы массив вызывающего
    return [...rows].sort((a, b) => sign * compare(valueOf(a), valueOf(b)));
  }, [rows, active, dir]);

  // СНАЧАЛА СОРТИРУЕМ ВЕСЬ МАССИВ, ПОТОМ РЕЖЕМ СТРАНИЦУ — см. шапку.
  const pages = pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, pages - 1);
  const shown = pageSize > 0 ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;

  // Список поехал (сменился фильтр, пришли данные) — возвращаемся на первую
  // страницу: остаться на седьмой в списке из трёх строк значит показать пусто.
  useEffect(() => {
    setPage(0);
  }, [rows, sort]);

  // Сколько строк ВИДНО сейчас — наружу. Страницы живут здесь (иначе сортировка
  // врёт, см. шапку), поэтому и счётчик снаружи может остаться честным только
  // отсюда: сам вызывающий текущую страницу больше не знает.
  //
  // ⚠️ Колбэк держим В РЕФЕ и НЕ кладём в зависимости. Вызывающий почти всегда
  // передаёт стрелку прямо в JSX — её личность меняется каждый рендер, эффект
  // срабатывал бы на каждый, ставил бы состояние снаружи и заводил бесконечный
  // цикл. Обязывать всех оборачивать в useCallback значило бы переложить свою
  // ловушку на каждого потребителя.
  //
  // useLayoutEffect, а НЕ useEffect: снаружи по этому значению рисуют счётчик
  // «показано N из M», и пассивный эффект отдал бы его кадром позже — человек
  // успевал увидеть «показано 0».
  const viewRef = useRef(onView);
  viewRef.current = onView;
  const shownCount = shown.length;
  const totalCount = sorted.length;
  useLayoutEffect(() => {
    viewRef.current?.({ page: safePage, pages, shown: shownCount, total: totalCount });
  }, [safePage, pages, shownCount, totalCount]);

  const toggle = (col) => {
    setSort((prev) =>
      prev && prev.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.numeric ? "desc" : "asc" },
    );
  };

  const fixed = columns.some((c) => c.width);
  const alignOf = (c) => c.align || (c.numeric ? "right" : "left");

  // Нижняя граница ширины: сумма заданных пикселей плюс минимум на каждую
  // колонку без ширины. Уже этого таблица не сжимается — она прокручивается
  // (иначе колонка без ширины получает ноль, см. шапку).
  const px = (w) => (typeof w === "number" ? w : typeof w === "string" && w.endsWith("px") ? parseFloat(w) : null);
  const minWidth = fixed ? columns.reduce((sum, c) => sum + (px(c.width) ?? AUTO_COL_MIN), 0) : undefined;

  const table = (
    <table
      role="table"
      aria-label={ariaLabel}
      style={{
        width: "100%",
        minWidth,
        tableLayout: fixed ? "fixed" : "auto",
        /* separate + вертикальный borderSpacing — тот же зазор между строками,
           что был у прежних div-строк; collapse съел бы его вместе с углами */
        borderCollapse: "separate",
        borderSpacing: "0 var(--sp-1)",
        fontSize: "var(--fs-body)",
      }}
    >
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => {
            const isActive = active != null && active.key === c.key;
            return (
              <th
                key={c.key}
                scope="col"
                aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined}
                style={{
                  padding: "var(--sp-1) var(--sp-3)",
                  textAlign: alignOf(c),
                  fontSize: "var(--fs-caption)",
                  fontWeight: "var(--fw-medium)",
                  letterSpacing: "var(--ls-caption)",
                  color: isActive ? "var(--text-2)" : "var(--text-3)",
                }}
              >
                {c.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggle(c)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--sp-1)",
                      /* заголовок — не кнопка на вид: ни фона, ни рамки, только
                         курсор и стрелка говорят, что по нему можно щёлкнуть */
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      color: "inherit",
                      font: "inherit",
                      cursor: "pointer",
                      transition: "color var(--dur-state) var(--ease-standard)",
                    }}
                  >
                    {c.label}
                    <Icon
                      name={isActive && dir === "asc" ? "chevron-up" : "chevron-down"}
                      size={SORT_ICON}
                      style={{ opacity: isActive ? 1 : 0.35 }}
                    />
                  </button>
                ) : (
                  c.label
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {shown.length === 0 ? (
          <tr>
            <td
              colSpan={columns.length}
              style={{
                padding: "var(--sp-4) var(--sp-3)",
                color: "var(--text-3)",
                fontSize: "var(--fs-body)",
              }}
            >
              {empty}
            </td>
          </tr>
        ) : (
          shown.map((row, i) => {
            const key = rowKey(row, i);
            return (
              <tr
                key={key}
                onMouseEnter={() => setHoverKey(key)}
                onMouseLeave={() => setHoverKey(null)}
                style={{
                  /* подсветка строки — единственный способ не потерять её,
                     ведя глаз через пять колонок к правому краю */
                  background: hoverKey === key ? "var(--surface-4)" : "var(--surface-3)",
                  transition: "background var(--dur-state) var(--ease-standard)",
                }}
              >
                {columns.map((c, ci) => (
                  <td
                    key={c.key}
                    style={{
                      padding: "var(--sp-2) var(--sp-3)",
                      textAlign: alignOf(c),
                      color: ci === 0 ? "var(--text-1)" : "var(--text-2)",
                      fontVariantNumeric: c.numeric ? "tabular-nums" : undefined,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: c.wrap ? "normal" : "nowrap",
                      /* углы — на крайних ячейках: у <tr> border-radius не
                         работает вовсе, фон рисуют ячейки */
                      borderTopLeftRadius: ci === 0 ? "var(--r-sm)" : undefined,
                      borderBottomLeftRadius: ci === 0 ? "var(--r-sm)" : undefined,
                      borderTopRightRadius: ci === columns.length - 1 ? "var(--r-sm)" : undefined,
                      borderBottomRightRadius: ci === columns.length - 1 ? "var(--r-sm)" : undefined,
                    }}
                  >
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  return (
    <div style={style}>
      {/* ⚠️ Прокрутка ЗДЕСЬ, а не у страницы: широкая таблица обязана
          проматываться внутри себя, иначе она таскает вбок весь экран.
          scrollbarWidth не гасим — полоса тут и есть подсказка «дальше есть
          ещё»; невидимая полоса на этом же экране уже была причиной того, что
          уехавшую за край колонку никто не находил. */}
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>{table}</div>
      {pageSize > 0 && pages > 1 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--sp-2)", marginTop: "var(--sp-2)" }}>
          <IconButton
            icon="chevron-left"
            size="sm"
            label={prevLabel}
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          />
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
            {pageLabel ? pageLabel(safePage + 1, pages, sorted.length) : `${safePage + 1} / ${pages}`}
          </span>
          <IconButton
            icon="chevron-right"
            size="sm"
            label={nextLabel}
            disabled={safePage >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          />
        </div>
      ) : null}
    </div>
  );
}
