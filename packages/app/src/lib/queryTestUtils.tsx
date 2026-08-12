/** Провайдер запросов для тестов.
 *
 *  Экраны, которые ходят на сервер, живут под QueryClientProvider (его ставят
 *  оболочки: apps/desktop/src/main.tsx и apps/web/src/providers.tsx). Тест
 *  рендерит экран напрямую, поэтому провайдера обязан принести сам —
 *  react-query без него бросает, и это правильно: молчаливый фолбэк прятал бы
 *  забытый провайдер до самого прода.
 *
 *  ⚠️ КЛИЕНТ СВОЙ НА КАЖДЫЙ РЕНДЕР. Общий на файл протащил бы кэш из теста в
 *  тест: следующий получал бы данные предыдущего и проходил бы, ничего не
 *  проверив. Повторы выключены — тесту нужен отказ сразу, а не через три
 *  попытки; gcTime нулевой, чтобы между тестами ничего не оставалось. */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryTestProvider({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
