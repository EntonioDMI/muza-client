/** ТОНКАЯ ОБЁРТКА. Сам диалог «Поделиться» переехал в
 *  @muza/app/shell/ShareDialog (волна экранов веб-паритета, 2026-08-02).
 *
 *  Обёртка нужна ровно ради одной строки — ссылки на глиф Muza для рисунка
 *  карточки. Импорт картинки собирается у площадок по-разному (Vite отдаёт
 *  строку-URL, Next — объект для next/image), поэтому модуль, который
 *  собирают ОБЕ, такой импорт себе позволить не может — глиф приезжает
 *  пропом (тот же приём, что у общего экрана входа).
 *
 *  Второе касание приложения — «Сохранить PNG» — уехало в розетку (порт
 *  saveImage, см. src/platform/desktopAdapter.ts): в приложении кнопка на
 *  месте и делает то же, в браузере её просто нет.
 *
 *  App.tsx импорта не менял. */
import glyphUrl from "@muza/ui/assets/logo/glyph.svg";
import { ShareDialog as SharedShareDialog } from "@muza/app/shell/ShareDialog";
import type { ShareData } from "../lib/shareCard";

export function ShareDialog({
  data,
  onClose,
  onNotify,
}: {
  /** null — диалог закрыт. */
  data: ShareData | null;
  onClose: () => void;
  onNotify: (text: string, icon?: string) => void;
}) {
  return <SharedShareDialog data={data} glyphSrc={glyphUrl} onClose={onClose} onNotify={onNotify} />;
}
