/** Инварианты общей главной (волна экранов веб-паритета, 2026-08-02).
 *
 *  Проверяем ровно то, чем клиенты РАСХОДИЛИСЬ до переезда и что легко
 *  сломать обратно:
 *  1) порядок и форма секций — «В тренде» и «Новое в каталоге» витринами
 *     ВЫШЕ «Для тебя», а «Потому что…» ниже него; витрины — плитками,
 *     «Для тебя» — списком строк. У веба сортировки не было вовсе, и первая
 *     пришедшая секция всегда шла списком.
 *  2) необязательные умения приложения (оффлайн-копия ленты, прогрев добычи,
 *     вынос файла на рабочий стол) при их отсутствии НЕ должны ни падать, ни
 *     менять разметку — иначе веб получит десктопный проп в значении по
 *     умолчанию или пустой экран.
 *
 *  Тесты без LanguageProvider — английский фолбэк (DEFAULT_LANG="en"), как в
 *  остальных тестах пакета. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { HomeSection, MuzaApi, Track } from "@muza/api-client";
import { QueryTestProvider } from "../lib/queryTestUtils";
import { DragLayer } from "../shell/DragLayer";
import { HomeFeed } from "./HomeFeed";

afterEach(cleanup);

/** Слой переноса поднимают ОБА клиента выше страниц (App.tsx приложения,
 *  AppShell веба) — экран вправе на него рассчитывать, тест повторяет это. */
// Экран ходит на сервер через react-query — провайдер приносит тест
// (в бою его ставят оболочки, см. lib/queryTestUtils.tsx).
const show = (ui: React.ReactElement) =>
  render(
    <QueryTestProvider>
      <DragLayer>{ui}</DragLayer>
    </QueryTestProvider>,
  );

const track = (id: string, title: string): Track => ({
  id,
  artist: "Автор",
  title,
  album: null,
  durationSec: 100,
  coverUrl: null,
  isCached: false,
  sources: ["youtube"],
  loudness: null,
  localHash: null,
});

/** Порядок НАРОЧНО «неправильный»: сервер отдаёт «Для тебя» первым, а экран
 *  обязан поднять витрины над ним. */
const sections: HomeSection[] = [
  { key: "for_you", title: "Для тебя", tracks: [track("f1", "Первый"), track("f2", "Второй")] },
  { key: "because_1", title: "Потому что вы любите Автора", tracks: [track("b1", "Похожий")] },
  { key: "trending", title: "В тренде", tracks: [track("t1", "Модный")] },
  { key: "new", title: "Новое в каталоге", tracks: [track("n1", "Свежий")] },
];

const api = (list: HomeSection[] = sections) => ({ getHome: vi.fn(async () => list) }) as unknown as MuzaApi;

const noop = () => {};

/** Пропсы, которые обязана дать ЛЮБАЯ площадка (веб-минимум: ни снапшота,
 *  ни прогрева, ни розетки с портом выноса файла). */
const baseProps = {
  canSearch: true,
  greetName: "sivren",
  currentId: null,
  playing: false,
  likes: [] as string[],
  onPlayCatalog: noop,
  onLike: noop,
  onCatalogMenu: noop,
  onNotify: noop,
  onOpen: noop,
};

describe("общая главная", () => {
  it("витрины поднимаются над «Для тебя», «Потому что…» уходит вниз", async () => {
    show(<HomeFeed api={api()} {...baseProps} />);
    await screen.findByText("Для тебя");

    const titles = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent);
    expect(titles).toEqual(["В тренде", "Новое в каталоге", "Для тебя", "Потому что вы любите Автора"]);
  });

  it("«Для тебя» — список строк, витрина — плитки", async () => {
    show(<HomeFeed api={api()} {...baseProps} />);
    await screen.findByText("Для тебя");

    // строки списка нумерованы (index у TrackRow), плитки — нет
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    // оба трека «Для тебя» и трек витрины на экране
    for (const name of ["Первый", "Второй", "Модный", "Свежий"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("без оффлайн-копии лента ходит на сервер и плашки «оффлайн» не рисует", async () => {
    const a = api();
    show(<HomeFeed api={a} {...baseProps} />);
    await screen.findByText("Для тебя");

    expect((a.getHome as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(screen.queryByText(/offline copy/i)).toBeNull();
  });

  it("отдаёт пришедшие секции наружу — из них снаружи собирается меню", async () => {
    const onSections = vi.fn();
    show(<HomeFeed api={api()} {...baseProps} onSections={onSections} />);
    await waitFor(() => expect(onSections).toHaveBeenCalledTimes(1));
    expect(onSections.mock.calls[0][0]).toEqual(sections);
  });

  it("сервер лёг — честная плашка, а не выдуманная лента", async () => {
    const dead = { getHome: vi.fn(async () => { throw new Error("нет сети"); }) } as unknown as MuzaApi;
    show(<HomeFeed api={dead} {...baseProps} />);
    await screen.findByText(/Muza is unreachable|Муза сейчас недоступна/);
    expect(document.querySelectorAll("h2").length).toBe(0);
  });

  it("аноним: ленты нет, сервер не дёргается", async () => {
    const a = api();
    show(<HomeFeed api={a} {...baseProps} canSearch={false} greetName={null} />);
    await screen.findByText(/Recommendations need an account|Рекомендации живут/);
    expect((a.getHome as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
