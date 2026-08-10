/** Хук синхронизации настроек: подтянуть при входе, отправлять правки с
 *  задержкой. Правила и разделение ключей — в шапке `sync.ts`.
 *
 *  Ставится ОДИН раз в корне программы, рядом с хранилищем настроек: веб —
 *  `apps/web/src/prefs.tsx`, приложение — `apps/desktop/src/App.tsx`.
 *
 *  ⚠️ ОТМЕТКА СОГЛАСОВАНИЯ ЖИВЁТ В localStorage, А НЕ В ПРОФИЛЕ. Попав в Prefs,
 *  она сама стала бы правкой, которую надо отправить: отправка меняет отметку,
 *  изменение отметки требует отправки — цикл не сходится. Ключ свой на каждое
 *  устройство, и это верно: отметка отвечает на вопрос «что ЭТА установка уже
 *  видела с сервера».
 *
 *  ⚠️ МОЛЧАЛИВАЯ ДЕГРАДАЦИЯ. Сервер старее клиента (нет ручки), сети нет,
 *  человек не вошёл — синхронизации нет, и никто об этом не узнаёт: настройки
 *  продолжают работать локально, как работали до 11.08. Тост «не удалось
 *  синхронизировать настройки» здесь был бы шумом на пустом месте: человек
 *  ничего не терял и сделать ничего не может. */

import { useEffect, useRef } from "react";
import type { MuzaApi } from "@muza/api-client";
import type { Prefs } from "./types";
import { pullPrefs, pushPrefs, sameServerPrefs, type PrefsSyncDeps } from "./sync";

const STAMP_KEY = "muza.prefs.synced.v1";

/** Пауза между последней правкой и отправкой. Ползунок «Стекло» за один жест
 *  даёт десятки изменений, и слать каждое значило бы устроить серверу поток
 *  запросов ради промежуточных значений, которых человек даже не видел. */
const PUSH_DELAY_MS = 1500;

function readStamp(): string | null {
  try {
    return localStorage.getItem(STAMP_KEY);
  } catch {
    return null; // приватный режим — синхронизация просто не запомнит отметку
  }
}

function writeStamp(v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(STAMP_KEY);
    else localStorage.setItem(STAMP_KEY, v);
  } catch {
    /* см. readStamp */
  }
}

export function usePrefsSync({
  api,
  signedIn,
  prefs,
  applyPrefs,
  ready = true,
}: {
  api: MuzaApi;
  signedIn: boolean;
  prefs: Prefs;
  /** Применить приехавший профиль к состоянию программы. */
  applyPrefs: (p: Prefs) => void;
  /** Локальный профиль уже загружен. Пока false, отправлять нечего — иначе
   *  первое устройство залило бы на сервер дефолты вместо своих настроек. */
  ready?: boolean;
}): void {
  // Свежие значения — через ref: они нужны обработчикам, а перезапускать
  // эффекты на каждую правку профиля нельзя (это и есть правка).
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const applyRef = useRef(applyPrefs);
  applyRef.current = applyPrefs;

  const deps = useRef<PrefsSyncDeps | null>(null);
  deps.current = {
    api,
    signedIn,
    getPrefs: () => prefsRef.current,
    applyPrefs: (p) => applyRef.current(p),
    readStamp,
    writeStamp,
  };

  /** Жива ли синхронизация в этом сеансе. `null` — ещё не выясняли; `false` —
   *  сервер не умеет, и второй раз спрашивать незачем. */
  const alive = useRef<boolean | null>(null);
  /** Профиль на момент последнего согласования: с ним сравниваем правки, чтобы
   *  не слать на сервер изменение ключа устройства. */
  const lastSent = useRef<Prefs | null>(null);

  // ── Подтянуть при входе ────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !signedIn) {
      alive.current = null;
      lastSent.current = null;
      return;
    }
    let cancelled = false;
    const d = deps.current;
    if (!d) return;
    pullPrefs(d)
      .then((ok) => {
        if (cancelled) return;
        alive.current = ok;
        lastSent.current = prefsRef.current;
      })
      .catch(() => {
        // Сеть или сервер молчат — не мешаем человеку; следующая правка
        // попробует отправить профиль снова.
        if (!cancelled) alive.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [ready, signedIn]);

  // ── Отправить правку с задержкой ───────────────────────────────────────
  useEffect(() => {
    if (!ready || !signedIn || alive.current === false) return;
    // Первое согласование ещё не прошло — отправлять нечего: `pullPrefs` сам
    // зальёт профиль, если сервер о нём не знает.
    if (lastSent.current === null) return;
    if (sameServerPrefs(lastSent.current, prefs)) return;

    const timer = setTimeout(() => {
      const d = deps.current;
      if (!d) return;
      pushPrefs(d)
        .then((ok) => {
          alive.current = ok;
          if (ok) lastSent.current = prefsRef.current;
        })
        .catch(() => undefined);
    }, PUSH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [prefs, ready, signedIn]);

  // ── Выход из аккаунта ──────────────────────────────────────────────────
  // Отметку снимаем: следующий вход (возможно, под другим аккаунтом) обязан
  // принять серверный профиль, а не решить «у меня уже такой».
  useEffect(() => {
    if (!signedIn) writeStamp(null);
  }, [signedIn]);
}
