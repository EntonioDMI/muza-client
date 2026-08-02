"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Dialog, EmptyState, Icon, SearchInput, Tabs } from "@muza/ui";
import { pickRandomPlaylistIcon } from "@muza/core";
import { ApiError, type HistoryItem, type PlaylistMeta } from "@muza/api-client";
import { useT } from "@muza/app";
import { getApi } from "../../../src/api";
import { tracksLabel } from "../../../src/format";
import { useLikes } from "../../../src/likes";
import { usePlaylists } from "../../../src/playlists";
import { PlaylistCover } from "../../../src/components/PlaylistCover";
import { TrackList } from "../../../src/components/TrackList";
import { useToast } from "../../../src/toast";

/** Библиотека веба: плейлисты (создание/переименование/удаление — на
 *  странице плейлиста, здесь создание + вход по инвайт-коду) + история.
 *  Импорт по ссылке и локальные файлы — в десктопе, веб лёгкий. */
/** Плитка «Любимое» — всегда первая в сетке, фирменный градиент глифа
 *  (зеркало FavoritesTile десктопа, LibraryView.tsx:31). */
function FavoritesTile({ count }: { count: number }) {
  const { t, lang } = useT();
  const [lit, setLit] = useState(false);
  return (
    <Link
      href="/favorites"
      aria-label={t("media.nav.favorites")}
      onMouseEnter={() => setLit(true)}
      onMouseLeave={() => setLit(false)}
      style={{
        display: "block",
        padding: "var(--sp-3)",
        borderRadius: "var(--r-md)",
        background: lit ? "var(--surface-3)" : "var(--surface-2)",
        textDecoration: "none",
        transition: "background var(--dur-base) var(--ease-out)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "grid",
          placeItems: "center",
          aspectRatio: "1",
          marginBottom: "var(--sp-3)",
          borderRadius: "var(--r-sm)",
          overflow: "hidden",
          // градиент логотипа (glyph.svg: #F76967 → #3B82F6) — как в приложении
          background: "linear-gradient(160deg, #F76967 0%, #3B82F6 100%)",
        }}
      >
        <Icon name="heart" size={96} color="#fff" filled style={{ width: "58%", height: "58%" }} />
      </span>
      <span
        style={{
          display: "block",
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: "var(--fs-body)",
          color: "var(--text-1)",
        }}
      >
        {t("media.nav.favorites")}
      </span>
      <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: 2 }}>
        {tracksLabel(count, lang)}
      </span>
    </Link>
  );
}

/** Квадратная плитка плейлиста (было — строка): иконка на всю ширину
 *  колонки, имя и счётчик под ней — раскладка плитки десктопа. */
function PlaylistTile({ p }: { p: PlaylistMeta }) {
  const { t, lang } = useT();
  const [lit, setLit] = useState(false);
  return (
    <Link
      href={`/playlist?id=${p.id}`}
      onMouseEnter={() => setLit(true)}
      onMouseLeave={() => setLit(false)}
      style={{
        display: "block",
        padding: "var(--sp-3)",
        borderRadius: "var(--r-md)",
        background: lit ? "var(--surface-3)" : "var(--surface-2)",
        textDecoration: "none",
        transition: "background var(--dur-base) var(--ease-out)",
      }}
    >
      <span style={{ display: "block", marginBottom: "var(--sp-3)" }}>
        <PlaylistCover
          icon={p.icon}
          coverUrl={p.iconCoverUrl}
          shared={p.collaboratorsCount > 0 || p.role === "collaborator"}
          size={0}
          iconSize={48}
          fluid
          radius="var(--r-sm)"
        />
      </span>
      <span
        style={{
          display: "block",
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: "var(--fs-body)",
          color: "var(--text-1)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {p.name}
      </span>
      <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: 2 }}>
        {p.role === "collaborator"
          ? t("sidebar.playlistMeta.collabFrom", { count: p.trackCount, owner: p.ownerUsername ?? "" })
          : tracksLabel(p.trackCount, lang)}
      </span>
    </Link>
  );
}

