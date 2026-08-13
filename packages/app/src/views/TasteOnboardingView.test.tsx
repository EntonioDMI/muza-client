/** Экран «Что ты слушаешь?» — вкус, названный на входе (холодный старт, H7).
 *
 *  Стерегутся ровно те свойства, ради которых экран так устроен, — каждое
 *  куплено чужим замером (основания в шапке TasteOnboardingView.tsx):
 *   1. ЭКРАН НЕ БАРЬЕР: «Готово» доступно с пустым выбором, «Пропустить»
 *      сохраняет отказ (skipped=true), а не молчит — иначе экран вернётся;
 *   2. отметка НЕ ТЕРЯЕТСЯ, когда артист выпал из выдачи после сужения жанра:
 *      исчезнувшая с глаз галочка читается как «не засчиталось»;
 *   3. отметка жанра ПЕРЕСПРАШИВАЕТ сетку — иначе фильтр не отвечает;
 *   4. отказ сохранения НЕ ЗАКРЫВАЕТ экран: выбор человека остаётся на месте;
 *   5. ворота не спрашивают дважды и молчат на старом сервере.
 *
 *  Без LanguageProvider useT() отдаёт DEFAULT_LANG="en" — ассерты английские. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, TasteOptions } from "@muza/api-client";
import { QueryTestProvider } from "../lib/queryTestUtils";
import { TasteOnboardingView, useTasteGate } from "./TasteOnboardingView";

afterEach(() => cleanup());

const OPTIONS: TasteOptions = {
  genres: [
    { slug: "phonk", label: "Phonk", tracks: 120 },
    { slug: "rock", label: "Rock", tracks: 90 },
  ],
  artists: [
    { name: "Kordhell", genre: "phonk", cover: null },
    { name: "Radiohead", genre: "rock", cover: null },
  ],
};

function makeApi(over?: Partial<MuzaApi>): MuzaApi {
  return {
    getTasteOptions: vi.fn().mockResolvedValue(OPTIONS),
    putTasteSeed: vi.fn().mockResolvedValue({ artists: [], tags: [], skipped: false, updatedAt: "" }),
    getTasteSeed: vi.fn().mockResolvedValue({ supported: true, seed: null }),
    ...over,
  } as unknown as MuzaApi;
}

function renderView(api: MuzaApi, onDone = vi.fn(), onNotify?: (t: string, i?: string) => void) {
  render(
    <QueryTestProvider>
      <TasteOnboardingView api={api} onDone={onDone} onNotify={onNotify} />
    </QueryTestProvider>,
  );
  return { onDone };
}

describe("экран выбора вкуса — не барьер", () => {
  it("«Готово» доступно с пустым выбором: минимума отметок нет", async () => {
    const api = makeApi();
    const { onDone } = renderView(api);
    const done = await screen.findByRole("button", { name: "Done" });
    expect((done as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(done);
    await waitFor(() => expect(api.putTasteSeed).toHaveBeenCalled());
    expect(api.putTasteSeed).toHaveBeenCalledWith({ artists: [], tags: [], skipped: false });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("«Пропустить» сохраняет отказ, а не молчит — иначе экран вернётся", async () => {
    const api = makeApi();
    const { onDone } = renderView(api);
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    await waitFor(() => expect(api.putTasteSeed).toHaveBeenCalledWith({ artists: [], tags: [], skipped: true }));
    // saved=false: человек прошёл мимо, и вызывающий код не должен считать
    // это выбором.
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(false));
  });

  it("отмеченное уезжает на сервер в том виде, в каком его выбрали", async () => {
    const api = makeApi();
    renderView(api);
    fireEvent.click(await screen.findByRole("button", { name: "Kordhell" }));
    fireEvent.click(screen.getByRole("button", { name: "Phonk" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(api.putTasteSeed).toHaveBeenCalledWith({ artists: ["Kordhell"], tags: ["phonk"], skipped: false }),
    );
  });
});

describe("отметки и сужение сетки", () => {
  it("отметка жанра переспрашивает артистов под этот жанр", async () => {
    const api = makeApi();
    renderView(api);
    fireEvent.click(await screen.findByRole("button", { name: "Phonk" }));
    await waitFor(() =>
      expect(api.getTasteOptions).toHaveBeenCalledWith(expect.objectContaining({ tags: ["phonk"] })),
    );
  });

  it("отмеченный артист остаётся виден, даже когда выпал из новой выдачи", async () => {
    // Сузили жанр — сервер вернул сетку без него. Галочка обязана остаться:
    // исчезнувшая отметка читается как «не засчиталось».
    const getTasteOptions = vi
      .fn()
      .mockResolvedValueOnce(OPTIONS)
      .mockResolvedValue({ genres: OPTIONS.genres, artists: [{ name: "Kordhell", genre: "phonk", cover: null }] });
    const api = makeApi({ getTasteOptions } as unknown as Partial<MuzaApi>);
    renderView(api);

    fireEvent.click(await screen.findByRole("button", { name: "Radiohead" }));
    fireEvent.click(screen.getByRole("button", { name: "Phonk" }));

    await waitFor(() => expect(getTasteOptions).toHaveBeenCalledTimes(2));
    const kept = await screen.findByRole("button", { name: "Radiohead" });
    expect(kept.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("отказы", () => {
  it("сервер не принял выбор — экран остаётся, человек видит почему", async () => {
    const api = makeApi({ putTasteSeed: vi.fn().mockRejectedValue(new Error("нет сети")) } as unknown as Partial<MuzaApi>);
    const onNotify = vi.fn();
    const { onDone } = renderView(api, vi.fn(), onNotify);
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(() => expect(onNotify).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
    // Кнопка снова живая: «попробуй ещё раз» без перезапуска приложения.
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("каталог пуст — честная пустота, а не бесконечное ожидание", async () => {
    const api = makeApi({
      getTasteOptions: vi.fn().mockResolvedValue({ genres: [], artists: [] }),
    } as unknown as Partial<MuzaApi>);
    renderView(api);
    expect(await screen.findByText("Nothing to pick from yet")).toBeTruthy();
  });
});

/** Ворота: спрашивать ли вкус у этого человека. */
function Gate({ api, enabled }: { api: MuzaApi; enabled: boolean }) {
  const gate = useTasteGate(api, enabled);
  return <div>{gate.ask ? "ask" : "silent"}</div>;
}

