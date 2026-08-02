"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@muza/app";
import { LoginScreen } from "@muza/app/auth/LoginScreen";
import { getApi } from "../../src/api";
import { useSession } from "../../src/session";

/** Вход веба: тот же экран, что в приложении (@muza/app/auth/LoginScreen) —
 *  раньше здесь жила своя форма на 152 строки, написанная по памяти, и первое,
 *  что видит человек, у двух клиентов расходилось сильнее всего.
 *
 *  Чего в браузере нет — того нет и на экране, без серых заглушек:
 *  - почта и восстановление пароля (showEmailFeatures) — десктопные функции,
 *    ровно об этом и говорит строка внизу карточки;
 *  - анонимный вход (showAnonymous): сессия веба анонимной не бывает — при
 *    восстановлении такую выбрасывает src/session.tsx, и кнопка водила бы по
 *    кругу login → home → login;
 *  - согласие на анонимную статистику (onTelemetry): веб её не собирает,
 *    галочка обещала бы выключение того, чего нет.
 *
 *  Логотип пропом: у веба он лежит в public/ (Next из импорта .svg делает
 *  объект, а не строку — общий пакет такой импорт себе позволить не может). */
export default function LoginPage() {
  const { session, ready, setSession } = useSession();
  const router = useRouter();
  const { t, lang } = useT();

  useEffect(() => {
    if (ready && session) router.replace("/home");
  }, [ready, session, router]);

  return (
    <LoginScreen
      api={getApi()}
      lang={lang}
      glyphSrc="/glyph.svg"
      mobileSafe
      showEmailFeatures={false}
      showAnonymous={false}
      footerNote={t("web.login.footerNote")}
      onSession={(s) => {
        setSession(s);
        router.replace("/home");
      }}
    />
  );
}
