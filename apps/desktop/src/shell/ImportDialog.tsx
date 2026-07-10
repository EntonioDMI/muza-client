import { useState } from "react";
import { Button, Dialog, Icon, SearchInput } from "@muza/ui";
import type { ImportReport, MuzaApi } from "@muza/api-client";

/** «Импорт плейлиста» (Stage 4): ссылка на YT/YTM/Spotify/Apple → сервер
 *  матчит позиции в каталог и создаёт плейлист. Показываем честный отчёт:
 *  сколько нашли, что не нашлось (без иллюзии стопроцентного переноса). */
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
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

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
      onNotify(e instanceof Error ? e.message : "Импорт не удался", "x");
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
      title={report ? "Импорт готов" : "Импорт плейлиста"}
      onClose={close}
      actions={
        report ? (
          <Button variant="primary" icon="check" onClick={close}>
            Отлично
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Отмена
            </Button>
            <Button variant="primary" icon="import" disabled={busy || !url.trim()} onClick={() => void submit()}>
              {busy ? "Импортируем…" : "Импортировать"}
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
                нашлось {report.matched} из {report.total}
              </div>
            </div>
          </div>
          {report.unmatched.length > 0 ? (
            <div>
              <div style={{ fontSize: "var(--fs-caption)", fontWeight: 600, color: "var(--text-2)", marginBottom: "var(--sp-2)" }}>
                Не нашлись (можно добавить по ссылке вручную):
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
              Все позиции на месте.
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
          <SearchInput value={url} onChange={setUrl} placeholder="Ссылка на плейлист или альбом" icon="import" autoFocus />
          <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", lineHeight: 1.5 }}>
            YouTube / YouTube Music, Spotify, Apple Music. Плейлист должен быть публичным.
            Треки сопоставляются с каталогом — чего нет, поищем в источниках.
          </div>
          {busy ? (
            <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
              Матчим треки — большие плейлисты занимают до пары минут…
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
