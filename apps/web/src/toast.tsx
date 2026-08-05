"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Toast, TOAST_HOLD } from "@muza/ui";

/** Тосты веба: одна тихая пилюля над баром (модель десктопа).
 *
 *  Сколько тост живёт — ОБЩЕЕ число шкалы движения (TOAST_HOLD из
 *  packages/ui/src/lib/motion.js, пара к токену --dur-toast-hold), а не своя
 *  константа: пилюля в браузере и в программе обязана гаснуть одинаково, а
 *  число, зашитое здесь, разъезжается молча — вид у обеих один. */

type Notify = (text: string, icon?: string) => void;

const Ctx = createContext<Notify>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ open: boolean; text: string; icon: string }>({
    open: false,
    text: "",
    icon: "check",
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback<Notify>((text, icon = "check") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ open: true, text, icon });
    timer.current = setTimeout(() => setToast((t) => ({ ...t, open: false })), TOAST_HOLD);
  }, []);

  return (
    <Ctx.Provider value={notify}>
      {children}
      <Toast
        open={toast.open}
        message={toast.text}
        icon={toast.icon}
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: "calc(var(--h-playerbar) + var(--gap-zone) * 2)",
          zIndex: 60,
        }}
      />
    </Ctx.Provider>
  );
}

export function useToast(): Notify {
  return useContext(Ctx);
}
