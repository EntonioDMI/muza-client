import { describe, expect, it, vi } from "vitest";
import { PLAYLIST_ICON_IDS } from "@muza/core";
import { createPluginBridge, type PluginBridgeLive } from "./appBridge";

/** Живые зависимости бриджа — только то, что трогает createPlaylist.
 *  Остальное бридж в этих тестах не вызывает. */
function live(over: Partial<PluginBridgeLive> = {}): PluginBridgeLive {
  return {
    api: { createPlaylist: vi.fn(async (name: string) => ({ id: "pl9", name })) },
    canSearch: true,
    reloadPlaylists: vi.fn(async () => undefined),
    usedPlaylistIcons: () => [],
    ...over,
  } as unknown as PluginBridgeLive;
}

/** Регресс: плагин создавал плейлист БЕЗ иконки (createPlaylist(name) без
 *  второго аргумента) — сервер писал icon=null, и такой плейлист навсегда
 *  оставался с заготовкой, в отличие от созданного руками. */
describe("PluginBridge.library.createPlaylist: иконка", () => {
  it("передаёт иконку из манифеста", async () => {
    const l = live();
    await createPluginBridge(() => l).library.createPlaylist("Из плагина");
    expect(l.api.createPlaylist).toHaveBeenCalledTimes(1);
    const [name, icon] = vi.mocked(l.api.createPlaylist).mock.calls[0];
    expect(name).toBe("Из плагина");
    expect(PLAYLIST_ICON_IDS).toContain(icon);
  });

  it("не повторяет уже занятые пользователем иконки", async () => {
    // заняты все, кроме pi-07 → выбор детерминирован
    const used = PLAYLIST_ICON_IDS.filter((id) => id !== "pi-07");
    const l = live({ usedPlaylistIcons: () => used });
    await createPluginBridge(() => l).library.createPlaylist("Единственная свободная");
    expect(vi.mocked(l.api.createPlaylist).mock.calls[0][1]).toBe("pi-07");
  });

  it("все 38 заняты — иконка всё равно есть (повтор лучше пустоты)", async () => {
    const l = live({ usedPlaylistIcons: () => [...PLAYLIST_ICON_IDS] });
    await createPluginBridge(() => l).library.createPlaylist("Переполнение");
    expect(PLAYLIST_ICON_IDS).toContain(vi.mocked(l.api.createPlaylist).mock.calls[0][1]);
  });

  it("анониму по-прежнему отказ, сервер не дёргается", async () => {
    const l = live({ canSearch: false });
    await expect(createPluginBridge(() => l).library.createPlaylist("Аноним")).rejects.toThrow();
    expect(l.api.createPlaylist).not.toHaveBeenCalled();
  });
});
