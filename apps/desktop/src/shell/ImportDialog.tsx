import { useEffect, useState } from "react";
import { Button, Dialog, Icon, SearchInput } from "@muza/ui";
import type { ImportPreview, ImportReport, MuzaApi } from "@muza/api-client";
import { useT } from "../i18n";

/** Пауза после ввода перед походом за превью: каждый вызов — запрос к серверу,
 *  а тот идёт на страницу Spotify. По нажатию клавиши так ходить нельзя. */
const PREVIEW_DEBOUNCE_MS = 500;

/** Ссылка ли это вообще. Дописывают её посимвольно, и пока получается не
 *  ссылка — сервер будить незачем. Что за источник и стоит ли его смотреть,
 *  решает сервер: по ВИДУ ссылки владельца плейлиста всё равно не узнать. */
function looksLikeUrl(value: string): boolean {
  try {
    // Только https: импорт-ссылки Spotify/YouTube/Apple всегда https, а голый
    // литерал "http:" в бандле роняет release-gate (artifacts scan) — да и
    // принимать незащищённые URL незачем. Регэксп `https?:` не содержит
    // подстроки "http:" целиком, но нам http и не нужен — сверяем ровно https.
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** «Импорт плейлиста» (Stage 4): ссылка на YT/YTM/Spotify/Apple → сервер
 *  матчит позиции в каталог и создаёт плейлист. Показываем честный отчёт:
 *  сколько нашли, что не нашлось (без иллюзии стопроцентного переноса).
 *
 *  На вставку ссылки подтягиваем превью (см. previewImport): название, число
 *  позиций и — главное — может ли плейлист подстраиваться под слушателя. Такие
 *  плейлисты импортируются в общей версии, и без этой плашки расхождение
 *  выглядит как баг: 15.07 владелец потерял на нём полдня. Сказать надо ДО
 *  импорта — после человек уже получил «не тот» список.
 *
 *  Превью НИЧЕГО не блокирует: не ответило — просто не рисуем. */
export function ImportDialog({
  api,
  open,
  onClose,
  onImported,
  onNotify,
}: {
  api: MuzaApi;
  open: boolean;
  onClose: () => void;
  /** Плейлист создан: App обновляет сайдбар/открывает его. */
  onImported: (report: ImportReport) => void;
  onNotify: (text: string, icon?: string) => void;
}) {
  const { t } = useT();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  useEffect(() => {
    const value = url.trim();
    setPreview(null); // ссылку меняют — прошлое превью уже не про неё
    if (!looksLikeUrl(value)) return;
    let alive = true;
    const timer = setTimeout(() => {
      void api
        .previewImport(value)
        .then((p) => {
          if (alive && p.previewable) setPreview(p);
        })
        .catch(() => {
          // Превью — любезность, а не этап импорта: отказом не отвлекаем.
          // Если дело в самой ссылке, человек узнает об этом при импорте —
          // там ошибка уместна и с ней есть что делать.
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url, api]);

  const submit = async () => {
    const value = url.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const out = await api.importPlaylist(value);
      setUrl("");
      setReport(out);
      onImported(out);
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("dialogs.importPlaylist.failed"), "x");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setReport(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={report ? t("dialogs.importPlaylist.titleDone") : t("dialogs.importPlaylist.title")}
      onClose={close}
      actions={
        report ? (
          <Button variant="primary" icon="check" onClick={close}>
            {t("dialogs.importPlaylist.great")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="import" disabled={busy || !url.trim()} onClick={() => void submit()}>
              {busy ? t("dialogs.importPlaylist.importing") : t("dialogs.importPlaylist.import")}
            </Button>
          </>
        )
      }
    >
      {report ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 380, maxWidth: 460 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <Icon name="list-music" size={22} color="var(--accent-text)" />
            <div>
              <div style={{ fontSize: "var(--fs-body)", fontWeight: 700, color: "var(--text-1)" }}>
                «{report.playlist.name}»
              </div>
              <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
                {t("dialogs.importPlaylist.foundCount", { matched: report.matched, total: report.total })}
              </div>
            </div>
          </div>
          {report.unmatched.length > 0 ? (
            <div>
              <div style={{ fontSize: "var(--fs-caption)", fontWeight: 600, color: "var(--text-2)", marginBottom: "var(--sp-2)" }}>
                {t("dialogs.importPlaylist.notFoundLabel")}
              </div>
              <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {report.unmatched.map((u, i) => (
                  <div key={i} style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
                    {u.artist} — {u.title}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              {t("dialogs.importPlaylist.allFound")}
            </div>
          )}
        </div>
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 380 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        >
          <SearchInput value={url} onChange={setUrl} placeholder={t("dialogs.importPlaylist.urlPlaceholder")} icon="import" autoFocus />
          {preview?.name ? (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", minWidth: 0 }}>
              <Icon name="list-music" size={16} color="var(--accent-text)" />
              <span
                style={{
                  fontSize: "var(--fs-caption)",
                  fontWeight: 600,
                  color: "var(--text-1)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {preview.name}
              </span>
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", flex: "none" }}>
                {t("dialogs.importPlaylist.preview.trackCount", { count: preview.trackCount })}
              </span>
            </div>
          ) : null}
          {preview?.mayBePersonalized ? (
            // Спокойная плашка, не тревога: импорт исправен и идёт как шёл, а
            // человеку просто стоит знать, что он получит. Поэтому surface-3 и
            // text-2, а не акцент/danger — это сообщение, а не ошибка.
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "var(--sp-2)",
                padding: "var(--sp-2) var(--sp-3)",
                borderRadius: "var(--r-md)",
                background: "var(--surface-3)",
                color: "var(--text-2)",
                fontSize: "var(--fs-caption)",
                lineHeight: 1.5,
              }}
            >
              <Icon name="info" size={16} color="var(--text-3)" style={{ marginTop: 2 }} />
              <span>{t("dialogs.importPlaylist.preview.personalized")}</span>
            </div>
          ) : null}
          <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", lineHeight: 1.5 }}>
            {t("dialogs.importPlaylist.hint")}
          </div>
          {busy ? (
            <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
              {t("dialogs.importPlaylist.matching")}
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