describe("ворота экрана", () => {
  it("экрана ещё не было — спрашиваем", async () => {
    render(
      <QueryTestProvider>
        <Gate api={makeApi()} enabled />
      </QueryTestProvider>,
    );
    expect(await screen.findByText("ask")).toBeTruthy();
  });

  it("выбор уже есть — второй раз не спрашиваем", async () => {
    const api = makeApi({
      getTasteSeed: vi
        .fn()
        .mockResolvedValue({ supported: true, seed: { artists: [], tags: [], skipped: true, updatedAt: "" } }),
    } as unknown as Partial<MuzaApi>);
    render(
      <QueryTestProvider>
        <Gate api={api} enabled />
      </QueryTestProvider>,
    );
    // Даже пустой выбор со skipped=true — это ответ «нет», а не «не спрашивали».
    await waitFor(() => expect(api.getTasteSeed).toHaveBeenCalled());
    expect(screen.getByText("silent")).toBeTruthy();
  });

  it("сервер старее приложения — молчим, а не показываем экран в никуда", async () => {
    const api = makeApi({ getTasteSeed: vi.fn().mockResolvedValue({ supported: false }) } as unknown as Partial<MuzaApi>);
    render(
      <QueryTestProvider>
        <Gate api={api} enabled />
      </QueryTestProvider>,
    );
    await waitFor(() => expect(api.getTasteSeed).toHaveBeenCalled());
    expect(screen.getByText("silent")).toBeTruthy();
  });

  it("анонимный аккаунт — сервера нет, не спрашиваем и не ходим в сеть", async () => {
    const api = makeApi();
    render(
      <QueryTestProvider>
        <Gate api={api} enabled={false} />
      </QueryTestProvider>,
    );
    expect(screen.getByText("silent")).toBeTruthy();
    expect(api.getTasteSeed).not.toHaveBeenCalled();
  });
});
