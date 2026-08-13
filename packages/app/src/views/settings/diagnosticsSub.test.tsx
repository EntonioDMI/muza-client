/** Сторож экрана проверки загрузки треков — СВЯЗКИ, а не арифметики.
 *
 *  Арифметику стережёт lib/engineOverview.test.ts. Здесь проверяется то, что
 *  ломается при переезде и никакой типизацией не ловится:
 *   1. вердикт наверху говорит человеческими именами, а не машинными;
 *   2. половина картины, приходящая с сервера, действительно спрашивается, а
 *      её отсутствие не рисует пустую рамку;
 *   3. подробности (простыня, из-за которой экран и переписывали) свёрнуты по
 *      умолчанию и открываются кнопкой.
 *
 *  Пункт 3 — не косметика: именно развёрнутые подробности превращали экран в
 *  то, на что жаловался владелец. Разверни их обратно «чтобы было видно» —
 *  и вся работа отменится, а тест об этом скажет. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi, SearchSourceHealth } from "@muza/api-client";
import type { DiagnosticsPort, PlatformAdapter, TrackStartRecord } from "../../platform";
import { DEFAULT_LANG, translate } from "../../i18n";
import { DEFAULT_PREFS } from "../../prefs/types";
import { SettingsProvider } from "./settingsContext";
import { DiagnosticsSub } from "./DiagnosticsSub";

afterEach(cleanup);

const T = (key: string) => translate(DEFAULT_LANG, key as Parameters<typeof translate>[1]);

const START: TrackStartRecord = {
  trackId: "t1",
  title: "Kiasmos — Blurred",
  reason: "manual",
  at: 1_700_000_000_000,
  sourcesMs: 20,
  urlMs: 220,
  path: "stream",
  playCallMs: 280,
  soundMs: 540,
  error: null,
  silenceMs: 5,
  cls: "soundcloud",
  cold: false,
};

const DOWN_SOURCE: SearchSourceHealth = {
  source: "youtube:music",
  attempts: 20,
  ok: 0,
  empty: 0,
  failed: 20,
  medianMs: null,
  avgCount: null,
  lastFailure: { reason: "имя www.youtube.com не разрешилось", at: 1_700_000_100_000 },
  lastOkAt: null,
  failureRate: 1,
};

function port(overrides: Partial<DiagnosticsPort> = {}): DiagnosticsPort {
  return {
    health: () => Promise.resolve({ cooldown_until_ms: null, consecutive_fails: 0, sc_key_ready: true, events: [] }),
    startLog: () => [START],
    subscribeStartLog: () => () => undefined,
    startLogTsv: () => "at\treason",
    startSummary: () => [],
    ...overrides,
  };
}

function renderSub(opts: { api?: Partial<MuzaApi>; port?: DiagnosticsPort } = {}) {
  const platform: PlatformAdapter = { diagnostics: opts.port ?? port() };
  const api = { ...opts.api } as unknown as MuzaApi;
  return render(
    <SettingsProvider
      prefs={DEFAULT_PREFS}
      setPrefs={() => undefined}
      api={api}
      serverSession={false}
      username="tester"
      isAdmin={false}
      onLogout={() => undefined}
      onNotify={() => undefined}
      onOpenHotkeys={() => undefined}
      nowPlaying={null}
      glyphSrc="/glyph.svg"
      caps={new Set(["diagnostics" as const])}
      platform={platform}
      openSub={() => undefined}
      closeSub={() => undefined}
      goTo={() => undefined}
    >
      <DiagnosticsSub />
    </SettingsProvider>,
  );
}

describe("экран проверки загрузки треков", () => {
  it("⚠️ вердикт называет место человеческим именем, а не машинным", async () => {
    // «youtube:music не отвечает» — язык сервера в самой читаемой строке
    // экрана. Ровно это и было в первой сборке.
    renderSub({ api: { searchSourceHealth: () => Promise.resolve([DOWN_SOURCE]) } });
    await waitFor(() => expect(document.body.textContent).toContain("YouTube Music"));
    // Проверка по всему тексту экрана, а не по одной строке: машинному имени
    // нельзя вылезти НИГДЕ — ни в вердикте, ни в списке мест.
    expect(document.body.textContent).not.toContain("youtube:music");
  });

  it("сервер не умеет отвечать про места поиска — раздела нет, а не пустая рамка", async () => {
    renderSub({ api: {} });
    await waitFor(() => expect(screen.getByText(T("settings.system.stage0.overview.okTitle"))).toBeTruthy());
    expect(screen.queryByText(T("settings.system.stage0.overview.searchTitle"))).toBeNull();
  });

  it("не смогли спросить — так и сказано, а не «пусто»", async () => {
    renderSub({ api: { searchSourceHealth: () => Promise.reject(new Error("нет сети")) } });
    await waitFor(() =>
      expect(screen.getByText(T("settings.system.stage0.overview.searchUnavailable"))).toBeTruthy(),
    );
  });

  it("⚠️ подробности свёрнуты: простыня открывается кнопкой, а не встречает", async () => {
    renderSub();
    await waitFor(() => expect(screen.getByText(T("settings.system.stage0.overview.okTitle"))).toBeTruthy());
    expect(screen.queryByText(START.title, { exact: false })).toBeNull();
    fireEvent.click(screen.getByText(T("settings.system.stage0.overview.startsMore")));
    expect(screen.getByText(START.title, { exact: false })).toBeTruthy();
  });

  it("журнал склеивает одинаковые события в строку со счётчиком", async () => {
    renderSub({
      port: port({
        health: () =>
          Promise.resolve({
            cooldown_until_ms: null,
            consecutive_fails: 2,
            sc_key_ready: true,
            events: [
              { at_ms: 3, text: "сбой быстрого пути: YouTube требует вход — деталь B" },
              { at_ms: 2, text: "сбой быстрого пути: YouTube требует вход — деталь A" },
            ],
          }),
      }),
    });
    await waitFor(() => expect(screen.getByText("сбой быстрого пути: YouTube требует вход")).toBeTruthy());
    expect(screen.getByText(/×2/)).toBeTruthy();
    // Хвост — от самого свежего события: старый уже разобран.
    expect(screen.getByText(/деталь B/)).toBeTruthy();
  });

  it("нет журнала выгрузки — нет и кнопки «скопировать»", async () => {
    renderSub({ port: port({ startLogTsv: undefined }) });
    await waitFor(() => expect(screen.getByText(T("settings.system.stage0.overview.okTitle"))).toBeTruthy());
    expect(screen.queryByText(T("settings.system.stage0.starts.copy"))).toBeNull();
  });

  it("«обновить» перечитывает и предохранители, и места поиска", async () => {
    const health = vi.fn(() =>
      Promise.resolve({ cooldown_until_ms: null, consecutive_fails: 0, sc_key_ready: true, events: [] }),
    );
    const sources = vi.fn(() => Promise.resolve([DOWN_SOURCE]));
    renderSub({ api: { searchSourceHealth: sources }, port: port({ health }) });
    await waitFor(() => expect(sources).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText(T("settings.system.stage0.refresh")));
    await waitFor(() => expect(sources).toHaveBeenCalledTimes(2));
    expect(health.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
