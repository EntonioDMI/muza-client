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
 *  хуже ненайденного ряда — поэтому фильтр общий, а не по месту. Умений мало
 *  (они про «чего не бывает во вкладке браузера»), поэтому последнее слово за
 *  РЯДОМ, а не за разделом: результат остаётся в выдаче, только если ряд
 *  реально нарисован — см. collectRowTitles и isReachable ниже.
 *
 *  ⚠️ Приложение пока рисует свой каркас внутри apps/desktop/.../SettingsView.tsx
 *  (там он сплетён с десятком под-экранов) — этот файл собран из его же кода и
 *  ждёт, когда под-экраны переедут следом. Расхождению поведения тут взяться
 *  неоткуда: рельс, поиск и подсветка — одни и те же модули. */

import { isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Kbd, SearchInput } from "@muza/ui";
import { useT, type TranslationKey } from "../../i18n";
import { DEFAULT_HOTKEYS, formatCombo, hotkeyActionLabel, HOTKEY_ACTIONS } from "../../lib/hotkeys";
import { searchSettings, type SettingsCapability, type SettingsSearchHit } from "../../lib/settingsIndex";
import { paneStyle, SettingRow } from "./primitives";
import { navItemId, SETTINGS_PANE_ID, SETTINGS_TAB_KEYS, SettingsNav, type SettingsTabKey } from "./SettingsNav";
import "./settingsShell.css";

/** Названия рядов, которые площадка РЕАЛЬНО нарисовала в узлах разделов.
 *
 *  Зачем обход дерева, а не список от площадки: единственный, кто знает точно,
 *  какие ряды есть на экране, — сами узлы разделов. Список рядом с ними
 *  разъехался бы с ними же через неделю (ровно так поиск и начал водить в
 *  никуда: он спрашивал «есть ли РАЗДЕЛ», а у браузера раздел был, а девяти из
 *  десяти его рядов — нет).
 *
 *  Ищем проп `title`: его несёт SettingRow, и он же становится якорем
 *  data-rowtitle, к которому потом прокручивает переход из результатов —
 *  то есть сравниваем ровно то, по чему потом будем искать ряд в DOM.
 *
 *  Обход статический: элементы уже созданы (JSX площадки), рендерить ничего не
 *  надо. Ряд, спрятанный площадкой ВНУТРЬ своего компонента, обходу не виден —
 *  он просто не найдётся поиском. Это осознанный перекос в безопасную сторону:
 *  ненайденный ряд человек ищет глазами, а результат, ведущий в пустоту, врёт. */
function collectRowTitles(node: ReactNode, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) collectRowTitles(child as ReactNode, out);
    return;
  }
  if (!isValidElement(node)) return;
  const props = node.props as { title?: unknown; children?: ReactNode } | undefined;
  if (typeof props?.title === "string") out.add(props.title);
  if (props?.children !== undefined) collectRowTitles(props.children, out);
}

/** Раздел «Горячие клавиши» без переназначения — справочник «что какой
 *  клавишей».
 *
 *  Каркас рисует его САМ, когда площадка не передала свой: клавиши слышат обе
 *  площадки (слушатель — один общий модуль lib/hotkeys, в браузере он работает
 *  без единой правки), а список действий и сочетаний от площадки не зависит
 *  вообще. До этой правки раздел просто исчезал у веба молча — человек не мог
 *  узнать, что пробел ставит паузу, хотя пробел работал.
 *
 *  Чего здесь нет: переназначения. Оно требует места, где сочетания хранятся
 *  (у приложения это Prefs.hotkeys); у площадки без такого хранилища клавиши
 *  закреплены — об этом и говорит подпись под списком. Площадка с хранилищем
 *  передаёт СВОЙ узел раздела (приложение так и делает) — тогда этот не
 *  используется вовсе. */
function HotkeysReferencePane() {
  const { t, lang } = useT();
  // Новая строка заводится отдельным ходом волны (словари — не эта зона).
  // Пока её нет, translate вернул бы сам ключ — показываем старую строку того
  // же смысла вместо «settings.hotkeys.fixedNote» на экране.
  const noteKey = "settings.hotkeys.fixedNote";
  const note = t(noteKey as TranslationKey);
  return (
    <>
      {HOTKEY_ACTIONS.map((action) => (
        <SettingRow key={action.id} title={hotkeyActionLabel(action.id, lang)}>
          {/* Сочетание разбито на плашки-клавиши: «Ctrl + →» читается как две
              клавиши, а не как строка текста (тот же приём, что в справке «?»). */}
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            {formatCombo(DEFAULT_HOTKEYS[action.id])
              .split(" + ")
              .map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
          </div>
        </SettingRow>
      ))}
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)" }}>
        {note === noteKey ? t("settings.hotkeys.help.hint") : note}
      </div>
    </>
  );
}

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
  // Разделы, которые каркас умеет нарисовать сам, если площадка не передала
  // свой (сейчас такой один — «Горячие клавиши», см. HotkeysReferencePane).
  // Дальше по файлу площадочные и встроенные узлы неразличимы: и рельс, и
  // поиск смотрят в один объект.
  const shownPanes = useMemo(
    () => (panes.hotkeys === undefined ? { ...panes, hotkeys: <HotkeysReferencePane /> } : panes),
    [panes],
  );
  // Канонический порядок разделов держит SETTINGS_TAB_KEYS: площадка решает
  // только «есть/нет», а не «где» — иначе один и тот же «Внешний вид» стоял бы
  // в приложении пятым, а в браузере первым (так и было до этой волны).
  const tabs = useMemo(() => SETTINGS_TAB_KEYS.filter((key) => shownPanes[key] !== undefined), [shownPanes]);
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

  // Правило выдачи одно: результат показывается, только если из него ЕСТЬ КУДА
  // ВЕСТИ — раздел на площадке есть И сам ряд на экране существует. Ряд
  // существует двумя способами: он нарисован прямо в узле раздела (нашли по
  // названию) либо живёт в под-экране, который площадка умеет открыть.
  //
  // Раньше здесь стояло только «есть раздел» — и в браузере поиск выдавал
  // около 26 рядов, которых на экране нет: раздел «Внешний вид» у веба есть, а
  // девяти десятых его рядов — нет. Проверять раздел вместо ряда — это как
  // отвечать «дом такой есть» на вопрос о квартире.
  const isReachable = (hit: SettingsSearchHit, rowTitles: Set<string>) =>
    shownPanes[hit.tab as SettingsTabKey] !== undefined &&
    (rowTitles.has(hit.title) || (hit.sub !== null && (subs ?? []).includes(hit.sub)));

  const searchHits = useMemo(() => {
    if (!searchQ.trim()) return [];
    const rowTitles = new Set<string>();
    // Обходим узлы ВСЕХ разделов, а не только открытого: человек ищет по всем
    // настройкам, а не по тем, что сейчас перед глазами.
    for (const pane of Object.values(shownPanes)) collectRowTitles(pane, rowTitles);
    return searchSettings(searchQ, (key) => t(key as TranslationKey), caps).filter((hit) => isReachable(hit, rowTitles));
    // isReachable в зависимостях не нужен: он читает те же shownPanes и subs.
  }, [searchQ, shownPanes, subs, caps, t]); // eslint-disable-line react-hooks/exhaustive-deps

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
              {shownPanes[tab]}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
