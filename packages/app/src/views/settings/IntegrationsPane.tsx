/** РАЗДЕЛ «ИНТЕГРАЦИИ»: статус в Discord, отметки прослушиваний (Last.fm,
 *  ListenBrainz), медиа-клавиши.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Про статус подключения сервер спрашивается повторно, пока раздел открыт:
 *  сервер может быть ещё не поднят, и «Проверяем статус…» иначе висело бы
 *  вечно. Ожидание подтверждения Last.fm обрывается при уходе с экрана —
 *  иначе через две минуты пришёл бы тост про экран, который человек уже
 *  закрыл.
 *
 *  ВЕБ (волна 6, 2026-08-02). Раздел живёт и во вкладке браузера, но не
 *  целиком, и граница проходит ровно по тому, чем ряд ДЕЛАЕТ своё дело:
 *
 *   • Отметки прослушиваний — это сервер: Muza сама ходит в Last.fm и
 *     ListenBrainz за человека, клиент только показывает статус и передаёт
 *     согласие. Работает всюду, где есть аккаунт.
 *   • Статус в Discord — умение `discord`, и у страницы его нет ВОВСЕ:
 *     Discord слушает локальный сокет на том же устройстве, вкладка до него
 *     не дотянется. Поэтому ряда нет (не серого) и поиск его не находит —
 *     записи индекса помечены needs: "discord".
 *   • Медиаклавиши — Media Session API, один и тот же механизм на обеих
 *     площадках: приложение зовёт его из useMediaSession, страница — из
 *     своего плеера (apps/web/src/player.tsx). Настройка одна и работает
 *     одинаково, поэтому ряд общий.
 *
 *  ⚠️ Подключение Last.fm в браузере уводит в новую вкладку ПОСЛЕ ответа
 *  сервера. Браузер разрешает это, пока жив «след» нажатия (у Chromium ~5 с),
 *  так что медленный ответ сервера может стоить открытия вкладки — тогда
 *  человек видит подсказку «разреши доступ» без самой страницы Last.fm. */

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Switch } from "@muza/ui";
import { ApiError, type ScrobblingStatus } from "@muza/api-client";
import { useT } from "../../i18n";
import { paneStyle, RowValue, SettingInput, SettingRow } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

/** Повторы запроса статуса при лежачем сервере: сколько раз и с какой паузой.
 *  Пять попыток за ~2 минуты покрывают самый частый случай — приложение
 *  запустилось раньше своего сервера. */
const SCROB_RETRIES = 5;
const SCROB_RETRY_BASE_MS = 5000;
const SCROB_RETRY_MAX_MS = 60000;

