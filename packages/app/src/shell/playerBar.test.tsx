/** Полоса плеера — общая для приложения и веба (Э3 веб-паритета).
 *
 *  Что здесь доказывается (и почему именно это):
 *  1) ПРАВИЛО «умение = наличие обработчика». Приложение передаёт всё — в баре
 *     весь набор; веб передаёт часть — лишних кнопок нет ВООБЩЕ (не серых, не
 *     выключенных). Это единственная защита от того, чтобы веб не оброс
 *     кнопками, которые ничего не делают.
 *  2) ВРЕМЯ СЧИТАЕТСЯ ПО-ПРИЛОЖЕНЧЕСКИ. До переезда веб отбрасывал дробь, а
 *     приложение округляло — на одном треке подписи расходились на секунду.
 *     Тест ловит возврат к «floor».
 *  3) ПЕРЕТАСКИВАНИЕ ОБЛОЖКИ ФАЙЛОМ живёт через розетку: есть порт — файл
 *     уходит системе, нет порта (браузер) — жест просто ничего не делает и
 *     ничего не роняет.
 *
 *  Без LanguageProvider язык = DEFAULT_LANG ("en"), подписи берём из того же
 *  словаря, что и компонент, — тест не завязан на конкретные слова. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_LANG, translate } from "../i18n";
import { PlatformProvider, type PlatformAdapter } from "../platform";
import { PlayerBar } from "./PlayerBar";

afterEach(cleanup);

const noop = () => undefined;

const track = { id: "t1", title: "Title", artist: "Artist", cover: null, duration: 200 };

/** Несъёмное: транспорт, прогресс, лайк — его передают обе программы. */
const base = {
  track,
  playing: false,
  onTogglePlay: noop,
  onPrev: noop,
  onNext: noop,
  pos: 0,
  onSeek: noop,
  vol: 50,
  onVol: noop,
  liked: false,
  onLike: noop,
  shuffle: false,
  onShuffle: noop,
  repeat: "off" as const,
  onRepeat: noop,
};

/** Набор приложения: все умения на месте. */
const desktopExtras = {
  onSpeed: noop,
  onEqualizer: noop,
  onLyrics: noop,
  onJam: noop,
  onSleep: noop,
  sleepLabel: "sleep-timer",
  onExpand: noop,
  onQueue: noop,
  onMute: noop,
};

const label = {
  equalizer: translate(DEFAULT_LANG, "settings.equalizer.title"),
  lyrics: translate(DEFAULT_LANG, "player.lyrics"),
  jam: translate(DEFAULT_LANG, "player.jamTooltip"),
  fullscreen: translate(DEFAULT_LANG, "player.fullscreen"),
  queue: translate(DEFAULT_LANG, "player.queue"),
  shuffle: translate(DEFAULT_LANG, "player.shuffle"),
  volume: translate(DEFAULT_LANG, "player.volume"),
  mute: translate(DEFAULT_LANG, "player.mute"),
  cover: translate(DEFAULT_LANG, "player.listeningModeTooltip"),
};

