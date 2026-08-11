import { useEffect, useState } from "react";
import { EmptyState, Icon, TrackRow } from "@muza/ui";
import type { MuzaApi, Track } from "@muza/api-client";
import { fmtTime, primarySourceLabel } from "../lib/format";
import { trackRowL10n } from "../lib/dsLabels";
import { useDrag } from "../shell/DragLayer";
import { useLayout } from "../shell/LayoutContext";
import { useAltFileDrag } from "../platform";
import { useT } from "../i18n";
// Форма пропсов подготовки строки — общая (lib/rowWarm.ts): здесь она была
// объявлена своим RowWarmProps, ещё в четырёх экранах — своими копиями.
import type { WarmRow } from "../lib/rowWarm";

/** «Любимое» — настоящее избранное с сервера (слайс 4, переживает
 *  переустановку). Лайки живут в аккаунте, поэтому у анонима их нет.
 *  Раньше ниже была секция «Из демо-каталога», а App стартовал с
 *  захардкоженным лайком демо-трека — из-за чего честное пустое состояние
 *  не показывалось никогда.
 *
 *  ЭКРАН ОБЩИЙ (волна экранов веб-паритета, 2026-08-02): его рисуют обе
 *  программы — приложение через тонкую обёртку
 *  (apps/desktop/src/views/FavoritesView.tsx), веб — страницей /favorites.
 *  Приложенческие умения приезжают пропами и НЕОБЯЗАТЕЛЬНЫ: прогрев строк
 *  (warmRow) и чтение из последнего снимка при недоступном сервере
 *  (loadFavorites). Нет пропа — экран просто спрашивает сервер напрямую. */
export function FavoritesView({
  api,
  canSearch,
  likes,
  currentId,
  playing,
  onPlayCatalog,
  rowShow,
  onLike,
  onCatalogMenu,
  onNotify,
  loadFavorites,
  warmRow,
}: {
  api: MuzaApi;
  canSearch: boolean;
  likes: string[];
  /** id играющего трека; null — ничего не играет (ни одна строка не активна). */
  currentId: string | null;
  playing: boolean;
  /** Играть серверный трек в контексте избранного (Stage 3, движок). */
  onPlayCatalog: (tracks: Track[], id: string) => void;
  /** Строка трека (настройка «Строка трека»): что показывать. */
  rowShow?: { cover: boolean; duration: boolean; album: boolean; source: boolean };
  onLike: (id: string) => void;
  /** «⋯» на серверном треке: меню Stage 4 (плейлист, версии/источники). */
  onCatalogMenu: (t: Track, e: React.MouseEvent) => void;
  /** Тост (T18: «Трека нет в кэше…» при Alt+drag файла). */
  onNotify: (text: string, icon?: string) => void;
  /** Откуда брать список. Приложение подставляет чтение через последний
   *  снимок (сервер лёг — список всё равно виден); нет пропа — прямой запрос. */
  loadFavorites?: () => Promise<Track[]>;
  /** Готовит трек заранее по наведению; нет умения — строки просто без него. */
  warmRow?: WarmRow;
}) {
  const { t, lang } = useT();
  const { phone } = useLayout();
  const { dragSource } = useDrag();
  const altFileDrag = useAltFileDrag();
  const [server, setServer] = useState<Track[] | null>(null);

  useEffect(() => {
    if (!canSearch) return;
    // Stage 4: сервер лёг — приложение показывает последний снимок списка
    // (loadFavorites); у веба такого умения нет, он спрашивает сервер прямо.
    (loadFavorites ? loadFavorites() : api.getFavorites())
      .then((data) => setServer(data))
      .catch(() => setServer([]));
    // likes меняются лайками в интерфейсе — перечитываем список
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canSearch, likes]);

  const total = server?.length ?? 0;

  return (
    // Поле экрана на телефоне вдвое меньше: 24px с каждой стороны — это 48
    // пикселей из 385 доступных, и уходили они у СТРОКИ ТРЕКА, которой ширины
    // и не хватало. Воздух по краям дешевле текста ровно до тех пор, пока он
    // не начинает его резать.
    <div style={{ display: "flex", flexDirection: "column", gap: phone ? "var(--sp-4)" : "var(--sp-5)", padding: phone ? "var(--sp-4) var(--sp-4) 0" : "var(--sp-6) var(--sp-6) 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
        <Icon name="heart" size={phone ? 22 : 26} color="var(--accent-text)" filled />
        <h1 style={{ margin: 0, fontSize: phone ? "var(--fs-title)" : "var(--fs-h1)", fontWeight: 600, color: "var(--text-1)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t("views.favorites.title")}
        </h1>
        <span style={{ flex: "none", fontSize: phone ? "var(--fs-caption)" : "var(--fs-body)", color: "var(--text-3)", alignSelf: "flex-end", paddingBottom: 4 }}>
          {total > 0 ? t("views.favorites.trackCount", { count: total }) : ""}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", paddingBottom: "var(--sp-6)" }}>
        {(server ?? []).map((tr, i) => (
          // draggable: любимое можно унести в плейлист сайдбара; Alt+drag — файл (T18)
          <div
            key={tr.id}
            draggable
            onDragStart={(e) => {
              // Только Alt: для остального dragSource гасит draggable (native
              // drag убил бы pointer-перенос через pointercancel). Площадка без
              // выноса файла (браузер) вернёт false — и перенос в плейлист
              // отрабатывает как обычно.
              if (altFileDrag(e, (d) => d.exportTrackFile(tr), (m) => onNotify(m, "x"))) return;
              e.preventDefault();
            }}
            {...dragSource({ id: tr.id, title: tr.title, artist: tr.artist, cover: tr.coverUrl, kind: "track" })}
            {...(warmRow ? warmRow(tr.id) : {})}
          >
            <TrackRow
              {...trackRowL10n(t)}
              compact={phone}
              index={i + 1}
              cover={tr.coverUrl}
              showCover={rowShow?.cover !== false}
              title={tr.title}
              artist={tr.artist}
              album={rowShow?.album ? (tr.album ?? undefined) : undefined}
              duration={fmtTime(tr.durationSec)}
              showDuration={rowShow?.duration !== false}
              source={rowShow?.source ? primarySourceLabel(tr.sources, lang) : undefined}
              active={currentId === tr.id}
              playing={currentId === tr.id && playing}
              liked
              onPlay={() => onPlayCatalog(server ?? [], tr.id)}
              onLike={() => onLike(tr.id)}
              onMore={(e: React.MouseEvent) => onCatalogMenu(tr, e)}
            />
          </div>
        ))}

        {/* Аноним: лайки живут в аккаунте, сервера у него нет — говорим прямо.
            Залогиненный с пустым избранным — честное «пока пусто». */}
        {!canSearch ? (
          <EmptyState icon="user" title={t("views.favorites.anon.title")} hint={t("views.favorites.anon.hint")} />
        ) : total === 0 && server !== null ? (
          <EmptyState icon="heart" title={t("views.favorites.emptyTitle")} hint={t("views.favorites.empty")} />
        ) : null}
      </div>
    </div>
  );
}
