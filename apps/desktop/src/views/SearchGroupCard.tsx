import { useState } from "react";
import { Badge, Icon } from "@muza/ui";
import type { GroupSearchResult, Track } from "@muza/api-client";
import { pluralVersions, variantLabel } from "../lib/searchGrouping";
import { useT } from "../i18n";

/** T37: карточка-группа результата grouped-поиска (?group=1, T36 сервера) —
 *  канон + бейдж «N версий», разворот показывает варианты с человеческой
 *  подписью категории (Ремикс/Спидап/…). Вся логика строки (drag-out,
 *  очередь/лайк/меню) остаётся в SearchView — сюда передаётся готовый
 *  renderRow, чтобы не дублировать её (DRY с плоским режимом поиска).
 *  Состояние разворота — локальное (key карточки = id канона): новая выдача
 *  просто ремонтирует карточку и сбрасывает разворот сама по себе, без
 *  отдельного эффекта-сброса (в отличие от веб-аналога GroupedTrackList,
 *  где Set<index> требовал явного useEffect на смену results). */
export function SearchGroupCard({
  result,
  index,
  renderRow,
}: {
  result: GroupSearchResult;
  /** Порядковый номер карточки в выдаче — уходит в TrackRow.index канона. */
  index: number;
  renderRow: (track: Track, index?: number) => React.ReactNode;
}) {
  const { t, lang } = useT();
  const [expanded, setExpanded] = useState(false);
  const versionCount = result.variants.length;
  // hasOriginal=false — оригинала в выдаче нет, канон — заглушка (лучший
  // вариант); показываем это явно, чтобы «лайк карточке» не путал с оригиналом.
  const canonLabel = !result.hasOriginal ? variantLabel(result.canonicalVariantType, lang) : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>{renderRow(result.canonical, index)}</div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`${versionCount} ${pluralVersions(versionCount, lang)} — ${expanded ? t("views.search.groupCard.collapse") : t("views.search.groupCard.expand")}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-1)",
            flex: "none",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: "var(--sp-2)",
            borderRadius: "var(--r-sm)",
          }}
        >
          <Badge tone={result.hasOriginal ? "accent" : "neutral"}>
            {versionCount} {pluralVersions(versionCount, lang)}
          </Badge>
          <Icon
            name="chevron-down"
            size={16}
            color="var(--text-3)"
            style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform var(--dur-fast, 150ms)" }}
          />
        </button>
      </div>
      {canonLabel ? (
        <div
          style={{
            padding: "0 var(--sp-4) var(--sp-1) 82px",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-caption)",
            color: "var(--text-3)",
          }}
        >
          {t("views.search.groupCard.noOriginal", { label: canonLabel ?? "" })}
        </div>
      ) : null}
      {expanded ? (
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 32 }}>
          {result.variants.map((v, vi) => (
            <div key={`gv-${v.track.id}-${vi}`} style={{ display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-caption)",
                  fontWeight: 600,
                  color: "var(--text-3)",
                  padding: "var(--sp-1) 0 0 var(--sp-2)",
                }}
              >
                {variantLabel(v.variantType, lang)}
              </span>
              {renderRow(v.track)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
