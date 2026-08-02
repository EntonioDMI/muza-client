/** РАЗДЕЛ «ВОСПРОИЗВЕДЕНИЕ»: переходы между треками, звук, очередь,
 *  рекомендации, поток и таймер сна.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Здесь дважды применена конвенция «пресеты поверх обычных полей»: строка
 *  чипов задаёт понятный набор («Экономно» / «Обычно» / «Максимум»), а точные
 *  ползунки прячутся под стрелкой «Настроить». Активный чип НЕ хранится
 *  полем — он вычисляется сравнением текущих значений с набором, поэтому
 *  «Своё» появляется само, как только человек тронул ползунок. */

import { useEffect, useRef, useState } from "react";
import { Switch, Tabs } from "@muza/ui";
import type { RecsSettings } from "@muza/api-client";
import { useT } from "../../i18n";
import { DEFAULT_PREFS, type Prefs } from "../../prefs/types";
import { matchPreset, PRESETS_WARM } from "../../prefs/presets";
import { DisabledSlider, GroupTitle, LiveSlider, paneStyle, PresetRow, RowValue, SettingRow, StepsEditor } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

/** Шаг перемотки: чипы 5/10/30 с — та же конвенция «пресеты поверх обычного
 *  поля», набор локальный (одно поле). */
const SEEK_PRESETS: Record<string, Partial<Prefs>> = {
  s5: { seekStepSec: 5 },
  s10: { seekStepSec: 10 },
  s30: { seekStepSec: 30 },
};

/** Ручки рекомендаций: доля новизны и период возврата любимого. Значения
 *  живут НА СЕРВЕРЕ (не в настройках устройства) — они про подбор музыки,
 *  а он общий для всех устройств человека. Запись отложенная: тянуть
 *  ползунок и слать запрос на каждый пиксель было бы расточительно.
 *
 *  Экспортируется ради страницы настроек веба (apps/web/app/(app)/settings):
 *  свой раздел «Воспроизведение» она собирает сама — половины рядов приложения
 *  во вкладке браузера не бывает, — но подбор музыки делает ОДИН сервер, и
 *  вторая пара ползунков с той же отложенной записью была бы копией правды.
 *  Всё нужное эти два ряда берут из контекста экрана настроек, который у веба
 *  теперь тоже есть. */
export function RecsTuning() {
  const { t } = useT();
  const { api, serverSession, onNotify } = useSettingsScreen();
  const [s, setS] = useState<RecsSettings | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!serverSession) return;
    let alive = true;
    api
      .getRecsSettings()
      .then((v) => {
        if (alive) setS(v);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, serverSession]);

  const push = (next: { epsilon?: number; tauScale?: number }) => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      api
        .updateRecsSettings(next)
        .then(setS)
        .catch(() => onNotify(t("settings.playback.recs.saveFailed"), "x"));
    }, 600);
  };

  if (!serverSession || s === null) {
    return (
      <SettingRow title={t("settings.playback.recs.title")} hint={serverSession ? t("common.loading") : t("settings.playback.recs.needsAccount")}>
        <DisabledSlider value={30} max={100} label={t("settings.playback.recs.title")} />
      </SettingRow>
    );
  }

  // Шкала периода геометрическая: на линейной «чаще» зажималось бы в первых 20%
  const tauPos = Math.round((Math.log(s.tauScale / s.tauScaleMin) / Math.log(s.tauScaleMax / s.tauScaleMin)) * 100);
  const tauFromPos = (v: number) =>
    Math.round(s.tauScaleMin * Math.pow(s.tauScaleMax / s.tauScaleMin, v / 100) * 100) / 100;

  return (
    <>
      <SettingRow title={t("settings.playback.recs.novelty.title")} hint={t("settings.playback.recs.novelty.hint")}>
        <LiveSlider
          value={Math.round(s.epsilon * 100)}
          max={Math.round(s.epsilonMax * 100)}
          label={t("settings.playback.recs.novelty.title")}
          suffix={`${Math.round(s.epsilon * 100)} %`}
          onChange={(v) => {
            const epsilon = Math.round(v) / 100;
            setS({ ...s, epsilon });
            push({ epsilon });
          }}
        />
      </SettingRow>
      <SettingRow title={t("settings.playback.recs.repeats.title")} hint={t("settings.playback.recs.repeats.hint")}>
        <LiveSlider
          value={tauPos}
          max={100}
          label={t("settings.playback.recs.repeats.title")}
          suffix={`×${s.tauScale}`}
          onChange={(v) => {
            const tauScale = tauFromPos(v);
            setS({ ...s, tauScale });
            push({ tauScale });
          }}
        />
      </SettingRow>
    </>
  );
}

