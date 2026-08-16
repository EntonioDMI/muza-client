/** ПОД-ЭКРАН «ВИТРИНА»: чужие оформления и расширения с сервера.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки.
 *
 *  ГДЕ ВХОД (2026-08-11, решение владельца): «Внешний вид → Кастомизация →
 *  Маркетплейс тем» — на ОБЕИХ площадках. Раньше домом витрины числились
 *  «Расширения», и оформления были заперты вместе с плагинами в разделе,
 *  которого у браузера нет вовсе. Вход из «Расширений» остался, но только за
 *  половиной расширений («Маркетплейс расширений»). Дом в SUB_HOME_TAB —
 *  теперь `appearance`.
 *
 *  Две половины витрины устроены по-разному, и это осознанно:
 *   • оформления — просто данные, их ставит любая площадка (это набор
 *     значений настроек, ничего исполняемого);
 *   • расширения — исполняемый код, поэтому их половина держится на порте
 *     plugins, и установка идёт ТЕМ ЖЕ путём, что из файла: подготовка →
 *     общий экран согласия (он в провайдере) → установка. Второго, «лёгкого»
 *     пути установки быть не должно — иначе рано или поздно один из них
 *     забудет спросить человека.
 *
 *  Оформление с чужим CSS честно предупреждает перед установкой: CSS может
 *  переопределить в интерфейсе что угодно, и молча этого делать нельзя. */

import { useEffect, useState } from "react";
import { Badge, Button, ChipGroup, Dialog, Icon, IconButton } from "@muza/ui";
import { ApiError, type MarketPlugin, type MarketTheme, humanError } from "@muza/api-client";
import { useT } from "../../i18n";
// Список сохранённых оформлений здесь не держим: его читает «Кастомизация»
// при входе (listThemes — это чтение хранилища устройства), и после
// addTheme ниже она увидит новое оформление сама.
import { addTheme, applyTheme, sanitizeTokens, tokensFromPrefs } from "../../prefs/themes";
import { GroupTitle, paneStyle, SettingInput, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

/** Карточка оформления: превью собирается из самих значений — глядя на
 *  карточку, человек видит будущий фон и акцент, а не абстрактную плашку. */
function MarketThemeCard({
  theme,
  onInstall,
  onRemove,
  onReport,
}: {
  theme: MarketTheme;
  onInstall: () => void;
  onRemove?: () => void;
  onReport?: () => void;
}) {
  const { t } = useT();
  const p = theme.payload as { accent?: string; customAccent?: string; bgColor?: string; baseBg?: string; bgType?: string; customCss?: string };
  const accent =
    p.accent === "custom" && typeof p.customAccent === "string"
      ? p.customAccent
      : p.accent === "red"
        ? "#f76967"
        : p.accent === "bolt"
          ? "#327ad9"
          : "#3b82f6";
  const bg =
    p.bgType === "color" || p.bgType === "gradient"
      ? typeof p.bgColor === "string"
        ? p.bgColor
        : "#121110"
      : p.baseBg === "amoled"
        ? "#000000"
        : p.baseBg === "warm"
          ? "#151110"
          : p.baseBg === "cold"
            ? "#0f1114"
            : "#121110";
  const hasCss = typeof p.customCss === "string" && p.customCss.trim().length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", padding: "var(--sp-4)", borderRadius: "var(--r-md)", background: "var(--surface-2)" }}>
      <div
        aria-hidden="true"
        style={{
          height: 64,
          borderRadius: "var(--r-sm)",
          background: `linear-gradient(120deg, ${bg} 0%, ${bg} 62%, ${accent} 62%)`,
          outline: "1px solid var(--hairline)",
          outlineOffset: -1,
        }}
      ></div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-body)", fontWeight: 400, color: "var(--text-1)" }}>{theme.name}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
          {theme.author} · {t("settings.market.installsCount", { n: theme.installs })}
          {hasCss ? ` · ${t("settings.market.hasCss")}` : ""}
          {theme.hidden ? <span style={{ color: "var(--danger)" }}> · {t("settings.market.hiddenByModeration")}</span> : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <Button variant="secondary" icon="download" onClick={onInstall}>
          {t("common.install")}
        </Button>
        {onRemove ? <IconButton icon="trash-2" label={t("settings.market.unpublish")} onClick={onRemove} /> : null}
        {onReport ? <IconButton icon="flag" label={t("settings.market.report")} onClick={onReport} /> : null}
      </div>
    </div>
  );
}

/** Карточка расширения: бейджи «Полный доступ» и «На модерации» видны ДО
 *  установки — про полный доступ человек должен узнать не в момент, когда
 *  уже жмёт «Установить». */
