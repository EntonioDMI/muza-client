/** РАЗДЕЛ «РАСШИРЕНИЯ»: установка из файла, список установленных, журнал их
 *  ошибок и вход на витрину.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  Экран согласия на права здесь НЕ рисуется: он общий и живёт в провайдере
 *  экрана (settingsContext.tsx) — ставить расширение можно и отсюда, и с
 *  витрины, а спрашивать человека надо одинаково.
 *
 *  Визуализатор и отклик на бас устроены внутри как встроенные расширения и
 *  жили в этом разделе, но человеку это неоткуда знать — он ищет их во
 *  внешнем виде. Ряды переехали в «Кастомизацию», здесь осталась строка-
 *  указатель, ведущая ровно туда. */

import { Badge, Button, IconButton, Switch } from "@muza/ui";
import { isFullAccessManifest } from "@muza/core";
import { useT } from "../../i18n";
import { GroupTitle, paneStyle, RowValue, SettingRow } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

export function ExtensionsPane() {
  const { t } = useT();
  const { caps, plugins, goTo, openSub, setMarketFilter, paneClass } = useSettingsScreen();
  const canPlugins = caps.has("plugins");
  const openMarket = (filter: "themes" | "plugins") => {
    setMarketFilter(filter);
    openSub("market");
  };

  return (
    <div className={paneClass} style={paneStyle}>
      {canPlugins ? (
        <>
          <GroupTitle>{t("settings.extensions.builtInGroup")}</GroupTitle>
          <SettingRow
            title={t("settings.extensions.visualizerMoved.title")}
            hint={t("settings.extensions.visualizerMoved.hint")}
            onClick={() => goTo("appearance", "customize")}
            chevron
          ></SettingRow>
          <GroupTitle>{t("settings.extensions.externalGroup")}</GroupTitle>
          <SettingRow title={t("settings.extensions.installFromFile.title")} hint={t("settings.extensions.installFromFile.hint")}>
            <Button variant="ghost" icon="folder-open" disabled={plugins.busy} onClick={() => void plugins.installFromFile()}>
              {t("settings.extensions.installFromFile.button")}
            </Button>
          </SettingRow>
          {plugins.installed.length === 0 ? (
            <SettingRow title={t("settings.extensions.installed.title")} hint={t("settings.extensions.installed.emptyHint")}>
              <RowValue>{t("settings.extensions.installed.zero")}</RowValue>
            </SettingRow>
          ) : (
            plugins.installed.map((p) => (
              <SettingRow
                key={p.id}
                title={p.manifest.name}
                titleExtra={
                  isFullAccessManifest(p.manifest) ? (
                    <Badge tone="accent" style={{ background: "color-mix(in srgb, var(--danger) 22%, transparent)", color: "var(--danger)" }}>
                      {t("settings.extensions.fullAccessBadge")}
                    </Badge>
                  ) : undefined
                }
                hint={t("settings.extensions.installed.hint", { version: p.version, author: p.manifest.author, n: p.granted.length })}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  <Switch
                    checked={p.enabled}
                    onChange={(on: boolean) => void plugins.setEnabled(p.id, on)}
                    label={t("settings.extensions.installed.enableAria", { name: p.manifest.name })}
                  />
                  <IconButton
                    icon="trash-2"
                    size="sm"
                    label={t("settings.extensions.installed.deleteAria", { name: p.manifest.name })}
                    onClick={() => void plugins.remove(p.id, p.manifest.name)}
                  />
                </div>
              </SettingRow>
            ))
          )}
          {plugins.errors.length > 0 ? (
            <>
              <GroupTitle>{t("settings.extensions.errorsGroup")}</GroupTitle>
              {plugins.errors.map((err, i) => (
                <SettingRow
                  key={`${err.pluginId}-${err.at}-${i}`}
                  title={plugins.installed.find((p) => p.id === err.pluginId)?.manifest.name ?? err.pluginId}
                  hint={err.message}
                  danger
                >
                  <RowValue>{new Date(err.at).toLocaleTimeString()}</RowValue>
                </SettingRow>
              ))}
              <SettingRow title={t("settings.extensions.errorLog.title")} hint={t("settings.extensions.errorLog.hint", { n: plugins.errors.length })}>
                <Button variant="ghost" icon="trash-2" onClick={plugins.clearErrors}>
                  {t("settings.extensions.errorLog.clear")}
                </Button>
              </SettingRow>
            </>
          ) : null}
          <SettingRow title={t("settings.extensions.pluginMarket.title")} hint={t("settings.extensions.pluginMarket.hint")} onClick={() => openMarket("plugins")} chevron></SettingRow>
        </>
      ) : null}
      {/* ⚠️ ЗДЕСЬ БЫЛ ВТОРОЙ ВХОД В ВИТРИНУ — «Маркетплейс тем». Удалён
          2026-08-11 (решение владельца): у оформлений теперь один дом,
          «Внешний вид → Кастомизация → Маркетплейс тем», и он есть на обеих
          площадках. Пока вход был здесь, тема — просто набор значений
          настроек — оказывалась заперта в разделе, который требует Tauri.
          Два входа в один экран к тому же ничем не отличались: оба открывали
          витрину с фильтром «оформления». */}
    </div>
  );
}