export function IntegrationsPane() {
  const { t } = useT();
  const { prefs, set, api, serverSession, caps, platform, onNotify, openSub, paneClass } = useSettingsScreen();
  const openExternal = platform.system?.openExternal;

  const [scrob, setScrob] = useState<ScrobblingStatus | null>(null);
  const [scrobErr, setScrobErr] = useState(false);
  const [lfmWaiting, setLfmWaiting] = useState(false);
  const lfmCancelRef = useRef(false);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbToken, setLbToken] = useState("");
  const [lbErr, setLbErr] = useState<string | null>(null);
  const [lbBusy, setLbBusy] = useState(false);

  useEffect(() => {
    if (!serverSession) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    // ПОВТОР С ОТСТУПАНИЕМ, а не ровный интервал (правка 2026-08-03). Раньше
    // опрос стоял на setInterval и снимался ТОЛЬКО при успехе: сервер лежит,
    // раздел открыт — запрос каждые 5 секунд бесконечно, без пауз и потолка
    // попыток. Теперь пауза растёт (5, 10, 20, 40, 60 с), а после RETRIES
    // попыток опрос прекращается: ряды уже пишут «сервер недоступен», и молотить
    // лежачий сервер из открытой вкладки настроек незачем. Вернуться к проверке
    // можно перезаходом в раздел — эффект пересоздаётся.
    const load = async () => {
      try {
        const s = await api.getScrobbling();
        if (dead) return;
        setScrob(s);
        setScrobErr(false);
        // успех: сервер жив, дальше статус меняют кнопки этого же раздела
      } catch {
        if (dead) return;
        setScrobErr(true);
        tries += 1;
        if (tries >= SCROB_RETRIES) return;
        timer = setTimeout(() => void load(), Math.min(SCROB_RETRY_MAX_MS, SCROB_RETRY_BASE_MS * 2 ** (tries - 1)));
      }
    };
    void load();
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
    };
  }, [serverSession, api]);

  // Уход с экрана — ожидание подтверждения Last.fm останавливается
  useEffect(
    () => () => {
      lfmCancelRef.current = true;
    },
    [],
  );

  /** Last.fm: код → страница «Разрешить» снаружи → ждём подтверждения ~2 минуты. */
  const lfmConnect = async () => {
    setLfmWaiting(true);
    lfmCancelRef.current = false;
    try {
      const { token, authUrl } = await api.lastfmConnectStart();
      await openExternal?.(authUrl);
      onNotify(t("settings.integrations.lastfm.allowInBrowser"), "radio-tower");
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        if (lfmCancelRef.current) return;
        try {
          const { username } = await api.lastfmConnectComplete(token);
          setScrob((s) => (s ? { ...s, lastfm: { ...s.lastfm, connected: true, username } } : s));
          onNotify(t("settings.integrations.lastfm.connected", { username }), "radio-tower");
          return;
        } catch (e) {
          // 409 = ещё не нажал «Разрешить» — ждём дальше
          if (!(e instanceof ApiError && e.status === 409)) throw e;
        }
      }
      onNotify(t("settings.integrations.lastfm.errors.timeout"), "x");
    } catch (e) {
      onNotify(e instanceof ApiError ? e.message : t("settings.integrations.lastfm.errors.connectFailed"), "x");
    } finally {
      setLfmWaiting(false);
    }
  };

  const lfmDisconnect = async () => {
    try {
      await api.lastfmDisconnect();
      setScrob((s) => (s ? { ...s, lastfm: { ...s.lastfm, connected: false, username: null } } : s));
      onNotify(t("settings.integrations.lastfm.disconnected"), "radio-tower");
    } catch {
      onNotify(t("settings.integrations.lastfm.errors.disconnectFailed"), "x");
    }
  };

  const lbConnect = async () => {
    const token = lbToken.trim();
    if (token.length < 8) {
      setLbErr(t("settings.integrations.listenbrainz.errors.pasteToken"));
      return;
    }
    setLbBusy(true);
    setLbErr(null);
    try {
      const { username } = await api.listenbrainzConnect(token);
      setScrob((s) => (s ? { ...s, listenbrainz: { connected: true, username } } : s));
      setLbOpen(false);
      setLbToken("");
      onNotify(t("settings.integrations.listenbrainz.connected", { username }), "radio-tower");
    } catch (e) {
      setLbErr(e instanceof ApiError ? e.message : t("settings.integrations.listenbrainz.errors.connectFailed"));
    } finally {
      setLbBusy(false);
    }
  };

  const lbDisconnect = async () => {
    try {
      await api.listenbrainzDisconnect();
      setScrob((s) => (s ? { ...s, listenbrainz: { connected: false, username: null } } : s));
      onNotify(t("settings.integrations.listenbrainz.disconnected"), "radio-tower");
    } catch {
      onNotify(t("settings.integrations.listenbrainz.errors.disconnectFailed"), "x");
    }
  };

  return (
    <>
      <div className={paneClass} style={paneStyle}>
        {caps.has("discord") ? (
          <SettingRow title={t("settings.integrations.discord.rowTitle")} hint={t("settings.integrations.discord.rowHint")} onClick={() => openSub("discord")} chevron>
            <RowValue>{prefs.discordRpcOn ? t("common.on") : t("common.off")}</RowValue>
          </SettingRow>
        ) : null}
        <SettingRow
          title={t("settings.integrations.lastfm.title")}
          hint={
            !serverSession
              ? t("settings.integrations.needsAccount")
              : !scrob
                ? scrobErr
                  ? t("settings.integrations.serverUnavailable")
                  : t("settings.integrations.checkingStatus")
                : scrob.lastfm.connected
                  ? t("settings.integrations.lastfm.connectedAs", { username: scrob.lastfm.username ?? "" })
                  : scrob.lastfm.available
                    ? t("settings.integrations.lastfm.willSync")
                    : t("settings.integrations.lastfm.noApiKeys")
          }
        >
          {serverSession && scrob?.lastfm.connected ? (
            <Button variant="ghost" icon="unlink" onClick={() => void lfmDisconnect()}>
              {t("common.disconnect")}
            </Button>
          ) : serverSession && scrob?.lastfm.available ? (
            <Button variant="secondary" icon="link" disabled={lfmWaiting} onClick={() => void lfmConnect()}>
              {lfmWaiting ? t("settings.integrations.lastfm.waitingBrowser") : t("common.connect")}
            </Button>
          ) : (
            <RowValue>{serverSession && scrob ? t("settings.integrations.unavailable") : t("settings.integrations.notConnected")}</RowValue>
          )}
        </SettingRow>
        <SettingRow
          title={t("settings.integrations.listenbrainz.title")}
          hint={
            !serverSession
              ? t("settings.integrations.needsAccount")
              : !scrob && scrobErr
                ? t("settings.integrations.serverUnavailable")
                : scrob?.listenbrainz.connected
                  ? t("settings.integrations.listenbrainz.connectedAs", { username: scrob.listenbrainz.username ?? "" })
                  : t("settings.integrations.listenbrainz.hint")
          }
        >
          {serverSession && scrob?.listenbrainz.connected ? (
            <Button variant="ghost" icon="unlink" onClick={() => void lbDisconnect()}>
              {t("common.disconnect")}
            </Button>
          ) : serverSession && scrob ? (
            <Button
              variant="secondary"
              icon="link"
              onClick={() => {
                setLbErr(null);
                setLbToken("");
                setLbOpen(true);
              }}
            >
              {t("common.connect")}
            </Button>
          ) : (
            <RowValue>{t("settings.integrations.notConnected")}</RowValue>
          )}
        </SettingRow>
        <SettingRow title={t("settings.integrations.mediaKeys.title")} hint={t("settings.integrations.mediaKeys.hint")}>
          <Switch checked={prefs.mediaKeys} onChange={(mediaKeys: boolean) => set({ mediaKeys })} label={t("settings.integrations.mediaKeys.title")} />
        </SettingRow>
      </div>

      {/* ListenBrainz: личный код со страницы настроек сервиса */}
      <Dialog
        open={lbOpen}
        title={t("settings.integrations.listenbrainz.dialogTitle")}
        onClose={() => setLbOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setLbOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="link" disabled={lbBusy} onClick={() => void lbConnect()}>
              {lbBusy ? t("settings.integrations.listenbrainz.checking") : t("common.connect")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 320 }}>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.5 }}>{t("settings.integrations.listenbrainz.dialogBody")}</div>
          <Button
            variant="ghost"
            icon="external-link"
            onClick={() => void openExternal?.("https://listenbrainz.org/settings/")}
            style={{ alignSelf: "flex-start" }}
          >
            {t("settings.integrations.listenbrainz.openSettings")}
          </Button>
          <SettingInput value={lbToken} onChange={setLbToken} placeholder={t("settings.integrations.listenbrainz.tokenPlaceholder")} width={320} />
          {lbErr ? <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{lbErr}</div> : null}
        </div>
      </Dialog>
    </>
  );
}
