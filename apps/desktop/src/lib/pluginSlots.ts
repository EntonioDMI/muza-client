/** Ключи плагинных слотов в композиции бара/сайдбара (эпик W8, T44).
 *  Формат `plugin:<id>:<slotId>` — плагинные элементы встраиваются в те же
 *  нормализованные списки prefs.barButtons/navItems, что и родные, и живут в
 *  настройках композиции, пока плагин установлен/включён. См. §3.3 дизайн-дока. */

export const PLUGIN_KEY_PREFIX = "plugin:";

export function pluginSlotKey(pluginId: string, slotId: string): string {
  return `${PLUGIN_KEY_PREFIX}${pluginId}:${slotId}`;
}

export function isPluginKey(key: string): boolean {
  return key.startsWith(PLUGIN_KEY_PREFIX);
}

/** `plugin:<id>:<slot>` → {pluginId, slotId}; null — не плагинный ключ или
 *  битый формат (id/slot не должны содержать «:» — id по regex не содержит). */
export function parsePluginKey(key: string): { pluginId: string; slotId: string } | null {
  if (!isPluginKey(key)) return null;
  const rest = key.slice(PLUGIN_KEY_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep >= rest.length - 1) return null;
  return { pluginId: rest.slice(0, sep), slotId: rest.slice(sep + 1) };
}
