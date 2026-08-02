/** КАРКАС ЭКРАНА НАСТРОЕК (волна веб-паритета «настройки», 2026-08-02).
 *
 *  Рельс разделов слева, поиск сверху, содержимое раздела справа — и вся
 *  механика вокруг них: переключение раздела, поиск по всем настройкам,
 *  переход из результата к нужному ряду с подсветкой, возврат прокрутки к
 *  началу при смене раздела.
 *
 *  Содержимое разделов каркас НЕ знает: он получает готовые узлы в `panes`.
 *  Это то самое место, где площадки честно расходятся — у приложения в
 *  «Системе» живут трей и обновления, у браузера этого раздела нет ВОВСЕ
 *  (нет ключа в `panes` — нет пункта в рельсе, нет ряда в поиске).
 *
 *  Что умеет площадка — говорит `caps`: тот же список, что фильтрует индекс
 *  поиска (lib/settingsIndex.ts). Поиск, приводящий к несуществующему ряду,
 *  хуже ненайденного ряда — поэтому фильтр общий, а не по месту.
 *
 *  ⚠️ Приложение пока рисует свой каркас внутри apps/desktop/.../SettingsView.tsx
 *  (там он сплетён с десятком под-экранов) — этот файл собран из его же кода и
 *  ждёт, когда под-экраны переедут следом. Расхождению поведения тут взяться
 *  неоткуда: рельс, поиск и подсветка — одни и те же модули. */

import { useEffect, useMemo, useRef, useState } from "react";
import { SearchInput } from "@muza/ui";
import { useT, type TranslationKey } from "../../i18n";
import { searchSettings, type SettingsCapability, type SettingsSearchHit } from "../../lib/settingsIndex";
import { paneStyle, SettingRow } from "./primitives";
import { navItemId, SETTINGS_PANE_ID, SETTINGS_TAB_KEYS, SettingsNav, type SettingsTabKey } from "./SettingsNav";
import "./settingsShell.css";

export function SettingsScreen({
  panes,
  caps,
  subs,
  initialTab,
}: {
  /** Содержимое разделов. Раздела нет в объекте — нет и пункта в рельсе. */
  panes: Partial<Record<SettingsTabKey, React.ReactNode>>;
  /** Умения площадки — ими же фильтруется поиск по настройкам. */
  caps?: readonly SettingsCapability[];
  /** Под-экраны, которые площадка умеет открыть. Пусто — результаты поиска,
   *  ведущие в под-экран, не показываются: вести некуда. */
  subs?: readonly string[];
  initialTab?: SettingsTabKey;
}) {
  const { t } = useT();
  // Канонический порядок разделов держит SETTINGS_TAB_KEYS: площадка решает
  // только «есть/нет», а не «где» — иначе один и тот же «Внешний вид» стоял бы
  // в приложении пятым, а в браузере первым (так и было до этой волны).
  const tabs = useMemo(() => SETTINGS_TAB_KEYS.filter((key) => panes[key] !== undefined), [panes]);
  const [tab, setTab] = useState<SettingsTabKey>(() => initialTab ?? tabs[0] ?? "appearance");

  // Прокрутка живёт в самой панели: при смене раздела возвращаем её к началу,
  // иначе скролл прошлого раздела протекает в следующий.
  const paneScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (paneScrollRef.current) paneScrollRef.current.scrollTop = 0;
  }, [tab]);

  const [searchQ, setSearchQ] = useState("");
  // Название ряда, к которому надо прокрутить и подсветить после перехода из
  // результатов поиска. Ставится вместе с setTab — эффект ниже срабатывает
  // уже ПОСЛЕ рендера целевой панели.
  const [flashTitle, setFlashTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!flashTitle) return;
    setFlashTitle(null);
    const row = document.querySelector<HTMLElement>(`[data-rowtitle="${CSS.escape(flashTitle)}"]`);
    // Ряда может не быть: он спрятан за выключенным тумблером или свёрнутым
    // «Настроить» — тогда просто открыли нужный раздел, без подсветки.
    if (!row) return;
    row.scrollIntoView?.({ block: "center" });
    row.classList.add("muza-settings-row--flash");
    // Таймер без cleanup нарочно: setFlashTitle(null) выше перезапускает
    // эффект, и cleanup снял бы класс мгновенно, не дав подсветке пожить.
    setTimeout(() => row.classList.remove("muza-settings-row--flash"), 2000);
  }, [flashTitle]);

  const goToHit = (hit: SettingsSearchHit) => {
    setSearchQ("");
    setTab(hit.tab as SettingsTabKey);
    setFlashTitle(hit.title);
  };

  const searchHits = searchQ.trim()
    ? searchSettings(searchQ, (key) => t(key as TranslationKey), caps).filter((hit) =>
        // Ряд из раздела, которого на площадке нет, в выдачу не попадает —
        // даже если умение для него не заведено (страховка «одно из двух»).
        hit.sub === null ? panes[hit.tab as SettingsTabKey] !== undefined : (subs ?? []).includes(hit.sub),
      )
    : [];

  return (
    <div className="muza-settings">
      <div className="muza-settings__cols">
        <SettingsNav value={tab} onChange={setTab} tabs={tabs} />
        <div ref={paneScrollRef} className="muza-settings__pane" id={SETTINGS_PANE_ID} role="tabpanel" aria-labelledby={navItemId(tab)}>
          {/* Поиск — первый элемент панели: живёт над содержимым любого
              раздела. Непустой запрос подменяет содержимое списком найденных
              рядов; клик по результату ведёт в раздел с подсветкой ряда. */}
          <SearchInput
            value={searchQ}
            onChange={setSearchQ}
            placeholder={t("settings.search.placeholder")}
            style={{ marginTop: "var(--sp-6)" }}
          />
          {searchQ.trim() ? (
            <div key="search-results" style={paneStyle}>
              {searchHits.length === 0 ? (
                <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{t("settings.search.empty")}</div>
              ) : (
                searchHits.map((hit) => (
                  <SettingRow
                    key={`${hit.tab}·${hit.sub ?? ""}·${hit.titleKey}`}
                    title={hit.title}
                    hint={t(`settings.tabs.${hit.tab}` as TranslationKey)}
                    chevron
                    onClick={() => goToHit(hit)}
                  ></SettingRow>
                ))
              )}
            </div>
          ) : (
            <div key={tab} style={paneStyle}>
              {panes[tab]}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
