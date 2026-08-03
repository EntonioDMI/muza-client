import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Lyrics } from "./Lyrics.jsx";

/** autoScroll={false}: центрирование зовёт wrap.scrollTo, которого в jsdom нет.
 *  На проверяемое поведение (обход Tab, стрелки, Enter) это не влияет. */
const lines = [{ text: "первая" }, { text: "вторая", note: "смысл" }, { text: "третья" }];

function renderLyrics(props) {
  return render(<Lyrics lines={lines} activeIndex={0} autoScroll={false} {...props} />);
}

describe("Lyrics", () => {
  it("строка перематывается с клавиатуры, а в обходе Tab она одна — текущая", () => {
    const onSeek = vi.fn();
    renderLyrics({ onSeek, activeIndex: 1 });

    const rows = screen.getAllByRole("button");
    expect(rows.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);

    act(() => rows[1].focus());
    fireEvent.keyDown(rows[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[2]);

    fireEvent.keyDown(rows[2], { key: "Enter" });
    expect(onSeek).toHaveBeenCalledWith(2);
  });

  it("у строки с заметкой Enter делает то же, что клик, а смысл — по Shift+Enter", () => {
    const onSeek = vi.fn();
    const onExplain = vi.fn();
    renderLyrics({ onSeek, onExplain });

    const noted = screen.getAllByRole("button")[1];
    fireEvent.click(noted);
    fireEvent.keyDown(noted, { key: "Enter" });
    expect(onSeek).toHaveBeenCalledTimes(2);
    expect(onSeek).toHaveBeenLastCalledWith(1);
    expect(onExplain).not.toHaveBeenCalled();

    fireEvent.keyDown(noted, { key: "Enter", shiftKey: true });
    expect(onExplain).toHaveBeenCalledWith(1);
  });

  it("без перемотки (plain-текст) строка с заметкой открывает смысл и кликом, и Enter", () => {
    const onExplain = vi.fn();
    renderLyrics({ onExplain, activeIndex: -1 });

    const noted = screen.getByRole("button");
    fireEvent.click(noted);
    fireEvent.keyDown(noted, { key: "Enter" });
    expect(onExplain).toHaveBeenCalledTimes(2);
  });
});