function MarketPluginCard({
  item,
  isAdmin,
  installing,
  onInstall,
  onRemove,
  onReport,
  onHideToggle,
  onApprove,
}: {
  item: MarketPlugin;
  isAdmin: boolean;
  installing: boolean;
  onInstall: () => void;
  onRemove?: () => void;
  onReport?: () => void;
  onHideToggle?: () => void;
  onApprove?: () => void;
}) {
  const { t } = useT();
  const manifest = (item.payload as { manifest?: { description?: string } }).manifest;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", padding: "var(--sp-4)", borderRadius: "var(--r-md)", background: "var(--surface-2)" }}>
      <div
        aria-hidden="true"
        style={{
          height: 64,
          borderRadius: "var(--r-sm)",
          background: "var(--accent-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="puzzle" size={28} color="var(--accent-text)" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--fs-body)", fontWeight: 400, color: "var(--text-1)" }}>{item.name}</span>
          {item.fullAccess ? (
            <Badge tone="accent" style={{ background: "color-mix(in srgb, var(--danger) 22%, transparent)", color: "var(--danger)" }}>
              {t("settings.extensions.fullAccessBadge")}
            </Badge>
          ) : null}
          {item.pending ? <Badge tone="neutral">{t("settings.market.pendingBadge")}</Badge> : null}
        </div>
        {manifest?.description ? (
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: 2, lineHeight: 1.5 }}>{manifest.description}</div>
        ) : null}
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
          {item.author} · v{item.version} · {t("settings.market.installsCount", { n: item.installs })}
          {item.hidden ? <span style={{ color: "var(--danger)" }}> · {t("settings.market.hiddenByModerationShort")}</span> : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
        <Button variant="secondary" icon="download" disabled={installing} onClick={onInstall}>
          {installing ? t("settings.market.installing") : t("common.install")}
        </Button>
        {onRemove ? <IconButton icon="trash-2" label={t("settings.market.unpublish")} onClick={onRemove} /> : null}
        {onReport ? <IconButton icon="flag" label={t("settings.market.report")} onClick={onReport} /> : null}
        {isAdmin && onHideToggle ? (
          <IconButton
            icon={item.hidden ? "eye" : "eye-off"}
            label={item.hidden ? t("settings.market.unhide") : t("settings.market.hide")}
            onClick={onHideToggle}
          />
        ) : null}
        {isAdmin && item.pending && onApprove ? (
          <Button variant="primary" icon="check" onClick={onApprove}>
            {t("settings.market.approve")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function MarketSub() {
  // lang — для дефолтного имени темы в addTheme (у витрины имя обычно своё,
  // но безымянная тема не должна становиться английской в русском интерфейсе).
  const { t, lang } = useT();
  const { prefs, setPrefs, api, serverSession, isAdmin, caps, plugins, onNotify, marketFilter, setMarketFilter, closeSub, paneClass } =
    useSettingsScreen();
  const canPlugins = caps.has("plugins");

  const [marketThemes, setMarketThemes] = useState<MarketTheme[] | null>(null);
  const [marketPlugins, setMarketPlugins] = useState<MarketPlugin[] | null>(null);
  const [pluginInstalling, setPluginInstalling] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [publishErr, setPublishErr] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  // Оформление с чужим CSS честно предупреждает перед установкой
  const [cssWarnTheme, setCssWarnTheme] = useState<MarketTheme | null>(null);

  useEffect(() => {
    if (!serverSession) return;
    let alive = true;
    api
      .getMarketThemes()
      .then((themes) => {
        if (alive) setMarketThemes(themes);
      })
      .catch(() => {
        if (alive) setMarketThemes([]);
      });
    return () => {
      alive = false;
    };
  }, [serverSession, api]);

  useEffect(() => {
    if (!serverSession || !canPlugins) return;
    let alive = true;
    api
      .getMarketPlugins()
      .then((p) => {
        if (alive) setMarketPlugins(p);
      })
      .catch(() => {
        if (alive) setMarketPlugins([]);
      });
    return () => {
      alive = false;
    };
  }, [serverSession, canPlugins, api]);

  const doInstallTheme = async (theme: MarketTheme) => {
    // Счётчик установок — по возможности: сервер лёг, а значения уже у нас
    const installed = await api.installMarketTheme(theme.id).catch(() => null);
    const tokens = sanitizeTokens(installed?.payload ?? theme.payload);
    addTheme(theme.name, tokens, lang);
    setPrefs(applyTheme(tokens, prefs));
    setMarketThemes((list) => list?.map((x) => (x.id === theme.id ? { ...x, installs: x.installs + 1 } : x)) ?? list);
    onNotify(t("settings.market.themeInstalled", { name: theme.name }), "download");
  };

  const installTheme = async (theme: MarketTheme) => {
    const css = (theme.payload as { customCss?: unknown }).customCss;
    if (typeof css === "string" && css.trim().length > 0) {
      setCssWarnTheme(theme); // CSS может переопределить что угодно — спрашиваем
      return;
    }
    await doInstallTheme(theme);
  };

  const unpublishTheme = async (theme: MarketTheme) => {
    try {
      await api.deleteMarketTheme(theme.id);
      setMarketThemes((list) => list?.filter((x) => x.id !== theme.id) ?? list);
      onNotify(t("settings.market.themeUnpublished"), "trash-2");
    } catch {
      onNotify(t("settings.market.errors.unpublishThemeFailed"), "x");
    }
  };

  const reportTheme = async (theme: MarketTheme) => {
    try {
      await api.reportMarketTheme(theme.id);
      onNotify(t("settings.market.reportSent"), "flag");
    } catch (e) {
      onNotify(humanError(e, t("settings.market.errors.reportFailed")), "x");
    }
  };

  const openPublishTheme = () => {
    setPublishName("");
    setPublishErr(null);
    setPublishOpen(true);
  };
  const submitPublishTheme = async () => {
    if (publishName.trim().length < 2) {
      setPublishErr(t("settings.market.errors.nameTooShort"));
      return;
    }
    setPublishBusy(true);
    setPublishErr(null);
    try {
      const published = await api.publishMarketTheme(publishName.trim(), tokensFromPrefs(prefs));
      setMarketThemes((list) => {
        const rest = (list ?? []).filter((x) => x.id !== published.id);
        return [published, ...rest];
      });
      setPublishOpen(false);
      onNotify(t("settings.market.themePublished", { name: published.name }), "upload");
    } catch (e) {
      setPublishErr(humanError(e, t("settings.market.errors.publishFailed")));
    } finally {
      setPublishBusy(false);
    }
  };

  /** Скачивает содержимое расширения целиком и отдаёт его на подготовку —
   *  дальше открывается ОДИН И ТОТ ЖЕ экран согласия, что и при установке
   *  из файла (он живёт в провайдере экрана). */
  const installFromMarket = async (m: MarketPlugin) => {
    setPluginInstalling(m.id);
    try {
      const installed = await api.installMarketPlugin(m.id);
      const payload = installed.payload as {
        manifest?: Record<string, unknown>;
        code?: string;
        css?: string;
        strings?: Record<string, string>;
      };
      if (!payload.manifest || typeof payload.code !== "string") {
        throw new Error(t("settings.market.errors.corruptPayload"));
      }
      await plugins.installFromMarket({
        manifest: payload.manifest,
        code: payload.code,
        css: payload.css,
        strings: payload.strings,
      });
      setMarketPlugins((list) => list?.map((x) => (x.id === m.id ? { ...x, installs: x.installs + 1 } : x)) ?? list);
    } catch (e) {
      onNotify(humanError(e, t("settings.market.errors.installPluginFailed")), "x");
    } finally {
      setPluginInstalling(null);
    }
  };

  const unpublishMarketPlugin = async (m: MarketPlugin) => {
    try {
      await api.deleteMarketPlugin(m.id);
      setMarketPlugins((list) => list?.filter((x) => x.id !== m.id) ?? list);
      onNotify(t("settings.market.pluginUnpublished"), "trash-2");
    } catch {
      onNotify(t("settings.market.errors.unpublishPluginFailed"), "x");
    }
  };

  const reportMarketPlugin = async (m: MarketPlugin) => {
    try {
      await api.reportMarketPlugin(m.id);
      onNotify(t("settings.market.reportSent"), "flag");
    } catch (e) {
      onNotify(humanError(e, t("settings.market.errors.reportFailed")), "x");
    }
  };

  const toggleHideMarketPlugin = async (m: MarketPlugin) => {
    try {
      await api.hideMarketPlugin(m.id, !m.hidden);
      setMarketPlugins((list) => list?.map((x) => (x.id === m.id ? { ...x, hidden: !x.hidden } : x)) ?? list);
      onNotify(m.hidden ? t("settings.market.pluginUnhidden") : t("settings.market.pluginHidden"), m.hidden ? "eye" : "eye-off");
    } catch {
      onNotify(t("settings.market.errors.visibilityFailed"), "x");
    }
  };

  const approveMarketPluginRow = async (m: MarketPlugin) => {
    try {
      await api.approveMarketPlugin(m.id);
      setMarketPlugins((list) => list?.map((x) => (x.id === m.id ? { ...x, pending: false } : x)) ?? list);
      onNotify(t("settings.market.pluginApproved", { name: m.name }), "check");
    } catch {
      onNotify(t("settings.market.errors.approveFailed"), "x");
    }
  };

  return (
    <>
      <div className={paneClass} style={paneStyle}>
        <SubHeader title={t("settings.market.title")} onBack={closeSub} />
        <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          {/* ПЕРЕКЛЮЧАТЕЛЯ НЕТ ТАМ, ГДЕ ПЕРЕКЛЮЧАТЬ НЕ НА ЧТО. Половин у витрины
              две, но расширения держатся на порте plugins: во вкладке браузера
              их не поставить никогда. Раньше чипы стояли всегда, и «Расширения»
              приводили к строчке «работает только в приложении» — то есть к
              обещанию пустоты. Строка удалена вместе с чипом (2026-08-11). */}
          {canPlugins ? (
            <ChipGroup
              items={[
                { key: "all", label: t("settings.market.filter.all") },
                { key: "themes", label: t("settings.market.filter.themes") },
                { key: "plugins", label: t("settings.market.filter.plugins") },
              ]}
              value={marketFilter}
              onChange={(k) => setMarketFilter(k as "all" | "themes" | "plugins")}
            />
          ) : null}
          {serverSession && (!canPlugins || marketFilter !== "plugins") ? (
            <Button variant="secondary" icon="upload" onClick={openPublishTheme} style={{ marginLeft: "auto" }}>
              {t("settings.market.publishTheme")}
            </Button>
          ) : null}
        </div>

        {/* Без порта расширений витрина состоит из одних оформлений, каким бы
            ни было значение фильтра: переключить его тут нечем. */}
        {!canPlugins || marketFilter !== "plugins" ? (
          !serverSession ? (
            <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.market.themesNeedAccount")}</div>
          ) : marketThemes === null ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("common.loading")}</div>
          ) : marketThemes.length === 0 ? (
            <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.market.themesEmpty")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
              {marketThemes.map((theme) => (
                <MarketThemeCard
                  key={theme.id}
                  theme={theme}
                  onInstall={() => void installTheme(theme)}
                  onRemove={theme.isMine ? () => void unpublishTheme(theme) : undefined}
                  onReport={!theme.isMine ? () => void reportTheme(theme) : undefined}
                />
              ))}
            </div>
          )
        ) : null}

        {canPlugins && marketFilter !== "themes" ? (
          <>
            {marketFilter === "all" ? <GroupTitle>{t("settings.market.filter.plugins")}</GroupTitle> : null}
            {!serverSession ? (
              <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.market.pluginsNeedAccount")}</div>
            ) : marketPlugins === null ? (
              <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("common.loading")}</div>
            ) : marketPlugins.length === 0 ? (
              <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.market.pluginsEmpty")}</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
                {marketPlugins.map((m) => (
                  <MarketPluginCard
                    key={m.id}
                    item={m}
                    isAdmin={isAdmin}
                    installing={pluginInstalling === m.id}
                    onInstall={() => void installFromMarket(m)}
                    onRemove={m.isMine ? () => void unpublishMarketPlugin(m) : undefined}
                    onReport={!m.isMine ? () => void reportMarketPlugin(m) : undefined}
                    onHideToggle={isAdmin ? () => void toggleHideMarketPlugin(m) : undefined}
                    onApprove={isAdmin ? () => void approveMarketPluginRow(m) : undefined}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Публикация своего оформления в витрину */}
      <Dialog
        open={publishOpen}
        title={t("settings.market.publishDialog.title")}
        onClose={() => setPublishOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon="upload" disabled={publishBusy} onClick={() => void submitPublishTheme()}>
              {publishBusy ? t("settings.market.publishDialog.publishing") : t("settings.market.publishDialog.submit")}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", minWidth: 300 }}>
          <SettingInput value={publishName} onChange={setPublishName} placeholder={t("settings.customize.themes.namePlaceholder")} width={300} />
          {publishErr ? (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--danger)" }}>{publishErr}</div>
          ) : (
            <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>{t("settings.market.publishDialog.hint")}</div>
          )}
        </div>
      </Dialog>

      {/* Оформление с чужим CSS: честное предупреждение перед установкой */}
      <Dialog
        open={cssWarnTheme !== null}
        title={t("settings.market.cssWarnDialog.title")}
        onClose={() => setCssWarnTheme(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setCssWarnTheme(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              icon="download"
              onClick={() => {
                const theme = cssWarnTheme;
                setCssWarnTheme(null);
                if (theme) void doInstallTheme(theme);
              }}
            >
              {t("settings.market.cssWarnDialog.installAnyway")}
            </Button>
          </>
        }
      >
        <div style={{ maxWidth: 360, fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.55 }}>
          {t("settings.market.cssWarnDialog.body")}
        </div>
      </Dialog>
    </>
  );
}
