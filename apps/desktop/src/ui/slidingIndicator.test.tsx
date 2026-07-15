import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ChipGroup, Tabs } from "@muza/ui";

/** Пилюля Tabs и подсветка ChipGroup позиционируются JS-замером (offsetLeft/Width).
 *  jsdom layout не считает — все offset'ы там нули, поэтому настоящую геометрию
 *  здесь проверить нельзя (это только живым окном). Проверяем механику, из-за
 *  которой геометрия и разъезжалась: КОГДА компонент перемеряет (подписи в депсах),
 *  ЧТО он при этом меряет (свежий value, а не захваченный подпиской) и ЗА ЧЕМ
 *  следит RO (каждый сегмент, а не только контейнер). */

afterEach(cleanup);

// --- шпион на querySelector: measure() ходит в DOM через него, значит по логу
// селекторов видно и факт перезамера, и то, какой ключ мерили.
const seen: string[] = [];
const realQS = Element.prototype.querySelector;
beforeAll(() => {
  Element.prototype.querySelector = function (this: Element, sel: string) {
    seen.push(sel);
    return realQS.call(this, sel);
  } as typeof Element.prototype.querySelector;
});
afterAll(() => {
  Element.prototype.querySelector = realQS;
});
beforeEach(() => {
  seen.length = 0;
});

// --- фейковый ResizeObserver: jsdom его не реализует, а компоненты его и сторожат
// (typeof ResizeObserver === "undefined" → выходят). Копим подписки и дёргаем колбэк руками.
class FakeRO implements ResizeObserver {
  targets = new Set<Element>();
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    ros.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
    const i = ros.indexOf(this);
    if (i >= 0) ros.splice(i, 1);
  }
  /** Ресайз наблюдаемого элемента: entries компонентам не нужны — они мерят DOM сами. */
  fire() {
    act(() => this.cb([], this));
  }
}
const ros: FakeRO[] = [];
const realRO = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = FakeRO;
});
afterAll(() => {
  globalThis.ResizeObserver = realRO;
});
beforeEach(() => {
  ros.length = 0;
});

/** Единственный живой RO компонента (подписка пересоздаётся при смене набора). */
const ro = () => {
  expect(ros).toHaveLength(1);
  return ros[0]!;
};
const observedKeys = (attr: string) =>
  [...ro().targets].map((el) => el.getAttribute(attr)).filter((k): k is string => k !== null);

describe("Tabs — пилюля переезжает за раскладкой сегментов", () => {
  const ru = [
    { key: "general", label: "Основные" },
    { key: "audio", label: "Звук" },
    { key: "about", label: "О программе" },
  ];
  const en = [
    { key: "general", label: "General" },
    { key: "audio", label: "Audio" },
    { key: "about", label: "About" },
  ];

  it("RO следит за каждым сегментом, а не только за таблистом", () => {
    render(<Tabs items={ru} value="audio" wrap />);
    // Контейнер (без data-tabkey) + все три сегмента.
    expect(observedKeys("data-tabkey").sort()).toEqual(["about", "audio", "general"]);
    expect(ro().targets.size).toBe(4);
  });

  it("перемеряет при смене подписей — тот же value и то же число вкладок (смена языка UI)", () => {
    const { rerender } = render(<Tabs items={ru} value="audio" wrap />);
    seen.length = 0;
    rerender(<Tabs items={en} value="audio" wrap />);
    // До фикса депсы были [value, items.length] → на этом рендере эффект молчал.
    expect(seen).toContain('[data-tabkey="audio"]');
  });

  it("пересобирает подписку RO под новый набор сегментов (тот же счётчик, другие ключи)", () => {
    const { rerender } = render(<Tabs items={ru} value="audio" wrap />);
    const first = ro();
    rerender(
      <Tabs items={[{ key: "rock", label: "Рок" }, { key: "pop", label: "Поп" }, { key: "jazz", label: "Джаз" }]} value="rock" wrap />,
    );
    // Старый RO отброшен, новый следит за новыми кнопками (иначе держал бы
    // размонтированные узлы и не видел бы живых).
    expect(ros).not.toContain(first);
    expect(observedKeys("data-tabkey").sort()).toEqual(["jazz", "pop", "rock"]);
  });

  it("по ресайзу мерит актуальный value, а не захваченный подпиской (measureRef)", () => {
    const { rerender } = render(<Tabs items={ru} value="audio" wrap />);
    rerender(<Tabs items={ru} value="about" wrap />);
    seen.length = 0;
    ro().fire();
    expect(seen).toContain('[data-tabkey="about"]');
    expect(seen).not.toContain('[data-tabkey="audio"]');
  });
});

describe("ChipGroup — подсветка переезжает за раскладкой чипов", () => {
  const ru = [
    { key: "playlists", label: "Плейлисты" },
    { key: "albums", label: "Альбомы" },
    { key: "artists", label: "Исполнители" },
  ];
  const en = [
    { key: "playlists", label: "Playlists" },
    { key: "albums", label: "Albums" },
    { key: "artists", label: "Artists" },
  ];

  it("по ресайзу мерит выбранный чип, а не тот, что был выбран на маунте (stale closure)", () => {
    const { rerender } = render(<ChipGroup items={ru} value="playlists" />);
    rerender(<ChipGroup items={ru} value="albums" />);
    seen.length = 0;
    ro().fire();
    // Живой баг: RO звал measure из замыкания первого рендера → подсветка
    // прыгала обратно на «Плейлисты» после любого ресайза окна.
    expect(seen).toContain('[data-chipkey="albums"]');
    expect(seen).not.toContain('[data-chipkey="playlists"]');
  });

  it("RO следит за каждым чипом, а не только за рядом", () => {
    render(<ChipGroup items={ru} value="albums" />);
    expect(observedKeys("data-chipkey").sort()).toEqual(["albums", "artists", "playlists"]);
    expect(ro().targets.size).toBe(4);
  });

  it("перемеряет при смене подписей — тот же value и то же число чипов (смена языка UI)", () => {
    const { rerender } = render(<ChipGroup items={ru} value="albums" />);
    seen.length = 0;
    rerender(<ChipGroup items={en} value="albums" />);
    expect(seen).toContain('[data-chipkey="albums"]');
  });

  it("строковые items (EQ-пресеты в настройках) работают как и {key,label}", () => {
    render(<ChipGroup items={["Флэт", "Бас", "Свой"]} value="Бас" />);
    expect(observedKeys("data-chipkey").sort()).toEqual(["Бас", "Свой", "Флэт"]);
  });
});
