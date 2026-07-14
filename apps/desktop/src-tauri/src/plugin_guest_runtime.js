/* Guest-рантайм плагинов уровня 1 (эпик W8, T44) — window.Muza SDK.
 * Плейн JS (НЕ TypeScript): исполняется внутри `<iframe sandbox="allow-scripts">`
 * (opaque origin, CSP `default-src 'none'; script-src 'nonce-...'; connect-src 'none'`)
 * без доступа к npm/бандлеру — must be a self-contained IIFE. Вшивается в
 * bootstrap-HTML через include_str! в apps/desktop/src-tauri/src/plugins.rs
 * ПЕРЕД кодом entry.js плагина (тем же <script nonce>).
 *
 * Формат конверта — зеркало packages/core/src/plugin/messages.ts (этот файл
 * его не импортирует, оба места правь синхронно). Метод-неймспейсы — зеркало
 * packages/core/src/plugin/manifest.ts::METHOD_PERMISSIONS/EVENT_PERMISSIONS.
 */
(function () {
  "use strict";

  var V = 1;
  var pending = Object.create(null); // id -> {resolve, reject}
  var listeners = Object.create(null); // eventType -> Set<fn>
  var seq = 0;

  function nextId() {
    seq += 1;
    return "guest-" + Date.now().toString(36) + "-" + seq;
  }

  function post(env) {
    try {
      window.parent.postMessage(env, "*");
    } catch (e) {
      /* родитель недоступен — не должно случаться в живом приложении */
    }
  }

  function call(method, args) {
    return new Promise(function (resolve, reject) {
      var id = nextId();
      pending[id] = { resolve: resolve, reject: reject };
      post({ v: V, id: id, kind: "req", method: method, args: args });
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          var err = new Error("timeout");
          err.code = "timeout";
          reject(err);
        }
      }, 5000);
    });
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var env = e.data;
    if (!env || typeof env !== "object" || env.v !== V || typeof env.id !== "string") return;

    if (env.kind === "res" || env.kind === "error") {
      var p = pending[env.id];
      if (!p) return;
      delete pending[env.id];
      if (env.kind === "res") {
        p.resolve(env.result);
      } else {
        var err = new Error(env.message || env.code || "error");
        err.code = env.code;
        p.reject(err);
      }
      return;
    }

    // Watchdog: хост пингует зарезервированным req __ping — отвечаем сами,
    // плагин об этом не знает и не может это перехватить/сломать.
    if (env.kind === "req" && env.method === "__ping") {
      post({ v: V, id: env.id, kind: "res", ok: true, result: "pong" });
      return;
    }

    if (env.kind === "event" && env.method) {
      var set = listeners[env.method];
      if (set) {
        set.forEach(function (fn) {
          try {
            fn(env.args);
          } catch (err) {
            /* обработчик плагина сломался — его код, не наша забота */
          }
        });
      }
    }
  });

  function on(type, fn) {
    if (!listeners[type]) listeners[type] = new Set();
    listeners[type].add(fn);
  }
  function off(type, fn) {
    if (listeners[type]) listeners[type].delete(fn);
  }

  window.Muza = {
    apiVersion: V,
    Player: {
      getState: function () {
        return call("player.getState");
      },
      getCurrentTrack: function () {
        return call("player.getCurrentTrack");
      },
      getQueue: function () {
        return call("player.getQueue");
      },
      play: function () {
        return call("player.play");
      },
      pause: function () {
        return call("player.pause");
      },
      next: function () {
        return call("player.next");
      },
      prev: function () {
        return call("player.prev");
      },
      seek: function (sec) {
        return call("player.seek", { sec: sec });
      },
      setVolume: function (v) {
        return call("player.setVolume", { v: v });
      },
      setRate: function (r) {
        return call("player.setRate", { r: r });
      },
      enqueue: function (trackIds, pos) {
        return call("player.enqueue", { trackIds: trackIds, pos: pos });
      },
      removeFromQueue: function (pos) {
        return call("player.removeFromQueue", { pos: pos });
      },
      reorderQueue: function (from, to) {
        return call("player.reorderQueue", { from: from, to: to });
      },
      clearQueue: function () {
        return call("player.clearQueue");
      },
      playTrack: function (trackId) {
        return call("player.playTrack", { trackId: trackId });
      },
    },
    Library: {
      getPlaylists: function () {
        return call("library.getPlaylists");
      },
      getPlaylistTracks: function (id) {
        return call("library.getPlaylistTracks", { id: id });
      },
      getFavorites: function () {
        return call("library.getFavorites");
      },
      createPlaylist: function (name) {
        return call("library.createPlaylist", { name: name });
      },
      addToPlaylist: function (id, trackIds) {
        return call("library.addToPlaylist", { id: id, trackIds: trackIds });
      },
      removeFromPlaylist: function (id, trackIds) {
        return call("library.removeFromPlaylist", { id: id, trackIds: trackIds });
      },
      like: function (trackId) {
        return call("library.like", { trackId: trackId });
      },
      unlike: function (trackId) {
        return call("library.unlike", { trackId: trackId });
      },
    },
    UI: {
      toast: function (text, kind) {
        return call("ui.toast", { text: text, kind: kind });
      },
      setBadge: function (slotId, text) {
        return call("ui.setBadge", { slotId: slotId, text: text });
      },
      setBarButtonState: function (id, state) {
        return call("ui.setBarButtonState", { id: id, state: state });
      },
      openTab: function (tabId) {
        return call("ui.openTab", { tabId: tabId });
      },
      applyCss: function (css) {
        return call("ui.applyCss", { css: css });
      },
      removeCss: function () {
        return call("ui.removeCss");
      },
    },
    Strings: {
      override: function (map) {
        return call("strings.override", { map: map });
      },
      reset: function () {
        return call("strings.reset");
      },
    },
    Storage: {
      get: function (key) {
        return call("storage.get", { key: key });
      },
      set: function (key, value) {
        return call("storage.set", { key: key, value: value });
      },
      remove: function (key) {
        return call("storage.remove", { key: key });
      },
      keys: function () {
        return call("storage.keys");
      },
    },
    Net: {
      fetch: function (url, init) {
        return call("net.fetch", { url: url, init: init || null });
      },
    },
    Events: { on: on, off: off },
  };

  post({ v: V, id: nextId(), kind: "ready" });
})();
