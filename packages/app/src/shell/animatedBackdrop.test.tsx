/** РИСОВАЛКА ФОНА: разметка, которую видит человек.
 *
 *  Главный вопрос файла — «не изменился ли вид у того, кто ничего не
 *  настраивал». Караоке выглядит одинаково у всех со Stage 3, и правка, которая
 *  добавляет НАСТРОЙКУ, не имеет права менять КАРТИНКУ. Поэтому здесь сверяются
 *  конкретные стили прежнего задника, а не «компонент что-то отрисовал». */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AnimatedBackdrop } from "./AnimatedBackdrop";
import { ListeningMode } from "./ListeningMode";
import { backdropViewFromPrefs, DEFAULT_SCENE_BACKDROP, type BackdropView } from "../prefs/backdrop";
import { DEFAULT_PREFS, type Prefs } from "../prefs/types";

afterEach(cleanup);

const COVER = "https://example.test/cover.jpg";

function view(patch: Partial<Prefs>): BackdropView {
  return backdropViewFromPrefs({ ...DEFAULT_PREFS, ...patch }, "scene");
}

describe("сцена караоке по умолчанию = прежняя размытая обложка", () => {
  it("та же разметка, что была зашита в ListeningMode до 03.08", () => {
    const { container } = render(<AnimatedBackdrop view={DEFAULT_SCENE_BACKDROP} cover={COVER} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(COVER);
    const s = img!.style;
    expect(s.position).toBe("absolute");
    expect(s.inset).toBe("-10%");
    expect(s.width).toBe("120%");
    expect(s.height).toBe("120%");
    expect(s.objectFit).toBe("cover");
    expect(s.filter).toBe("blur(var(--blur-scenery))");
    expect(s.transform).toBe("scale(1.1)");
    // Сцена НЕ приглушается: поверх неё ложится своя плёнка --glass-deep.
    expect(s.opacity).toBe("");
    // И не фейдится на смене трека — раньше там просто менялся src.
    expect(img!.className).toBe("");
  });

  it("подложка приложения — тот же снимок, но приглушённый и с fade", () => {
    const appView = backdropViewFromPrefs({ ...DEFAULT_PREFS, bgType: "cover" }, "app");
    const { container } = render(<AnimatedBackdrop view={appView} cover={COVER} />);
    const img = container.querySelector("img")!;
    expect(img.style.opacity).toBe("0.22");
    expect(img.style.transform).toBe("");
    expect(img.className).toBe("muza-fade");
  });

  it("нет обложки — нет и задника (остаётся фон зоны, как было всегда)", () => {
    const { container } = render(<AnimatedBackdrop view={DEFAULT_SCENE_BACKDROP} cover={null} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("сам оверлей караоке без пропа фона рисует ту же обложку", () => {
    const { container } = render(
      <ListeningMode
        open
        track={{ id: "1", title: "T", artist: "A", cover: COVER, duration: 100 }}
        lyrics={[]}
        playing={false}
        pos={0}
        activeLine={-1}
        onTogglePlay={() => undefined}
        onPrev={() => undefined}
        onNext={() => undefined}
        onSeek={() => undefined}
        onSeekLine={() => undefined}
        onClose={() => undefined}
      />,
    );
    const backdrop = container.querySelector('img[src="' + COVER + '"]');
    expect(backdrop).not.toBeNull();
    expect((backdrop as HTMLElement).style.filter).toBe("blur(var(--blur-scenery))");
    expect((backdrop as HTMLElement).style.transform).toBe("scale(1.1)");
  });
});

describe("виды фона караоке", () => {
  it("цвет и градиент — плоские слои без картинки", () => {
    const { container: c1 } = render(
      <AnimatedBackdrop view={view({ karaokeBgType: "color", karaokeBgColor: "#123456" })} cover={COVER} />,
    );
    expect(c1.querySelector("img")).toBeNull();
    expect((c1.firstElementChild as HTMLElement).style.background).toContain("rgb(18, 52, 86)");

    const { container: c2 } = render(
      <AnimatedBackdrop
        view={view({ karaokeBgType: "gradient", karaokeBgColor: "#000000", karaokeBgColor2: "#ffffff" })}
        cover={COVER}
      />,
    );
    expect((c2.firstElementChild as HTMLElement).style.background).toContain("linear-gradient");
  });

  it("картинка по ссылке (в том числе гифка) рисуется даже без обложки трека", () => {
    const { container } = render(
      <AnimatedBackdrop
        view={view({ karaokeBgType: "image", karaokeBgImageUrl: "https://example.test/a.gif" })}
        cover={null}
      />,
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://example.test/a.gif");
    expect(img.style.inset).toBe("-5%");
  });

  it("пустая ссылка — фона нет, а не битая картинка", () => {
    const { container } = render(<AnimatedBackdrop view={view({ karaokeBgType: "image" })} cover={COVER} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("выключенный фон не рисует ничего", () => {
    const { container } = render(<AnimatedBackdrop view={view({ karaokeBgType: "none" })} cover={COVER} />);
    expect(container.firstElementChild).toBeNull();
  });
});

describe("типы анимации", () => {
  const spinClasses = (el: HTMLElement) =>
    [...el.querySelectorAll("[class*='muza-backdrop-orb']")].map((n) => n.className);

  it("две обложки навстречу друг другу — прежний вид: левая по часовой, правая против", () => {
    const { container } = render(<AnimatedBackdrop view={view({ karaokeBgType: "animated" })} cover={COVER} />);
    expect(spinClasses(container)).toEqual(["muza-backdrop-orb--cw", "muza-backdrop-orb--ccw"]);
  });

  it("«в разные стороны» — то, что делал старый тумблер: пара наоборот", () => {
    const { container } = render(
      <AnimatedBackdrop view={view({ karaokeBgType: "animated", karaokeBgAnimSpin: "outward" })} cover={COVER} />,
    );
    expect(spinClasses(container)).toEqual(["muza-backdrop-orb--ccw", "muza-backdrop-orb--cw"]);
  });

  it("обе в одну сторону — новая возможность, раньше её не было вовсе", () => {
    const { container: cw } = render(
      <AnimatedBackdrop view={view({ karaokeBgType: "animated", karaokeBgAnimSpin: "cw" })} cover={COVER} />,
    );
    expect(spinClasses(cw)).toEqual(["muza-backdrop-orb--cw", "muza-backdrop-orb--cw"]);
    const { container: ccw } = render(
      <AnimatedBackdrop view={view({ karaokeBgType: "animated", karaokeBgAnimSpin: "ccw" })} cover={COVER} />,
    );
    expect(spinClasses(ccw)).toEqual(["muza-backdrop-orb--ccw", "muza-backdrop-orb--ccw"]);
  });

  it("одна обложка стоит по центру и берёт направление левого круга", () => {
    const { container } = render(
      <AnimatedBackdrop view={view({ karaokeBgType: "animated", karaokeBgAnimDiscs: "one" })} cover={COVER} />,
    );
    expect(spinClasses(container)).toEqual(["muza-backdrop-orb--cw"]);
    const orb = container.querySelector("[class*='muza-backdrop-orb']")!.parentElement as HTMLElement;
    expect(orb.style.left).toBe("50%");
    expect(orb.style.transform).toBe("translate(-50%, -50%)");
  });

  it("скорость вращения приезжает из настройки, а не из класса", () => {
    const { container } = render(
      <AnimatedBackdrop view={view({ karaokeBgType: "animated", karaokeBgAnimSpeedSec: 30 })} cover={COVER} />,
    );
    const orb = container.querySelector("[class*='muza-backdrop-orb']") as HTMLElement;
    expect(orb.style.animationDuration).toBe("30s");
  });

  it("анимации выключены — круги стоят на месте, но не пропадают", () => {
    const { container } = render(
      <AnimatedBackdrop view={view({ karaokeBgType: "animated" })} cover={COVER} spinning={false} />,
    );
    expect(spinClasses(container)).toEqual([]);
    expect(container.querySelectorAll("img").length).toBe(2);
  });

  it("фон не виден — вращение на паузе (угол замирает, а не сбрасывается)", () => {
    const { container } = render(
      <AnimatedBackdrop view={view({ karaokeBgType: "animated" })} cover={COVER} paused />,
    );
    expect(container.querySelectorAll("[data-orb-paused]").length).toBe(2);
  });
});

describe("мусор в настройках не роняет экран", () => {
  it("чужая тема с бессмыслицей в новых полях рисует прежнюю картинку", () => {
    const hostile = {
      ...DEFAULT_PREFS,
      karaokeBgType: "<script>",
      karaokeBgAnimSpin: 17,
      karaokeBgAnimDiscs: null,
      karaokeBgAnimScale: Number.NaN,
      karaokeBgAnimSpeedSec: "быстро",
    } as unknown as Prefs;
    const { container } = render(
      <AnimatedBackdrop view={backdropViewFromPrefs(hostile, "scene")} cover={COVER} />,
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(COVER);
    expect(img.style.transform).toBe("scale(1.1)");
  });
});
