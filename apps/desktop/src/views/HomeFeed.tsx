import { useEffect, useState } from "react";
import { Button, Icon, Shelf, Tile, TrackRow } from "@muza/ui";
import type { HomeSection, MuzaApi, Track } from "@muza/api-client";
import { PLAYLISTS, RELEASES, TRACKS, type DemoTrack } from "../data/demo";
import { withSnapshot } from "../lib/offlineSnapshot";
import { WRAPPED_BANNER_PREVIEW, wrappedSeason } from "../lib/wrappedSeason";
import { fmtTime } from "../lib/format";
import { startTrackDrag } from "../lib/dnd";
import { exportCachedTrack, maybeAltFileDrag } from "../lib/dragOut";
import { useT } from "../i18n";
import type { TParams, TranslationKey } from "../i18n";
import type { View } from "../types";

/** Функция перевода — тип совпадает с useT().t; передаётся параметром в
 *  свободные (module-level) функции без доступа к React-контексту (см.
 *  тот же приём в SettingsView.tsx). */
type T = (key: TranslationKey, params?: TParams) => string;

function greeting(t: T) {
  const h = new Date().getHours();
  if (h < 5) return t("views.home.greeting.night");
  if (h < 12) return t("views.home.greeting.morning");
  if (h < 18) return t("views.home.greeting.day");
  return t("views.home.greeting.evening");
}

/** Плейсхолдер обложки: у части каталожных треков cover_url нет, а Tile
 *  требует картинку (нейтральный градиент в токенах бренда). */
const COVER_FALLBACK =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2a33"/><stop offset="1" stop-color="#17171c"/></linearGradient></defs><rect width="176" height="176" fill="url(#g)"/></svg>`,
  );

/** Порядок секций главной (решение владельца): витрины сверху, «Для тебя»
 *  списком ниже, «Потому что…» после него. Неизвестные ключи — в конец. */
const SECTION_RANK: Record<string, number> = { trending: 0, new: 1, for_you: 2 };
const sectionRank = (key: string): number => SECTION_RANK[key] ?? (key.startsWith("because") ? 3 : 4);

const sectionH2: React.CSSProperties = {
  margin: "0 0 var(--sp-3)",
  fontSize: "var(--fs-title)",
  fontWeight: 700,
  color: "var(--text-1)",
};

/** Главная (Stage 5, T25): при серверной сессии — живая лента рекомендаций
 *  (/home: «Для тебя», «Потому что вы любите X», «В тренде», «Новое»),
 *  «Для тебя» — списком с действиями, остальные — карусели. Демо-полки
 *  Stage 1 показываются ТОЛЬКО анониму (сервер его не знает) и явно
 *  помечены как демо. У залогиненного пустая лента и ошибка загрузки —
 *  честный текст без подмены демо-каталогом (T25: раньше подмена была). */
