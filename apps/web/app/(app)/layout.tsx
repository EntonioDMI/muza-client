import { AppShell } from "../../src/components/AppShell";
import { AppHotkeys } from "../../src/providers";

/** Layout залогиненной части: оболочка с плеером живёт здесь и не
 *  размонтируется при переходах между страницами — музыка не прерывается.
 *  Здесь же — горячие клавиши (AppHotkeys, providers.tsx): их слушатель
 *  переживает переходы, а на /login (вне этого layout) не мешает вводу. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHotkeys />
      <AppShell>{children}</AppShell>
    </>
  );
}
