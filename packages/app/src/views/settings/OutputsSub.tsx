/** ПОД-ЭКРАН «ВЫВОД ЗВУКА»: на какие устройства играть, громкость каждого,
 *  подмешивание голоса и наборы устройств.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Экран ТОЛЬКО редактирует настройки: применением маршрутов на движок звука
 *  владеет плеер — он следит за prefs.audioOutputs. Поэтому сюда не надо
 *  прокидывать плеер, и поэтому экран смог переехать целиком.
 *
 *  Перечисление устройств — порт audioDevices: у площадки без него этого
 *  под-экрана нет вовсе, как и строки-входа в него. */

import { useEffect, useState } from "react";
import { Button, Dialog, IconButton, Select, Slider, Switch } from "@muza/ui";
import { useT } from "../../i18n";
import type { AudioDeviceInfo } from "../../platform";
import type { AudioOutputRoute, OutputProfile } from "../../prefs/types";
import { GroupTitle, paneStyle, SettingInput, SettingRow, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export function OutputsSub() {
  const { t } = useT();
  const { prefs, set, platform, closeSub, paneClass } = useSettingsScreen();
  const devicesPort = platform.audioDevices;

  const [outDevices, setOutDevices] = useState<AudioDeviceInfo[] | null>(null);
  const [inDevices, setInDevices] = useState<AudioDeviceInfo[]>([]);
  const refresh = () => {
    if (!devicesPort) return;
    void devicesPort.listOutputs().then(setOutDevices);
    void devicesPort.listInputs().then(setInDevices);
  };
  useEffect(() => {
    refresh();
    // Список устройств меняется, пока экран открыт: воткнули наушники — строка
    // должна появиться сама, а не после ручного обновления.
    const md = navigator.mediaDevices;
    const onChange = () => refresh();
    md?.addEventListener?.("devicechange", onChange);
    return () => md?.removeEventListener?.("devicechange", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devicesPort]);

  const outRoutes = prefs.audioOutputs;
  /** Маршрут устройства: по идентификатору, затем по имени (идентификатор
   *  мог смениться между запусками системы, имя — обычно нет). */
  const routeForDevice = (dev: AudioDeviceInfo) =>
    outRoutes.find((r) => r.deviceId === dev.deviceId) ?? outRoutes.find((r) => r.label === dev.label);
  /** Ручная правка уходит от применённого набора — снимаем отметку. */
  const setDeviceRoute = (dev: AudioDeviceInfo, on: boolean) => {
    const rest = outRoutes.filter((r) => r.deviceId !== dev.deviceId && r.label !== dev.label);
    set({
      audioOutputs: on ? [...rest, { deviceId: dev.deviceId, label: dev.label, volume: 100, followsMaster: true }] : rest,
      activeOutputProfile: "",
    });
  };
  const patchRoute = (target: AudioOutputRoute, patch: Partial<AudioOutputRoute>) => {
    set({
      audioOutputs: outRoutes.map((r) => (r === target ? { ...r, ...patch } : r)),
      activeOutputProfile: "",
    });
  };
  /** Сохранённые устройства, которых сейчас нет в системе, видны строками
   *  «недоступно»: и понятно, куда делся звук, и можно убрать. */
  const orphanRoutes =
    outDevices === null ? [] : outRoutes.filter((r) => !outDevices.some((d) => d.deviceId === r.deviceId || d.label === r.label));

  const [profileNameDraft, setProfileNameDraft] = useState<string | null>(null);
  const saveOutputProfile = (name: string) => {
    const id = `p${Date.now().toString(36)}`;
    set({
      outputProfiles: [...prefs.outputProfiles, { id, name, outputs: outRoutes.map((r) => ({ ...r })) }],
      activeOutputProfile: id,
    });
  };
  const applyOutputProfile = (p: OutputProfile) => set({ audioOutputs: p.outputs.map((r) => ({ ...r })), activeOutputProfile: p.id });
  const deleteOutputProfile = (id: string) =>
    set({
      outputProfiles: prefs.outputProfiles.filter((p) => p.id !== id),
      activeOutputProfile: prefs.activeOutputProfile === id ? "" : prefs.activeOutputProfile,
    });

  const deviceRow = (dev: AudioDeviceInfo) => {
    const r = routeForDevice(dev);
    const hint = r
      ? [
          r.followsMaster ? t("settings.outputs.device.linkedHint") : t("settings.outputs.device.independentHint"),
          r.mixMic ? t("settings.outputs.device.micHint") : null,
        ]
          .filter(Boolean)
          .join(" ")
      : undefined;
    return (
      <SettingRow key={dev.deviceId} title={dev.label} hint={hint}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          {r ? (
            <>
              <IconButton
                icon={r.mixMic ? "mic" : "mic-off"}
                size="sm"
                active={!!r.mixMic}
                label={r.mixMic ? t("settings.outputs.device.micOff") : t("settings.outputs.device.micOn")}
                onClick={() => patchRoute(r, { mixMic: !r.mixMic })}
              />
              <IconButton
                icon={r.followsMaster ? "link" : "unlink"}
                size="sm"
                active={!!r.followsMaster}
                label={r.followsMaster ? t("settings.outputs.device.unlink") : t("settings.outputs.device.link")}
                onClick={() => patchRoute(r, { followsMaster: !r.followsMaster })}
              />
              <Slider
                value={r.volume}
                onChange={(v: number) => patchRoute(r, { volume: Math.round(v) })}
                ariaLabel={t("settings.outputs.device.volumeAria", { name: dev.label })}
                valueText={`${r.volume} %`}
                style={{ width: 110 }}
              />
            </>
          ) : null}
          <Switch checked={!!r} onChange={(on: boolean) => setDeviceRoute(dev, on)} label={dev.label} />
        </div>
      </SettingRow>
    );
  };

  return (
    // Диалог имени набора — СОСЕДОМ панели, а не внутри неё: панель на время
    // анимации появления держит transform, а внутри трансформированного предка
    // `position: fixed` считается от него (замер — в шапке settingsShell.css).
    // Так же расставлены и все остальные диалоги настроек.
    <>
      <div className={paneClass} style={paneStyle}>
        <SubHeader title={t("settings.outputs.title")} onBack={closeSub} />
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.outputs.intro")}</div>

        <GroupTitle>{t("settings.outputs.devicesGroup")}</GroupTitle>
        {outDevices === null ? (
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.outputs.loading")}</div>
        ) : outDevices.length === 0 ? (
          // Пустой список — две разные беды с одинаковым видом. Пока их не
          // различали, человека с запретом микрофона в системе отправляли
          // проверять провода.
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
            {t(devicesPort?.accessDenied() ? "settings.outputs.blocked" : "settings.outputs.empty")}
          </div>
        ) : (
          outDevices.map(deviceRow)
        )}
        {orphanRoutes.map((r) => (
          <SettingRow key={`orphan-${r.deviceId}`} title={r.label} hint={t("settings.outputs.device.missingHint")}>
            <Switch
              checked
              onChange={() => set({ audioOutputs: outRoutes.filter((x) => x !== r), activeOutputProfile: "" })}
              label={r.label}
            />
          </SettingRow>
        ))}
        <div>
          <Button variant="ghost" icon="refresh-cw" onClick={refresh}>
            {t("settings.outputs.refresh")}
          </Button>
        </div>

        <GroupTitle>{t("settings.outputs.voiceGroup")}</GroupTitle>
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.outputs.voiceIntro")}</div>
        <SettingRow title={t("settings.outputs.micDevice.title")} hint={t("settings.outputs.micDevice.hint")}>
          <Select
            items={[
              { key: "default", label: t("settings.outputs.micDevice.systemDefault") },
              ...inDevices.map((d) => ({ key: d.deviceId, label: d.label })),
            ]}
            value={prefs.micDeviceId || "default"}
            onChange={(key: string) => {
              const dev = inDevices.find((d) => d.deviceId === key);
              set(key === "default" ? { micDeviceId: "", micDeviceLabel: "" } : { micDeviceId: key, micDeviceLabel: dev?.label ?? "" });
            }}
            ariaLabel={t("settings.outputs.micDevice.title")}
            width={260}
          />
        </SettingRow>
        <SettingRow title={t("settings.outputs.micGain.title")} hint={t("settings.outputs.micGain.hint")}>
          <Slider
            value={prefs.micGain}
            onChange={(v: number) => set({ micGain: Math.round(v) })}
            ariaLabel={t("settings.outputs.micGain.title")}
            valueText={`${prefs.micGain} %`}
            style={{ width: 160 }}
          />
        </SettingRow>

        <GroupTitle>{t("settings.outputs.profilesGroup")}</GroupTitle>
        {prefs.outputProfiles.map((p) => (
          <SettingRow key={p.id} title={p.name} hint={p.outputs.map((o) => o.label).join(" · ") || t("settings.outputs.profileSystem")}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              {prefs.activeOutputProfile === p.id ? (
                <span style={{ fontSize: "var(--fs-caption)", color: "var(--accent-text, var(--accent))" }}>
                  {t("settings.outputs.profileActive")}
                </span>
              ) : (
                <Button variant="ghost" onClick={() => applyOutputProfile(p)}>
                  {t("settings.outputs.profileApply")}
                </Button>
              )}
              <IconButton icon="trash-2" size="sm" label={t("settings.outputs.profileDelete")} onClick={() => deleteOutputProfile(p.id)} />
            </div>
          </SettingRow>
        ))}
        <div>
          <Button icon="plus" disabled={outRoutes.length === 0} onClick={() => setProfileNameDraft("")}>
            {t("settings.outputs.profileSave")}
          </Button>
        </div>
      </div>

      <Dialog
        open={profileNameDraft !== null}
        title={t("settings.outputs.profileDialog.title")}
        onClose={() => setProfileNameDraft(null)}
        actions={
          <>
            <Button onClick={() => setProfileNameDraft(null)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              disabled={!profileNameDraft?.trim()}
              onClick={() => {
                if (profileNameDraft?.trim()) saveOutputProfile(profileNameDraft.trim());
                setProfileNameDraft(null);
              }}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <SettingInput
          value={profileNameDraft ?? ""}
          onChange={(v) => setProfileNameDraft(v)}
          placeholder={t("settings.outputs.profileDialog.placeholder")}
          width={300}
        />
      </Dialog>
    </>
  );
}
