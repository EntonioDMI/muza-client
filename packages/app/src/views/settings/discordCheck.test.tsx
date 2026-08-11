/** РЕГРЕСС 12.08: отказ Discord перестал быть неотличимым от «ничего не было».
 *
 *  Жалобы владельца 2 и 5 из семи: «не работает кастомная кнопка в профиле» и
 *  «лично у моего друга RPC не работает вообще — сколько ни переключай
 *  настройки, ничего не меняется».
 *
 *  Разбор показал, что вторая жалоба неразрешима по построению. `rpc_update`
 *  возвращал голый `bool` на ПЯТЬ разных исходов: сборка без application id,
 *  клиент IPC не создался, Discord не запущен, Discord отклонил активность,
 *  всё получилось. Текст ошибки от самого Discord выбрасывался. То есть у нас
 *  не было ни одного способа узнать, что именно не сложилось у человека, — и у
 *  него тоже.
 *
 *  Тесты сторожат наблюдаемое: экран говорит РАЗНОЕ на разные причины и не
 *  выдаёт правило Discord за нашу поломку. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MuzaApi } from "@muza/api-client";
import type { DiscordOutcomeInfo, PlatformAdapter } from "../../platform";
import { DEFAULT_LANG, translate } from "../../i18n";
import { DEFAULT_PREFS, type Prefs } from "../../prefs/types";
import { SettingsProvider } from "./settingsContext";
import { DiscordSub } from "./DiscordSub";

afterEach(cleanup);

const T = (key: string) => translate(DEFAULT_LANG, key as Parameters<typeof translate>[1]);
const apiStub = {} as unknown as MuzaApi;

function renderSub(platform: PlatformAdapter, prefs: Partial<Prefs> = {}) {
  return render(
    <SettingsProvider
      prefs={{ ...DEFAULT_PREFS, ...prefs }}
      setPrefs={() => undefined}
      api={apiStub}
      serverSession={false}
      username="tester"
      isAdmin={false}
      onLogout={() => undefined}
      onNotify={() => undefined}
      onOpenHotkeys={() => undefined}
      nowPlaying={null}
      glyphSrc="/glyph.svg"
      caps={new Set([])}
      platform={platform}
      openSub={() => undefined}
      closeSub={() => undefined}
      goTo={() => undefined}
    >
      <DiscordSub />
    </SettingsProvider>,
  );
}

/** Площадка с Discord-портом, отвечающим заданным исходом. */
function portWith(outcome: DiscordOutcomeInfo, test = vi.fn(() => Promise.resolve(outcome))) {
  return {
    platform: {
      discordStatus: {
        configured: () => Promise.resolve(true),
        lastOutcome: () => null,
        test,
      },
    } as PlatformAdapter,
    test,
  };
}

const press = async () => {
  await waitFor(() => expect(screen.getByText(T("settings.integrations.discord.check.action"))).toBeTruthy());
  fireEvent.click(screen.getByText(T("settings.integrations.discord.check.action")));
};

describe("Проверка подключения к Discord", () => {
  it("Discord не запущен и Discord отклонил активность — это РАЗНЫЕ ответы", async () => {
    const notRunning = portWith({ ok: false, stage: "no_discord", message: "cannot connect" });
    renderSub(notRunning.platform);
    await press();
    await waitFor(() => expect(screen.getByText(T("settings.integrations.discord.check.noDiscord"))).toBeTruthy());
    cleanup();

    const rejected = portWith({ ok: false, stage: "rejected", message: "invalid button url" });
    renderSub(rejected.platform);
    await press();
    await waitFor(() => expect(screen.getByText(T("settings.integrations.discord.check.rejected"))).toBeTruthy());

    // До 12.08 оба исхода приходили одинаковым false и объяснить их было нечем.
    expect(screen.queryByText(T("settings.integrations.discord.check.noDiscord"))).toBeNull();
  });

  it("слова самого Discord показываются — именно их человек присылает нам снимком", async () => {
    const { platform } = portWith({ ok: false, stage: "rejected", message: "invalid button url" });
    renderSub(platform);
    await press();

    await waitFor(() =>
      expect(
        screen.getByText(T("settings.integrations.discord.check.detail").replace("{message}", "invalid button url")),
      ).toBeTruthy(),
    );
  });

  it("получилось — но про свою кнопку честно предупреждаем", async () => {
    // Кнопка настроена и годна: btnShown === true.
    const { platform } = portWith({ ok: true, stage: "ok", message: null });
    renderSub(platform, {
      discordBtnOn: true,
      discordBtnLabel: "Слушать",
      discordBtnUrl: "https://muza.lol",
    });
    await press();

    // Своих кнопок Discord автору не показывает — это его правило. Без этой
    // строки «проверка прошла, а кнопки нет» читается как наша поломка, и
    // ровно так и родилась жалоба 2 из семи.
    await waitFor(() => expect(screen.getByText(T("settings.integrations.discord.check.okWithButton"))).toBeTruthy());
  });

  it("проба уходит С ТОЙ ЖЕ кнопкой, что настроена у человека", async () => {
    const { platform, test } = portWith({ ok: true, stage: "ok", message: null });
    renderSub(platform, {
      discordBtnOn: true,
      discordBtnLabel: "Слушать",
      discordBtnUrl: "https://muza.lol",
    });
    await press();

    // Проба без кнопки проверяла бы не то, на что жалуются: у Discord
    // подключение и приём активности — разные шаги, и отклонить он может
    // именно второй, из-за адреса кнопки.
    await waitFor(() => expect(test).toHaveBeenCalledWith({ label: "Слушать", url: "https://muza.lol" }));
  });

  it("кнопка выключена — проба идёт без неё", async () => {
    const { platform, test } = portWith({ ok: true, stage: "ok", message: null });
    renderSub(platform, { discordBtnOn: false });
    await press();

    await waitFor(() => expect(test).toHaveBeenCalledWith({ label: null, url: null }));
  });

  it("площадка без пробы — ряда проверки нет вовсе (правило розетки)", () => {
    renderSub({ discordStatus: { configured: () => Promise.resolve(true) } } as PlatformAdapter);

    expect(screen.queryByText(T("settings.integrations.discord.check.title"))).toBeNull();
  });
});
