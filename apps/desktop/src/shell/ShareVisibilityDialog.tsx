import { useState } from "react";
import { Button, Dialog, Icon, IconButton } from "@muza/ui";
import type { MuzaApi, PlaylistDetail, PlaylistVisibility } from "@muza/api-client";
import { useT } from "../i18n";

/** Ступень лесенки — плоская плашка по ДС (замечание владельца 17.07: НИКАКИХ
 *  обводок): покой surface-2, ховер surface-3, актив accent-soft + accent-text.
 *  Тот же язык, что плашки настроек (SettingsView) и кнопки хоткеев. */
function StepPlate({
  step,
  active,
  busy,
  onPick,
}: {
  step: { key: PlaylistVisibility; icon: string; title: string; hint: string };
  active: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={busy}
      onClick={onPick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-3) var(--sp-4)",
        border: "none",
        borderRadius: "var(--r-md)",
        background: active ? "var(--accent-soft)" : hover && !busy ? "var(--surface-3)" : "var(--surface-2)",
        cursor: busy ? "default" : "pointer",
        textAlign: "left",
        color: "var(--text-1)",
        fontFamily: "var(--font-ui)",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      <Icon name={step.icon} size={18} color={active ? "var(--accent-text)" : "var(--text-3)"} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: "var(--fs-body)",
            fontWeight: 600,
            color: active ? "var(--accent-text)" : "var(--text-1)",
          }}
        >
          {step.title}
        </span>
        <span style={{ display: "block", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{step.hint}</span>
      </span>
      {active ? <Icon name="check" size={16} color="var(--accent-text)" /> : null}
    </button>
  );
}

/** «Поделиться плейлистом» (2026-07-17): лесенка видимости
 *  private → code → public + вечный код PL_… с копированием.
 *
 *  НЕ путать с CollabDialog (право ПРАВКИ по инвайт-коду) и шеринг-карточкой
 *  (картинка для соцсетей): здесь только право ЧТЕНИЯ. Код рождается на
 *  сервере при первом подъёме из private и не меняется; спуск в private его
 *  не стирает — просто «замораживает» (подпись codeInactive). */
