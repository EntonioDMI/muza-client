import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, PlaylistDetail } from "@muza/api-client";
import { PlaylistView } from "./PlaylistView";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
beforeEach(() => localStorage.clear());

/** Снапшот владельческого плейлиста (все дефолты PlaylistDetail заполнены). */
const ownerDetail: PlaylistDetail = {
  id: "pl1",
  name: "Мой микс",
  tracks: [],
  isOwner: true,
  ownerUsername: "",
  inviteCode: null,
  collaborators: [],
  addedBy: {},
  icon: null,
};

/** Ключ снапшота повторяет формат offlineSnapshot.ts: PREFIX+scope+key.
 *  scope пуст (setSnapshotScope в тесте не зовём) → двойное двоеточие. */
const SNAPSHOT_KEY = "muza.snapshot.v1::playlist:pl1";

const noop = () => undefined;

function renderView(api: MuzaApi) {
  return render(
    <PlaylistView
      api={api}
      playlistId="pl1"
      userId="u1"
      likes={[]}
      currentId=""
      playing={false}
      onPlayCatalog={noop}
      onLike={noop}
      onNotify={noop}
      onVersions={noop}
      onShare={noop}
      onSaveOffline={noop}
      onChanged={noop}
      onDeleted={noop}
      onChangeIcon={noop}
    />,
  );
}

describe("PlaylistView — владельческие кнопки", () => {
  it("прячет «Переименовать»/«Удалить» на оффлайн-снапшоте удалённого плейлиста", async () => {
    // Сервер отдаёт удалённый плейлист (404), но локально есть снапшот, где
    // пользователь был владельцем → withSnapshot вернёт offline:true с isOwner.
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(ownerDetail));
    const api = {
      getPlaylist: vi.fn().mockRejectedValue(new Error("404 not found")),
    } as unknown as MuzaApi;

    renderView(api);

    // Дожидаемся, пока страница осядет в состоянии «оффлайн-копия».
    await waitFor(() => expect(screen.getByText(/оффлайн-копия/)).toBeTruthy());

    // Кнопки владельца, бьющие по мёртвому id, не должны быть отрисованы.
    expect(screen.queryByRole("button", { name: "Переименовать" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Удалить плейлист" })).toBeNull();
  });

  it("показывает «Переименовать»/«Удалить» для живого плейлиста владельца", async () => {
    // Онлайн-ответ сервера: offline:false, isOwner:true → кнопки на месте.
    const api = {
      getPlaylist: vi.fn().mockResolvedValue(ownerDetail),
    } as unknown as MuzaApi;

    renderView(api);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Переименовать" })).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Удалить плейлист" })).toBeTruthy();
    // Контроль: это не оффлайн-состояние.
    expect(screen.getByText(/синхронизируется/)).toBeTruthy();
  });
});