describe("полоса плеера: одна на две программы", () => {
  it("приложение отдаёт все умения — в баре весь набор кнопок", () => {
    render(<PlayerBar {...base} {...desktopExtras} />);
    for (const l of [label.equalizer, label.lyrics, label.jam, label.fullscreen, label.queue, "sleep-timer"]) {
      expect(screen.queryByLabelText(l), l).not.toBeNull();
    }
  });

  it("веб не умеет таймер сна, скорость, эквалайзер, текст и совместное — этих кнопок НЕТ вовсе", () => {
    render(<PlayerBar {...base} onQueue={noop} onMute={noop} />);
    for (const l of [label.equalizer, label.lyrics, label.jam, label.fullscreen, "sleep-timer"]) {
      expect(screen.queryByLabelText(l), l).toBeNull();
    }
    // а то, что веб умеет, на месте
    for (const l of [label.queue, label.shuffle, label.volume, label.mute]) {
      expect(screen.queryByLabelText(l), l).not.toBeNull();
    }
  });

  it("тайм-код округляет (правило приложения), а не отбрасывает дробь", () => {
    render(<PlayerBar {...base} pos={3.6} />);
    expect(screen.queryByText("0:04")).not.toBeNull();
    expect(screen.queryByText("0:03")).toBeNull();
  });

  it("длительность-«не число» (метаданные ещё не пришли) не превращается в NaN", () => {
    render(<PlayerBar {...base} track={{ ...track, duration: Number.NaN }} />);
    // два нуля: слева позиция, справа длительность
    expect(screen.queryAllByText("0:00").length).toBe(2);
  });

  it("умение есть: перетаскивание обложки отдаёт готовый файл системе", async () => {
    const startFileDrag = vi.fn(async () => {});
    const adapter: PlatformAdapter = {
      dragOut: { exportTrackFile: async () => "C:/tmp/Artist - Title.mp3", startFileDrag },
    };
    render(
      <PlatformProvider adapter={adapter}>
        <PlayerBar {...base} onCoverDragOut={async () => "C:/tmp/Artist - Title.mp3"} />
      </PlatformProvider>,
    );
    const cover = screen.getByLabelText(label.cover);
    fireEvent.pointerDown(cover, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(cover, { clientX: 40, clientY: 0 });
    await waitFor(() => expect(startFileDrag).toHaveBeenCalledWith("C:/tmp/Artist - Title.mp3"));
  });

  it("умения нет (браузер): тот же жест ничего не делает и не роняет бар", async () => {
    const onCoverDragOut = vi.fn(async () => "C:/tmp/Artist - Title.mp3");
    const onExpand = vi.fn();
    // без PlatformProvider — площадка не умеет ничего
    render(<PlayerBar {...base} onCoverDragOut={onCoverDragOut} onExpand={onExpand} />);
    const cover = screen.getByLabelText(label.cover);
    fireEvent.pointerDown(cover, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(cover, { clientX: 40, clientY: 0 });
    fireEvent.pointerUp(cover);
    // жест распознан как перенос — «развернуть» по клику не открывается
    fireEvent.click(cover);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("нет трека — бар остаётся на месте с плейсхолдером, транспорт выключен", () => {
    render(<PlayerBar {...base} track={null} />);
    expect(screen.queryByText(translate(DEFAULT_LANG, "player.empty.title"))).not.toBeNull();
    expect(screen.getByLabelText(translate(DEFAULT_LANG, "player.next"))).toHaveProperty("disabled", true);
  });

  it("компоновка (настройки приложения) выключает кнопку: её нет в баре", () => {
    render(<PlayerBar {...base} {...desktopExtras} buttons={[{ key: "queue", on: false }]} />);
    expect(screen.queryByLabelText(label.queue)).toBeNull();
    // остальные ключи нормализатор дописывает включёнными
    expect(screen.queryByLabelText(label.lyrics)).not.toBeNull();
  });
});

/** Полоса прогресса дорисовывает позицию между редкими timeupdate собственным
 *  циклом кадров (Slider, rate>0). Пока окна не видно, эта работа уходит в
 *  никуда, а стоит она дорого: в WebView2 у свёрнутого окна кадры не
 *  тормозятся, а РАЗГОНЯЮТСЯ (замер 03.08 — 171 к/с). Спросить об этом
 *  document.hidden нельзя (он про свёрнутое окно не знает), поэтому сигнал
 *  приходит пропом; у веба пропа нет — там значение по умолчанию «видно». */
describe("PlayerBar — дорисовка прогресса кадрами", () => {
  it("окна не видно: кадров нет; вернулось — снова идут", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      const view = render(<PlayerBar {...base} playing speed={1} windowVisible={false} />);
      expect(raf).not.toHaveBeenCalled();

      view.rerender(<PlayerBar {...base} playing speed={1} windowVisible />);
      expect(raf).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("пропа нет (веб) — поведение прежнее: музыка идёт, кадры идут", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1 as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      render(<PlayerBar {...base} playing speed={1} />);
      expect(raf).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