export function ShareVisibilityDialog({
  api,
  open,
  playlistId,
  detail,
  onClose,
  onNotify,
  onChanged,
}: {
  api: MuzaApi;
  open: boolean;
  playlistId: string;
  detail: PlaylistDetail | null;
  onClose: () => void;
  onNotify: (text: string, icon?: string) => void;
  /** Видимость/код сменились — перечитать detail и сайдбар. */
  onChanged: () => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  // Код/адрес из последнего ответа сервера: detail отстаёт до onChanged-перезагрузки
  const [freshCode, setFreshCode] = useState<string | null>(null);
  const [freshHandle, setFreshHandle] = useState<string | null | undefined>(undefined);
  const [handleDraft, setHandleDraft] = useState("");
  const [handleBusy, setHandleBusy] = useState(false);
  if (!detail) return null;
  const code = freshCode ?? detail.publicCode;
  const handle = freshHandle !== undefined ? freshHandle : detail.handle;
  const visibility = detail.visibility;
  const draftValid = /^[A-Za-z0-9_]{3,32}$/.test(handleDraft.trim());

  const setVisibility = async (next: PlaylistVisibility) => {
    if (busy || next === visibility) return;
    setBusy(true);
    try {
      const out = await api.setPlaylistVisibility(playlistId, next);
      setFreshCode(out.publicCode);
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("dialogs.shareVisibility.changeFailed"), "x");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      onNotify(t("dialogs.shareVisibility.copied"), "copy");
    } catch {
      onNotify(t("dialogs.copyFailed"), "x");
    }
  };

  /** Сохранить @адрес: занятость и формат окончательно решает сервер. */
  const saveHandle = async () => {
    if (!draftValid || handleBusy) return;
    setHandleBusy(true);
    try {
      const out = await api.setPlaylistHandle(playlistId, handleDraft.trim());
      setFreshHandle(out.handle);
      setHandleDraft("");
      onNotify(t("dialogs.shareVisibility.handleSaved"), "at-sign");
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t("views.search.somethingWrong"), "x");
    } finally {
      setHandleBusy(false);
    }
  };

  const copyHandle = async () => {
    if (!handle) return;
    try {
      await navigator.clipboard.writeText(`@${handle}`);
      onNotify(t("dialogs.shareVisibility.handleCopied"), "copy");
    } catch {
      onNotify(t("dialogs.copyFailed"), "x");
    }
  };

  const steps: { key: PlaylistVisibility; icon: string; title: string; hint: string }[] = [
    {
      key: "private",
      icon: "lock",
      title: t("dialogs.shareVisibility.stepPrivate"),
      hint: t("dialogs.shareVisibility.stepPrivateHint"),
    },
    {
      key: "code",
      icon: "key-round",
      title: t("dialogs.shareVisibility.stepCode"),
      hint: t("dialogs.shareVisibility.stepCodeHint"),
    },
    {
      key: "public",
      icon: "globe",
      title: t("dialogs.shareVisibility.stepPublic"),
      hint: t("dialogs.shareVisibility.stepPublicHint"),
    },
  ];

  return (
    <Dialog
      open={open}
      title={t("dialogs.shareVisibility.title")}
      onClose={onClose}
      actions={<Button onClick={onClose}>{t("dialogs.shareVisibility.done")}</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {steps.map((s) => {
          const active = s.key === visibility;
          return <StepPlate key={s.key} step={s} active={active} busy={busy} onPick={() => void setVisibility(s.key)} />;
        })}

        {code ? (
          <div style={{ marginTop: "var(--sp-3)" }}>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", marginBottom: "var(--sp-1)" }}>
              {t("dialogs.shareVisibility.codeLabel")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <code
                style={{
                  flex: 1,
                  padding: "var(--sp-2) var(--sp-3)",
                  borderRadius: "var(--r-sm)",
                  // surface-3 — язык полей ввода ДС (см. tokens/colors.css)
                  background: "var(--surface-3)",
                  fontSize: "var(--fs-body)",
                  letterSpacing: "0.06em",
                  opacity: visibility === "private" ? 0.5 : 1,
                }}
              >
                {code}
              </code>
              <IconButton icon="copy" size="sm" label={t("dialogs.shareVisibility.copy")} onClick={() => void copyCode()} />
            </div>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: "var(--sp-1)" }}>
              {visibility === "private"
                ? t("dialogs.shareVisibility.codeInactive")
                : t("dialogs.shareVisibility.codeHint")}
            </div>
          </div>
        ) : null}

        {/* @Адрес (2026-07-17): уникальное имя — только на ступени public.
            Стиль полей ДС: surface-3, без обводок. */}
        {visibility === "public" ? (
          <div style={{ marginTop: "var(--sp-3)" }}>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", marginBottom: "var(--sp-1)" }}>
              {t("dialogs.shareVisibility.handleLabel")}
            </div>
            {handle ? (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                <code
                  style={{
                    flex: 1,
                    padding: "var(--sp-2) var(--sp-3)",
                    borderRadius: "var(--r-sm)",
                    background: "var(--surface-3)",
                    fontSize: "var(--fs-body)",
                    letterSpacing: "0.04em",
                  }}
                >
                  @{handle}
                </code>
                <IconButton
                  icon="copy"
                  size="sm"
                  label={t("dialogs.shareVisibility.handleCopied")}
                  onClick={() => void copyHandle()}
                />
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                <span style={{ color: "var(--text-3)", fontSize: "var(--fs-body)" }}>@</span>
                <input
                  value={handleDraft}
                  onChange={(e) => setHandleDraft(e.target.value)}
                  placeholder={t("dialogs.shareVisibility.handlePlaceholder")}
                  aria-label={t("dialogs.shareVisibility.handleLabel")}
                  style={{
                    flex: 1,
                    height: 36,
                    padding: "0 var(--sp-3)",
                    border: "none",
                    borderRadius: "var(--r-sm)",
                    background: "var(--surface-3)",
                    color: "var(--text-1)",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--fs-body)",
                    outline: "none",
                  }}
                />
                <Button variant="secondary" disabled={!draftValid || handleBusy} onClick={() => void saveHandle()}>
                  {t("dialogs.shareVisibility.handleSave")}
                </Button>
              </div>
            )}
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: "var(--sp-1)" }}>
              {handleDraft.trim() && !draftValid
                ? t("dialogs.shareVisibility.handleFormat")
                : t("dialogs.shareVisibility.handleHint")}
            </div>
          </div>
        ) : handle ? (
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: "var(--sp-2)" }}>
            <span style={{ opacity: 0.6 }}>@{handle}</span> — {t("dialogs.shareVisibility.handleFrozen")}
          </div>
        ) : null}

        {detail.followersCount > 0 ? (
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: "var(--sp-2)" }}>
            {t("dialogs.shareVisibility.followers", { count: detail.followersCount })}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
