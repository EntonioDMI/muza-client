/** ПОД-ЭКРАН «СТАТУС В DISCORD»: что видят друзья, пока человек слушает.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Предпросмотр — ЗЕРКАЛО реальной активности, а не картинка «как примерно
 *  будет»: играет трек — берутся его данные и его же обложка; кнопка
 *  показывается ровно тогда, когда она реально уйдёт (есть текст и годная
 *  ссылка); включённая кнопка переводит активность в другой тип, где Discord
 *  не рисует полосу времени, — предпросмотр это и показывает. Настройка,
 *  предпросмотр которой врёт, хуже настройки без предпросмотра. */

import { useEffect, useState } from "react";
import { Button, Switch } from "@muza/ui";
import type { DiscordOutcomeInfo } from "../../platform";
import { useT } from "../../i18n";
import { discordCoverUrl, formatTemplate, isValidButtonUrl } from "../../lib/discord";
import { fmtTime } from "../../lib/format";
import { GroupTitle, paneStyle, RowValue, SettingInput, SettingRow, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export function DiscordSub() {
  const { t } = useT();
  const { prefs, set, platform, nowPlaying, glyphSrc, closeSub, paneClass } = useSettingsScreen();
  const statusPort = platform.discordStatus;

  // Готова ли связка с Discord: без этого подсказка обещала бы статус,
  // которого не будет.
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    if (!statusPort) return;
    void statusPort.configured().then(setConfigured);
  }, [statusPort]);

  // Итог связи с Discord. Открыли экран — показываем последний известный (его
  // помнит мост), нажали «Проверить» — свежий.
  const [outcome, setOutcome] = useState<DiscordOutcomeInfo | null>(() => statusPort?.lastOutcome?.() ?? null);
  const [checking, setChecking] = useState(false);
  const runCheck = () => {
    if (!statusPort?.test || checking) return;
    setChecking(true);
    void statusPort
      .test({
        label: btnShown ? prefs.discordBtnLabel : null,
        url: btnShown ? prefs.discordBtnUrl : null,
      })
      .then(setOutcome)
      .finally(() => setChecking(false));
  };
  /** Что сказать человеку по итогу. Успех разводит два случая: кнопку он не
   *  увидит даже когда всё сработало — Discord показывает её только другим, и
   *  без этой строки «проверка прошла, а кнопки нет» читается как поломка. */
  const outcomeText = (o: DiscordOutcomeInfo): string => {
    const base = "settings.integrations.discord.check" as const;
    if (o.ok) return t(`${base}.${btnShown ? "okWithButton" : "ok"}`);
    if (o.stage === "no_discord") return t(`${base}.noDiscord`);
    if (o.stage === "rejected") return t(`${base}.rejected`);
    if (o.stage === "off") return t(`${base}.off`);
    return t(`${base}.noClient`);
  };

  const vars = nowPlaying
    ? { track: nowPlaying.title, artist: nowPlaying.artist, album: nowPlaying.album }
    : {
        track: t("settings.integrations.discord.preview.track"),
        artist: t("settings.integrations.discord.preview.artist"),
        album: t("settings.integrations.discord.preview.album"),
      };
  const cover = prefs.discordShowCover && nowPlaying?.cover ? discordCoverUrl(nowPlaying.cover) : null;
  const btnUrlInvalid = prefs.discordBtnUrl.trim() !== "" && !isValidButtonUrl(prefs.discordBtnUrl);
  const btnShown = prefs.discordBtnOn && prefs.discordBtnLabel.trim() !== "" && isValidButtonUrl(prefs.discordBtnUrl);
  const duration = nowPlaying && nowPlaying.duration > 0 ? Math.round(nowPlaying.duration) : 204;
  const elapsed = Math.round(duration / 3);
  const showBar = prefs.discordProgressOn && !btnShown;

  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.integrations.discord.title")} onBack={closeSub} />
      <SettingRow
        title={t("settings.integrations.discord.enable.title")}
        hint={configured === false ? t("settings.integrations.discord.enable.hintNoAppId") : t("settings.integrations.discord.enable.hint")}
      >
        <Switch checked={prefs.discordRpcOn} onChange={(discordRpcOn: boolean) => set({ discordRpcOn })} label={t("settings.integrations.discord.enable.ariaLabel")} />
      </SettingRow>
      {/* Проверка связи. Без неё отказ выглядел как отсутствие статуса, и
          жалоба «не работает вообще» не поддавалась разбору: и человек, и мы
          переключали тумблеры вслепую (жалоба 5 из семи, 12.08). */}
      {statusPort?.test ? (
        <SettingRow
          title={t("settings.integrations.discord.check.title")}
          hint={outcome ? outcomeText(outcome) : t("settings.integrations.discord.check.hint")}
        >
          <Button variant="ghost" onClick={runCheck} disabled={checking}>
            {checking ? t("settings.integrations.discord.check.checking") : t("settings.integrations.discord.check.action")}
          </Button>
        </SettingRow>
      ) : null}
      {/* Слова самого Discord — отдельной строкой и только когда они есть.
          Человеку хватает подсказки выше; эта строка нужна, когда он присылает
          нам снимок экрана. */}
      {outcome?.message && !outcome.ok ? (
        <RowValue>{t("settings.integrations.discord.check.detail", { message: outcome.message })}</RowValue>
      ) : null}
      <GroupTitle>{t("settings.integrations.discord.whatToShow")}</GroupTitle>
      <SettingRow title={t("settings.integrations.discord.cover.title")} hint={t("settings.integrations.discord.cover.hint")}>
        <Switch checked={prefs.discordShowCover} onChange={(discordShowCover: boolean) => set({ discordShowCover })} label={t("settings.integrations.discord.cover.ariaLabel")} />
      </SettingRow>
      <SettingRow title={t("settings.integrations.discord.progress.title")} hint={t("settings.integrations.discord.progress.hint")}>
        <Switch checked={prefs.discordProgressOn} onChange={(discordProgressOn: boolean) => set({ discordProgressOn })} label={t("settings.integrations.discord.progress.ariaLabel")} />
      </SettingRow>
      <SettingRow title={t("settings.integrations.discord.line1.title")} hint={t("settings.integrations.discord.line1.hint")}>
        <SettingInput value={prefs.discordLine1} placeholder="{track}" onChange={(v) => set({ discordLine1: v.slice(0, 128) })} />
      </SettingRow>
      <SettingRow title={t("settings.integrations.discord.line2.title")} hint={t("settings.integrations.discord.line2.hint")}>
        <SettingInput value={prefs.discordLine2} placeholder="{artist}" onChange={(v) => set({ discordLine2: v.slice(0, 128) })} />
      </SettingRow>
      <GroupTitle>{t("settings.integrations.discord.buttonGroup")}</GroupTitle>
      <SettingRow title={t("settings.integrations.discord.btnOn.title")} hint={t("settings.integrations.discord.btnOn.hint")}>
        <Switch checked={prefs.discordBtnOn} onChange={(discordBtnOn: boolean) => set({ discordBtnOn })} label={t("settings.integrations.discord.btnOn.ariaLabel")} />
      </SettingRow>
      <SettingRow title={t("settings.integrations.discord.btnLabel.title")} hint={t("settings.integrations.discord.btnLabel.hint")}>
        <SettingInput
          value={prefs.discordBtnLabel}
          placeholder={t("settings.integrations.discord.btnLabel.placeholder")}
          onChange={(v) => set({ discordBtnLabel: v.slice(0, 32) })}
        />
      </SettingRow>
      <SettingRow title={t("settings.integrations.discord.btnUrl.title")} hint={t("settings.integrations.discord.btnUrl.hint")}>
        <SettingInput value={prefs.discordBtnUrl} placeholder="https://…" width={260} onChange={(v) => set({ discordBtnUrl: v })} />
      </SettingRow>
      {btnUrlInvalid ? (
        // Без годной ссылки кнопка молча не уходит — говорим об этом
        <div style={{ margin: "calc(var(--sp-2) * -1) 0 0", fontSize: "var(--fs-caption)", color: "var(--danger)" }}>
          {t("settings.integrations.discord.btnUrl.invalid")}
        </div>
      ) : null}
      <GroupTitle>{t("settings.integrations.discord.previewGroup")}</GroupTitle>
      {/* Карточка активности — как в профиле Discord */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
          padding: "var(--sp-4) var(--sp-5)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-2)",
          maxWidth: 380,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-3)" }}>
          {t(btnShown ? "settings.integrations.discord.preview.playingTo" : "settings.integrations.discord.preview.listeningTo")}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center" }}>
          {cover ? (
            // реальная обложка играющего трека — та же, что уйдёт в Discord
            <img src={cover} alt="" style={{ width: 48, height: 48, borderRadius: "var(--r-sm)", objectFit: "cover", flex: "none" }} />
          ) : (
            // нет обложки → значок программы (он же уходит в Discord)
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "var(--r-sm)",
                background: "var(--surface-3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <img src={glyphSrc} alt="" style={{ width: 28, height: 28 }} />
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "var(--fs-caption)", fontWeight: 400, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {formatTemplate(prefs.discordLine1, vars) || t("settings.integrations.discord.preview.track")}
            </div>
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {formatTemplate(prefs.discordLine2, vars) || t("settings.integrations.discord.preview.artist")}
            </div>
            {showBar ? (
              // родная полоса времени Discord: линия + таймкоды
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginTop: 4 }}>
                <span style={{ fontSize: 10, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{fmtTime(elapsed)}</span>
                <div style={{ flex: 1, height: 3, borderRadius: 2, background: "var(--surface-4)", overflow: "hidden" }}>
                  <div style={{ width: `${Math.round((elapsed / duration) * 100)}%`, height: "100%", background: "var(--text-2)" }} />
                </div>
                <span style={{ fontSize: 10, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{fmtTime(duration)}</span>
              </div>
            ) : (
              // без линии Discord показывает счётчик прослушанного
              <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{fmtTime(elapsed)}</div>
            )}
          </div>
        </div>
        {btnShown ? (
          <div
            style={{
              height: 34,
              borderRadius: "var(--r-xs)",
              background: "var(--surface-4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--fs-caption)",
              fontWeight: 400,
              color: "var(--text-1)",
            }}
          >
            {prefs.discordBtnLabel.trim() || t("settings.integrations.discord.btnLabel.placeholder")}
          </div>
        ) : null}
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{t("settings.integrations.discord.preview.caption")}</div>
      </div>
    </div>
  );
}
