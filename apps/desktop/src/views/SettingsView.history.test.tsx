/** МЕСТО В НАСТРОЙКАХ ↔ ИСТОРИЯ: связка, которая один раз уже повесила окно.
 *
 *  Жалоба владельца 13.08 (вечер): «был на странице диагностики, перешёл на
 *  другую, зашёл обратно в настройки — страница пытается ОДНОВРЕМЕННО
 *  вернуться в диагностику и перейти на главную настроек, интерфейс завис».
 *
 *  Механизм зависания. Поддерево экрана пересоздаётся при смене вкладки, то
 *  есть SettingsView монтируется заново с tab = null, а App всё ещё держит
 *  ПРОШЛОЕ место. Дальше два эффекта тянули состояние в разные стороны:
 *  приведение к записи вело экран в диагностику, а отчёт на монтировании
 *  докладывал наверх (null, null) — App записывал это к себе, приведение
 *  видело новое значение и вело обратно. Бесконечный цикл.
 *
 *  Тесты ниже стерегут ОБЕ половины разрыва: молчание на монтировании и
 *  применение места только при смене НОМЕРА записи. Достаточно вернуть любую
 *  из них — и петля оживёт, поэтому проверяются они по отдельности. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { DEFAULT_PREFS } from "@muza/app/prefs/types";
import type { MuzaApi } from "@muza/api-client";

afterEach(() => cleanup());

const noop = () => undefined;

function renderView(props: Partial<React.ComponentProps<typeof SettingsView>> = {}) {
  const onPlaceChange = props.onPlaceChange ?? vi.fn();
  const view = render(
    <SettingsView
      api={{} as MuzaApi}
      serverSession
      prefs={DEFAULT_PREFS as never}
      setPrefs={noop}
      username="tester"
      onLogout={noop}
      onNotify={noop}
      onOpenHotkeys={noop}
      {...props}
      onPlaceChange={onPlaceChange}
    />,
  );
  return { ...view, onPlaceChange };
}

describe("SettingsView ↔ история", () => {
  it("⚠️ монтирование НЕ докладывает место наверх", () => {
    // Отчёт на монтировании затирал в App место, к которому экран ещё даже не
    // пришёл, — это была вторая половина зависания.
    const { onPlaceChange } = renderView({ placeTab: null, placeSub: null, placeNonce: 0 });
    expect(onPlaceChange).not.toHaveBeenCalled();
  });

  it("⚠️ ЧУЖОЕ МЕСТО ПРИ ТОМ ЖЕ НОМЕРЕ НЕ ПРИМЕНЯЕТСЯ — экран остаётся на входе", () => {
    // Ровно сценарий владельца: вернулись в настройки, App ещё держит
    // диагностику, номер записи с прошлого раза не менялся. Экран обязан
    // показать вход в настройки, а не утащить человека обратно в диагностику.
    renderView({ placeTab: "system", placeSub: "stage0", placeNonce: 0 });
    // Кнопка «All settings» есть ТОЛЬКО внутри раздела. Её отсутствие и значит
    // «мы на входе». (Без провайдера языка useT отдаёт английский — см.
    // i18n/index.tsx, так устроены и остальные тесты этого дерева.)
    expect(screen.queryByRole("button", { name: "All settings" })).toBeNull();
  });

  it("смена НОМЕРА записи место применяет — «назад» продолжает работать", () => {
    const { rerender } = renderView({ placeTab: null, placeSub: null, placeNonce: 0 });
    expect(screen.queryByRole("button", { name: "All settings" })).toBeNull();
    rerender(
      <SettingsView
        api={{} as MuzaApi}
        serverSession
        prefs={DEFAULT_PREFS as never}
        setPrefs={noop}
        username="tester"
        onLogout={noop}
        onNotify={noop}
        onOpenHotkeys={noop}
        placeTab="appearance"
        placeSub={null}
        placeNonce={1}
        onPlaceChange={noop}
      />,
    );
    // Ушли со входа в раздел — значит запись истории применилась.
    expect(screen.queryByRole("button", { name: "All settings" })).not.toBeNull();
  });
});
