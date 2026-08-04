/** РЕЛЬС РАЗДЕЛОВ НАСТРОЕК (волна веб-паритета «настройки», 2026-08-02).
 *
 *  Приехал как есть из apps/desktop/src/views/SettingsView.tsx. Веб рисовал
 *  свой рельс со своим набором разделов и своими классами — из-за этого один
 *  и тот же «Внешний вид» лежал в приложении пятым, а в браузере первым.
 *
 *  Набор разделов — ОДИН на обе площадки (SETTINGS_TAB_KEYS ниже). Площадка,
 *  которая какой-то раздел показать не может (в браузере нет ни трея, ни
 *  плагинов), просто НЕ передаёт его ключ в `tabs` — пункта нет вовсе, а не
 *  серый. Умение = наличие, точка (правило розетки platform/types.ts). */

import { Icon } from "@muza/ui";
import { useT } from "../../i18n";

/** Ключи разделов настроек — порядок массива = порядок пунктов навигации.
 *  Подписи НЕ хранятся здесь (модуль верхнего уровня не имеет доступа к
 *  useT()) — берутся в компоненте из словаря по `settings.tabs.<key>`:
 *  ключи этого массива буквально совпадают с ключами словаря, см. i18n/en.ts.
 *  «О приложении» — секция внутри Системы, не свой раздел. */
export const SETTINGS_TAB_KEYS = [
  "account",
  "appearance",
  "playback",
  "sources",
  "lyrics",
  "library",
  "integrations",
  "hotkeys",
  "extensions",
  "system",
] as const;

export type SettingsTabKey = (typeof SETTINGS_TAB_KEYS)[number];

/** Иконка раздела (lucide, kebab-case). Нужна схлопнутому рельсу: на узкой
 *  панели подписи прячутся и иконка остаётся единственной приметой раздела —
 *  поэтому берём те, что уже что-то значат в этом же приложении (paintbrush —
 *  темы, puzzle — плагины, library-big — «Библиотека» в сайдбаре).
 *  Record<> по ключам массива: добавили раздел — TS потребует иконку. */
export const SETTINGS_TAB_ICONS: Record<SettingsTabKey, string> = {
  account: "user",
  appearance: "paintbrush",
  playback: "play",
  sources: "globe",
  lyrics: "mic-vocal",
  library: "library-big",
  integrations: "plug",
  hotkeys: "keyboard",
  extensions: "puzzle",
  system: "monitor-cog",
};

/** id пункта навигации — на него ссылается aria-labelledby панели. */
export const navItemId = (key: string) => `muza-settings-nav-${key}`;
/** id панели — на него ссылается aria-controls пунктов навигации. */
export const SETTINGS_PANE_ID = "muza-settings-pane";

/** Высота пункта (48) + gap sp-2 (8) — шаг скользящей пилюли. Держать в паре
 *  с метриками .muza-settings-nav__item в CSS. */
const PILL_STEP = 56;

/** Вертикальная навигация по разделам настроек (левая колонка каркаса).
 *
 *  role=tablist, а не список ссылок: выбор раздела мгновенно меняет соседнюю
 *  панель и никуда не «уходит» (ни маршрута, ни истории) — это ровно
 *  tab/tabpanel. Тот же набор ролей, что у Tabs из @muza/ui, плюс то, чего
 *  Tabs не даёт: aria-orientation=vertical и связка aria-controls ↔
 *  aria-labelledby с панелью. Роving tabindex со стрелками намеренно нет —
 *  все пункты достижимы Tab'ом, как и сегменты Tabs по всему приложению.
 *
 *  Вид (в т.ч. схлопывание в рельс на узкой панели) — .muza-settings-nav;
 *  активный пункт стилизуется по aria-selected, чтобы доступность и подсветка
 *  не разъехались. */
export function SettingsNav({
  value,
  onChange,
  tabs = SETTINGS_TAB_KEYS,
}: {
  value: string;
  onChange: (key: SettingsTabKey) => void;
  /** Какие разделы показывает ЭТА площадка. По умолчанию все. */
  tabs?: readonly SettingsTabKey[];
}) {
  const { t } = useT();
  const activeIdx = tabs.indexOf(value as SettingsTabKey);
  return (
    <nav
      className="muza-settings-nav"
      role="tablist"
      aria-orientation="vertical"
      aria-label={t("settings.title")}
    >
      {/* ЗАГОЛОВКА ЗДЕСЬ БОЛЬШЕ НЕТ (редизайн 04.08).
          Он был единственным h1 во всём приложении, который жил ВНУТРИ
          навигационного рельса, а не над содержимым. У Главной, Медиатеки,
          Статистики и админки заголовок стоит над своим экраном — и из-за
          этого исключения «Настройки» читались как чужая страница, вставленная
          в приложение. Дословная жалоба владельца: «заголовок Settings почему-то
          совершенно не вписывается».
          Теперь он живёт над панелью, как везде (SettingsScreen.tsx и
          apps/desktop/src/views/SettingsView.tsx), а рельс остался навигацией и
          только ей. Доступность не пострадала: aria-label списка выше несёт то
          же слово. */}
      {/* Пункты в своей обёртке, чтобы пилюля считалась от индекса без учёта
          высоты заголовка — тот же приём анимированного фона, что у главного
          сайдбара (Sidebar.tsx): переключение раздела едет, а не мигает
          (жалоба 2026-07-16). */}
      <div className="muza-settings-nav__items">
        <div
          aria-hidden="true"
          className="muza-settings-nav__pill"
          style={{ transform: `translateY(${Math.max(activeIdx, 0) * PILL_STEP}px)`, opacity: activeIdx >= 0 ? 1 : 0 }}
        />
        {tabs.map((key) => {
          const label = t(`settings.tabs.${key}`);
          return (
            <button
              key={key}
              id={navItemId(key)}
              type="button"
              role="tab"
              aria-selected={key === value}
              aria-controls={SETTINGS_PANE_ID}
              // Рельс прячет подпись СТИЛЕМ, а не условным рендером (@container
              // из JS не виден), поэтому подпись нужна и машине, и глазу при
              // любой ширине: aria-label — скринридеру, __tip — курсору в узком
              // режиме (CSS-тултип в языке ДС; нативный title рисовал стоковую
              // плашку WebView2 — жалоба 2026-07-16).
              aria-label={label}
              className="muza-settings-nav__item"
              onClick={() => onChange(key)}
            >
              <Icon name={SETTINGS_TAB_ICONS[key]} size={20} />
              <span className="muza-settings-nav__label">{label}</span>
              <span className="muza-settings-nav__tip" aria-hidden="true">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
