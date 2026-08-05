/** Полноэкранный «Сейчас играет» телефона — ЕСТЬ ЛИ У НЕГО УХОД.
 *
 *  Раньше оболочка снимала экран из дерева условием (`{mobileNp ? <…/> : null}`),
 *  а кейфрейм в globals.css умел только вход: закрытие стирало полный экран
 *  кадром. Теперь жизненный цикл держит useLayerState — узел остаётся в дереве,
 *  пока играет уход, и снимается по прозрачности.
 *
 *  Проверяется НАБЛЮДАЕМОЕ: есть ли узел в разметке, какая на нём поза
 *  (data-layer-state) и когда он исчезает. Сама анимация в jsdom не идёт —
 *  стилей пакета в прогоне нет, и это не мешает: переход снаружи, хук лишь
 *  ждёт его конца.
 *
 *  Плеер, лайки и текст песни подменены: экрану от них нужны «что играет» и
 *  «лайкнуто ли», а настоящие модули тянут два `<audio>` и запросы к серверу. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@muza/api-client";

const TRACK: Track = {
  id: "t-1",
  artist: "Артист",
  title: "Песня",
  durationSec: 200,
  coverUrl: null,
  isCached: true,
  sources: ["youtube"],
  loudness: null,
  localHash: null,
};

/** Состояние плеера — ИЗМЕНЯЕМОЕ: «очередь кончилась» проверяется тем, что
 *  трек пропал ровно в момент закрытия. hoisted — фабрика vi.mock поднимается
 *  выше объявлений файла. */
const player = vi.hoisted(() => ({ current: null as unknown, error: null as string | null }));

vi.mock("../player", () => ({
  usePlayer: () => ({
    current: player.current,
    playing: false,
    error: player.error,
    repeat: "off" as const,
    shuffle: false,
    toggle: () => undefined,
    prev: () => undefined,
    next: () => undefined,
    seek: () => undefined,
    toggleShuffle: () => undefined,
    cycleRepeat: () => undefined,
  }),
  usePosition: () => ({ position: 0, duration: 200 }),
}));
vi.mock("../likes", () => ({ useLikes: () => ({ likedIds: new Set<string>(), toggle: () => undefined }) }));
vi.mock("./LyricsPanel", () => ({ LyricsBlock: () => null }));

const { MobileNowPlaying } = await import("./MobileNowPlaying");

const overlay = (): HTMLElement | null => document.querySelector(".np-overlay");

/** transitionend руками: конструктора TransitionEvent в jsdom нет, а без него
 *  до хука не доедет propertyName — то самое поле, по которому он отличает
 *  конец ухода от любого другого перехода внутри экрана. */
function endTransition(node: Element, propertyName: string): void {
  const e = new Event("transitionend", { bubbles: true }) as Event & { propertyName?: string };
  e.propertyName = propertyName;
  fireEvent(node, e);
}

describe("мобильный «Сейчас играет»: уход", () => {
  // vitest здесь без globals — авто-очистки testing-library нет
  afterEach(() => {
    cleanup();
    player.current = TRACK;
  });
  player.current = TRACK;

  it("закрытый экран не висит в разметке", () => {
    render(<MobileNowPlaying open={false} onClose={() => undefined} />);
    expect(overlay()).toBeNull();
  });

  it("открытый доводится до открытой позы и объявляет себя сценой", () => {
    const { rerender } = render(<MobileNowPlaying open={false} onClose={() => undefined} />);
    rerender(<MobileNowPlaying open onClose={() => undefined} />);

    const node = overlay()!;
    expect(node.dataset.layerState).toBe("open");
    // время и кривые сцены берутся отсюда — не своим кейфреймом
    expect(node.classList.contains("muza-layer--scene")).toBe(true);
  });

  it("закрытие оставляет узел на время ухода и снимает его по прозрачности", () => {
    const { rerender } = render(<MobileNowPlaying open onClose={() => undefined} />);
    const node = overlay()!;

    rerender(<MobileNowPlaying open={false} onClose={() => undefined} />);
    expect(overlay()).toBe(node); // узел жив — ему есть что доиграть
    expect(node.dataset.layerState).toBe("closed");
    expect(node.hasAttribute("inert")).toBe(true); // кликать по уходящему нечего

    endTransition(node, "transform");
    expect(overlay()).toBe(node); // поза доехала, прозрачность ещё нет

    endTransition(node, "opacity");
    expect(overlay()).toBeNull();
  });

  it("очередь кончилась — экран всё равно уходит, а не пропадает кадром", () => {
    const { rerender } = render(<MobileNowPlaying open onClose={() => undefined} />);
    const node = overlay()!;

    // трек кончился и очередь пуста: экран закрывается сам, но уходить обязан
    player.current = null;
    rerender(<MobileNowPlaying open={false} onClose={() => undefined} />);

    expect(overlay()).toBe(node);
    expect(node.dataset.layerState).toBe("closed");
    expect(screen.getByText("Песня")).toBeTruthy(); // показывает последний трек
  });

  it("повторное открытие посреди ухода возвращает ТОТ ЖЕ узел", () => {
    const { rerender } = render(<MobileNowPlaying open onClose={() => undefined} />);
    const node = overlay()!;

    rerender(<MobileNowPlaying open={false} onClose={() => undefined} />);
    rerender(<MobileNowPlaying open onClose={() => undefined} />);

    // Ремаунт означал бы старт с закрытой позы — то есть телепорт полуушедшего
    // экрана вниз и заново вверх.
    expect(overlay()).toBe(node);
    expect(node.dataset.layerState).toBe("open");
    expect(node.hasAttribute("inert")).toBe(false);
  });

  it("Esc закрывает открытый экран и не трогает закрытый", () => {
    const onClose = vi.fn();
    const { rerender } = render(<MobileNowPlaying open onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<MobileNowPlaying open={false} onClose={onClose} />);
    // Узел ещё в дереве (уход), но клавиатура уже не его: иначе Esc отбирался
    // бы у диалогов оболочки всё время работы вкладки.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
