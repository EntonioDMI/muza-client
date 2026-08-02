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
 *  неоткуда: рельс, поиск и подсветка — одни и те же модули.
 *
 *  ПОЧЕМУ КАРКАС БОЛЬШЕ НЕ ЧИТАЕТ РАЗМЕТКУ (правка 2026-08-02). До этой правки
 *  достижимость ряда каркас выяснял обходом JSX-дерева раздела: искал в узлах
 *  проп `title`. Обход видел ряд, только если площадка написала его ПРЯМО в
 *  узле, — а четыре раздела из девяти веб отдаёт готовым компонентом
 *  (`<AccountPane/>`, «Интеграции», «Медиатека», «Система»), и их ряды лежат
 *  внутри компонента. Поиск был к ним слеп: «выгрузить данные» не находилось
 *  вовсе. Костыль «а компоненты считаем по индексу» дал бы два правила и
 *  «особенные» разделы, поэтому обход убран целиком.
 *
 *  Теперь правило ОДНО и для всех девяти разделов: ряд достижим, если он есть
 *  В ОПИСИ ПЛОЩАДКИ (`rows`) — «ключ индекса → где этот ряд нарисован». Описи
 *  нет — площадка рисует весь индекс там, где его написал индекс (это
 *  приложение: у него есть каждый раздел, каждый под-экран и каждый ряд).
 *
 *  Опись положительная, а не «чего у меня нет», нарочно: забытый ключ прячет
 *  существующий ряд (человек найдёт его глазами), а забытая строчка в списке
 *  отсутствующих привела бы в пустоту — то есть соврала. Собирать опись руками
 *  целиком не нужно: раздел, приехавший готовым, отдаёт её функцией paneRows
 *  (settingsContext.tsx) — список рядом с чужим компонентом разъехался бы с ним
 *  на первой же правке. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Kbd, SearchInput } from "@muza/ui";
