import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, Cover, EmptyState, Icon, SearchInput, Spinner } from "@muza/ui";
import type { MuzaApi, TasteArtist } from "@muza/api-client";
import { useT } from "../i18n";
import { useLayout } from "../shell/LayoutContext";

/**
 * «Что ты слушаешь?» — вкус, названный НА ВХОДЕ (холодный старт, план H7).
 *
 * Зачем экран вообще: все сигналы рекомендаций Музы выводятся из прослушиваний
 * (топ-артисты, совстречаемость, теги прослушанного). У нового человека их
 * ноль, поэтому лента ему честно молчит, пока он не наслушает. Замер
 * собственного онбординга Spotify даёт цену молчания цифрой: без сигналов,
 * собранных на входе, качество на соответствующих кластерах ниже на 13.8%.
 *
 * ФОРМА ЭКРАНА ВЫБРАНА ПО ЧУЖИМ ЗАМЕРАМ, А НЕ ПО ВКУСУ. Пять решений и их
 * основания — их и стоит защищать при правках:
 *
 * 1. ЖАНРЫ И АРТИСТЫ ВМЕСТЕ, НА ОДНОМ ЭКРАНЕ. Разбор elicitation для холодного
 *    старта (Gharahighehi et al., 2025) прямо показывает: набор «предмет +
 *    признак» (артисты + жанры) работает лучше, чем одни артисты, ИМЕННО НА
 *    ПЕРВЫХ шагах — то есть ровно в нашем случае. А в один экран, а не в мастер
 *    из двух шагов, потому что разбиение на шаги перекладывает нагрузку, а не
 *    снимает её: год экспериментов на четырёх продуктах дал ОТРИЦАТЕЛЬНЫЙ
 *    результат у трёх, разбивших форму на «более простые» экраны.
 *
 * 2. ПОРЯДОК АРТИСТОВ — ЗНАКОМОСТЬ + ОХВАТ, и он приходит с сервера
 *    (taste.service.ts, там же основания). Экран его НЕ ПЕРЕСОРТИРОВЫВАЕТ.
 *
 * 3. ЖАНР — ЭТО ФИЛЬТР СЕТКИ, А НЕ ОТДЕЛЬНЫЙ ШАГ. Отметил «фонк» — сетка
 *    отвечает фонком. Это наш дешёвый аналог того, что у Spotify называют
 *    «динамическими подсказками» (выбрал артиста — рядом появились похожие) и
 *    что разборы их онбординга называют главной находкой экрана. Похожести по
 *    эмбеддингам у нас нет, а жанр есть — и он честно объясним.
 *
 * 4. МИНИМУМА ОТМЕТОК НЕТ, «Готово» доступно всегда, рядом «Пропустить».
 *    Конкурентный анализ музыкальных приложений (2024) прямо называет
 *    обязательные три артиста ошибкой: людям, которым нечего отметить, проще
 *    закрыть приложение, чем экран.
 *
 * 5. ПОИСК ОБЯЗАТЕЛЕН. Самая частая жалоба на экран Spotify — «моего артиста
 *    тут нет, а руками искать бесконечно» (их же форум). Поиск ходит ТОЛЬКО в
 *    каталог Музы — человек ещё ничего не включил, платить за него сетью
 *    внешних источников нечестно.
 *
 * ⚠️ ПЛИТКА ЗДЕСЬ СВОЯ, А НЕ <Tile> ИЗ ДИЗАЙН-СИСТЕМЫ, И ЭТО НАМЕРЕННО. Tile
 * всегда рисует play-пилюлю (Tile.jsx: она под opacity, а не под условием), а
 * на экране выбора играть нечего — кнопка обещала бы действие, которого нет.
 * Обложка при этом взята у ДС (<Cover>): у неё живёт кроп 4:3-тумб ytimg,
 * который своей вёрсткой пришлось бы повторять.
 */

