/** Меню трека в вебе: НАБОР ПУНКТОВ, а не внутренности хука.
 *
 *  ЗАЧЕМ ЭТОТ ФАЙЛ. Пункт меню появляется ровно потому, что в умениях площадки
 *  есть соответствующее поле (правило menuActions.ts). Значит любая «уборка»
 *  умений — молчаливое исчезновение пунктов: ни типы, ни рендер этого не ловят.
 *  Ровно так меню веба и оказалось урезанным (нет радио, источников,
 *  «поделиться», замены версии), и ровно так чуть не уехали массовые умения
 *  `addManyToPlaylist`/`likeMany` при сносе своего множественного выбора —
 *  их читают ОБЩИЕ экраны через menuCtxRef, а не этот хук.
 *
 *  Проверяем через ту же buildMenuItems, что собирает настоящее меню: набор
 *  иконок для «Любимого» и для поиска. Иконки, а не подписи, — подписи зависят
 *  от языка провайдера, а тесту нужен состав. */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@muza/api-client";
import { QueryTestProvider } from "@muza/app/lib/queryTestUtils";
import { buildMenuItems, type MenuAbilities } from "@muza/app/shell/ContextMenu";
import type { ContextTarget } from "@muza/app/shell/ContextMenu";

/** Плеер подменён целиком: хуку от него нужны только `current`, `playing` и
 *  `playContext` (радио и прослушка кандидата замены), а настоящий модуль тянет
 *  два `<audio>`, Web Audio и таймеры — к составу меню это не имеет отношения. */
vi.mock("../player", () => ({
  usePlayer: () => ({ current: null, playing: false, playContext: () => undefined }),
}));

const api = {
  onSessionRevoked: () => undefined,
  restoreSession: () => Promise.resolve(null),
  getFavorites: () => Promise.resolve([]),
  getPlaylists: () => Promise.resolve([]),
};
vi.mock("../api", () => ({ getApi: () => api }));

// Провайдеры импортируются ПОСЛЕ моков — иначе они утащат настоящий ./api.
const { LikesProvider } = await import("../likes");
const { PlaylistsProvider } = await import("../playlists");
const { SessionProvider } = await import("../session");
const { ToastProvider } = await import("../toast");
const { useWebTrackMenu } = await import("./trackMenu");

const TRACK: Track = {
  id: "t-1",
  artist: "Артист",
  title: "Песня",
  durationSec: 200,
  coverUrl: null,
  isCached: false,
  sources: ["youtube"],
  loudness: null,
  localHash: null,
};

/** Подписи меню тесту не нужны — берём ключ как есть (провайдера языка нет). */
const t = ((key: string) => key) as unknown as Parameters<typeof buildMenuItems>[2];

function iconsFor(place: "search" | "favorites"): string[] {
  let abilities: MenuAbilities | null = null;
  function Probe() {
    abilities = useWebTrackMenu([TRACK], { place }).abilities;
    return null;
  }
  render(
    <QueryTestProvider><SessionProvider>
      <LikesProvider>
        <PlaylistsProvider>
          <ToastProvider>
            <Probe />
          </ToastProvider>
        </PlaylistsProvider>
      </LikesProvider>
    </SessionProvider></QueryTestProvider>,
  );
  const target: ContextTarget = { kind: "track", track: TRACK, place };
  return buildMenuItems(target, abilities!, t)
    .map((item) => (typeof item === "object" && "icon" in item ? item.icon : null))
    .filter((icon): icon is string => Boolean(icon));
}

describe("меню трека веба", () => {
  // vitest здесь без globals — авто-очистки testing-library нет
  afterEach(cleanup);

  it("в «Любимом» есть радио, источники, «поделиться» и замена версии", () => {
    const icons = iconsFor("favorites");
    expect(icons).toContain("radio"); // «Радио по треку»
    expect(icons).toContain("share-2"); // «Поделиться»
    expect(icons).toContain("git-branch"); // «Источники»
    expect(icons).toContain("refresh-cw"); // «Заменить версию» — только тут
    expect(icons).toContain("download"); // веб-умение «Скачать»
  });

  it("в поиске замены версии НЕТ (она только у Любимого)", () => {
    expect(iconsFor("search")).not.toContain("refresh-cw");
  });

  it("не показывает того, чего браузер не умеет", () => {
    const icons = iconsFor("search");
    // вставки в очередь: у веба нет ни playNext, ни queueTrack
    expect(icons).not.toContain("list-start");
    expect(icons).not.toContain("list-end");
    // «сохранить офлайн» — музыка на устройстве, порта у браузера нет
    expect(icons).not.toContain("cloud-off");
  });

  it("массовые умения на месте: их читают панели выделения общих экранов", () => {
    let abilities: MenuAbilities | null = null;
    function Probe() {
      abilities = useWebTrackMenu([TRACK]).abilities;
      return null;
    }
    render(
      <QueryTestProvider><SessionProvider>
        <LikesProvider>
          <PlaylistsProvider>
            <ToastProvider>
              <Probe />
            </ToastProvider>
          </PlaylistsProvider>
        </LikesProvider>
      </SessionProvider></QueryTestProvider>,
    );
    // SearchView/PlaylistView собирают свою панель по НАЛИЧИЮ этих полей
    expect(abilities!.addManyToPlaylist).toBeTypeOf("function");
    expect(abilities!.likeMany).toBeTypeOf("function");
  });
});
