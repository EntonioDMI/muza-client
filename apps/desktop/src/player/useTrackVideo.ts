/** Видео трека для «Сейчас играет» (2026-07-21): ленивый резолв ВИДЕО-дорожки
 *  YouTube через Rust (engine_resolve_video, itag 135/136/… — video-only,
 *  без скачивания: muted <video> играет удалённый googlevideo-URL напрямую).
 *
 *  Провал не критичен ПО ОПРЕДЕЛЕНИЮ — панель показывает обложку; поэтому все
 *  ошибки глотаются в null. Видео есть только у треков с youtube-источником
 *  (SoundCloud/Bandcamp его не имеют) — для остальных хук честно отдаёт null,
 *  не трогая ни сеть, ни Rust. refresh() — ре-резолв протухшего URL
 *  (googlevideo ~6ч, IP-bound): <video> зовёт его из onError; больше одного
 *  ре-резолва на трек не делаем — иначе мёртвое видео долбило бы InnerTube
 *  в цикле error→refresh. */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MuzaApi } from "@muza/api-client";
import type { PlayerTrack } from "./types";
import { getCachedSources, putCachedSources } from "./sourcesCache";

interface VideoResolveOut {
  url: string;
  itag: number;
  expires_at_ms: number;
}

export function useTrackVideo(
  api: MuzaApi,
  track: PlayerTrack | null,
  enabled: boolean,
  /** Серверная сессия жива (как canFetch у useLyrics): без неё источники
   *  берутся только из кэша плеера. */
  canFetch: boolean,
): { videoUrl: string | null; refreshVideo: () => void } {
  const [url, setUrl] = useState<string | null>(null);
  // nonce перезапускает эффект резолва; лимит — один refresh на трек
  const [nonce, setNonce] = useState(0);
  const refreshedFor = useRef<string | null>(null);

  const trackId = track && track.kind === "catalog" ? track.id : null;

  useEffect(() => {
    let dead = false;
    setUrl(null);
    if (!enabled || !trackId || !isTauri()) return;
    (async () => {
      try {
        let sources = getCachedSources(trackId);
        if (!sources) {
          if (!canFetch) return;
          sources = await api.getTrackSources(trackId);
          putCachedSources(trackId, sources);
        }
        const yt = sources.find((s) => s.provider === "youtube");
        if (!yt || dead) return;
        const out = await invoke<VideoResolveOut>("engine_resolve_video", { videoId: yt.sourceId });
        if (!dead) setUrl(out.url);
      } catch {
        /* нет видео (мёртвый источник/UNPLAYABLE) / кулдаун / сеть — обложка, это штатно */
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, enabled, canFetch, nonce]);

  const refreshVideo = useCallback(() => {
    if (!trackId || refreshedFor.current === trackId) {
      // повторный отказ того же трека — сдаёмся до смены трека (обложка)
      setUrl(null);
      return;
    }
    refreshedFor.current = trackId;
    setNonce((n) => n + 1);
  }, [trackId]);

  return { videoUrl: url, refreshVideo };
}
