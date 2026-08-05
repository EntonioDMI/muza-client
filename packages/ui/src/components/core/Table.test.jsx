import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Table } from "./Table.jsx";

/** Главное, чего не было у прежних div-таблиц: роли строк/колонок и
 *  сортировка по клику. Тесты сторожат и то, и другое. */

const columns = [
  { key: "name", label: "Тема", width: "60%", sortable: true },
  { key: "installs", label: "Установок", numeric: true, sortable: true },
  { key: "author", label: "Автор" },
];

const rows = [
  { id: "1", name: "Берёза", installs: 5, author: "anna" },
  { id: "2", name: "Азимут", installs: 12, author: "boris" },
  { id: "3", name: "Восток", installs: 9, author: "clara" },
];

const names = () =>
  screen
    .getAllByRole("row")
    .slice(1) // первая строка — шапка
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

const renderTable = (props = {}) =>
  render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} ariaLabel="Темы" {...props} />);

describe("Table", () => {
  it("это настоящая таблица: роли колонок и ячеек на месте", () => {
    renderTable();

    expect(screen.getByRole("table", { name: "Темы" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").length).toBe(3);
    expect(screen.getAllByRole("row").length).toBe(1 + rows.length);
    expect(names()).toEqual(["Берёза", "Азимут", "Восток"]);
  });

  it("клик по текстовому заголовку сортирует от А к Я и ставит aria-sort", () => {
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: /Тема/ }));

    expect(names()).toEqual(["Азимут", "Берёза", "Восток"]);
    expect(screen.getByRole("columnheader", { name: /Тема/ }).getAttribute("aria-sort")).toBe("ascending");
  });

  it("повторный клик разворачивает порядок", () => {
    renderTable();
    const head = screen.getByRole("button", { name: /Тема/ });

    fireEvent.click(head);
    fireEvent.click(head);

    expect(names()).toEqual(["Восток", "Берёза", "Азимут"]);
    expect(screen.getByRole("columnheader", { name: /Тема/ }).getAttribute("aria-sort")).toBe("descending");
  });

  it("числовая колонка с первого клика идёт по убыванию — «где больше всего»", () => {
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: /Установок/ }));

    expect(names()).toEqual(["Азимут", "Восток", "Берёза"]);
    expect(screen.getByRole("columnheader", { name: /Установок/ }).getAttribute("aria-sort")).toBe("descending");
  });

  it("сортировка по числам считает числа, а не строки", () => {
    render(
      <Table
        columns={columns}
        rows={[
          { id: "a", name: "A", installs: 9, author: "x" },
          { id: "b", name: "B", installs: 10, author: "y" },
        ]}
        rowKey={(r) => r.id}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Установок/ }));

    expect(names()).toEqual(["B", "A"]); // как строки было бы "9" > "10"
  });

  it("несортируемая колонка не кликается и не заявляет aria-sort", () => {
    renderTable();

    const th = screen.getByRole("columnheader", { name: "Автор" });
    expect(th.getAttribute("aria-sort")).toBeNull();
    expect(within(th).queryByRole("button")).toBeNull();
  });

  it("сортируемая колонка, пока по ней не сортируют, говорит aria-sort=none", () => {
    renderTable();

    expect(screen.getByRole("columnheader", { name: /Тема/ }).getAttribute("aria-sort")).toBe("none");
  });

  it("defaultSort применяется до первого клика", () => {
    renderTable({ defaultSort: { key: "installs", dir: "asc" } });

    expect(names()).toEqual(["Берёза", "Восток", "Азимут"]);
  });

  it("пустой список: шапка остаётся, вместо строк — объяснение", () => {
    renderTable({ rows: [], empty: "Пока ничего нет" });

    expect(screen.getAllByRole("columnheader").length).toBe(3);
    expect(screen.getByText("Пока ничего нет")).toBeTruthy();
  });

  it("render рисует ячейку сам, sortValue сортирует по своему значению", () => {
    render(
      <Table
        columns={[
          {
            key: "when",
            label: "Когда",
            sortable: true,
            numeric: true,
            render: (r) => <b>{r.label}</b>,
            sortValue: (r) => r.at,
          },
        ]}
        rows={[
          { id: "1", label: "вчера", at: 2 },
          { id: "2", label: "позавчера", at: 1 },
        ]}
        rowKey={(r) => r.id}
      />,
    );

    expect(names()).toEqual(["вчера", "позавчера"]);
    fireEvent.click(screen.getByRole("button", { name: /Когда/ }));
    expect(names()).toEqual(["вчера", "позавчера"]); // 2 > 1 — убывание первым кликом
    fireEvent.click(screen.getByRole("button", { name: /Когда/ }));
    expect(names()).toEqual(["позавчера", "вчера"]);
  });

  it("исходный массив не перетасовывается", () => {
    const source = [...rows];
    render(<Table columns={columns} rows={source} rowKey={(r) => r.id} />);

    fireEvent.click(screen.getByRole("button", { name: /Тема/ }));

    expect(source.map((r) => r.name)).toEqual(["Берёза", "Азимут", "Восток"]);
  });
});