export function HomeFeed({
  api,
  canSearch,
  greetName,
  currentId,
  playing,
  likes,
  onPlayTrack,
  onPlayCatalog,
  onQueueCatalog,
  onQueueDemo,
  rowShow,
  onLike,
  onTrackMenu,
  onCatalogMenu,
  onNotify,
  onOpen,
  onOpenWrapped,
}: {
  api: MuzaApi;
  /** false у анонима: сервер его не знает, лента недоступна. */
  canSearch: boolean;
  /** Ник для приветствия; null у анонима — просто «Доброе утро». */
  greetName: string | null;
  currentId: string;
  playing: boolean;
  likes: string[];
  onPlayTrack: (id: string) => void;
  /** Играть каталожный трек в контексте секции (очередь = секция). */
  onPlayCatalog: (tracks: Track[], id: string) => void;
  /** Дабл-клик = «в очередь» (настройка); нет — dblclick играет. */
  onQueueCatalog?: (t: Track) => void;
  onQueueDemo?: (id: string) => void;
  /** Строка трека (настройка «Строка трека»): что показывать. */
  rowShow?: { cover: boolean; duration: boolean };
  onLike: (id: string) => void;
  onTrackMenu: (t: DemoTrack, e: React.MouseEvent) => void;
  /** «⋯» на каталожном треке (плейлист/версии/оффлайн/радио). */
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
  /** Тост (T18: «Трека нет в кэше…» при Alt+drag файла). */
  onNotify: (text: string, icon?: string) => void;
  onOpen: (v: View) => void;
  /** Открыть Wrapped «Итоги года» (Stage 7); undefined у анонима. */
  onOpenWrapped?: () => void;
}) {
  const { t } = useT();
  // Честные состояния (UX-доводка): loading / live / offline-копия /
  // сервер недоступен / пустая лента нового аккаунта / демо (аноним)
  const [feed, setFeed] = useState<{
    status: "loading" | "live" | "error" | "demo";
    sections: HomeSection[];
    /** Данные из оффлайн-снапшота — сверху честная плашка. */
    offline: boolean;
  }>(() => (canSearch ? { status: "loading", sections: [], offline: false } : { status: "demo", sections: [], offline: false }));

  const load = () => {
    if (!canSearch) {
      setFeed({ status: "demo", sections: [], offline: false });
      return () => undefined;
    }
    let alive = true;
    setFeed({ status: "loading", sections: [], offline: false });
    withSnapshot("home", () => api.getHome())
      .then(({ data, offline }) => {
        if (alive) setFeed({ status: "live", sections: data, offline });
      })
      .catch(() => {
        // сервер лёг и снапшота нет — говорим прямо, а не притворяемся лентой
        if (alive) setFeed({ status: "error", sections: [], offline: false });
      });
    return () => {
      alive = false;
    };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [api, canSearch]);

  const live = feed.status === "live" && feed.sections.length > 0;
  // сортировка стабильная: внутри группы порядок сервера сохраняется
  const sections = [...feed.sections].sort((a, b) => sectionRank(a.key) - sectionRank(b.key));
  const season = wrappedSeason();
  const wrappedBanner = canSearch && !!onOpenWrapped && (WRAPPED_BANNER_PREVIEW || season.inSeason);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: "var(--fs-greet)",
          letterSpacing: "var(--ls-display)",
          color: "var(--text-1)",
          lineHeight: "var(--lh-tight)",
        }}
      >
        {greetName ? `${greeting(t)}, ${greetName}!` : greeting(t)}
      </h1>

      {feed.offline ? (
        <Notice icon="cloud-off" text={t("views.home.notice.offlineText")} action={t("views.home.notice.refresh")} onAction={load} />
      ) : null}

      {/* Wrapped (Stage 7): баннер-вход в «Итоги года» — сезонно (декабрь
          текущий год, январь прошлый); WRAPPED_BANNER_PREVIEW держит его
          видимым круглый год, пока владелец смотрит результат */}
      {wrappedBanner ? (
        <button
          type="button"
          onClick={onOpenWrapped}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-5)",
            padding: "var(--sp-4) var(--sp-5)",
            border: "none",
            borderRadius: "var(--r-md)",
            background:
              "linear-gradient(120deg, color-mix(in srgb, var(--accent) 26%, var(--surface-1)), var(--surface-1) 70%)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "var(--ls-display)",
              lineHeight: 1,
              color: "var(--accent-text)",
              flex: "none",
            }}
          >
            {season.year}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "var(--fs-body)", fontWeight: 700, color: "var(--text-1)" }}>
              {t("views.home.wrappedBanner.title", { year: season.year })}
            </span>
            <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
              {t("views.home.wrappedBanner.hint")}
            </span>
          </span>
          <Icon name="chevron-right" size={18} color="var(--text-3)" />
        </button>
      ) : null}

      {feed.status === "loading" ? (
        <FeedSkeleton />
      ) : feed.status === "error" ? (
        // T25: честная ошибка без демо-заглушек — залогиненному не подсовываем
        // вымышленный каталог вместо реальной ленты, даже с пометкой.
        <Notice
          icon="server-off"
          text={t("views.home.notice.errorText")}
          action={t("views.home.notice.retry")}
          onAction={load}
        />
      ) : feed.status === "live" && sections.length === 0 ? (
        // T25: реально пустая лента (новый аккаунт без сигнала) — честный
        // текст, а не демо-полки: это не «примеры», это заглушка под чужим видом.
        <Notice
          icon="sparkles"
          text={t("views.home.notice.emptyText")}
          action={t("views.home.notice.openSearch")}
          onAction={() => onOpen("search")}
        />
      ) : null}

      {live ? (
        <>
          {sections.map((s) =>
            s.key === "for_you" ? (
              // «Для тебя» — главный контент: список с лайками и меню
              <div key={s.key}>
                <h2 style={sectionH2}>{s.title}</h2>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {s.tracks.map((tr, i) => (
                    // T18 draggable: drag строки — в плейлист, Alt+drag — файл на рабочий стол
                    <div
                      key={tr.id}
                      draggable
                      onDragStart={(e) => {
                        if (maybeAltFileDrag(e, () => exportCachedTrack(tr.id, tr.artist, tr.title), (m) => onNotify(m, "x")))
                          return;
                        startTrackDrag(e, tr.id, tr.title, tr.artist);
                      }}
                    >
                      <TrackRow
                        index={i + 1}
                        cover={rowShow?.cover === false ? undefined : (tr.coverUrl ?? undefined)}
                        title={tr.title}
                        artist={tr.artist}
                        duration={fmtTime(tr.durationSec)}
                        showDuration={rowShow?.duration !== false}
                        active={currentId === tr.id}
                        playing={currentId === tr.id && playing}
                        liked={likes.includes(tr.id)}
                        onPlay={() => onPlayCatalog(s.tracks, tr.id)}
                        onRowDoubleClick={onQueueCatalog ? () => onQueueCatalog(tr) : undefined}
                        onLike={() => onLike(tr.id)}
                        onMore={(e: React.MouseEvent) => onCatalogMenu(tr, e)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // остальные секции — карусели (T17: ПКМ по плитке = меню «⋯»;
              // T18: плитка тоже draggable — у свежей ленты бывают только карусели)
              <Shelf key={s.key} title={s.title}>
                {s.tracks.map((tr) => (
                  <div
                    key={tr.id}
                    draggable
                    onDragStart={(e) => {
                      if (maybeAltFileDrag(e, () => exportCachedTrack(tr.id, tr.artist, tr.title), (m) => onNotify(m, "x")))
                        return;
                      startTrackDrag(e, tr.id, tr.title, tr.artist);
                    }}
                    style={{ flex: "none" }}
                  >
                    <Tile
                      cover={tr.coverUrl ?? COVER_FALLBACK}
                      title={tr.title}
                      subtitle={tr.artist}
                      playing={currentId === tr.id && playing}
                      onPlay={() => onPlayCatalog(s.tracks, tr.id)}
                      onClick={() => onPlayCatalog(s.tracks, tr.id)}
                      onMenu={(e: React.MouseEvent) => onCatalogMenu(tr, e)}
                    />
                  </div>
                ))}
              </Shelf>
            ),
          )}
          <div style={{ paddingBottom: "var(--sp-6)" }} />
        </>
      ) : feed.status === "demo" ? (
        // T25: демо-каталог показываем только анониму — DemoShelves сама
        // всегда рисует подпись «демо», выдавать его за реальную ленту нельзя.
        <DemoShelves
          currentId={currentId}
          playing={playing}
          likes={likes}
          onPlayTrack={onPlayTrack}
          onQueueDemo={onQueueDemo}
          rowShow={rowShow}
          onLike={onLike}
          onTrackMenu={onTrackMenu}
          onOpen={onOpen}
        />
      ) : null}
    </div>
  );
}

/** Плашка состояния: оффлайн-копия / сервер недоступен / пустая лента. */
function Notice({
  icon,
  text,
  action,
  onAction,
}: {
  icon: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-3) var(--sp-4)",
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
      }}
    >
      <Icon name={icon} size={18} color="var(--text-3)" />
      <span style={{ flex: 1, fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.5 }}>{text}</span>
      {action && onAction ? (
        <Button variant="secondary" onClick={onAction} style={{ flex: "none" }}>
          {action}
        </Button>
      ) : null}
    </div>
  );
}

