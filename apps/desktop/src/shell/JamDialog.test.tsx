import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { JamUi } from "../player/useJam";
import { JamDialog } from "./JamDialog";

afterEach(cleanup);

// Тот же регресс, что и у JoinPlaylistDialog (2026-07-15): код джема живёт в Redis
// КОНКРЕТНОГО сервера, между локалхостом и продом не ходит, а UI об этом молчал.
// Владелец сказал про плейлисты «тоже не работает» — корень общий.
// Разбор — docs/notes/2026-07-15-кросс-бэкенд-ловушка-коды.md.

function fakeJam(overrides: Partial<JamUi> = {}): JamUi {
  return {
    active: false,
    isHost: false,
    code: null,
    members: [],
    hostName: "",
    unavailable: false,
    hostState: null,
    busy: false,
    create: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    addTrack: vi.fn(),
    ...overrides,
  };
}

function show(apiHost: string | null, jam: JamUi = fakeJam()) {
  render(<JamDialog jam={jam} open canUse apiHost={apiHost} onClose={vi.fn()} onNotify={vi.fn()} />);
}

describe("JamDialog — подпись про бэкенд", () => {
  it("в проде (apiHost=null) подписи нет", () => {
    show(null);

    expect(screen.queryByText(/Dev build/i)).toBeNull();
  });

  it("в дев-сборке у поля кода показывает, из какой базы должен быть код", () => {
    show("localhost:8000");

    expect(screen.getByText(/only codes from localhost:8000 will work/i)).toBeTruthy();
  });

  it("уже в джеме — подписи нет: код показывает своё, вводить нечего", () => {
    show("localhost:8000", fakeJam({ active: true, isHost: true, code: "6PTX4C", hostName: "me" }));

    expect(screen.queryByText(/Dev build/i)).toBeNull();
  });

  it("анониму (canUse=false) подписи нет — до ввода кода дело не доходит", () => {
    render(<JamDialog jam={fakeJam()} open canUse={false} apiHost="localhost:8000" onClose={vi.fn()} onNotify={vi.fn()} />);

    expect(screen.queryByText(/Dev build/i)).toBeNull();
  });
});
