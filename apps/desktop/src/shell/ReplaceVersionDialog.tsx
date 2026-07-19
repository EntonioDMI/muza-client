import { useEffect, useState } from "react";
import { Button, Dialog, Icon, IconButton, Spinner } from "@muza/ui";
import type { MuzaApi, Track, TrackAlternative } from "@muza/api-client";
import { fmtTime, providerLabel } from "../lib/format";
import { useT } from "../i18n";

/** «Заменить версию» (ПКМ по треку в плейлисте/Любимом): подмена трека на
 *  ДРУГУЮ загрузку той же песни — отдельный канонический трек. Не путать с
 *  VersionsDialog: тот выбирает источник ТОГО ЖЕ трека. Кандидатов ранжирует
 *  сервер (GET /tracks/:id/alternatives, скоринг импорта); длительность НЕ
 *  фильтруется — текущая копия сама может быть замедленной, решает человек
 *  по Δ-бейджу и прослушке. Прослушка играет через ОСНОВНОЙ плеер и замещает
 *  очередь — осознанное решение владельца (2026-07-18). */

/** Где живёт заменяемый трек. У Любимого позиции сохраняет сервер (createdAt
 *  наследуется), у плейлиста — position; после замены родитель перечитывает
 *  список сам (reload / setLikes в App). */
export type ReplaceTarget =
  | { kind: "playlist"; playlistId: string; reload: () => void }
  | { kind: "favorites" };

export interface ReplaceCtx {
  track: Track;
  target: ReplaceTarget;
}

export function ReplaceVersionDialog({
  api,
  ctx,
  onClose,
  onNotify,
  onPlayCatalog,
  currentId,
  playing,
  onReplaced,
}: {
  api: MuzaApi;
  /** null — диалог закрыт. */
  ctx: ReplaceCtx | null;
  onClose: () => void;
  onNotify: (text: string, icon?: string) => void;
  /** Прослушка кандидата через основной плеер (повторный клик — пауза). */
  onPlayCatalog: (tracks: Track[], id: string) => void;
  /** id и статус трека в плеере — для иконки play/pause у прослушки. */
  currentId: string | null;
  playing: boolean;
  onReplaced: (oldId: string, newTrack: Track) => void;
}) {
  const { t, lang } = useT();
  const [alternatives, setAlternatives] = useState<TrackAlternative[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setAlternatives(null);
    setError(null);
    setBusyId(null);
    if (!ctx) return;
    api
      .getTrackAlternatives(ctx.track.id)
      .then(setAlternatives)
      .catch((e) => setError(e instanceof Error ? e.message : t("dialogs.replaceVersion.loadFailed")));
  }, [api, ctx, t]);

  const replaceWith = async (alt: TrackAlternative) => {
    if (!ctx || busyId) return;
    setBusyId(alt.track.id);
    try {
      if (ctx.target.kind === "playlist") {
        await api.replacePlaylistTrack(ctx.target.playlistId, ctx.track.id, alt.track.id);
        onNotify(t("toast.playlist.versionReplaced"), "check");
      } else {
        await api.replaceFavorite(ctx.track.id, alt.track.id);
        onNotify(t("toast.favorites.versionReplaced"), "check");
      }
      onReplaced(ctx.track.id, alt.track);
      onClose();
    } catch (e) {
      // Диалог не закрываем: пусть человек выберет другого кандидата
      onNotify(e instanceof Error ? e.message : t("dialogs.replaceVersion.replaceFailed"), "x");
      setBusyId(null);
    }
  };

  return (
    <Dialog
      open={ctx !== null}
      title={ctx ? t("dialogs.replaceVersion.titleWithTrack", { title: ctx.track.title }) : t("menu.catalog.replaceVersion")}
      onClose={onClose}
      width={520}
      actions={
        <Button variant="ghost" onClick={onClose}>
          {t("dialogs.close")}
        </Button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 400 }}>
        {error ? <div style={{ color: "var(--danger)", fontSize: "var(--fs-body)" }}>{error}</div> : null}
        {alternatives === null && !error ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-2) 0" }}>
            <Spinner size={20} />
            <span style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
              {t("dialogs.replaceVersion.loading")}
              <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
                {t("dialogs.replaceVersion.loadingHint")}
              </span>
            </span>
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-2)",
            maxHeight: "min(52vh, 460px)",
            overflowY: "auto",
            // Полосу красит глобальное правило ДС (base.css, ::-webkit-scrollbar).
            // overflow-y:auto превращает overflow-x из visible в auto — прячем
            // горизонтальную полосу явно.
            overflowX: "hidden",
            paddingRight: 2,
          }}
        >
          {(alternatives ?? []).map((alt) => {
            const tr = alt.track;
            const delta = ctx ? Math.round(tr.durationSec - ctx.track.durationSec) : 0;
            const previewing = currentId === tr.id;
            const meta = [tr.sources.map((p) => providerLabel(p, lang)).join(" + "), fmtTime(tr.durationSec)]
              .filter(Boolean)
              .join(" · ");
            return (
              // Строка — div c ДВУМЯ соседними кнопками (выбор + прослушка):
              // button-в-button — невалидный HTML, клики бы путались
              <div
                key={tr.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-2)",
                  padding: "var(--sp-2) var(--sp-3)",
                  borderRadius: "var(--r-md)",
                  // transparent, не токен: --stroke-1 из VersionsDialog — фантом
                  // (нигде не определён, рамка не рисовалась); прозрачная рамка
                  // держит размер строки равным matched-строке с рамкой акцента
                  border: alt.matched ? "1px solid var(--accent)" : "1px solid transparent",
                }}
              >
                <button
                  type="button"
                  onClick={() => void replaceWith(alt)}
                  disabled={busyId !== null}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-3)",
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    color: "var(--text-1)",
                    cursor: busyId ? "wait" : "pointer",
                    textAlign: "left",
                    font: "inherit",
                  }}
                >
                {tr.coverUrl ? (
                  <img
                    src={tr.coverUrl}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: "var(--r-sm)", objectFit: "cover", flexShrink: 0 }}
                  />
                ) : (
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "var(--r-sm)",
                      background: "var(--surface-2)",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="music" size={18} color="var(--text-3)" />
                  </span>
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: "var(--fs-body)",
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tr.title}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "var(--fs-caption)",
                      color: "var(--text-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tr.artist} · {meta}
                    {delta !== 0 ? (
                      <span style={{ color: "var(--text-2)", fontWeight: 600 }}>
                        {" "}({delta > 0 ? "+" : "−"}{Math.abs(delta)} {t("dialogs.replaceVersion.secondsShort")})
                      </span>
                    ) : null}
                  </span>
                  {alt.matched ? (
                    <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--accent-text)" }}>
                      {t("dialogs.replaceVersion.matched")}
                    </span>
                  ) : null}
                </span>
                </button>
                <IconButton
                  icon={previewing && playing ? "pause" : "play"}
                  size="sm"
                  label={t("dialogs.replaceVersion.preview")}
                  onClick={() => onPlayCatalog([tr], tr.id)}
                />
              </div>
            );
          })}
        </div>
        {alternatives !== null && alternatives.length === 0 ? (
          <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)" }}>{t("dialogs.replaceVersion.empty")}</div>
        ) : null}
        {alternatives !== null && alternatives.length > 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", lineHeight: 1.5, marginTop: "var(--sp-1)" }}>
            {t("dialogs.replaceVersion.footerHint")}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
