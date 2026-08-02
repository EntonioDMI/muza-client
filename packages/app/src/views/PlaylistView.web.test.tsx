import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, PlaylistDetail } from "@muza/api-client";
import { DragLayer } from "../shell/DragLayer";
import { ContextMenuProvider } from "../shell/ContextMenu";
import type { MenuAbilities } from "../shell/menuActions";
import { PlaylistView } from "./PlaylistView";

/** Страница плейлиста в «браузерной» сборке: та же страница, что в
 *  приложении, но БЕЗ приложенческих умений — ни оффлайн-копии на устройстве,
 *  ни «Сохранить оффлайн», ни замены версии, ни вставок в очередь.
 *
 *  Что стережём: правило розетки «нет умения — нет пункта, а не серый». До
 *  волны экранов веб-паритета у веба была своя урезанная страница; теперь код
 *  один, и единственная защита от «кнопка есть, а нажать нечего» — вот эти
 *  проверки. Приложенческая сборка (обёртка с withSnapshot/прогревом/файлами
 *  с диска) проверяется отдельно — apps/desktop/src/views/PlaylistView.test.tsx.
 *
 *  Без LanguageProvider useT() отдаёт DEFAULT_LANG="en" — ассерты английские. */

afterEach(cleanup);

const detail: PlaylistDetail = {
  id: "pl1",
  name: "Мой микс",
  tracks: [
    {
      id: "t1",
      artist: "A",
      title: "Первый",
      durationSec: 100,
      coverUrl: null,
      isCached: true,
      sources: ["youtube"],
      loudness: null,
      localHash: null,
    },
  ],
  isOwner: true,
  role: "owner",
  ownerUsername: "",
  inviteCode: null,
  publicCode: null,
  handle: null,
  visibility: "private",
  followersCount: 0,
  isFollowing: false,
  collaborators: [],
  addedBy: {},
  icon: null,
  iconCoverUrl: null,
};

const noop = () => undefined;

/** Умения браузера: в плейлист и в «Любимое» — да, очередь и хранение на
 *  устройстве — нет (ровно как в apps/web/src/components/TrackList.tsx). */
const WEB_ABILITIES: MenuAbilities = {
  addToPlaylist: noop,
  isLiked: () => false,
  toggleLike: noop,
  addManyToPlaylist: noop,
  likeMany: noop,
};

function renderWeb(api: MuzaApi) {
  return render(
    <ContextMenuProvider ctx={WEB_ABILITIES} suppressNativeMenu={false}>
      <DragLayer>
        <PlaylistView
          api={api}
          playlistId="pl1"
          userId="u1"
          likes={[]}
          currentId={null}
          playing={false}
          onPlayCatalog={noop}
          onLike={noop}
          onNotify={noop}
          onShare={noop}
          onChanged={noop}
          onDeleted={noop}
          onChangeIcon={noop}
        />
      </DragLayer>
    </ContextMenuProvider>,
  );
}

describe("PlaylistView без приложенческих умений", () => {
  it("читает плейлист прямо с сервера и не обещает оффлайн-копию", async () => {
    const api = { getPlaylist: vi.fn().mockResolvedValue(detail) } as unknown as MuzaApi;

    renderWeb(api);

    await waitFor(() => expect(screen.getByText("Первый")).toBeTruthy());
    expect(api.getPlaylist).toHaveBeenCalledWith("pl1");
    // «offline copy» — подпись приложения, у которого есть копия на устройстве
    expect(screen.queryByText(/offline copy/)).toBeNull();
  });

  it("не показывает «Сохранить оффлайн» — умения нет", async () => {
    const api = { getPlaylist: vi.fn().mockResolvedValue(detail) } as unknown as MuzaApi;

    renderWeb(api);

    await waitFor(() => expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Save offline" })).toBeNull();
  });

  it("в меню трека нет «Заменить версию», но есть «Убрать из плейлиста»", async () => {
    const api = { getPlaylist: vi.fn().mockResolvedValue(detail) } as unknown as MuzaApi;

    renderWeb(api);
    await waitFor(() => expect(screen.getByText("Первый")).toBeTruthy());

    // «⋯» рисуется только у подсвеченной строки — фокус на play поджигает её
    fireEvent.focus(screen.getByRole("button", { name: "Listen: Первый" }));
    (await screen.findByRole("button", { name: "More" })).click();

    await waitFor(() => expect(screen.getByText("Remove from playlist")).toBeTruthy());
    expect(screen.queryByText("Replace version")).toBeNull();
    // вставок в очередь у браузера нет — и пунктов тоже
    expect(screen.queryByText("Play next")).toBeNull();
  });
});
