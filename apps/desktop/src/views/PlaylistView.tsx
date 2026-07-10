import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, Icon, IconButton, Menu, SearchInput, TrackRow } from "@muza/ui";
import type { MuzaApi, PlaylistDetail, Track } from "@muza/api-client";
import { fmtTime } from "../lib/format";

/** Страница серверного плейлиста (Stage 2, слайс 4): треки по позициям,
 *  переименование, удаление, убрать трек. Воспроизведение — Stage 3. */
export function PlaylistView({
  api,
  playlistId,
  likes,
  onLike,
  onNotify,
  onChanged,
  onDeleted,
}: {
  api: MuzaApi;
  playlistId: string;
  likes: string[];
  onLike: (id: string) => void;
  onNotify: (text: string, icon?: string) => void;
  /** Состав/имя изменились — сайдбару пора перечитать список. */
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menu, setMenu] = useState<{ open: boolean; x: number; y: number; track: Track | null }>({
    open: false,
    x: 0,
    y: 0,
    track: null,
  });

  const load = useCallback(async () => {
    try {
      setDetail(await api.getPlaylist(playlistId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить плейлист");
    }
  }, [api, playlistId]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  const rename = async () => {
    const name = renameValue.trim();
    if (!name || !detail) return;
    await api.renamePlaylist(playlistId, name).catch(() => onNotify("Не удалось переименовать", "x"));
    setRenameOpen(false);
    await load();
    onChanged();
  };

  const remove = async () => {
    await api.deletePlaylist(playlistId).catch(() => onNotify("Не удалось удалить", "x"));
    setDeleteOpen(false);
    onChanged();
    onDeleted();
  };

  const removeTrack = async (trackId: string) => {
    await api.removePlaylistTrack(playlistId, trackId).catch(() => onNotify("Не удалось убрать трек", "x"));
    onNotify("Убрано из плейлиста", "list-x");
    await load();
    onChanged();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", padding: "var(--sp-6) var(--sp-6) 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: "var(--r-md)",
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <Icon name="list-music" size={26} color="var(--accent-text)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--fs-h1)",
              fontWeight: 700,
              color: "var(--text-1)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {detail?.name ?? "…"}
          </h1>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
            {detail ? `${detail.tracks.length} тр. · синхронизируется` : "загрузка"}
          </div>
        </div>
        <IconButton
          icon="pencil"
          size="sm"
          label="Переименовать"
          onClick={() => {
            setRenameValue(detail?.name ?? "");
            setRenameOpen(true);
          }}
        />
        <IconButton icon="trash-2" size="sm" label="Удалить плейлист" onClick={() => setDeleteOpen(true)} />
      </div>

      {error ? <div style={{ color: "var(--danger)", fontSize: "var(--fs-body)" }}>{error}</div> : null}

      <div style={{ display: "flex", flexDirection: "column", paddingBottom: "var(--sp-6)" }}>
        {(detail?.tracks ?? []).map((t, i) => (
          <TrackRow
            key={t.id}
            index={i + 1}
            cover={t.coverUrl ?? undefined}
            title={t.title}
            artist={t.artist}
            duration={fmtTime(t.durationSec)}
            liked={likes.includes(t.id)}
            onPlay={() => onNotify("Воспроизведение — в Stage 3 (движок)", "hourglass")}
            onLike={() => onLike(t.id)}
            onMore={(e: React.MouseEvent) => {
              e.stopPropagation();
              setMenu({
                open: true,
                x: Math.min(e.clientX, window.innerWidth - 250),
                y: Math.min(e.clientY, window.innerHeight - 160),
                track: t,
              });
            }}
          />
        ))}
        {detail && detail.tracks.length === 0 ? (
          <div style={{ padding: "var(--sp-7) var(--sp-4)", color: "var(--text-2)", fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
            Пусто. Добавляй треки из поиска: «⋯ → В плейлист».
          </div>
        ) : null}
      </div>

      <Menu
        open={menu.open}
        x={menu.x}
        y={menu.y}
        onClose={() => setMenu((m) => ({ ...m, open: false }))}
        items={[
          {
            icon: "list-x",
            label: "Убрать из плейлиста",
            onClick: () => {
              if (menu.track) void removeTrack(menu.track.id);
            },
          },
        ]}
      />

      <Dialog
        open={renameOpen}
        title="Переименовать плейлист"
        onClose={() => setRenameOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="check" onClick={() => void rename()}>
              Сохранить
            </Button>
          </>
        }
      >
        <SearchInput value={renameValue} onChange={setRenameValue} placeholder="Название" icon="list-music" autoFocus />
      </Dialog>

      <Dialog
        open={deleteOpen}
        title="Удалить плейлист?"
        onClose={() => setDeleteOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" icon="trash-2" onClick={() => void remove()}>
              Удалить
            </Button>
          </>
        }
      >
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-body)", fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
          «{detail?.name}» исчезнет со всех устройств. Треки останутся в каталоге.
        </div>
      </Dialog>
    </div>
  );
}
