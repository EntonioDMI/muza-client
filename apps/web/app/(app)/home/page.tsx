"use client";

import { useMemo, useState } from "react";
import type { HomeSection, Track } from "@muza/api-client";
import { HomeFeed } from "@muza/app/views/HomeFeed";
import { ContextMenuProvider } from "@muza/app/shell/ContextMenu";
import { useRouter } from "next/navigation";
import { getApi } from "../../../src/api";
import { useLikes } from "../../../src/likes";
import { usePlayer } from "../../../src/player";
import { useSession } from "../../../src/session";
import { useToast } from "../../../src/toast";
import { useWebTrackMenu } from "../../../src/components/TrackList";

/** Главная веба = ОБЩИЙ экран @muza/app/views/HomeFeed, тот же самый, что
 *  рисует приложение (волна экранов веб-паритета, 2026-08-02).
 *
 *  Что здесь было раньше: своя вёрстка ленты — секции в порядке сервера,
 *  первая всегда списком, остальные плитками без подписей. Человек видел
 *  «Для тебя» сразу, а витрин «В тренде» и «Новое в каталоге» не видел вовсе;
 *  заголовки были на 10 и 5 пикселей мельче приложения, у полок не было
 *  стрелок-листалок, у плиток — правой кнопки. Теперь порядок секций,
 *  типографика, полки и меню приезжают из одного файла на два клиента.
 *
 *  Страница осталась ВИЛКОЙ: отдаёт общему экрану то, чем веб умеет
 *  распоряжаться (плеер, лайки, тосты, переходы, меню по правой кнопке).
 *  Оффлайн-копии ленты, прогрева добычи и выноса файла на рабочий стол у
 *  браузера нет — соответствующие пропсы не передаются, и экран ведёт себя
 *  так, будто этих возможностей в продукте нет. */
export default function HomePage() {
  const { session } = useSession();
  const { current, playing, playContext } = usePlayer();
  const { likedIds, toggle } = useLikes();
  const notify = useToast();
  const router = useRouter();

  /** Треки ленты нужны меню по правой кнопке: оно живёт снаружи экрана
   *  (это веб-умение — «Скачать», диалог «В плейлист»), а треки знает только
   *  сам экран. Отдаёт он их коллбэком onSections. */
  const [sections, setSections] = useState<HomeSection[]>([]);
  const tracks = useMemo(() => {
    const seen = new Set<string>();
    const flat: Track[] = [];
    for (const s of sections) {
      for (const tr of s.tracks) {
        if (seen.has(tr.id)) continue;
        seen.add(tr.id);
        flat.push(tr);
      }
    }
    return flat;
  }, [sections]);
  const menu = useWebTrackMenu(tracks);

  return (
    // suppressNativeMenu={false}: у браузера своё меню — на сайте отбирать его
    // целиком нельзя, строки и плитки гасят нативное меню сами.
    <ContextMenuProvider ctx={menu.abilities} apiRef={menu.apiRef} suppressNativeMenu={false}>
      <HomeFeed
        api={getApi()}
        canSearch={Boolean(session)}
        greetName={session?.user.username ?? null}
        currentId={current?.id ?? null}
        playing={playing}
        likes={[...likedIds]}
        onPlayCatalog={(list, id) => {
          const i = list.findIndex((tr) => tr.id === id);
          if (i >= 0) playContext(list, i);
        }}
        onLike={(id) => {
          const tr = tracks.find((x) => x.id === id);
          if (tr) toggle(tr);
        }}
        onCatalogMenu={(tr, e) => menu.openRowMenu(tr, e)}
        onNotify={(text, icon) => notify(text, icon)}
        onOpen={(v) => router.push(`/${v}`)}
        onSections={setSections}
        // Поля несёт панель-зона `.main` (globals.css) — экран свои гасит,
        // иначе отступ сложился бы вдвое.
        padding="0"
      />
      {menu.overlay}
    </ContextMenuProvider>
  );
}