import { useT, type TranslationKey } from "../../i18n";
import { DEFAULT_HOTKEYS, formatCombo, hotkeyActionLabel, HOTKEY_ACTIONS } from "../../lib/hotkeys";
import { searchSettings, type SettingsCapability, type SettingsSearchHit } from "../../lib/settingsIndex";
import { paneStyle, SettingRow } from "./primitives";
import { navItemId, SETTINGS_PANE_ID, SETTINGS_TAB_KEYS, SettingsNav, type SettingsTabKey } from "./SettingsNav";
import type { SettingsSubKey } from "./settingsContext";
import "./settingsShell.css";

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
  rows,
  subs,
  sub,
  onSubChange,
  initialTab,
}: {
  /** Содержимое разделов. Раздела нет в объекте — нет и пункта в рельсе. */
  panes: Partial<Record<SettingsTabKey, ReactNode>>;
  /** Умения площадки — ими же фильтруется поиск по настройкам. */
  caps?: readonly SettingsCapability[];
  /** ОПИСЬ РЯДОВ: ключ индекса (titleKey) → где площадка этот ряд рисует
   *  (ключ под-экрана либо null — прямо в разделе). Ключа нет в описи — ряда у
   *  площадки нет: это единственный ответ каркаса на вопрос «есть ли ряд на
   *  экране», разметку он не читает (см. шапку файла).
   *
   *  Место — часть описи, а не справка из индекса, потому что площадки
   *  раскладывают одни и те же ряды по-разному: у приложения «Шрифт текста»
   *  лежит в под-экране «Кастомизация», а веб рисует его прямо во «Внешнем
   *  виде» — и переход из результата обязан вести туда, где ряд на самом деле.
   *
   *  Опись не передана — площадка рисует весь индекс там, где его написал сам
   *  индекс (это приложение: у него есть каждый раздел, под-экран и ряд). */
  rows?: Readonly<Record<string, SettingsSubKey | null>>;
  /** Под-экраны, которые площадка умеет открыть. Пусто — результаты поиска,
   *  ведущие в под-экран, не показываются: вести некуда. */
  subs?: readonly string[];
  /** Какой под-экран открыт сейчас. Состояние держит площадка — под-экран
   *  открывают не только результаты поиска, но и сами ряды («Кастомизация →»),
   *  а они дотягиваются до него контекстом (settingsContext.openSub). Каркасу
   *  оно нужно, чтобы вход в под-экран возвращал прокрутку панели к началу и
   *  пересоздавал содержимое — ровно как смена раздела. */
  sub?: SettingsSubKey | null;
  /** Каркас просит открыть под-экран (или закрыть его, null). Зовётся из
   *  результата поиска и при смене раздела. Не передан — каркас под-экранами не
   *  распоряжается, и результат из под-экрана открывает только раздел. */
  onSubChange?: (sub: SettingsSubKey | null) => void;
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

  // Ключ показанного: под-экран рисуется ВМЕСТО рядов раздела, поэтому для
  // прокрутки и пересоздания содержимого он такая же смена панели, как раздел.
  const paneKey = sub ?? tab;

  // Прокрутка живёт в самой панели: при смене панели возвращаем её к началу,
  // иначе скролл прошлого раздела протекает в следующий.
  const paneScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (paneScrollRef.current) paneScrollRef.current.scrollTop = 0;
  }, [paneKey]);

  // Смена раздела закрывает его под-экран: под-экран живёт ВНУТРИ раздела, и
  // без этого человек, заглянувший в «Сессии» и ушедший во «Внешний вид»,
  // вернулся бы в «Аккаунт» снова на «Сессиях» — вместо рядов раздела.
  const goToTab = (next: SettingsTabKey) => {
    onSubChange?.(null);
    setTab(next);
  };

  const [searchQ, setSearchQ] = useState("");
  // Название ряда, к которому надо прокрутить и подсветить после перехода из
  // результатов поиска. Ставится вместе с setTab/onSubChange — эффект ниже
  // срабатывает уже ПОСЛЕ рендера целевой панели (и целевого под-экрана).
  const [flashTitle, setFlashTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!flashTitle) return;
    setFlashTitle(null);
    // Сравниваем значение атрибута, а не подставляем название в селектор:
    // названия рядов — живой человеческий текст (кавычки, скобки, «×»), и
    // экранировать его нечем — CSS.escape есть не во всяком окружении, где
    // крутится этот общий код (в jsdom его нет вовсе).
    const row = [...document.querySelectorAll<HTMLElement>("[data-rowtitle]")].find(
      (el) => el.dataset.rowtitle === flashTitle,
    );
    // Ряда может не быть: он спрятан за выключенным тумблером или свёрнутым
    // «Настроить» — тогда просто открыли нужный раздел, без подсветки.
    if (!row) return;
    row.scrollIntoView?.({ block: "center" });
    row.classList.add("muza-settings-row--flash");
    // Таймер без cleanup нарочно: setFlashTitle(null) выше перезапускает
    // эффект, и cleanup снял бы класс мгновенно, не дав подсветке пожить.
    setTimeout(() => row.classList.remove("muza-settings-row--flash"), 2000);
  }, [flashTitle]);

  // ГДЕ У ЭТОЙ ПЛОЩАДКИ ЛЕЖИТ РЯД: ключ под-экрана, null — прямо в разделе,
  // undefined — ряда нет вовсе. Описи нет — верим индексу целиком.
  const rowPlace = (hit: SettingsSearchHit): SettingsSubKey | null | undefined =>
    rows ? rows[hit.titleKey] : (hit.sub as SettingsSubKey | null);

  // Правило выдачи одно и то же для всех девяти разделов: результат показан,
  // только если из него ЕСТЬ КУДА ВЕСТИ —
  //   1) ряд есть в описи площадки (описи нет — площадка рисует весь индекс),
  //   2) раздел у площадки есть (иначе некуда переключать рельс),
  //   3) ряд лежит в под-экране — этот под-экран площадка умеет открыть.
  //
  // Ни одного «а этот раздел особенный»: каркас не знает и не спрашивает, чем
  // раздел нарисован — своей разметкой на странице или готовым компонентом.
  // Раньше здесь стоял обход разметки, и ровно поэтому четыре раздела веба из
  // девяти поиск не видел вовсе (см. шапку файла).
  const isReachable = (hit: SettingsSearchHit) => {
    const place = rowPlace(hit);
    if (place === undefined) return false;
    return shownPanes[hit.tab as SettingsTabKey] !== undefined && (place === null || (subs ?? []).includes(place));
  };

  // Переход из результата ОТКРЫВАЕТ и под-экран, а не только раздел: человек
  // ищет «выгрузить данные» — он хочет саму выгрузку, а не «Аккаунт», в котором
  // её надо искать дальше руками. Ряд, лежащий прямо в разделе, закрывает
  // открытый под-экран — иначе результат вёл бы в раздел, поверх которого
  // всё ещё нарисован чужой под-экран.
  const goToHit = (hit: SettingsSearchHit) => {
    setSearchQ("");
    onSubChange?.(rowPlace(hit) ?? null);
    setTab(hit.tab as SettingsTabKey);
    setFlashTitle(hit.title);
  };

  const searchHits = useMemo(() => {
    if (!searchQ.trim()) return [];
    return searchSettings(searchQ, (key) => t(key as TranslationKey), caps).filter(isReachable);
    // isReachable в зависимостях не нужен: он читает те же shownPanes/rows/subs.
  }, [searchQ, shownPanes, rows, subs, caps, t]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="muza-settings">
      <div className="muza-settings__cols">
        <SettingsNav value={tab} onChange={goToTab} tabs={tabs} />
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
            <div key={paneKey} style={paneStyle}>
              {shownPanes[tab]}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
