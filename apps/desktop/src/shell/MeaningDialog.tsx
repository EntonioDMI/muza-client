import { Dialog, Icon, IconButton } from "@muza/ui";
import type { Annotation } from "@muza/api-client";
import type { LyricLine } from "../player/types";
import { openExternal } from "../lib/system";
import { useT } from "../i18n";

export function MeaningDialog({
  open,
  line,
  annotation,
  geniusUrl,
  onClose,
}: {
  open: boolean;
  line: LyricLine | null;
  annotation?: Annotation;
  geniusUrl?: string | null;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog
      open={open && Boolean(line)}
      title={t("dialogs.meaning.title")}
      width={560}
      onClose={onClose}
      headerAction={<IconButton icon="x" size="sm" label={t("dialogs.close")} onClick={onClose} />}
    >
      {line ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <div
            style={{
              display: "flex",
              gap: "var(--sp-3)",
              padding: "var(--sp-4)",
              borderRadius: "var(--r-md)",
              background: "var(--accent-soft)",
              color: "var(--accent-text)",
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          >
            <Icon name="sparkles" size={18} color="currentColor" style={{ flex: "none", marginTop: 2 }} />
            <span>«{line.text}»</span>
          </div>
          {/* overflowWrap обязателен: до него длинный URL внутри объяснения
              распирал диалог и добавлял ГОРИЗОНТАЛЬНЫЙ скролл (overflowY:auto
              делает overflowX тоже auto). Сами URL картинок сервер теперь из
              текста вычищает, но в аннотации может стоять любая длинная ссылка. */}
          <div
            style={{
              color: "var(--text-2)",
              lineHeight: 1.65,
              maxHeight: "42vh",
              overflowY: "auto",
              overflowX: "hidden", // overflow-y:auto иначе включает overflow-x
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-3)",
            }}
          >
            <span>{line.note}</span>
            {/* Картинки аннотации (Genius): раньше терялись — в plain-формате
                <img> либо пропадала, либо печаталась голым URL. */}
            {annotation?.images.map((img) => (
              <figure key={img.src} style={{ margin: 0, display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <img
                  src={img.src}
                  alt={img.alt ?? ""}
                  loading="lazy"
                  // width/height из Genius — резервируют место до загрузки (без
                  // прыжка вёрстки); картинка при этом остаётся резиновой
                  width={img.width}
                  height={img.height}
                  style={{
                    maxWidth: "100%",
                    height: "auto",
                    borderRadius: "var(--r-sm)",
                    background: "var(--surface-2)",
                    display: "block",
                  }}
                />
                {img.caption ? (
                  <figcaption style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)", lineHeight: 1.4 }}>
                    {img.caption}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
          {annotation ? (
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--sp-2)", color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>
              <span>
                Genius
                {annotation.verified ? t("dialogs.meaning.verifiedSuffix") : ""}
                {annotation.votes > 0 ? t("dialogs.meaning.votesSuffix", { votes: annotation.votes }) : ""}
              </span>
              {geniusUrl ? (
                <button
                  type="button"
                  onClick={() => void openExternal(geniusUrl)}
                  style={{ border: "none", background: "none", padding: 0, color: "var(--accent-text)", font: "inherit", cursor: "pointer" }}
                >
                  {t("dialogs.meaning.openOnGenius")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
