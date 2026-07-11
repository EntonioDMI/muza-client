import { useState } from "react";
import { Button, Dialog, Icon, IconButton, Tooltip } from "@muza/ui";
import type { MuzaApi, PlaylistDetail } from "@muza/api-client";

/** «Совместный доступ» плейлиста (Stage 7). Владелец: инвайт-код
 *  (создать/скопировать/отозвать) + участники с киком. Участник: список
 *  и «Покинуть плейлист». */
export function CollabDialog({
  api,
  open,
  playlistId,
  detail,
  myUserId,
  onClose,
  onNotify,
  onChanged,
  onLeft,
}: {
  api: MuzaApi;
  open: boolean;
  playlistId: string;
  detail: PlaylistDetail | null;
  /** id текущего пользователя — отличить «выйти самому» от кика. */
  myUserId: string;
  onClose: () => void;
  onNotify: (text: string, icon?: string) => void;
  /** Код/участники изменились — перечитать детали и сайдбар. */
  onChanged: () => void;
  /** Сам покинул плейлист — закрыть его страницу. */
  onLeft: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  if (!detail) return null;
  const isOwner = detail.isOwner;

  const createCode = async () => {
    setBusy(true);
    try {
      await api.createPlaylistInvite(playlistId);
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Не удалось создать код", "x");
    } finally {
      setBusy(false);
    }
  };

  const revokeCode = async () => {
    setBusy(true);
    try {
      await api.revokePlaylistInvite(playlistId);
      onNotify("Код отозван — новые не войдут", "shield");
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Не удалось отозвать код", "x");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!detail.inviteCode) return;
    try {
      await navigator.clipboard.writeText(detail.inviteCode);
      onNotify("Код скопирован — отправь другу", "copy");
    } catch {
      onNotify("Не удалось скопировать", "x");
    }
  };

  const kick = async (userId: string, username: string) => {
    try {
      await api.removePlaylistMember(playlistId, userId);
      onNotify(`${username} убран из плейлиста`, "user-x");
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Не удалось убрать участника", "x");
    }
  };

  const leave = async () => {
    try {
      await api.removePlaylistMember(playlistId, myUserId);
      onNotify("Ты покинул плейлист", "log-out");
      onLeft();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Не удалось выйти", "x");
    }
  };

  const memberRow = (id: string, username: string, badge: string | null, canKick: boolean, isMe: boolean) => (
    <div key={id} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minHeight: 36 }}>
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: "var(--accent-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <Icon name={badge ? "crown" : "user"} size={15} color="var(--accent-text)" />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: "var(--fs-body)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {username}
        {isMe ? <span style={{ color: "var(--text-3)" }}> (ты)</span> : null}
      </span>
      {badge ? (
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{badge}</span>
      ) : canKick ? (
        <Tooltip label="Убрать из плейлиста">
          <IconButton icon="user-x" size="sm" label={`Убрать ${username}`} onClick={() => void kick(id, username)} />
        </Tooltip>
      ) : null}
    </div>
  );

  return (
    <Dialog
      open={open}
      title="Совместный доступ"
      onClose={onClose}
      actions={
        isOwner ? (
          <Button variant="ghost" onClick={onClose}>
            Готово
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
            {leaveConfirm ? (
              <Button variant="primary" icon="log-out" onClick={() => void leave()}>
                Точно покинуть
              </Button>
            ) : (
              <Button variant="secondary" icon="log-out" onClick={() => setLeaveConfirm(true)}>
                Покинуть плейлист
              </Button>
            )}
          </>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", minWidth: 340, maxWidth: 420 }}>
        {isOwner ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <span style={{ fontSize: "var(--fs-caption)", fontWeight: 600, letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-3)" }}>
              Инвайт-код
            </span>
            {detail.inviteCode ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                  <code
                    style={{
                      flex: 1,
                      fontSize: 24,
                      fontWeight: 700,
                      letterSpacing: "0.18em",
                      color: "var(--text-1)",
                      background: "var(--surface-3)",
                      borderRadius: "var(--r-sm)",
                      padding: "var(--sp-3) var(--sp-4)",
                      textAlign: "center",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {detail.inviteCode}
                  </code>
                  <Tooltip label="Скопировать код">
                    <IconButton icon="copy" label="Скопировать код" onClick={() => void copyCode()} />
                  </Tooltip>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                  <span style={{ flex: 1, fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
                    Друг вводит код у себя: Библиотека → «По коду».
                  </span>
                  <Button variant="ghost" icon="shield-off" disabled={busy} onClick={() => void revokeCode()}>
                    Отозвать
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
                  Создай код и отправь другу — он сможет добавлять и убирать треки вместе с тобой.
                </div>
                <Button variant="primary" icon="users" disabled={busy} onClick={() => void createCode()}>
                  Создать код
                </Button>
              </>
            )}
          </div>
        ) : (
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
            Совместный плейлист {detail.ownerUsername ? <>пользователя <b style={{ color: "var(--text-1)" }}>{detail.ownerUsername}</b></> : null}.
            Ты можешь добавлять и убирать треки.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <span style={{ fontSize: "var(--fs-caption)", fontWeight: 600, letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-3)" }}>
            Участники · {detail.collaborators.length + 1}
          </span>
          {memberRow("owner", detail.ownerUsername || "владелец", "владелец", false, isOwner)}
          {detail.collaborators.map((c) => memberRow(c.id, c.username, null, isOwner, c.id === myUserId))}
          {detail.collaborators.length === 0 ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              Пока только ты. {isOwner && !detail.inviteCode ? "Создай код и позови кого-нибудь." : ""}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
