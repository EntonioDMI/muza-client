import { useState } from "react";
import { Button, Dialog, Icon, IconButton } from "@muza/ui";
import type { MuzaApi, PlaylistDetail } from "@muza/api-client";
import { useT } from "../i18n";

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
  const { t } = useT();
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
      onNotify(e instanceof Error ? e.message : t("dialogs.collab.createFailed"), "x");
    } finally {
      setBusy(false);
    }
  };

  const revokeCode = async () => {
    setBusy(true);
    try {
      await api.revokePlaylistInvite(playlistId);
      onNotify(t("dialogs.collab.codeRevoked"), "shield");
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("dialogs.collab.revokeFailed"), "x");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!detail.inviteCode) return;
    try {
      await navigator.clipboard.writeText(detail.inviteCode);
      onNotify(t("dialogs.collab.codeCopied"), "copy");
    } catch {
      onNotify(t("dialogs.copyFailed"), "x");
    }
  };

  const kick = async (userId: string, username: string) => {
    try {
      await api.removePlaylistMember(playlistId, userId);
      onNotify(t("dialogs.collab.memberRemoved", { username }), "user-x");
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("dialogs.collab.kickFailed"), "x");
    }
  };

  const leave = async () => {
    try {
      await api.removePlaylistMember(playlistId, myUserId);
      onNotify(t("dialogs.collab.left"), "log-out");
      onLeft();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("dialogs.collab.leaveFailed"), "x");
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
        {isMe ? <span style={{ color: "var(--text-3)" }}>{t("dialogs.collab.youSuffix")}</span> : null}
      </span>
      {badge ? (
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{badge}</span>
      ) : canKick ? (
        <IconButton icon="user-x" size="sm" label={t("dialogs.collab.removeFromPlaylist")} onClick={() => void kick(id, username)} />
      ) : null}
    </div>
  );

  return (
    <Dialog
      open={open}
      title={t("dialogs.collab.title")}
      onClose={onClose}
      actions={
        isOwner ? (
          <Button variant="ghost" onClick={onClose}>
            {t("dialogs.collab.done")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("dialogs.close")}
            </Button>
            {leaveConfirm ? (
              <Button variant="primary" icon="log-out" onClick={() => void leave()}>
                {t("dialogs.collab.confirmLeave")}
              </Button>
            ) : (
              <Button variant="secondary" icon="log-out" onClick={() => setLeaveConfirm(true)}>
                {t("dialogs.collab.leavePlaylist")}
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
              {t("dialogs.collab.inviteCodeLabel")}
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
                  <IconButton icon="copy" label={t("dialogs.copyCode")} onClick={() => void copyCode()} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                  <span style={{ flex: 1, fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>
                    {t("dialogs.collab.enterCodeHint")}
                  </span>
                  <Button variant="ghost" icon="shield-off" disabled={busy} onClick={() => void revokeCode()}>
                    {t("dialogs.collab.revoke")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
                  {t("dialogs.collab.createCodeHint")}
                </div>
                <Button variant="primary" icon="users" disabled={busy} onClick={() => void createCode()}>
                  {t("dialogs.collab.createCode")}
                </Button>
              </>
            )}
          </div>
        ) : (
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.5 }}>
            {t("dialogs.collab.sharedPrefix")}{" "}
            {detail.ownerUsername ? (
              <>
                {t("dialogs.collab.sharedByUser")} <b style={{ color: "var(--text-1)" }}>{detail.ownerUsername}</b>
              </>
            ) : null}
            . {t("dialogs.collab.sharedCanEdit")}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <span style={{ fontSize: "var(--fs-caption)", fontWeight: 600, letterSpacing: "var(--ls-caps)", textTransform: "uppercase", color: "var(--text-3)" }}>
            {t("dialogs.collab.membersHeading", { count: detail.collaborators.length + 1 })}
          </span>
          {memberRow("owner", detail.ownerUsername || t("dialogs.collab.ownerFallback"), t("dialogs.collab.ownerFallback"), false, isOwner)}
          {detail.collaborators.map((c) => memberRow(c.id, c.username, null, isOwner, c.id === myUserId))}
          {detail.collaborators.length === 0 ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
              {t("dialogs.collab.onlyYou")} {isOwner && !detail.inviteCode ? t("dialogs.collab.createCodeAndInvite") : ""}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
