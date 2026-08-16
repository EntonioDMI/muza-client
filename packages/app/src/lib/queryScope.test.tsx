/** Сброс кэша запросов при смене пользователя.
 *
 *  Барьер против жалобы владельца 16.08 «рекомендации будто смешиваются с
 *  чужими»: клиент запросов один на окно, ключи (`["home"]`, `["favorites"]`)
 *  пользователя не различают, gcTime — 10 минут. Без сброса вошедший вторым
 *  видел ленту первого. Разбор — шапка lib/queryClient.ts.
 *
 *  Главное, что здесь проверяется, — не сам факт очистки, а МОМЕНТ: сброс
 *  обязан случиться ДО того, как экран отрисует чужие данные. Поэтому второй
 *  тест смотрит на то, что реально видит человек в первом кадре, а не на
 *  состояние кэша после.
 *
 *  Расстановка узлов повторяет приложение: провайдер запросов — самый верхний
 *  (main.tsx / providers.tsx), скоуп зовётся в теле узла с сессией (AppRoot /
 *  SessionProvider), экраны — его дети. */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { QK, useQueryScope } from "./queryClient";

function Feed() {
  const q = useQuery({ queryKey: QK.home, queryFn: async () => "лента с сервера" });
  return <div data-testid="feed">{q.data ?? "пусто"}</div>;
}

function Shell({ user }: { user: string | null }) {
  useQueryScope(user);
  // Экраны монтируются только под вошедшим — как Player в App.tsx.
  return user ? <Feed /> : null;
}

function Wrapper({ client, user }: { client: QueryClient; user: string | null }) {
  return (
    <QueryClientProvider client={client}>
      <Shell user={user} />
    </QueryClientProvider>
  );
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 10 * 60_000 } },
  });
}

// Автоочистки в этом пакете нет (vitest без setup-файла) — иначе следующий
// тест находит два узла с одним data-testid.
afterEach(cleanup);

describe("useQueryScope", () => {
  it("первый вызов ничего не сбрасывает — восстановление сессии не должно терять свои запросы", () => {
    const client = makeClient();
    client.setQueryData(QK.home, "лента из прошлого запуска");
    render(<Wrapper client={client} user="a" />);
    expect(client.getQueryData(QK.home)).toBe("лента из прошлого запуска");
  });

  it("вошедший вторым не видит ленту первого ни одним кадром", () => {
    const client = makeClient();
    // A походил по приложению и вышел: экраны размонтированы, кэш остался.
    const { rerender } = render(<Wrapper client={client} user={null} />);
    client.setQueryData(QK.home, "лента A");

    rerender(<Wrapper client={client} user="b" />);

    // Если сброс переехать в useEffect, здесь окажется «лента A»: эффекты
    // детей выполняются раньше эффектов родителя, и кадр уже нарисован.
    expect(screen.getByTestId("feed").textContent).not.toBe("лента A");
  });

  it("выход сбрасывает кэш, не дожидаясь следующего входа", () => {
    const client = makeClient();
    const { rerender } = render(<Wrapper client={client} user="a" />);
    client.setQueryData(QK.favorites, ["трек A"]);
    rerender(<Wrapper client={client} user={null} />);
    expect(client.getQueryData(QK.favorites)).toBeUndefined();
  });

  it("тот же пользователь кэш не теряет — иначе перерисовки корня обнуляли бы его", () => {
    const client = makeClient();
    const { rerender } = render(<Wrapper client={client} user="a" />);
    client.setQueryData(QK.favorites, ["трек A"]);
    rerender(<Wrapper client={client} user="a" />);
    expect(client.getQueryData(QK.favorites)).toEqual(["трек A"]);
  });
});
