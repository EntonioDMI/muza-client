/** Кнопка «Сейчас играет» в полосе плеера веба.
 *
 *  ЗАЧЕМ. Панель прячется на /settings (она отбирает у двухколоночного экрана
 *  340px и роняет его в узкий режим), а полоса плеера получала СЫРУЮ настройку
 *  prefs.npOpen — то есть на настройках кнопка горела нажатой и по нажатию не
 *  показывала ничего. Это два разных вопроса: «панель на этом экране бывает» и
 *  «раскрыта прямо сейчас». Правило площадки одно: нет умения — нет кнопки,
 *  а не серая и не залипшая.
 *
 *  Проверяется НАБЛЮДАЕМОЕ: есть ли в разметке кнопка с именем панели. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Плеер и лайки подменены: полосе от них нужны только «что играет» и
 *  «лайкнуто ли», а настоящие модули тянут два `<audio>` и запросы к серверу. */
vi.mock("../player", () => ({
  usePlayer: () => ({
    current: { id: "t-1", title: "Песня", artist: "Артист", coverUrl: null, durationSec: 200 },
    queue: [],
    index: 0,
    playing: false,
    loading: false,
    error: null,
    muted: false,
    volume: 1,
    shuffle: false,
    repeat: "off",
    toggle: () => undefined,
    prev: () => undefined,
    next: () => undefined,
    seek: () => undefined,
    setVolume: () => undefined,
    toggleMute: () => undefined,
    toggleShuffle: () => undefined,
    cycleRepeat: () => undefined,
    playContext: () => undefined,
  }),
  usePosition: () => ({ position: 0, duration: 200 }),
}));
vi.mock("../likes", () => ({ useLikes: () => ({ likedIds: new Set<string>(), toggle: () => undefined }) }));
/** Настройки и тосты подменены по той же причине, что плеер: полосе от них
 *  нужны ровно шаги скорости и способ показать «1.25×». Настоящий PrefsProvider
 *  потянул бы localStorage и миграции профиля — к кнопке «Сейчас играет» это
 *  отношения не имеет. */
vi.mock("../prefs", () => ({ usePrefs: () => ({ prefs: { speedSteps: [1, 1.25, 1.5] }, set: () => undefined }) }));
vi.mock("../toast", () => ({ useToast: () => () => undefined }));

const { PlayerBar } = await import("./PlayerBar");
const { translate, DEFAULT_LANG } = await import("@muza/app");

/** Имя панели — общий ключ словаря (им же подписан тултип кнопки). Провайдера
 *  языка в тесте нет, значит useT отвечает на DEFAULT_LANG — берём ту же
 *  строку тем же путём, а не переписываем её сюда руками. */
const NP_LABEL = translate(DEFAULT_LANG, "nowPlaying.heading");

describe("полоса плеера: кнопка «Сейчас играет»", () => {
  // vitest здесь без globals — авто-очистки testing-library нет, и без этой
  // строки разметка первого теста доживает до второго (там ищут ОТСУТСТВИЕ)
  afterEach(cleanup);

  it("есть там, где панель бывает", () => {
    render(<PlayerBar npOpen={false} onToggleNp={() => undefined} onOpenMobile={() => undefined} />);
    expect(screen.getAllByRole("button", { name: NP_LABEL }).length).toBeGreaterThan(0);
  });

  it("на экране без панели кнопки НЕТ вовсе (а не нажатая и бездействующая)", () => {
    render(<PlayerBar npOpen={false} onOpenMobile={() => undefined} />);
    expect(screen.queryByRole("button", { name: NP_LABEL })).toBeNull();
  });
});