export function PlaybackPane() {
  const { t } = useT();
  const { prefs, set, caps, openSub, paneClass } = useSettingsScreen();
  return (
    <div className={paneClass} style={paneStyle}>
      <GroupTitle>{t("settings.playback.transitionsGroup")}</GroupTitle>
      <SettingRow title={t("settings.playback.crossfade.title")} hint={t("settings.playback.crossfade.hint")}>
        <Switch checked={prefs.crossfade} onChange={(v: boolean) => set({ crossfade: v })} label={t("settings.playback.crossfade.title")} />
      </SettingRow>
      {/* Длительность имеет смысл только при включённом плавном переходе —
          прячем ползунок целиком, а не гасим. */}
      {prefs.crossfade ? (
        <SettingRow title={t("settings.playback.crossfade.duration.title")} hint={t("settings.playback.crossfade.duration.hint")}>
          <LiveSlider
            value={prefs.crossfadeSec - 1}
            max={11}
            label={t("settings.playback.crossfade.duration.title")}
            suffix={t("settings.playback.crossfade.duration.seconds", { n: prefs.crossfadeSec })}
            onChange={(v) => set({ crossfadeSec: 1 + Math.round(v) })}
          />
        </SettingRow>
      ) : null}
      <SettingRow
        title={t("settings.playback.gapless.title")}
        hint={prefs.crossfade ? t("settings.playback.gapless.hintCrossfadeOn") : t("settings.playback.gapless.hint")}
      >
        <Switch checked={prefs.gapless} onChange={(v: boolean) => set({ gapless: v })} label={t("settings.playback.gapless.title")} />
      </SettingRow>
      <GroupTitle>{t("settings.playback.soundGroup")}</GroupTitle>
      <SettingRow title={t("settings.playback.equalizer.rowTitle")} hint={t("settings.playback.equalizer.rowHint")} onClick={() => openSub("equalizer")} chevron>
        <RowValue>{prefs.eqOn ? prefs.eqPreset : t("common.off")}</RowValue>
      </SettingRow>
      {caps.has("audioOutputs") ? (
        <SettingRow title={t("settings.playback.outputs.rowTitle")} hint={t("settings.playback.outputs.rowHint")} onClick={() => openSub("outputs")} chevron>
          <RowValue>
            {prefs.audioOutputs.length === 0
              ? t("settings.playback.outputs.system")
              : prefs.audioOutputs.length === 1
                ? prefs.audioOutputs[0].label
                : t("settings.playback.outputs.count", { n: prefs.audioOutputs.length })}
          </RowValue>
        </SettingRow>
      ) : null}
      <SettingRow title={t("settings.playback.normalize.title")} hint={t("settings.playback.normalize.hint")}>
        <Switch checked={prefs.normalize} onChange={(v: boolean) => set({ normalize: v })} label={t("settings.playback.normalize.title")} />
      </SettingRow>
      <SettingRow title={t("settings.playback.speedSteps.title")} hint={t("settings.playback.speedSteps.hint")}>
        <StepsEditor
          values={prefs.speedSteps}
          onApply={(speedSteps) => set({ speedSteps })}
          min={0.25}
          max={4}
          maxCount={8}
          fallback={DEFAULT_PREFS.speedSteps}
          suffix="×"
        />
      </SettingRow>
      <GroupTitle>{t("settings.playback.queueGroup")}</GroupTitle>
      <SettingRow title={t("settings.playback.radioEndless.title")} hint={t("settings.playback.radioEndless.hint")}>
        <Switch checked={prefs.radioEndless} onChange={(v: boolean) => set({ radioEndless: v })} label={t("settings.playback.radioEndless.title")} />
      </SettingRow>
      <GroupTitle>{t("settings.playback.recsGroup")}</GroupTitle>
      <RecsTuning />
      <SettingRow title={t("settings.playback.resumePosition.title")} hint={t("settings.playback.resumePosition.hint")}>
        <Switch
          checked={prefs.resumePosition}
          onChange={(resumePosition: boolean) => set({ resumePosition })}
          label={t("settings.playback.resumePosition.ariaLabel")}
        />
      </SettingRow>
      <GroupTitle>{t("settings.playback.streamGroup")}</GroupTitle>
      <SettingRow title={t("settings.playback.streamQuality.title")} hint={t("settings.playback.streamQuality.hint")}>
        <Tabs
          items={[
            { key: "auto", label: t("settings.playback.streamQuality.auto") },
            { key: "econom", label: t("settings.playback.streamQuality.econom") },
          ]}
          value={prefs.streamQuality}
          onChange={(k: string) => set({ streamQuality: k as Prefs["streamQuality"] })}
        />
      </SettingRow>
      {/* Подготовка очереди — одной строкой пресетов, точные числа под
          «Настроить». */}
      <PresetRow
        title={t("settings.playback.queuePrep.title")}
        hint={t("settings.playback.queuePrep.hint")}
        chips={[
          { key: "eco", label: t("settings.playback.queuePrep.presets.eco") },
          { key: "normal", label: t("settings.playback.queuePrep.presets.normal") },
          { key: "max", label: t("settings.playback.queuePrep.presets.max") },
        ]}
        active={matchPreset(PRESETS_WARM, prefs)}
        onPick={(k) => set(PRESETS_WARM[k])}
      >
        <SettingRow title={t("settings.playback.queuePrep.warm.title")} hint={t("settings.playback.queuePrep.warm.hint")}>
          <LiveSlider
            value={prefs.warmAhead}
            max={30}
            label={t("settings.playback.queuePrep.warm.title")}
            suffix={t("settings.playback.units.tracks", { n: prefs.warmAhead })}
            onChange={(v) => set({ warmAhead: Math.round(v) })}
          />
        </SettingRow>
        <SettingRow title={t("settings.playback.queuePrep.preload.title")} hint={t("settings.playback.queuePrep.preload.hint")}>
          <LiveSlider
            value={prefs.preloadAheadSec - 5}
            max={55}
            label={t("settings.playback.queuePrep.preload.title")}
            suffix={t("settings.playback.units.seconds", { n: prefs.preloadAheadSec })}
            onChange={(v) => set({ preloadAheadSec: 5 + Math.round(v) })}
          />
        </SettingRow>
      </PresetRow>
      {/* Шаг перемотки: чипы 5/10/30 с, своё значение — под «Настроить». */}
      <PresetRow
        title={t("settings.playback.seekStep.title")}
        hint={t("settings.playback.seekStep.hint")}
        chips={[
          { key: "s5", label: t("settings.playback.units.seconds", { n: 5 }) },
          { key: "s10", label: t("settings.playback.units.seconds", { n: 10 }) },
          { key: "s30", label: t("settings.playback.units.seconds", { n: 30 }) },
        ]}
        active={matchPreset(SEEK_PRESETS, prefs)}
        onPick={(k) => set(SEEK_PRESETS[k])}
      >
        <SettingRow title={t("settings.playback.seekStep.fine.title")} hint={t("settings.playback.seekStep.fine.hint")}>
          <LiveSlider
            value={prefs.seekStepSec - 1}
            max={59}
            label={t("settings.playback.seekStep.fine.title")}
            suffix={t("settings.playback.units.seconds", { n: prefs.seekStepSec })}
            onChange={(v) => set({ seekStepSec: 1 + Math.round(v) })}
          />
        </SettingRow>
      </PresetRow>
      <SettingRow title={t("settings.playback.sleepTimer.title")} hint={t("settings.playback.sleepTimer.hint")}>
        <StepsEditor
          values={prefs.sleepPresets}
          onApply={(sleepPresets) => set({ sleepPresets: sleepPresets.map(Math.round) })}
          min={1}
          max={600}
          maxCount={6}
          fallback={DEFAULT_PREFS.sleepPresets}
          suffix={t("settings.playback.sleepTimer.minSuffix")}
        />
      </SettingRow>
    </div>
  );
}