export default function LibraryPage() {
  const router = useRouter();
  const notify = useToast();
  const { t } = useT();
  const { favorites } = useLikes();
  const { playlists, loaded, refresh } = usePlaylists();
  const [tab, setTab] = useState("playlists");
  const [history, setHistory] = useState<HistoryItem[] | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "history" || history !== null) return;
    getApi()
      .getHistory(50)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [tab, history]);

  const closeCreate = () => {
    setCreateOpen(false);
    setCreateName("");
  };

  const create = async () => {
    const name = createName.trim();
    if (!name) return;
    setCreateBusy(true);
    try {
      const usedIcons = playlists.map((p) => p.icon).filter((v): v is string => Boolean(v));
      const icon = pickRandomPlaylistIcon(usedIcons);
      const playlist = await getApi().createPlaylist(name, icon);
      await refresh();
      closeCreate();
      router.push(`/playlist?id=${playlist.id}`);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t("toast.playlist.createFailed"), "x");
    } finally {
      setCreateBusy(false);
    }
  };

  const closeJoin = () => {
    setJoinOpen(false);
    setJoinCode("");
    setJoinError(null);
  };

  const join = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setJoinError(t("dialogs.codeTooShort"));
      return;
    }
    setJoinBusy(true);
    setJoinError(null);
    try {
      const playlist = await getApi().joinPlaylist(code);
      await refresh();
      closeJoin();
      router.push(`/playlist?id=${playlist.id}`);
    } catch (e) {
      setJoinError(e instanceof ApiError ? e.message : t("dialogs.joinPlaylist.joinFailed"));
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          {t("media.nav.library")}
        </h1>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <Button variant="ghost" size="lg" icon="users" onClick={() => setJoinOpen(true)}>
            {t("web.library.haveCode")}
          </Button>
          <Button variant="primary" size="lg" icon="plus" onClick={() => setCreateOpen(true)}>
            {t("web.library.createPlaylist")}
          </Button>
        </div>
      </div>
      <Tabs
        items={[
          { key: "playlists", label: t("views.library.chips.playlists") },
          { key: "history", label: t("web.library.tabHistory") },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "playlists" ? (
        !loaded ? (
          <p style={noteStyle}>{t("common.loading")}</p>
        ) : (
          /* Сетка КВАДРАТНЫХ плиток, как в приложении (было — строки);
             «Любимое» всегда первой, даже без единого плейлиста */
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "var(--sp-3)" }}>
            <FavoritesTile count={favorites.length} />
            {playlists.map((p) => (
              <PlaylistTile key={p.id} p={p} />
            ))}
          </div>
        )
      ) : history === null ? (
        <p style={noteStyle}>{t("common.loading")}</p>
      ) : history.length === 0 ? (
        <EmptyState icon="history" title={t("web.library.historyEmptyTitle")} hint={t("web.library.historyEmptyHint")} />
      ) : (
        <TrackList tracks={history.map((h) => h.track)} />
      )}

      <Dialog
        open={createOpen}
        title={t("app.newPlaylistName")}
        onClose={closeCreate}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={closeCreate}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="lg" icon="check" disabled={createBusy || !createName.trim()} onClick={() => void create()}>
              {createBusy ? t("common.busy") : t("app.newPlaylistDialog.create")}
            </Button>
          </>
        }
      >
        <div
          style={{ minWidth: 280 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        >
          <SearchInput value={createName} onChange={setCreateName} placeholder={t("common.namePlaceholder")} icon="list-music" autoFocus />
        </div>
      </Dialog>

      <Dialog
        open={joinOpen}
        title={t("dialogs.joinPlaylist.title")}
        onClose={closeJoin}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={closeJoin}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="lg" icon="users" disabled={joinBusy} onClick={() => void join()}>
              {joinBusy ? t("dialogs.joinPlaylist.joining") : t("dialogs.joinPlaylist.join")}
            </Button>
          </>
        }
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 280 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void join();
          }}
        >
          <p style={{ margin: 0, fontFamily: "var(--font-ui)", color: "var(--text-2)", lineHeight: 1.5 }}>
            {t("dialogs.joinPlaylist.hint")}
          </p>
          <SearchInput
            value={joinCode}
            onChange={(v: string) => {
              setJoinCode(v.toUpperCase());
              setJoinError(null);
            }}
            placeholder={t("dialogs.joinPlaylist.codePlaceholder")}
            icon="users"
            autoFocus
          />
          {joinError ? <p style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "#e5484d" }}>{joinError}</p> : null}
        </div>
      </Dialog>
    </div>
  );
}

const noteStyle: React.CSSProperties = { margin: 0, fontFamily: "var(--font-ui)", color: "var(--text-3)" };