/** Скелетон ленты: заголовок + ряд плиток, три секции. Без анимации-мерцания
 *  (ДС запрещает свечения) — просто тихие поверхности. */
function FeedSkeleton() {
  const { t } = useT();
  const tile = (
    <div style={{ width: 176, flex: "none" }}>
      <div style={{ width: "100%", aspectRatio: "1", borderRadius: "var(--r-md)", background: "var(--surface-2)" }} />
      <div style={{ height: 12, width: "70%", marginTop: 10, borderRadius: 6, background: "var(--surface-2)" }} />
      <div style={{ height: 10, width: "45%", marginTop: 6, borderRadius: 5, background: "var(--surface-1)" }} />
    </div>
  );
  return (
    <div aria-label={t("views.home.skeletonAria")} role="status" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      {[0, 1, 2].map((s) => (
        <div key={s}>
          <div style={{ height: 16, width: 160, borderRadius: 8, background: "var(--surface-2)", marginBottom: "var(--sp-4)" }} />
          <div style={{ display: "flex", gap: "var(--sp-4)", overflow: "hidden" }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i}>{tile}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Демо-полки Stage 1 (T25: только для анонима — сервер его не знает,
 *  живой ленты быть не может). Подпись рисуется всегда: демо не должно
 *  выглядеть как реальные тренды/рекомендации. */
function DemoShelves({
  currentId,
  playing,
  likes,
  onPlayTrack,
  onQueueDemo,
  rowShow,
  onLike,
  onTrackMenu,
  onOpen,
}: {
  currentId: string;
  playing: boolean;
  likes: string[];
  onPlayTrack: (id: string) => void;
  /** Дабл-клик = «в очередь» (настройка); нет — dblclick играет. */
  onQueueDemo?: (id: string) => void;
  /** Строка трека (настройка «Строка трека»): что показывать. */
  rowShow?: { cover: boolean; duration: boolean };
  onLike: (id: string) => void;
  onTrackMenu: (t: DemoTrack, e: React.MouseEvent) => void;
  onOpen: (v: View) => void;
}) {
  const { t } = useT();
  return (
    <>
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
        {t("views.home.demo.banner")}
      </div>
      <Shelf title={t("views.home.demo.continueListening")}>
        {TRACKS.map((tr) => (
          <Tile
            key={tr.id}
            cover={tr.cover}
            title={tr.title}
            subtitle={tr.artist}
            playing={currentId === tr.id && playing}
            onPlay={() => onPlayTrack(tr.id)}
            onClick={() => onPlayTrack(tr.id)}
            onMenu={(e: React.MouseEvent) => onTrackMenu(tr, e)}
          />
        ))}
      </Shelf>
      <Shelf title={t("views.home.demo.pickedForYou")} action={t("common.showAll")} onAction={() => onOpen("library")}>
        {PLAYLISTS.map((p) => (
          <Tile key={p.id} cover={p.cover} title={p.name} subtitle={p.meta} onPlay={() => onPlayTrack(TRACKS[0].id)} />
        ))}
      </Shelf>
      <Shelf title={t("views.home.demo.newReleases")} action={t("common.showAll")} onAction={() => onOpen("library")}>
        {RELEASES.map((r) => (
          <Tile key={r.id} cover={r.cover} title={r.name} subtitle={r.meta} onPlay={() => onPlayTrack(TRACKS[1].id)} />
        ))}
      </Shelf>
      {/* Простой список под полками — «как библиотека», без тяжёлых плиток */}
      <div style={{ paddingBottom: "var(--sp-6)" }}>
        <h2 style={sectionH2}>{t("views.home.demo.selection")}</h2>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {TRACKS.map((tr, i) => (
            <TrackRow
              key={tr.id}
              index={i + 1}
              cover={rowShow?.cover === false ? undefined : tr.cover}
              title={tr.title}
              artist={tr.artist}
              duration={fmtTime(tr.duration)}
              showDuration={rowShow?.duration !== false}
              explicit={tr.explicit}
              active={currentId === tr.id}
              playing={currentId === tr.id && playing}
              liked={likes.includes(tr.id)}
              onPlay={() => onPlayTrack(tr.id)}
              onRowDoubleClick={onQueueDemo ? () => onQueueDemo(tr.id) : undefined}
              onLike={() => onLike(tr.id)}
              onMore={(e: React.MouseEvent) => onTrackMenu(tr, e)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
