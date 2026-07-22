"use client";

import { useEffect } from "react";
import { EmptyState } from "@muza/ui";
import { useT } from "@muza/app";
import { useLikes } from "../../../src/likes";
import { TrackList } from "../../../src/components/TrackList";

/** Любимое: общий лайк-контекст (обновляется при заходе — лайки могли
 *  прилететь с десктопа). */
export default function FavoritesPage() {
  const { favorites, refresh } = useLikes();
  const { t } = useT();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <h1 className="page-title">{t("views.favorites.title")}</h1>
      {favorites.length === 0 ? (
        <EmptyState icon="heart" title={t("web.favorites.emptyTitle")} hint={t("web.favorites.emptyHint")} />
      ) : (
        <TrackList tracks={favorites} />
      )}
    </div>
  );
}