/** Сколько плиток просить у сервера сразу и на сколько растить по «Показать
 *  ещё». Первый экран — это те 3-4 ряда, которые решают, отметит человек
 *  кого-то или закроет; остальное приезжает по требованию (у Spotify это
 *  называют «полубесконечным запасом» и считают удачей экрана). */
const PAGE = 36;
const PAGE_STEP = 24;
/** Потолок сервера (TasteOptionsQueryDto.limit ≤ 100) — просить больше
 *  бессмысленно, кнопка «Показать ещё» на этом гаснет. */
const PAGE_MAX = 100;

/** Пауза перед запросом на набранное в поиске: экран живёт и на телефоне, а
 *  запрос ходит в каталог. 250 мс — обычная для проекта величина «человек
 *  дописал слово». */
const SEARCH_DEBOUNCE_MS = 250;

export function TasteOnboardingView({
  api,
  onDone,
  onNotify,
}: {
  api: MuzaApi;
  /** Экран закрыт: `saved` — человек сохранил выбор, иначе прошёл мимо.
   *  Показывать его снова не нужно ни в том, ни в другом случае — сервер
   *  запомнил обе развилки (флаг skipped). */
  onDone: (saved: boolean) => void;
  /** Тост об отказе сохранения; нет пропа — экран молчит и остаётся открытым. */
  onNotify?: (text: string, icon?: string) => void;
}) {
  const { t } = useT();
  const { phone } = useLayout();

  const [artists, setArtists] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Ключ локальный, а не из QK: экран самодостаточен и ни с кем этот запрос не
  // делит — разъехаться тут нечему.
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["taste-options", [...tags].sort().join(","), debounced, limit],
    queryFn: () => api.getTasteOptions({ tags, query: debounced || undefined, limit }),
    // Отказ НЕ роняет экран: он не обязателен, и упирать человека в стену на
    // первом же шаге нельзя. Но и молчать нельзя — см. `isError` ниже.
    throwOnError: false,
    staleTime: 5 * 60_000,
  });

  // Жанры показываем из ПЕРВОГО удачного ответа и больше не мигаем ими: они не
  // зависят ни от поиска, ни от отметок, а исчезающий на время запроса ряд
  // чипов читается как «сломалось».
  const [genres, setGenres] = useState<{ slug: string; label: string }[]>([]);
  useEffect(() => {
    if (data && data.genres.length > 0 && genres.length === 0) setGenres(data.genres);
  }, [data, genres.length]);

  const shown: TasteArtist[] = data?.artists ?? [];

  /** Отмеченные, но выпавшие из текущей выдачи (сузили жанр, ушли в поиск),
   *  дорисовываются первыми. Иначе отметка исчезает с глаз, и человек делает
   *  единственный разумный вывод — «не засчиталось». */
  const grid = useMemo(() => {
    const visible = new Set(shown.map((a) => a.name));
    const missing = artists.filter((name) => !visible.has(name)).map((name) => ({ name, genre: null, cover: null }));
    return [...missing, ...shown];
  }, [shown, artists]);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function finish(skipped: boolean) {
    setSaving(true);
    try {
      const out = await api.putTasteSeed({ artists, tags, skipped });
      // false = ручки на сервере нет (он старее приложения). Прятать экран всё
      // равно правильно: держать человека на шаге, который некуда сохранить,
      // хуже, чем тихо пропустить его.
      onDone(out !== false && !skipped);
    } catch {
      onNotify?.(t("views.taste.saveFailed"), "x");
      setSaving(false);
    }
  }

  const pad = phone ? "var(--sp-4)" : "var(--sp-6)";
  /** ⚠️ Отказ сервера — ТРЕТИЙ случай, и раньше он молча сливался с «в каталоге
   *  пусто»: `throwOnError:false` отдавал `data === undefined`, сетка выходила
   *  пустой, и человеку на ПЕРВОМ экране показывали текст «каталог наполняется,
   *  пропусти этот шаг» — то есть врали о причине и уговаривали уйти. */
  const empty = !isPending && !isError && grid.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `${pad} ${pad} var(--sp-6)` }}>
        <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <h1
              style={{
                margin: 0,
                fontSize: phone ? "var(--fs-title)" : "var(--fs-h1)",
                fontWeight: 600,
                color: "var(--text-1)",
              }}
            >
              {t("views.taste.title")}
            </h1>
            {/* Подсказка отвечает на «что произойдёт», а не «как устроено»: про
                сигналы и рекомендательные слои человеку тут знать нечего. */}
            <p style={{ margin: 0, maxWidth: 620, fontSize: "var(--fs-body)", color: "var(--text-3)", lineHeight: "var(--lh-text)" }}>
              {t("views.taste.hint")}
            </p>
          </div>

          {genres.length > 0 ? (
            <section style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              <h2 style={{ margin: 0, fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-2)" }}>
                {t("views.taste.genresTitle")}
              </h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
                {genres.map((g) => (
                  <Chip
                    key={g.slug}
                    selected={tags.includes(g.slug)}
                    onClick={() => {
                      setTags((prev) => toggle(prev, g.slug));
                      // Сузили жанр — сетка начинается сначала: держать
                      // разросшийся limit значило бы отдать человеку три экрана
                      // фонка там, где он ждёт первый ряд.
                      setLimit(PAGE);
                    }}
                  >
                    {g.label}
                  </Chip>
                ))}
              </div>
            </section>
          ) : null}

          <section style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-2)" }}>
                {t("views.taste.artistsTitle")}
              </h2>
              {tags.length > 0 && debounced === "" ? (
                <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
                  {t("views.taste.artistsFiltered")}
                </span>
              ) : null}
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={t("views.taste.searchPlaceholder")}
                style={{ marginLeft: "auto", maxWidth: phone ? "100%" : 280, flex: phone ? "1 1 100%" : undefined }}
              />
            </div>

            {isError ? (
              <EmptyState
                icon="cloud-off"
                title={t("views.taste.failedTitle")}
                hint={t("views.taste.failedHint")}
                action={
                  <Button variant="secondary" icon="rotate-cw" onClick={() => void refetch()}>
                    {t("common.retry")}
                  </Button>
                }
              />
            ) : empty ? (
              // Две РАЗНЫЕ пустоты, и путать их нельзя: «не нашлось по запросу»
              // лечится другим запросом, «в каталоге пока пусто» — не лечится
              // вовсе, и честнее отпустить человека дальше.
              <EmptyState
                icon={debounced === "" ? "music-2" : "search"}
                title={debounced === "" ? t("views.taste.emptyCatalogTitle") : t("views.taste.emptyTitle")}
                hint={debounced === "" ? t("views.taste.emptyCatalogHint") : t("views.taste.emptyHint")}
              />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(auto-fill, minmax(${phone ? 104 : 132}px, 1fr))`,
                  gap: phone ? "var(--sp-3)" : "var(--sp-4)",
                }}
              >
                {grid.map((a) => (
                  <ArtistPick
                    key={a.name}
                    artist={a}
                    selected={artists.includes(a.name)}
                    onToggle={() => setArtists((prev) => toggle(prev, a.name))}
                  />
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "center", minHeight: 40, alignItems: "center" }}>
              {isPending ? (
                <Spinner label={t("views.taste.loadingAria")} />
              ) : !empty && debounced === "" && limit < PAGE_MAX && shown.length >= limit ? (
                // Кнопка живёт, только пока сервер отдаёт полную страницу:
                // иначе она обещала бы ещё артистов там, где их больше нет.
                <Button variant="ghost" onClick={() => setLimit((n) => Math.min(n + PAGE_STEP, PAGE_MAX))}>
                  {t("views.taste.more")}
                </Button>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      {/* Подвал прибит к низу: «Готово» обязано быть видно, не долистывая сетку
          до конца — иначе экран читается как обязательный. */}
      <div
        style={{
          flex: "none",
          borderTop: "1px solid var(--border-1)",
          background: "var(--surface-1)",
          padding: phone ? "var(--sp-3) var(--sp-4)" : "var(--sp-4) var(--sp-6)",
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
          }}
        >
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", minWidth: 0 }}>
            {t("views.taste.chosen", { count: artists.length + tags.length })}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)" }}>
            <Button variant="ghost" disabled={saving} onClick={() => void finish(true)}>
              {t("views.taste.skip")}
            </Button>
            {/* Всегда доступна, даже с пустым выбором: экран не барьер. */}
            <Button variant="primary" disabled={saving} onClick={() => void finish(false)}>
              {saving ? t("views.taste.saving") : t("views.taste.done")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Спрашивать ли вкус у ЭТОГО человека. Вынесено сюда, чтобы вызывающий код
 * оставался одной строкой и чтобы правило «когда показывать» не расползлось по
 * приложению копиями. Подключение:
 *
 *     const taste = useTasteGate(api, canSearch);
 *     {taste.ask ? <TasteOnboardingView api={api} onDone={taste.dismiss} onNotify={notify} /> : null}
 *
 * `dismiss` закрывает экран на эту сессию; чтобы он не вернулся после
 * перезапуска, ответ уже сохранён сервером — своими руками ничего помнить
 * не нужно.
 *
 * ⚠️ ТРИ РАЗНЫХ «НЕТ», и все три — не ошибка:
 *  - `enabled=false` (анонимный аккаунт): сохранять выбор некуда, аккаунт живёт
 *    только на устройстве;
 *  - `supported:false` (сервер старее приложения): ручки ещё нет. Показать
 *    экран и потерять выбор — худшее из первых впечатлений;
 *  - `seed !== null`: экран уже был. Неважно, отметил человек что-то или прошёл
 *    мимо — второй раз не спрашиваем (флаг skipped на сервере ровно для этого).
 */
export function useTasteGate(api: MuzaApi, enabled: boolean): { ask: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery({
    queryKey: ["taste-seed"],
    queryFn: () => api.getTasteSeed(),
    enabled,
    // Отказ = не спрашиваем: экран не настолько важен, чтобы городить повторы
    // на пути человека, который только что вошёл.
    throwOnError: false,
    staleTime: Infinity,
  });
  return {
    ask: !dismissed && data?.supported === true && data.seed === null,
    dismiss: () => setDismissed(true),
  };
}

/** Плитка артиста: обложка ДС + имя + галочка отметки. Кнопка целиком —
 *  «частое в один клик»: попасть надо в плитку, а не в маленький чекбокс. */
function ArtistPick({
  artist,
  selected,
  onToggle,
}: {
  artist: TasteArtist;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      aria-label={artist.name}
      className="muza-press"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        padding: "var(--sp-2)",
        border: "none",
        borderRadius: "var(--r-md)",
        background: selected ? "var(--surface-4)" : "transparent",
        cursor: "pointer",
        textAlign: "left",
        minWidth: 0,
        transition: "background var(--dur-state) var(--ease-standard)",
      }}
    >
      <div style={{ position: "relative" }}>
        {/* Круглая обложка — так артист отличается от альбома и плейлиста,
            которые в Музе везде квадратные. */}
        <Cover src={artist.cover} radius="var(--r-pill)" />
        {selected ? (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 4,
              bottom: 4,
              width: 26,
              height: 26,
              borderRadius: "var(--r-pill)",
              background: "var(--accent)",
              display: "grid",
              placeItems: "center",
              color: "var(--text-1)",
              // Обводка цветом плитки: галочка не сливается со светлой обложкой.
              boxShadow: "0 0 0 2px var(--surface-1)",
            }}
          >
            <Icon name="check" size={16} color="currentColor" />
          </span>
        ) : null}
      </div>
      <span
        style={{
          fontSize: "var(--fs-caption)",
          color: selected ? "var(--text-1)" : "var(--text-2)",
          lineHeight: "var(--lh-ui)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {artist.name}
      </span>
    </button>
  );
}
