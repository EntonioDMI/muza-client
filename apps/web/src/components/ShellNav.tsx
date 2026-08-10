"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Icon, useLayerState } from "@muza/ui";
import { useT } from "@muza/app";
import { isFillableNavIcon } from "@muza/app/shell/Sidebar";

/** НАВИГАЦИЯ УЗКИХ РАСКЛАДОК: нижняя панель телефона, иконный рельс планшета
 *  и общий для них выдвижной ящик («бургер»).
 *
 *  Почему они здесь, а не в AppShell: оболочка и без того держит плеер, слои,
 *  меню и пять диалогов, а это три самостоятельных куска разметки с одним
 *  общим набором пунктов. Набор объявлен ОДИН раз (в AppShell) и раздаётся
 *  всем трём — иначе третий вид навигации разъехался бы с первыми двумя на
 *  первой же правке (ровно так уже случилось с заливкой активного глифа:
 *  копия набора fillable жила в вебе третьей, см. Sidebar.isFillableNavIcon).
 *
 *  ⚠️ ЧТО ГДЕ ЛЕЖИТ И ПОЧЕМУ ИМЕННО ТАК.
 *  Телефон: пять пунктов внизу (главная, поиск, любимое, медиатека, «Ещё»).
 *  Шесть подписей на 393px давали 65px на пункт — «Библиотека» и «Настройки»
 *  висели на грани обрезки. Редкое (статистика, настройки, аккаунт) и длинное
 *  (список плейлистов) уехало в ящик.
 *  Планшет: рельс из тех же пунктов плюс статистика и настройки — вертикаль
 *  там есть, а ширина дорога.
 *  Бургер ВНИЗУ на телефоне и ВВЕРХУ на планшете: телефон держат одной рукой,
 *  и верхний угол экрана 852pt пальцем не достать; планшет держат двумя или
 *  кладут, там верх — привычное место шапки.
 *
 *  ⚠️ ПЛЕЙЛИСТЫ В ЯЩИКЕ — НЕ УДОБСТВО, А ПОЧИНКА. До 10.08 на телефоне их
 *  нельзя было открыть вовсе: сайдбар прятался целиком, а нижняя навигация про
 *  плейлисты не знает. Ящик показывает ТОТ ЖЕ общий Sidebar, что и десктоп, —
 *  со всеми его умениями (закреп, переименование, приём переносом). */

export interface NavEntry {
  href: string;
  icon: string;
  label: string;
}

function NavGlyph({ icon, active, size }: { icon: string; active: boolean; size: number }) {
  // Заливка активного глифа — правило ОБЩЕЙ панели: lucide рисует штрихом, и
  // заливка годится только замкнутым силуэтам (сердце — да, дом — нет).
  return <Icon name={icon} size={size} filled={active && isFillableNavIcon(icon)} />;
}

/** Нижняя навигация телефона. Пятый пункт — кнопка, а не ссылка: он открывает
 *  ящик, а не ведёт по адресу, и ссылкой быть не вправе (скринридер обещал бы
 *  переход, которого нет). */
export function BottomNav({
  entries,
  pathname,
  onOpenMenu,
  menuOpen,
}: {
  entries: NavEntry[];
  pathname: string;
  onOpenMenu: () => void;
  menuOpen: boolean;
}) {
  const { t } = useT();
  return (
    <nav className="bottomnav" aria-label={t("web.nav.bottomNavAria")}>
      {entries.map((n) => (
        <Link key={n.href} href={n.href} className={pathname === n.href ? "active" : undefined}>
          <NavGlyph icon={n.icon} active={pathname === n.href} size={22} />
          <span>{n.label}</span>
        </Link>
      ))}
      <button
        type="button"
        className={menuOpen ? "active" : undefined}
        aria-label={t("web.nav.openMenu")}
        aria-expanded={menuOpen}
        onClick={onOpenMenu}
      >
        <NavGlyph icon="menu" active={menuOpen} size={22} />
        <span>{t("web.nav.more")}</span>
      </button>
    </nav>
  );
}

/** Иконный рельс планшета. Стоит в ячейке сетки вместо сайдбара — см.
 *  globals.css, раздел «Иконный рельс планшета». */
export function NavRail({
  entries,
  pathname,
  onOpenMenu,
  menuOpen,
}: {
  entries: NavEntry[];
  pathname: string;
  onOpenMenu: () => void;
  menuOpen: boolean;
}) {
  const { t } = useT();
  return (
    <nav className="navrail" aria-label={t("web.nav.bottomNavAria")}>
      <button
        type="button"
        className="navrail__burger"
        aria-label={t("web.nav.openMenu")}
        aria-expanded={menuOpen}
        onClick={onOpenMenu}
      >
        <Icon name="menu" size={22} />
        <span>{t("web.nav.more")}</span>
      </button>
      {entries.map((n) => (
        <Link key={n.href} href={n.href} className={pathname === n.href ? "active" : undefined}>
          <NavGlyph icon={n.icon} active={pathname === n.href} size={22} />
          <span>{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Выдвижной ящик с полным сайдбаром.
 *
 *  ⚠️ Живёт ПРОПОМ `open`, а не условным рендером родителя — то же правило,
 *  что у MobileNowPlaying: снимешь узел из дерева по клику, и уходить будет
 *  нечему, ящик исчезнет кадром. Жизненный цикл держит useLayerState, время и
 *  позу — .muza-layer--panel (animations.css) плюс --layer-pose в globals.css.
 *
 *  Затемнение и панель — ДВА слоя с общим `open`: у них разные позы (фон
 *  копится прозрачностью, панель проезжает свою ширину), а одним узлом это не
 *  выразить. Оба закрываются одним обработчиком. */
export function ShellDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useT();
  const panel = useLayerState(open);
  const scrim = useLayerState(open);

  // Esc закрывает — слушатель только пока открыт, иначе ящик отбирал бы
  // клавишу у диалогов оболочки.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!panel.mounted && !scrim.mounted) return null;

  return (
    <>
      {scrim.mounted ? (
        <button
          type="button"
          className="drawer-scrim muza-layer muza-layer--scrim"
          aria-label={t("web.nav.closeMenu")}
          onClick={onClose}
          {...scrim.layerProps}
        />
      ) : null}
      {panel.mounted ? (
        <aside
          className="drawer muza-layer muza-layer--panel"
          role="dialog"
          aria-label={t("web.nav.menuAria")}
          {...panel.layerProps}
        >
          {children}
        </aside>
      ) : null}
    </>
  );
}
