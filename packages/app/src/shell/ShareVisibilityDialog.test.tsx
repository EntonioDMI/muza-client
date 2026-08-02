import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, PlaylistDetail } from "@muza/api-client";
import { ShareVisibilityDialog } from "./ShareVisibilityDialog";

// «Поделиться плейлистом» (2026-07-17): лесенка private→code→public + код.
// Без LanguageProvider → DEFAULT_LANG="en", ассерты на английский.

afterEach(() => cleanup());

const detail = (over: Partial<PlaylistDetail> = {}): PlaylistDetail =>
  ({
    id: "pl1",
    name: "Мой микс",
    tracks: [],
    isOwner: true,
    role: "owner",
    ownerUsername: "me",
    inviteCode: null,
    publicCode: null,
    visibility: "private",
    followersCount: 0,
    isFollowing: false,
    collaborators: [],
    addedBy: {},
    icon: null,
    iconCoverUrl: null,
    ...over,
  }) as PlaylistDetail;

function renderDialog(api: MuzaApi, d: PlaylistDetail, extra: { onNotify?: (m: string) => void; onChanged?: () => void } = {}) {
  return render(
    <ShareVisibilityDialog
      api={api}
      open
      playlistId="pl1"
      detail={d}
      onClose={() => undefined}
      onNotify={extra.onNotify ?? (() => undefined)}
      onChanged={extra.onChanged ?? (() => undefined)}
    />,
  );
}

describe("ShareVisibilityDialog — лесенка", () => {
  it("три ступени, активная — текущая видимость", () => {
    renderDialog({} as MuzaApi, detail({ visibility: "code", publicCode: "PL_GGCRYGB8" }));

    const pressed = screen
      .getAllByRole("button", { pressed: true })
      .map((b) => b.textContent ?? "");
    expect(pressed.some((x) => x.includes("By code"))).toBe(true);
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
  });

  it("клик по ступени зовёт setPlaylistVisibility и показывает код", async () => {
    const setPlaylistVisibility = vi.fn().mockResolvedValue({ visibility: "code", publicCode: "PL_NEWCODE1" });
    const onChanged = vi.fn();
    renderDialog({ setPlaylistVisibility } as unknown as MuzaApi, detail(), { onChanged });

    screen.getByText("By code").click();

    await waitFor(() => expect(setPlaylistVisibility).toHaveBeenCalledWith("pl1", "code"));
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("PL_NEWCODE1")).toBeTruthy());
  });

  it("приватный с кодом: код виден, но с подписью «неактивен»", () => {
    renderDialog({} as MuzaApi, detail({ visibility: "private", publicCode: "PL_GGCRYGB8" }));

    expect(screen.getByText("PL_GGCRYGB8")).toBeTruthy();
    expect(screen.getByText(/inactive while the playlist is private/)).toBeTruthy();
  });

  it("«Скопировать код» кладёт код в буфер и тостит", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onNotify = vi.fn();
    renderDialog({} as MuzaApi, detail({ visibility: "code", publicCode: "PL_GGCRYGB8" }), { onNotify });

    screen.getByRole("button", { name: "Copy code" }).click();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("PL_GGCRYGB8"));
    expect(onNotify).toHaveBeenCalledWith("Code copied", "copy");
  });

  it("счётчик слушателей виден при N>0", () => {
    renderDialog({} as MuzaApi, detail({ visibility: "public", publicCode: "PL_GGCRYGB8", followersCount: 7 }));

    expect(screen.getByText("Listeners: 7")).toBeTruthy();
  });

  it("403 админ-бана — текст сервера тостом, ступень не меняется", async () => {
    const setPlaylistVisibility = vi.fn().mockRejectedValue(new Error("Публикация запрещена администратором"));
    const onNotify = vi.fn();
    renderDialog({ setPlaylistVisibility } as unknown as MuzaApi, detail(), { onNotify });

    screen.getByText("Public").click();

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("Публикация запрещена администратором", "x"));
  });
});

// @Адрес (2026-07-17): поле только на ступени public; заморозка — подпись.
describe("ShareVisibilityDialog — @адрес", () => {
  const publicDetail = (over: Partial<PlaylistDetail> = {}) =>
    detail({ visibility: "public", publicCode: "PL_GGCRYGB8", ...over });

  it("public без адреса: поле ввода + «Save», ввод и сохранение", async () => {
    const setPlaylistHandle = vi.fn().mockResolvedValue({ handle: "fonk_2026" });
    const onChanged = vi.fn();
    renderDialog({ setPlaylistHandle } as unknown as MuzaApi, publicDetail(), { onChanged });

    const input = screen.getByLabelText("@Address");
    fireEvent.change(input, { target: { value: "Fonk_2026" } });
    screen.getByRole("button", { name: "Save" }).click();

    await waitFor(() => expect(setPlaylistHandle).toHaveBeenCalledWith("pl1", "Fonk_2026"));
    await waitFor(() => expect(screen.getByText("@fonk_2026")).toBeTruthy());
    expect(onChanged).toHaveBeenCalled();
  });

  it("кривой формат — кнопка задавлена, подпись формата", () => {
    renderDialog({} as MuzaApi, publicDetail());

    fireEvent.change(screen.getByLabelText("@Address"), { target: { value: "ab" } });

    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/Only latin letters/)).toBeTruthy();
  });

  it("409 занят — текст сервера тостом", async () => {
    const setPlaylistHandle = vi.fn().mockRejectedValue(new Error("Адрес занят"));
    const onNotify = vi.fn();
    renderDialog({ setPlaylistHandle } as unknown as MuzaApi, publicDetail(), { onNotify });

    fireEvent.change(screen.getByLabelText("@Address"), { target: { value: "fonk_2026" } });
    screen.getByRole("button", { name: "Save" }).click();

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("Адрес занят", "x"));
  });

  it("не public с адресом: приглушённый @имя + «заморожен», поля ввода нет", () => {
    renderDialog({} as MuzaApi, detail({ visibility: "code", publicCode: "PL_GGCRYGB8", handle: "fonk_2026" }));

    expect(screen.getByText(/@fonk_2026/)).toBeTruthy();
    expect(screen.getByText(/frozen while the playlist isn't public/)).toBeTruthy();
    expect(screen.queryByLabelText("@Address")).toBeNull();
  });

  it("клик по копированию адреса кладёт @имя в буфер", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onNotify = vi.fn();
    renderDialog({} as MuzaApi, publicDetail({ handle: "fonk_2026" }), { onNotify });

    screen.getByRole("button", { name: "Address copied" }).click();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("@fonk_2026"));
  });
});
