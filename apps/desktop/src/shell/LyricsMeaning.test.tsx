import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Lyrics } from "@muza/ui";

afterEach(cleanup);

describe("Lyrics meaning interaction", () => {
  it("opens an explanation only from a line that has a note", () => {
    const onExplain = vi.fn();
    render(
      <Lyrics
        lines={[
          { t: 0, text: "Обычная строка" },
          { t: 0, text: "Строка со смыслом", note: "Объяснение" },
        ]}
        activeIndex={-1}
        onExplain={onExplain}
      />,
    );

    expect(screen.queryByRole("button", { name: /Обычная строка/ })).toBeNull();
    const annotated = screen.getByRole("button", { name: "Смысл строки: Строка со смыслом" });
    expect(annotated.style.color).toBe("var(--accent-text)");
    expect(annotated.style.background).toBe("");
    expect(annotated.style.boxShadow).toBe("");
    expect(annotated.style.padding).toBe("");
    expect(annotated.style.borderRadius).toBe("");
    expect(annotated.style.textDecorationLine).toBe("");
    fireEvent.click(annotated);
    fireEvent.keyDown(annotated, { key: "Enter" });
    fireEvent.keyDown(annotated, { key: " " });

    expect(onExplain).toHaveBeenCalledTimes(3);
    expect(onExplain).toHaveBeenLastCalledWith(1);
  });
});
