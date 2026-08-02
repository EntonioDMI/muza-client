"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Dialog, IconButton, Menu, SearchInput } from "@muza/ui";
import { ApiError, type PlaylistDetail } from "@muza/api-client";
import { getApi } from "../../../src/api";
import { usePlayer } from "../../../src/player";
import { usePlaylists } from "../../../src/playlists";
import { useSession } from "../../../src/session";
import { PlaylistCover } from "../../../src/components/PlaylistCover";
import { PlaylistIconPicker, useT } from "@muza/app";
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
  const { t } = useT();
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
  const [iconOpen, setIconOpen] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    getApi()
      .getPlaylist(id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : t("web.playlist.notFound")));
  }, [id, t]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    load();
  }, [id, load]);

  if (!id) return <p style={noteStyle}>{t("web.playlist.noId")}</p>;
  if (error) return <p style={noteStyle}>{error}</p>;
  if (!detail) return <p style={noteStyle}>{t("common.loading")}</p>;

  const playable = detail.tracks.filter((tr) => !tr.localHash);

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
      notify(e instanceof ApiError ? e.message : t("toast.playlist.renameFailed"), "x");
    } finally {
      setRenameBusy(false);
    }
  };

  const remove = async () => {
    setDeleteBusy(true);
    try {
      await getApi().deletePlaylist(id);
      notify(t("toast.playlist.deleted"), "trash-2");
      await refreshPlaylists();
      router.replace("/library");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t("toast.playlist.deleteFailed"), "x");
      setDeleteBusy(false);
    }
  };

  const removeTrack = async (trackId: string) => {
    try {
      await getApi().removePlaylistTrack(id, trackId);
      notify(t("views.playlist.removedFromPlaylist"), "list-x");
      load();
      void refreshPlaylists();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t("views.playlist.removeTrackFailed"), "x");
    }
  };

  const changeIcon = async (icon: string) => {
    setIconBusy(true);
    try {
      await getApi().setPlaylistIcon(id, icon);
      setDetail((d) => (d ? { ...d, icon } : d));
      setIconOpen(false);
      notify(t("toast.playlist.iconChanged"), "image");
      void refreshPlaylists();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t("toast.playlist.iconChangeFailed"), "x");
    } finally {
      setIconBusy(false);
    }
  };

  const createInvite = async () => {
    setShareBusy(true);
    try {
      const { code } = await getApi().createPlaylistInvite(id);
      setDetail((d) => (d ? { ...d, inviteCode: code } : d));
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t("dialogs.collab.createFailed"), "x");
    } finally {
      setShareBusy(false);
    }
  };

  const revokeInvite = async () => {
    setShareBusy(true);
    try {
      await getApi().revokePlaylistInvite(id);
      setDetail((d) => (d ? { ...d, inviteCode: null } : d));
      notify(t("dialogs.collab.codeRevoked"), "shield");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t("dialogs.collab.revokeFailed"), "x");
    } finally {
      setShareBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!detail.inviteCode) return;
    try {
      await navigator.clipboard.writeText(detail.inviteCode);
      notify(t("dialogs.collab.codeCopied"), "copy");
    } catch {
      notify(t("dialogs.copyFailed"), "x");
    }
  };

  const leave = async () => {
    if (!session) return;
    setLeaveBusy(true);
    try {
      await getApi().removePlaylistMember(id, session.user.id);
      notify(t("dialogs.collab.left"), "log-out");
      await refreshPlaylists();
      router.replace("/library");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t("dialogs.collab.leaveFailed"), "x");
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
        <PlaylistCover
          icon={detail.icon}
          coverUrl={detail.iconCoverUrl}
          shared={detail.collaborators.length > 0}
          size={72}
          radius="var(--r-md)"
          iconSize={30}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="page-title" style={{ fontSize: 24 }}>
            {detail.name}
          </h1>
          <p style={{ margin: "4px 0 0", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
            {!detail.isOwner && detail.ownerUsername
              ? t("sidebar.playlistMeta.collabFrom", { count: detail.tracks.length, owner: detail.ownerUsername })
              : t("views.playlist.trackCount", { count: detail.tracks.length })}
          </p>
        </div>
        <Button variant="primary" icon="play" disabled={playable.length === 0} onClick={() => playContext(detail.tracks, 0)}>
          {t("player.play")}
        </Button>
        <div ref={menuAnchorRef}>
          <IconButton icon="ellipsis" label={t("web.playlist.actionsAria")} onClick={openMenu} />
        </div>
      </div>
      {detail.tracks.length === 0 ? (
        <p style={noteStyle}>{t("web.playlist.empty")}</p>
      ) : (
        <TrackList tracks={detail.tracks} onRemoveFromPlaylist={(tr) => void removeTrack(tr.id)} />
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
                  label: t("menu.playlist.rename"),
                  onClick: () => {
                    setRenameValue(detail.name);
                    setRenameOpen(true);
                  },
                },
                { icon: "image", label: t("menu.playlist.changeIcon"), onClick: () => setIconOpen(true) },
                { icon: "share-2", label: t("menu.catalog.share"), onClick: () => setShareOpen(true) },
                "-",
                { icon: "trash-2", label: t("menu.playlist.delete"), danger: true, onClick: () => setDeleteOpen(true) },
              ]
            : [{ icon: "log-out", label: t("dialogs.collab.leavePlaylist"), danger: true, onClick: () => setLeaveOpen(true) }]
        }
      />

      <PlaylistIconPicker
        open={iconOpen}
        currentIcon={detail.icon}
        busy={iconBusy}
        onClose={() => setIconOpen(false)}
        onPick={(icon) => void changeIcon(icon)}
      />

      <Dialog
        open={renameOpen}
        title={t("app.renamePlaylistDialog.title")}
        onClose={() => setRenameOpen(false)}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={() => setRenameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="lg" icon="check" disabled={renameBusy || !renameValue.trim()} onClick={() => void rename()}>
              {renameBusy ? t("common.busy") : t("common.save")}
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
          <SearchInput value={renameValue} onChange={setRenameValue} placeholder={t("common.namePlaceholder")} icon="list-music" autoFocus />
        </div>
      </Dialog>

      <Dialog
        open={deleteOpen}
        title={t("app.deletePlaylistDialog.title")}
        onClose={() => setDeleteOpen(false)}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={() => setDeleteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="lg" icon="trash-2" disabled={deleteBusy} onClick={() => void remove()}>
              {deleteBusy ? t("common.busy") : t("app.deletePlaylistDialog.confirm")}
            </Button>
          </>
        }
      >
        <div style={{ fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
          {t("app.deletePlaylistDialog.bodyServer", { name: detail.name })}
        </div>
      </Dialog>

      <Dialog
        open={leaveOpen}
        title={t("web.playlist.leaveDialogTitle")}
        onClose={() => setLeaveOpen(false)}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={() => setLeaveOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="lg" icon="log-out" disabled={leaveBusy} onClick={() => void leave()}>
              {leaveBusy ? t("common.busy") : t("dialogs.collab.leavePlaylist")}
            </Button>
          </>
        }
      >
        <div style={{ fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>
          {t("web.playlist.leaveDialogBody", { name: detail.name })}
        </div>
      </Dialog>

      <Dialog
        open={shareOpen}
        title={t("dialogs.shareVisibility.title")}
        onClose={() => setShareOpen(false)}
        actions={
          <Button variant="ghost" size="lg" onClick={() => setShareOpen(false)}>
            {t("dialogs.collab.done")}
          </Button>
        }
      >
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
                <IconButton icon="copy" label={t("dialogs.shareVisibility.copy")} onClick={() => void copyInvite()} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <span style={{ flex: 1, fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
                  {t("web.library.joinCodeHint")}
                </span>
                <Button variant="ghost" size="lg" icon="shield-off" disabled={shareBusy} onClick={() => void revokeInvite()}>
                  {t("dialogs.collab.revoke")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontFamily: "var(--font-ui)", lineHeight: 1.5 }}>{t("dialogs.collab.createCodeHint")}</p>
              <Button variant="primary" size="lg" icon="users" disabled={shareBusy} onClick={() => void createInvite()}>
                {t("dialogs.collab.createCode")}
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
                {t("dialogs.collab.membersHeading", { count: detail.collaborators.length + 1 })}
              </span>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
                {detail.ownerUsername || t("dialogs.collab.ownerFallback")} {t("web.playlist.ownerSuffix")}
                {detail.collaborators.length ? ", " : ""}
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
  const { t } = useT();
  // useSearchParams в статическом экспорте обязан жить под Suspense
  return (
    <Suspense fallback={<p style={noteStyle}>{t("common.loading")}</p>}>
      <PlaylistBody />
    </Suspense>
  );
}

const noteStyle: React.CSSProperties = { margin: 0, fontFamily: "var(--font-ui)", color: "var(--text-3)" };
