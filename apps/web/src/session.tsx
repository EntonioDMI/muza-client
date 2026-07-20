"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@muza/api-client";
import { getApi } from "./api";

/** Сессия веба. Анонимный режим десктопа на вебе не существует: без серверной
 *  сессии браузеру нечем играть (добыча — только через серверный резолвер). */

interface SessionCtx {
  session: Session | null;
  /** restoreSession завершился — можно принимать решения о редиректах. */
  ready: boolean;
  setSession: (s: Session | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Отзыв входа на ходу (2026-07-20): restoreSession больше не ходит в
    // сеть, поэтому просроченный вход вскрывается первым же 401 — без этого
    // сигнала страница осталась бы «залогиненной» с падающими запросами.
    getApi().onSessionRevoked(() => setSession(null));
    getApi()
      .restoreSession()
      .then((s) => setSession(s && !s.user.anonymous ? s : null))
      .catch(() => setSession(null))
      .finally(() => setReady(true));
  }, []);

  const logout = useCallback(async () => {
    await getApi()
      .logout()
      .catch(() => undefined);
    setSession(null);
  }, []);

  return <Ctx.Provider value={{ session, ready, setSession, logout }}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession вне SessionProvider");
  return ctx;
}
