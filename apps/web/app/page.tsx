"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "../src/session";

/** Корень: по восстановленной сессии — в приложение, иначе на вход. */
export default function IndexPage() {
  const { session, ready } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    router.replace(session ? "/home" : "/login");
  }, [ready, session, router]);
  return <div style={{ position: "fixed", inset: 0, background: "var(--bg-0)" }} />;
}
