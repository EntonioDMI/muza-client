import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { Annotation } from "@muza/api-client";
import { MeaningDialog } from "./MeaningDialog";
import { ListeningMode } from "./ListeningMode";

afterEach(cleanup);

const annotation: Annotation = {
  fragment: "Выделенная строка",
  body: "Подробное объяснение",
  votes: 12,
  verified: true,
  lineIdx: 0,
  lineCount: 1,
  lineIdxs: [0],
};

function show(onClose = vi.fn()) {
  render(
    <MeaningDialog
      open
      line={{ t: 0, text: "Выделенная строка", note: annotation.body }}
      annotation={annotation}
      geniusUrl="https://genius.com/example"
      onClose={onClose}
    />,
  );
  return onClose;
}

describe("MeaningDialog", () => {
  it("does not close when the user clicks inside the dialog", () => {
    const onClose = show();

    fireEvent.click(screen.getByRole("dialog"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the empty backdrop, close button, and Escape", () => {
    const onClose = show();
    const dialog = screen.getByRole("dialog");

    fireEvent.click(dialog.parentElement!);
    // T34a (i18n): вне LanguageProvider useT() фолбэкает на DEFAULT_LANG="en".
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("consumes Escape so an overlay underneath does not also close", () => {
    show();
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    const stopImmediatePropagation = vi.spyOn(event, "stopImmediatePropagation");

    window.dispatchEvent(event);

    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("keeps listening mode open when Escape closes the dialog above it", async () => {
    const noop = vi.fn();
    function Harness() {
      const [dialogOpen, setDialogOpen] = useState(true);
      const [listeningOpen, setListeningOpen] = useState(true);
      return <>
        <ListeningMode
          open={listeningOpen}
          track={{ id: "t3", kind: "demo", title: "Стеклянный дом", artist: "Мира", album: "Тише", duration: 234, cover: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", explicit: false, loudness: null }}
          lyrics={[]}
          playing={false}
          pos={0}
          activeLine={-1}
          onTogglePlay={noop}
          onPrev={noop}
          onNext={noop}
          onSeek={noop}
          onSeekLine={noop}
          onExplain={noop}
          onClose={() => setListeningOpen(false)}
        />
        <MeaningDialog
          open={dialogOpen}
          line={{ t: 0, text: "Выделенная строка", note: annotation.body }}
          annotation={annotation}
          onClose={() => setDialogOpen(false)}
        />
      </>;
    }
    render(<Harness />);

    fireEvent.keyDown(window, { key: "Escape" });

    // Dialog делает delayed-unmount на время exit-анимации (T13) — узел
    // уходит из DOM асинхронно (onAnimationEnd/таймаут-фолбэк), не сразу.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // T31 (i18n): вне LanguageProvider useT() фолбэкает на DEFAULT_LANG="en".
    expect(screen.getByRole("button", { name: "Minimize" })).toBeTruthy();
  });
});
