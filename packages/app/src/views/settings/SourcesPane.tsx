/** РАЗДЕЛ «ИСТОЧНИКИ»: откуда брать звук и как искать.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Три переключателя площадок связаны правилом «последний не выключается»:
 *  выключить все три значит остаться без звука вообще, поэтому единственный
 *  оставшийся включённым переключатель гаснет. Это не «нет умения», а защита
 *  от тупика — потому и disabled, а не отсутствие ряда.
 *
 *  ⚠️ ОДИН РАЗДЕЛ НА ОБЕ ПРОГРАММЫ с 2026-08-11 (до этого веб рисовал свою
 *  копию с ОДНИМ рядом из шести). Что чем закрыто:
 *   - политика и три переключателя площадок — умение `sourcePicker`: их
 *     исполняет добыча на устройстве, у веба поток приходит от сервера;
 *   - «Прямые ссылки и файлы» — `localFiles`;
 *   - охват поиска, мгновенный поиск и группировка — есть у обеих: их читает
 *     общий экран поиска (views/SearchView) на любой площадке. */

import { Switch, Tabs } from "@muza/ui";
import { useT } from "../../i18n";
import type { Prefs } from "../../prefs/types";
import { GroupTitle, paneStyle, RowValue, SettingRow } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export function SourcesPane() {
  const { t } = useT();
  const { prefs, set, caps, paneClass } = useSettingsScreen();
  return (
    <div className={paneClass} style={paneStyle}>
      {caps.has("sourcePicker") ? (
        <SettingRow title={t("settings.sources.policy.title")} hint={t("settings.sources.policy.hint")}>
          <Tabs
            items={[
              { key: "official", label: t("settings.sources.policy.official") },
              { key: "soundcloudFirst", label: t("settings.sources.policy.soundcloudFirst") },
            ]}
            value={prefs.sourcePolicy}
            onChange={(k: string) => set({ sourcePolicy: k as Prefs["sourcePolicy"] })}
          />
        </SettingRow>
      ) : null}
      {/* Переключатели площадок — ЧАСТЬ ТОГО ЖЕ УМЕНИЯ, что и политика выше, и
          исчезают вместе с ней: и то и другое читает ОДНА функция на устройстве
          (applySourcePolicy) — она фильтрует и сортирует список источников
          перед добычей. Там, где поток добывает не программа, а сервер
          (браузер: getStreamUrl отдаёт готовый подписанный адрес и про
          источники ничего не спрашивает), три тумблера были бы переключателями
          в никуда — а такой хуже отсутствующего. */}
      {caps.has("sourcePicker") ? (
        <>
          <GroupTitle>{t("settings.sources.priorityGroup")}</GroupTitle>
          <SettingRow title="YouTube / YT Music" hint={t("settings.sources.youtube.hint")}>
            <Switch
              checked={prefs.sourcesEnabled.youtube}
              disabled={prefs.sourcesEnabled.youtube && !prefs.sourcesEnabled.soundcloud && !prefs.sourcesEnabled.bandcamp}
              onChange={(on: boolean) => set({ sourcesEnabled: { ...prefs.sourcesEnabled, youtube: on } })}
              label="YouTube / YT Music"
            />
          </SettingRow>
          <SettingRow title="SoundCloud" hint={t("settings.sources.soundcloud.hint")}>
            <Switch
              checked={prefs.sourcesEnabled.soundcloud}
              disabled={prefs.sourcesEnabled.soundcloud && !prefs.sourcesEnabled.youtube && !prefs.sourcesEnabled.bandcamp}
              onChange={(on: boolean) => set({ sourcesEnabled: { ...prefs.sourcesEnabled, soundcloud: on } })}
              label="SoundCloud"
            />
          </SettingRow>
          <SettingRow title="Bandcamp" hint={t("settings.sources.bandcamp.hint")}>
            <Switch
              checked={prefs.sourcesEnabled.bandcamp}
              disabled={prefs.sourcesEnabled.bandcamp && !prefs.sourcesEnabled.youtube && !prefs.sourcesEnabled.soundcloud}
              onChange={(on: boolean) => set({ sourcesEnabled: { ...prefs.sourcesEnabled, bandcamp: on } })}
              label="Bandcamp"
            />
          </SettingRow>
        </>
      ) : null}
      <GroupTitle>{t("settings.sources.searchGroup")}</GroupTitle>
      <SettingRow title={t("settings.sources.searchScope.title")} hint={t("settings.sources.searchScope.hint")}>
        <Tabs
          items={[
            { key: "all", label: t("settings.sources.searchScope.all") },
            { key: "catalog", label: t("settings.sources.searchScope.catalogOnly") },
          ]}
          value={prefs.searchScope}
          onChange={(k: string) => set({ searchScope: k as Prefs["searchScope"] })}
        />
      </SettingRow>
      <SettingRow title={t("settings.sources.instantSearch.title")} hint={t("settings.sources.instantSearch.hint")}>
        <Switch checked={prefs.instantSearch} onChange={(instantSearch: boolean) => set({ instantSearch })} label={t("settings.sources.instantSearch.title")} />
      </SettingRow>
      <SettingRow title={t("settings.sources.searchGrouping.title")} hint={t("settings.sources.searchGrouping.hint")}>
        <Switch
          checked={prefs.searchGrouping}
          onChange={(searchGrouping: boolean) => set({ searchGrouping })}
          label={t("settings.sources.searchGrouping.title")}
        />
      </SettingRow>
      {caps.has("localFiles") ? (
        <SettingRow title={t("settings.sources.directLocal.title")} hint={t("settings.sources.directLocal.hint")}>
          <RowValue>{t("settings.sources.directLocal.value")}</RowValue>
        </SettingRow>
      ) : null}
    </div>
  );
}
