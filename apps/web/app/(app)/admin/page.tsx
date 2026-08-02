"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminView } from "@muza/app/views/AdminView";
import { getApi } from "../../../src/api";
import { useSession } from "../../../src/session";

/** Админка веба — ТОТ ЖЕ экран, что в приложении (@muza/app/views/AdminView):
 *  он с самого начала был чистым React без обращений к рабочему столу, так что
 *  в браузере работает как есть. До 2026-08-02 страницы просто не существовало,
 *  и владельцу приходилось открывать приложение ради обзора и рубильников.
 *
 *  Право доступа спрашиваем у сервера (он же и охраняет каждый запрос): не
 *  админ — тихо уводим на главную, без страницы-заглушки. Пока ответ не
 *  пришёл, не рисуем ничего: мигнуть админкой и убрать её хуже пустоты. */
export default function AdminPage() {
  const router = useRouter();
  const { session, ready } = useSession();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (session === null) {
      router.replace("/login");
      return;
    }
    let alive = true;
    getApi()
      .adminPing()
      .then((ok) => {
        if (!alive) return;
        setAllowed(ok);
        if (!ok) router.replace("/home");
      })
      .catch(() => {
        if (!alive) return;
        setAllowed(false);
        router.replace("/home");
      });
    return () => {
      alive = false;
    };
  }, [ready, session, router]);

  if (allowed !== true) return null;
  // .shared-screen гасит отступ зоны: поле (24px) приносит сам экран, как в
  // приложении, где <main> голый. Без обёртки поля складывались и содержимое
  // стояло на 78px от края зоны вместо 58px (globals.css → «ЕДИНСТВЕННЫЙ
  // способ погасить поле зоны»).
  return (
    <div className="shared-screen">
      <AdminView api={getApi()} />
    </div>
  );
}
