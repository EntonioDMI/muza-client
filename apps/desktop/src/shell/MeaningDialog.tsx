import { Dialog, Icon, IconButton } from "@muza/ui";
import type { Annotation } from "@muza/api-client";
import type { LyricLine } from "../data/demo";
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
          <div style={{ color: "var(--text-2)", lineHeight: 1.65, maxHeight: "42vh", overflowY: "auto" }}>
            {line.note}
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
          ) : (
            <div style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>{t("dialogs.meaning.demoLabel")}</div>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
