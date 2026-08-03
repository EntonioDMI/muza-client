/** Своя полоса заголовка. Тут проверяется НЕ вёрстка, а те три её свойства,
 *  потеря которых оставляет человека с окном, которое нельзя ни закрыть, ни
 *  подвинуть, — и которые при этом не видны ни типам, ни глазу на скриншоте:
 *
 *  1) кнопки зовут ПЕРЕДАННЫЕ действия (компонент не знает про Tauri и знать
 *     не должен — вилка живёт в apps/desktop/src/lib/windowControls.ts);
 *  2) на корне стоит data-tauri-drag-region="deep" — именно "deep", а не
 *     голый атрибут: с голым тащится только сам корень, и попытка потянуть
 *     окно за надпись «Muza» или за глиф ничего не делает;
 *  3) кнопки НЕ несут этот атрибут — иначе нажатие на крестик станет
 *     перетаскиванием (обработчик Tauri идёт от цели события вверх и
 *     останавливается на первом <button> БЕЗ атрибута).
 *
 *  Двойной клик по полосе разворачивает окно СИЛАМИ TAURI, а не нашим
 *  onDoubleClick: его инжектированный скрипт при e.detail===2 зовёт
 *  internal_toggle_maximize. Проверяем то, от чего это зависит и что можно
 *  сломать правкой разметки, — сам drag-region (пункты 2 и 3); свой
 *  обработчик здесь появиться не должен, он бы задвоил разворот. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../i18n";
import { TitleBar, TITLEBAR_H } from "./TitleBar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderBar(props: Partial<React.ComponentProps<typeof TitleBar>> = {}) {
  const onMinimize = vi.fn();
  const onToggleMaximize = vi.fn();
  const onClose = vi.fn();
  render(
    <LanguageProvider lang="ru">
      <TitleBar
        onMinimize={onMinimize}
        onToggleMaximize={onToggleMaximize}
        onClose={onClose}
        {...props}
      />
    </LanguageProvider>,
  );
  return { onMinimize, onToggleMaximize, onClose };
}

describe("TitleBar", () => {
  it("кнопки зовут переданные действия окна", () => {
    const { onMinimize, onToggleMaximize, onClose } = renderBar();

    fireEvent.click(screen.getByLabelText("Свернуть окно"));
    fireEvent.click(screen.getByLabelText("Развернуть окно"));
    fireEvent.click(screen.getByLabelText("Закрыть окно"));

    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("в развёрнутом окне средняя кнопка становится «вернуть прежний размер»", () => {
    const { onToggleMaximize } = renderBar({ maximized: true });

    expect(screen.queryByLabelText("Развернуть окно")).toBeNull();
    fireEvent.click(screen.getByLabelText("Вернуть прежний размер"));
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("полоса — область перетаскивания «deep», а кнопки из неё исключены", () => {
    renderBar();
    const bar = screen.getByTestId("titlebar");

    // "deep" обязательно: с голым атрибутом тянется только сам корень
    expect(bar.getAttribute("data-tauri-drag-region")).toBe("deep");
    // Двойной клик разворачивает силами Tauri — свой обработчик задвоил бы его
    expect(bar.ondblclick).toBeFalsy();

    for (const button of bar.querySelectorAll("button")) {
      expect(button.hasAttribute("data-tauri-drag-region")).toBe(false);
    }
  });

  it("все три кнопки подписаны для скринридера и доступны с клавиатуры", () => {
    renderBar();
    const buttons = [...screen.getByTestId("titlebar").querySelectorAll("button")];

    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
      // Нативная <button> без tabindex="-1" — в порядке обхода Tab
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("tabindex")).toBeNull();
    }
  });

  it("в полосе нет ни логотипа, ни надписи — только кнопки", () => {
    renderBar();
    const bar = screen.getByTestId("titlebar");

    // Глиф и «Muza» тут БЫЛИ и убраны заявкой владельца 03.08: те же логотип
    // и название стоят в шапке сайдбара, два одинаковых один под другим
    // читались как ошибка. Тест держит договорённость.
    expect(bar.querySelector("img")).toBeNull();
    expect(bar.textContent?.trim()).toBe("");
  });

  it("высота полосы — та же величина, на которую App уменьшает верхнее поле", () => {
    renderBar();
    // Раскладка App.tsx ставит paddingTop: TITLEBAR_H. Разъедутся — полоса
    // либо накроет содержимое, либо повиснет над пустой щелью.
    expect(screen.getByTestId("titlebar").style.height).toBe(`${TITLEBAR_H}px`);
  });
});
