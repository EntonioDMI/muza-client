"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Dialog, EmptyState, Icon, SearchInput, Tabs } from "@muza/ui";
import { ApiError, type HistoryItem } from "@muza/api-client";
import { getApi } from "../../../src/api";
import { usePlaylists } from "../../../src/playlists";
import { TrackList } from "../../../src/components/TrackList";
import { useToast } from "../../../src/toast";

/** Библиотека веба: плейлисты (создание/переименование/удаление — на
 *  странице плейлиста, здесь создание + вход по инвайт-коду) + история.
 *  Импорт по ссылке и локальные файлы — в десктопе, веб лёгкий. */
export default function LibraryPage() {
  const router = useRouter();
  const notify = useToast();
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
      const playlist = await getApi().createPlaylist(name);
      await refresh();
      closeCreate();
      router.push(`/playlist?id=${playlist.id}`);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Не удалось создать плейлист", "x");
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
      setJoinError("Код короче 4 символов — проверь его");
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
      setJoinError(e instanceof ApiError ? e.message : "Не удалось войти по коду");
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Библиотека
        </h1>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <Button variant="ghost" size="lg" icon="users" onClick={() => setJoinOpen(true)}>
            У меня есть код
          </Button>
          <Button variant="primary" size="lg" icon="plus" onClick={() => setCreateOpen(true)}>
            Создать плейлист
          </Button>
        </div>
      </div>
      <Tabs
        items={[
          { key: "playlists", label: "Плейлисты" },
          { key: "history", label: "История" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "playlists" ? (
        !loaded ? (
          <p style={noteStyle}>Загрузка…</p>
        ) : playlists.length === 0 ? (
          <EmptyState
            icon="list-music"
            title="Плейлистов пока нет"
            hint="Создай первый кнопкой выше — или войди по коду в совместный плейлист друга."
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--sp-3)" }}>
            {playlists.map((p) => (
              <Link
                key={p.id}
                href={`/playlist?id=${p.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-3)",
                  padding: "var(--sp-3)",
                  borderRadius: "var(--r-md)",
                  background: "var(--surface-2)",
                  textDecoration: "none",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "var(--r-xs)",
                    flex: "none",
                    background: "var(--accent-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={p.collaboratorsCount > 0 || p.role === "collaborator" ? "users" : "list-music"} size={22} color="var(--accent-text)" />
                </span>
                <span style={{ minWidth: 0 }}>
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
                  <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
                    {p.trackCount} трек(ов)
                    {p.role === "collaborator" ? ` · от ${p.ownerUsername}` : ""}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )
      ) : history === null ? (
        <p style={noteStyle}>Загрузка…</p>
      ) : history.length === 0 ? (
        <EmptyState icon="history" title="История пуста" hint="Всё, что послушаешь, будет здесь — с любого устройства." />
      ) : (
        <TrackList tracks={history.map((h) => h.track)} />
      )}

      <Dialog
        open={createOpen}
        title="Новый плейлист"
        onClose={closeCreate}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={closeCreate}>
              Отмена
            </Button>
            <Button variant="primary" size="lg" icon="check" disabled={createBusy || !createName.trim()} onClick={() => void create()}>
              {createBusy ? "Секунду…" : "Создать"}
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
          <SearchInput value={createName} onChange={setCreateName} placeholder="Название" icon="list-music" autoFocus />
        </div>
      </Dialog>

      <Dialog
        open={joinOpen}
        title="Плейлист по коду"
        onClose={closeJoin}
        actions={
          <>
            <Button variant="ghost" size="lg" onClick={closeJoin}>
              Отмена
            </Button>
            <Button variant="primary" size="lg" icon="users" disabled={joinBusy} onClick={() => void join()}>
              {joinBusy ? "Входим…" : "Войти"}
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
            Введи код, который прислал владелец плейлиста, — и добавляйте треки вместе.
          </p>
          <SearchInput
            value={joinCode}
            onChange={(v: string) => {
              setJoinCode(v.toUpperCase());
              setJoinError(null);
            }}
            placeholder="Например: 7WQK2M9T"
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
