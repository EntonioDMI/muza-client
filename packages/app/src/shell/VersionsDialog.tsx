import { useEffect, useState } from "react";
import { Button, Dialog, Icon } from "@muza/ui";
import type { MuzaApi, Track, TrackSource } from "@muza/api-client";
import { fmtTime, providerLabel } from "../lib/format";
import { usePlatform } from "../platform";
import { useT } from "../i18n";

/** Разворот «Версии и источники» (Stage 4): опциональный выбор конкретного
 *  источника канонического трека. Выбор запоминается per-user на сервере
 *  (UserTrackSource) и не перебивается авто-матчингом; смена выбора заставляет
 *  устройство забыть подготовленное для трека — иначе продолжит играть старый
 *  файл.
 *
 *  ⚠️ ПЕРЕЕХАЛО из apps/desktop/src/shell/VersionsDialog.tsx (волна экранов
 *  веб-паритета, 2026-08-02). Оба десктопных касания — файл трека в
 *  приложении и разобранные источники в памяти плеера — сведены в ОДИН порт
 *  розетки, preparedTracks.forget(trackId): у обоих одна причина («версия
 *  сменилась — подготовленное больше не про неё») и одно место вызова.
 *  Браузер заранее ничего не готовит, порта у него нет — шаг пропускается. */

// Имена провайдеров — из lib/format.ts (providerLabel, единый источник с
// бейджем в поиске); вид источника (kind) переводится локальным kindLabel(t).
const PROVIDER_ICON: Record<string, string> = {
  youtube: "play",
  soundcloud: "cloud",
  bandcamp: "disc-3",
  local: "hard-drive",
};

export function VersionsDialog({
  api,
  track,
  onClose,
  onNotify,
}: {
  api: MuzaApi;
  /** null — диалог закрыт. */
  track: Track | null;
  onClose: () => void;
  onNotify: (text: string, icon?: string) => void;
}) {
  const { t, lang } = useT();
  const prepared = usePlatform().preparedTracks;
  const [sources, setSources] = useState<TrackSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const kindLabel = (kind: string) =>
    kind === "direct" ? t("dialogs.versions.kindDirect") : kind === "local" ? t("dialogs.versions.kindLocal") : kind;

  useEffect(() => {
    setSources(null);
    setError(null);
    if (!track) return;
    api
      .getTrackSources(track.id)
      .then(setSources)
      .catch((e) => setError(e instanceof Error ? e.message : t("dialogs.versions.loadFailed")));
  }, [api, track]);

  const chosen = sources?.find((s) => s.isChosen) ?? null;

  const choose = async (s: TrackSource) => {
    if (!track || busyId) return;
    setBusyId(s.id);
    try {
      await api.chooseTrackSource(track.id, s.id);
      await prepared?.forget(track.id); // подготовленное — от прежней версии
      setSources((list) => (list ?? []).map((x) => ({ ...x, isChosen: x.id === s.id })));
      onNotify(t("dialogs.versions.nowPlaying", { provider: providerLabel(s.provider, lang) }), "check");
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("dialogs.versions.chooseFailed"), "x");
    } finally {
      setBusyId(null);
    }
  };

  const reset = async () => {
    if (!track || busyId) return;
    setBusyId("reset");
    try {
      await api.resetTrackSource(track.id);
      await prepared?.forget(track.id); // сброс выбора тоже меняет порядок источников
      setSources((list) => (list ?? []).map((x) => ({ ...x, isChosen: false })));
      onNotify(t("dialogs.versions.resetDone"), "check");
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("dialogs.versions.resetFailed"), "x");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog
      open={track !== null}
      title={track ? t("dialogs.versions.titleWithTrack", { title: track.title }) : t("menu.catalog.versions")}
      icon="git-branch"
      closeLabel={t("dialogs.close")}
      onClose={onClose}
      actions={
        <>
          {chosen ? (
            <Button variant="ghost" icon="rotate-ccw" onClick={() => void reset()}>
              {t("dialogs.versions.resetChoice")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("dialogs.close")}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", minWidth: 360 }}>
        {error ? <div style={{ color: "var(--danger)", fontSize: "var(--fs-body)" }}>{error}</div> : null}
        {sources === null && !error ? (
          <div style={{ color: "var(--text-3)", fontSize: "var(--fs-body)" }}>{t("dialogs.versions.loading")}</div>
        ) : null}
        {/* Список источников скроллится при большом числе; полосу красит глобальное
            правило ДС (base.css, ::-webkit-scrollbar). overflowX:hidden — без горизонтальной. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-2)",
            maxHeight: "min(52vh, 460px)",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 2,
          }}
        >
          {(sources ?? []).map((s) => {
          const meta = [
            kindLabel(s.kind),
            s.durationSec ? fmtTime(s.durationSec) : null,
            s.provider === "local" ? null : t("dialogs.versions.priority", { n: s.priority }),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={s.id || `${s.provider}:${s.sourceId}`}
              type="button"
              onClick={() => void choose(s)}
              disabled={busyId !== null}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-3)",
                padding: "var(--sp-3)",
                borderRadius: "var(--r-md)",
                border: s.isChosen ? "1px solid var(--accent)" : "1px solid var(--stroke-1)",
                background: s.isChosen ? "var(--accent-soft)" : "transparent",
                color: "var(--text-1)",
                cursor: busyId ? "wait" : "pointer",
                textAlign: "left",
                font: "inherit",
              }}
            >
              <Icon
                name={PROVIDER_ICON[s.provider] ?? "music"}
                size={18}
                color={s.isChosen ? "var(--accent-text)" : "var(--text-2)"}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "var(--fs-body)", fontWeight: 400 }}>
                  {providerLabel(s.provider, lang)}
                </span>
                <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
                  {meta || s.sourceId}
                </span>
              </span>
              {s.isChosen ? <Icon name="check" size={16} color="var(--accent-text)" /> : null}
            </button>
          );
        })}
        </div>
        {sources !== null && sources.length === 0 ? (
          <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)" }}>
            {t("dialogs.versions.noSources")}
          </div>
        ) : null}
        <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", lineHeight: 1.5, marginTop: "var(--sp-1)" }}>
          {t("dialogs.versions.footerHint")}
        </div>
      </div>
    </Dialog>
  );
}
