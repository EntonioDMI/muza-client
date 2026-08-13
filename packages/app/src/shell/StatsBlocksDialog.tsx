/** «Настроить блоки статистики» — состав и порядок блоков страницы
 *  статистики. Ровно то же умение, что у приложения в настройках (под-экран
 *  «Статистика», группа «Блоки страницы»): переключатель показа + стрелки
 *  порядка, изменения применяются сразу.
 *
 *  ПОЧЕМУ ДИАЛОГ, А НЕ ЭКРАН НАСТРОЕК. В приложении кнопка «Настроить» уводит
 *  в настройки, где у статистики свой под-экран. У веба такого под-экрана нет,
 *  а прятать умение целиком нельзя: без него человек не может убрать ни один
 *  блок вовсе — до 2026-08-02 так и было. Диалог даёт то же самое, не заводя
 *  вебу второй экран настроек.
 *
 *  ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ, А НЕ ВНУТРИ StatsView. Общий экран статистики
 *  сознательно ничего не знает про хранение настроек: у него есть только
 *  `onCustomize` («есть обработчик — есть кнопка»). Кнопку рисует он, а чем
 *  она открывается, решает площадка — приложение уходит в настройки, веб
 *  открывает этот диалог.
 *
 *  Хранит список ВЫЗЫВАЮЩИЙ (у веба — профиль настроек, у приложения — Prefs):
 *  диалог только сообщает новый порядок, ни в какое хранилище не пишет. */

import { Button, Dialog, IconButton, Switch } from "@muza/ui";
import { DEFAULT_STATS_BLOCKS, type StatsBlockKey } from "../views/StatsView";
import { useT } from "../i18n";

/** Строка сохранённого списка: блок и показывать ли его. Порядок массива =
 *  порядок блоков на странице (та же модель, что prefs.statsBlocks
 *  приложения — списки ходят между клиентами без приведения). */
export interface StatsBlockPref {
  key: StatsBlockKey;
  on: boolean;
}

/** Сохранённый список → полный: незнакомые ключи выбрасываются (блок могли
 *  убрать в новой версии), отсутствующие дописываются в конец включёнными
 *  (блок могли добавить — новинку не прячем). Пустой список на входе даёт
 *  канонический порядок целиком: так выглядит профиль, где состав ещё ни разу
 *  не трогали. Та же логика, что normalizeStatsBlocks приложения. */
export function normalizeStatsBlocks(saved: readonly { key: string; on: boolean }[]): StatsBlockPref[] {
  const known = new Set<string>(DEFAULT_STATS_BLOCKS);
  const seen = new Set<string>();
  const out: StatsBlockPref[] = [];
  for (const b of saved) {
    if (!known.has(b.key) || seen.has(b.key)) continue;
    seen.add(b.key);
    out.push({ key: b.key as StatsBlockKey, on: b.on });
  }
  for (const key of DEFAULT_STATS_BLOCKS) {
    if (!seen.has(key)) out.push({ key, on: true });
  }
  return out;
}

/** Включённые блоки в порядке показа — то, что ждёт проп `blocks` StatsView. */
export function enabledStatsBlocks(saved: readonly { key: string; on: boolean }[]): StatsBlockKey[] {
  return normalizeStatsBlocks(saved)
    .filter((b) => b.on)
    .map((b) => b.key);
}

/** Ряд списка: название и пояснение слева, управление справа — раскладка ряда
 *  настроек обоих клиентов (SettingRow приложения / Row настроек веба). */
function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-4)",
        padding: "var(--sp-3) 0",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: "var(--fs-body)", fontWeight: 400, color: "var(--text-1)" }}>{title}</div>
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: 2 }}>{hint}</div>
      </div>
      {children}
    </div>
  );
}

export function StatsBlocksDialog({
  open,
  blocks,
  onChange,
  onClose,
}: {
  open: boolean;
  /** Сохранённый список (можно сырой из хранилища — нормализуем сами). */
  blocks: readonly { key: string; on: boolean }[];
  /** Новый список целиком: и показ, и порядок — одним значением. */
  onChange: (next: StatsBlockPref[]) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const items = normalizeStatsBlocks(blocks);
  const label = (key: StatsBlockKey) => t(`media.statsBlocks.${key}.label`);
  const hint = (key: StatsBlockKey) => t(`media.statsBlocks.${key}.hint`);

  const toggle = (key: StatsBlockKey, on: boolean) =>
    onChange(items.map((b) => (b.key === key ? { ...b, on } : b)));

  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <Dialog
      open={open}
      title={t("settings.stats.blocksGroup")}
      icon="chart-line"
      closeLabel={t("dialogs.close")}
      width={520}
      onClose={onClose}
      actions={<Button onClick={onClose}>{t("common.ok")}</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((b, i) => (
          <Row key={b.key} title={label(b.key)} hint={hint(b.key)}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flex: "none" }}>
              {/* крайние стрелки приглушены, но остаются на месте — иначе ряды
                  первой и последней строки разъезжаются по ширине */}
              <span style={{ opacity: i === 0 ? 0.3 : 1 }}>
                <IconButton
                  icon="chevron-up"
                  size="sm"
                  label={t("settings.bar.moveUp", { name: label(b.key) })}
                  onClick={() => move(i, -1)}
                />
              </span>
              <span style={{ opacity: i === items.length - 1 ? 0.3 : 1 }}>
                <IconButton
                  icon="chevron-down"
                  size="sm"
                  label={t("settings.bar.moveDown", { name: label(b.key) })}
                  onClick={() => move(i, 1)}
                />
              </span>
              <Switch checked={b.on} onChange={(on: boolean) => toggle(b.key, on)} label={label(b.key)} />
            </div>
          </Row>
        ))}
      </div>
    </Dialog>
  );
}
