import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import { JoinPlaylistDialog } from "./JoinPlaylistDialog";

afterEach(cleanup);

// Подпись про бэкенд в дев-сборке. Регресс, который она закрывает (2026-07-15):
// код, выданный на проде, не находится в локальной базе — сервер отвечает «код не
// найден», а UI ничем не намекал, что база вообще другая. Владелец завёл два
// бага на исправные фичи. Разбор — docs/notes/2026-07-15-кросс-бэкенд-ловушка-коды.md.

function fakeApi(): MuzaApi {
  return { joinPlaylist: vi.fn() } as unknown as MuzaApi;
}

function show(apiHost: string | null) {
  render(
    <JoinPlaylistDialog api={fakeApi()} open apiHost={apiHost} onClose={vi.fn()} onJoined={vi.fn()} />,
  );
}

describe("JoinPlaylistDialog — подпись про бэкенд", () => {
  it("в проде (apiHost=null) подписи нет — пользователю про хосты знать незачем", () => {
    show(null);

    expect(screen.queryByText(/Dev build/i)).toBeNull();
    expect(screen.queryByText(/localhost/i)).toBeNull();
  });

  it("в дев-сборке показывает, из какой базы должен быть код", () => {
    show("localhost:8000");

    expect(screen.getByText(/only codes from localhost:8000 will work/i)).toBeTruthy();
  });

  it("дев-сборка, направленная на прод, называет прод-хост", () => {
    show("api.muza.lol");

    expect(screen.getByText(/only codes from api\.muza\.lol will work/i)).toBeTruthy();
  });

  it("подпись не мешает вводу — поле кода на месте", () => {
    show("localhost:8000");

    expect(screen.getByPlaceholderText(/7WQK2M9T/)).toBeTruthy();
  });
});
