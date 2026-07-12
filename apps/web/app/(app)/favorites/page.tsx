"use client";

import { useEffect } from "react";
import { EmptyState } from "@muza/ui";
import { useLikes } from "../../../src/likes";
import { TrackList } from "../../../src/components/TrackList";

/** Любимое: общий лайк-контекст (обновляется при заходе — лайки могли
 *  прилететь с десктопа). */
export default function FavoritesPage() {
  const { favorites, refresh } = useLikes();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <h1 className="page-title">Любимое</h1>
      {favorites.length === 0 ? (
        <EmptyState
          icon="heart"
          title="Здесь будет твоё любимое"
          hint="Жми сердечко у любого трека — в списке, плеере или панели «Сейчас играет». Лайки синхронизируются с приложением."
        />
      ) : (
        <TrackList tracks={favorites} />
      )}
    </div>
  );
}
