/** Пенёк: сам экран переехал в @muza/app (Э2 веб-паритета) — веб рисовал свою
 *  форму входа по памяти, и первое, что видит человек, у двух клиентов
 *  расходилось сильнее всего.
 *
 *  Не чистый ре-экспорт, а тонкая обёртка: логотип общий пакет принимает
 *  пропом (сборщики превращают `import … from "…svg"` каждый в своё), а
 *  App.tsx про это знать не должен — у него нулевой дифф.
 *
 *  Новый код импортирует напрямую из "@muza/app/auth/LoginScreen". */
import glyph from "@muza/ui/assets/logo/glyph.svg";
import { LoginScreen as SharedLoginScreen, type LoginScreenProps } from "@muza/app/auth/LoginScreen";

export function LoginScreen(props: Omit<LoginScreenProps, "glyphSrc">) {
  return <SharedLoginScreen {...props} glyphSrc={glyph} />;
}
