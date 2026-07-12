import { AppShell } from "../../src/components/AppShell";

/** Layout залогиненной части: оболочка с плеером живёт здесь и не
 *  размонтируется при переходах между страницами — музыка не прерывается. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
