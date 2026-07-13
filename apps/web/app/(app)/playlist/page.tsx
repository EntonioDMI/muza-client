"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Dialog, Icon, IconButton, Menu, SearchInput } from "@muza/ui";
import { ApiError, type PlaylistDetail } from "@muza/api-client";
import { getApi } from "../../../src/api";
import { usePlayer } from "../../../src/player";
import { usePlaylists } from "../../../src/playlists";
import { useSession } from "../../../src/session";
import { TrackList } from "../../../src/components/TrackList";
import { useToast } from "../../../src/toast";

/** Страница плейлиста. id — query-параметр (`/playlist?id=…`): статический
 *  экспорт Next не умеет динамические сегменты без generateStaticParams.
 *  «⋯» у заголовка: владелец — переименовать/поделиться(инвайт)/удалить;
 *  участник — покинуть плейлист. Убрать трек — пункт в меню TrackList. */

function PlaylistBody() {
  const params = useSearchParams();
  const id = params.get("id");
  const router = useRouter();
  const notify = useToast();
  const { session } = useSession();
  const { playContext } = usePlayer();
  const { refresh: refreshPlaylists } = usePlaylists();
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const menuAnchorRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    getApi()
      .getPlaylist(id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "Плейлист не найден"));
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    load();
  }, [id, load]);

  if (!id) return <p style={noteStyle}>Плейлист не указан.</p>;
  if (error) return <p style={noteStyle}>{error}</p>;
  if (!detail) return <p style={noteStyle}>Загрузка…</p>;

  const playable = detail.tracks.filter((t) => !t.localHash);

  const rename = async () => {
    const name = renameValue.trim();
    if (!name) return;
    setRenameBusy(true);
    try {
      await getApi().renamePlaylist(id, name);
      setDetail((d) => (d ? { ...d, name } : d));
      setRenameOpen(false);
      void refreshPlaylists();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Не удалось переименовать", "x");
    } finally {
      setRenameBusy(false);
    }
  };

  const remove = async () => {
    setDeleteBusy(true);
    try {
      await getApi().deletePlaylist(id);
      notify("Плейлист удалён", "trash-2");
      await refreshPlaylists();
      router.replace("/library");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Не удалось удалить", "x");
      setDeleteBusy(false);
    }
  };

  const removeTrack = async (trackId: string) => {
    try {
      await getApi().removePlaylistTrack(id, trackId);
      notify("Убрано из плейлиста", "list-x");
      load();
      void refreshPlaylists();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Не удалось убрать трек", "x");
    }
  };

  const createInvite = async () => {
    setShareBusy(true);
    try {
      const { code } = await getApi().createPlaylistInvite(id);
      setDetail((d) => (d ? { ...d, inviteCode: code } : d));
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Не удалось создать код", "x");
    } finally {
      setShareBusy(false);
    }
  };

  const revokeInvite = async () => {
    setShareBusy(true);
    try {
      await getApi().revokePlaylistInvite(id);
      setDetail((d) => (d ? { ...d, inviteCode: null } : d));
      notify("Код отозван — новые не войдут", "shield");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Не удалось отозвать код", "x");
    } finally {
      setShareBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!detail.inviteCode) return;
    try {
      await navigator.clipboard.writeText(detail.inviteCode);
      notify("Код скопирован — отправь другу", "copy");
    } catch {
      notify("Не удалось скопировать", "x");
    }
  };

  const leave = async () => {
    if (!session) return;
    setLeaveBusy(true);
    try {
      await getApi().removePlaylistMember(id, session.user.id);
      notify("Ты покинул плейлист", "log-out");
      await refreshPlaylists();
      router.replace("/library");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Не удалось выйти", "x");
      setLeaveBusy(false);
    }
  };

  /** «⋯» — кнопка фиксирована в шапке, якорим меню на её позицию (а не на
   *  клик, как в строках треков): IconButton типизирован как onClick: () => void. */
  const openMenu = () => {
    const rect = menuAnchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({
      x: Math.min(rect.right - 220, window.innerWidth - 236),
      y: Math.min(rect.bottom + 6, window.innerHeight - 220),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
        <span
          aria-hidden="true"
          style={{
            width: 72,
            height: 72,
            borderRadius: "var(--r-md)",
            flex: "none",
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={detail.collaborators.length > 0 ? "users" : "list-music"} size={30} color="var(--accent-text)" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="page-title" style={{ fontSize: 24 }}>
            {detail.name}
          </h1>
          <p style={{ margin: "4px 0 0", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
            {detail.tracks.length} трек(ов)
            {!detail.isOwner && detail.ownerUsername ? ` · от ${detail.ownerUsername}` : ""}
          </p>
        </div>
        <Button variant="primary" icon="play" disabled={playable.length === 0} onClick={() => playContext(detail.tracks, 0)}>
          Слушать
        </Button>
        <div ref={menuAnchorRef}>
          <IconButton icon="ellipsis" label="Действия с плейлистом" onClick={openMenu} />
        </div>
      </div>
      {detail.tracks.length === 0 ? (
        <p style={noteStyle}>Плейлист пуст.</p>
      ) : (
        <TrackList tracks={detail.tracks} onRemoveFromPlaylist={(t) => void removeTrack(t.id)} />
      )}

      <Menu
        open={menu !== null}
        x={menu?.x}
        y={menu?.y}
        onClose={() => setMenu(null)}
        items={
          detail.isOwner
            ? [
                {
                  icon: "pencil",
                  label: "Переименовать",
                  onClick: () => {
                    setRenameValue(detail.name);
                    setRenameOpen(true);
                  },
                },
                { icon: "share-2", label: "Поделиться", onClick: () => setShareOpen(true) },
                "-",
                { icon: "trash-2", label: "Удалить плейлист", danger: true, onClick: () => setDeleteOpen(true) },
              ]
            : [{ icon: "log-out", label: "Покинуть плейлист", danger: true, onClick: () => setLeaveOpen(true) }]
        }
      />

      <Dialog
        open={renameOpen}
        title="Переименовать плейлист"
        onClose={() => setRenameOpen(false)}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={() => setRenameOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" size="lg" icon="check" disabled={renameBusy || !renameValue.trim()} onClick={() => void rename()}>
              {renameBusy ? "Секунду…" : "Сохранить"}
            </Button>
          </>
        }
      >
        <div
          style={{ minWidth: 280 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void rename();
          }}
        >
          <SearchInput value={renameValue} onChange={setRenameValue} placeholder="Название" icon="list-music" autoFocus />
        </div>
      </Dialog>

      <Dialog
        open={deleteOpen}
        title="Удалить плейлист?"
        onClose={() => setDeleteOpen(false)}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" size="lg" icon="trash-2" disabled={deleteBusy} onClick={() => void remove()}>
              {deleteBusy ? "Секунду…" : "Удалить"}
            </Button>
          </>
        }
      >
        <div style={{ fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>«{detail.name}» исчезнет со всех устройств. Треки останутся в каталоге.</div>
      </Dialog>

      <Dialog
        open={leaveOpen}
        title="Покинуть плейлист?"
        onClose={() => setLeaveOpen(false)}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={() => setLeaveOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" size="lg" icon="log-out" disabled={leaveBusy} onClick={() => void leave()}>
              {leaveBusy ? "Секунду…" : "Покинуть"}
            </Button>
          </>
        }
      >
        <div style={{ fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
          Ты перестанешь видеть «{detail.name}» и не сможешь добавлять треки — пока владелец не пришлёт код снова.
        </div>
      </Dialog>

      <Dialog open={shareOpen} title="Поделиться плейлистом" onClose={() => setShareOpen(false)} actions={<Button variant="ghost" size="lg" onClick={() => setShareOpen(false)}>Готово</Button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", minWidth: 280 }}>
          {detail.inviteCode ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <code
                  style={{
                    flex: 1,
                    fontSize: 22,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                    color: "var(--text-1)",
                    background: "var(--surface-3)",
                    borderRadius: "var(--r-sm)",
                    padding: "var(--sp-3)",
                    textAlign: "center",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {detail.inviteCode}
                </code>
                <IconButton icon="copy" label="Скопировать код" onClick={() => void copyInvite()} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
                  Друг вводит код у себя: Библиотека → «У меня есть код».
                </span>
                <Button variant="ghost" size="lg" icon="shield-off" disabled={shareBusy} onClick={() => void revokeInvite()}>
                  Отозвать
                </Button>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
                Создай код и отправь другу — он сможет добавлять и убирать треки вместе с тобой.
              </p>
              <Button variant="primary" size="lg" icon="users" disabled={shareBusy} onClick={() => void createInvite()}>
                Создать код
              </Button>
            </>
          )}
          {detail.collaborators.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-caption)",
                  fontWeight: 600,
                  letterSpacing: "var(--ls-caps)",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                }}
              >
                Участники · {detail.collaborators.length + 1}
              </span>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
                {detail.ownerUsername || "владелец"} (владелец){detail.collaborators.length ? ", " : ""}
                {detail.collaborators.map((c) => c.username).join(", ")}
              </span>
            </div>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}

export default function PlaylistPage() {
  // useSearchParams в статическом экспорте обязан жить под Suspense
  return (
    <Suspense fallback={<p style={noteStyle}>Загрузка…</p>}>
      <PlaylistBody />
    </Suspense>
  );
}

const noteStyle: React.CSSProperties = { margin: 0, fontFamily: "var(--font-ui)", color: "var(--text-3)" };
