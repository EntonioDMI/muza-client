/** T44-fix: security review (Important #1) — watchdog обязан НЕ просто
 *  помечать фрейм "зависшим" в FrameReg (эта запись стирается при unregister),
 *  а держать это состояние отдельно и переживать unregisterFrame — иначе
 *  PluginFrames после размонтажа тут же перемонтирует тот же фрейм заново
 *  (crash-restart-петля), и зависший realm формально "исчезает" на кадр и
 *  тут же появляется опять. См. host.ts::crashedIds/isCrashed/clearCrashed,
 *  PluginFrames.tsx::mountable. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluginHost } from "./host";

function mountedIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  return iframe;
}

describe("pluginHost — watchdog teardown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("плагин без ready за READY_DEADLINE_MS (3с) помечается crashed", () => {
    const iframe = mountedIframe();
    pluginHost.registerFrame("host-test-noready", iframe, []);
    expect(pluginHost.isCrashed("host-test-noready")).toBe(false);

    vi.advanceTimersByTime(3100);

    expect(pluginHost.isCrashed("host-test-noready")).toBe(true);
    pluginHost.clearCrashed("host-test-noready");
  });

  it("crashed-статус переживает unregisterFrame (реальный DOM-тердаун) — не сбрасывается сам", () => {
    const iframe = mountedIframe();
    pluginHost.registerFrame("host-test-survive", iframe, []);
    vi.advanceTimersByTime(3100);
    expect(pluginHost.isCrashed("host-test-survive")).toBe(true);

    // Это происходит, когда PluginFrames снимает <iframe> из DOM
    // (cleanup эффекта в PluginFrame) — ключевой момент бага: раньше это
    // стирало саму запись и следующий рендер монтировал фрейм заново.
    pluginHost.unregisterFrame("host-test-survive");

    expect(pluginHost.isCrashed("host-test-survive")).toBe(true);
    pluginHost.clearCrashed("host-test-survive");
  });

  it("clearCrashed сбрасывает статус (новое включение плагина — честная попытка)", () => {
    const iframe = mountedIframe();
    pluginHost.registerFrame("host-test-clear", iframe, []);
    vi.advanceTimersByTime(3100);
    expect(pluginHost.isCrashed("host-test-clear")).toBe(true);

    pluginHost.clearCrashed("host-test-clear");
    expect(pluginHost.isCrashed("host-test-clear")).toBe(false);
  });

  it("плагин, приславший ready вовремя, НЕ помечается crashed", () => {
    const iframe = mountedIframe();
    pluginHost.registerFrame("host-test-ok", iframe, []);
    const win = iframe.contentWindow;
    expect(win).not.toBeNull();
    window.dispatchEvent(
      new MessageEvent("message", { data: { v: 1, id: "r1", kind: "ready" }, source: win as Window }),
    );

    vi.advanceTimersByTime(3100);
    expect(pluginHost.isCrashed("host-test-ok")).toBe(false);

    pluginHost.unregisterFrame("host-test-ok");
  });
});
