/** Манифест плагина (эпик W8, T44) — Zod-схема, один источник истины для
 *  клиента (guest-рантайм + установка из файла, apps/desktop/src/plugins/)
 *  и сервера (publish-скан маркетплейса, T45 — muza-server держит копию,
 *  репозитории раздельные, шарить пакет напрямую нельзя).
 *  См. docs/notes/2026-07-13-плагины-архитектура.md §1, §4. */

import { z } from "zod";

/** Права уровня 1 (структурный API песочницы) + `app:full-access` — уровень 2
 *  (T44b, код в хост-контексте), поглощает все остальные права. */
export const PLUGIN_PERMISSIONS = [
  "player.read",
  "player.control",
  "player.queue",
  "library.read",
  "library.write",
  "ui.tab",
  "ui.slots",
  "ui.theme",
  "strings",
  "storage",
  "net",
  "events.track",
  "events.playback",
  "events.library",
  "events.ui",
  "app:full-access",
] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export const PluginPermissionSchema = z.enum(PLUGIN_PERMISSIONS);

/** Человекочитаемые описания для модалки согласия при установке (§4):
 *  dangerous — выделяются отдельно («опасные» права). `app:full-access`
 *  ведёт на отдельный громкий экран (T44b) — этот лейбл только для
 *  честного списка, не для самой модалки полного доступа. */
export const PERMISSION_INFO: Record<PluginPermission, { label: string; dangerous?: boolean }> = {
  "player.read": { label: "Читать состояние плеера и очередь" },
  "player.control": { label: "Управлять воспроизведением (play/pause/next/prev/seek/громкость)" },
  "player.queue": { label: "Менять очередь воспроизведения" },
  "library.read": { label: "Читать плейлисты и «Любимое»" },
  "library.write": { label: "Изменять плейлисты и «Любимое»", dangerous: true },
  "ui.tab": { label: "Открывать свою вкладку и показывать уведомления" },
  "ui.slots": { label: "Добавлять кнопки в бар, пункты сайдбара и меню, панели, оверлей" },
  "ui.theme": { label: "Менять оформление приложения (CSS)", dangerous: true },
  strings: { label: "Подменять текст интерфейса" },
  storage: { label: "Хранить свои данные на диске (до 1 МБ)" },
  net: { label: "Ходить в сеть на разрешённые адреса", dangerous: true },
  "events.track": { label: "Получать события смены трека и позиции" },
  "events.playback": { label: "Получать события воспроизведения и очереди" },
  "events.library": { label: "Получать события библиотеки (лайки, плейлисты)" },
  "events.ui": { label: "Получать события интерфейса (вкладка, тема)" },
  "app:full-access": { label: "ПОЛНЫЙ ДОСТУП: менять приложение без ограничений", dangerous: true },
};

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Общая форма элемента contributes (tabs/barButtons/navItems/menus.*). */
const ContributesItemSchema = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(60),
  icon: z.string().min(1).max(40).optional(),
});
export type PluginContributesItem = z.infer<typeof ContributesItemSchema>;

export const PluginContributesSchema = z
  .object({
    tabs: z.array(ContributesItemSchema).max(10).optional(),
    barButtons: z.array(ContributesItemSchema).max(10).optional(),
    navItems: z.array(ContributesItemSchema).max(10).optional(),
    menus: z
      .object({
        track: z.array(ContributesItemSchema).max(10).optional(),
        catalogTrack: z.array(ContributesItemSchema).max(10).optional(),
        playlist: z.array(ContributesItemSchema).max(10).optional(),
      })
      .strict()
      .optional(),
    panel: ContributesItemSchema.optional(),
    overlay: z.object({ id: z.string().min(1).max(60) }).optional(),
    css: z
      .string()
      .min(1)
      .max(200)
      .refine((p) => !p.includes("..") && !p.startsWith("/") && !p.startsWith("\\"), "contributes.css: недопустимый путь")
      .optional(),
    strings: z
      .string()
      .min(1)
      .max(200)
      .refine((p) => !p.includes("..") && !p.startsWith("/") && !p.startsWith("\\"), "contributes.strings: недопустимый путь")
      .optional(),
  })
  .strict();
export type PluginContributes = z.infer<typeof PluginContributesSchema>;

export const PluginManifestSchema = z.object({
  id: z.string().regex(ID_PATTERN, "id: латиница/цифры/дефис, 3-40 символов, без дефиса по краям"),
  name: z.string().min(1).max(60),
  version: z.string().regex(SEMVER_PATTERN, "version: semver (х.у.з)"),
  api_version: z.literal(1),
  description: z.string().min(1).max(200),
  author: z.string().min(1).max(32),
  entry: z
    .string()
    .min(1)
    .max(200)
    .refine((p) => !p.includes("..") && !p.startsWith("/") && !p.startsWith("\\"), "entry: недопустимый путь"),
  permissions: z.array(PluginPermissionSchema).default([]),
  contributes: PluginContributesSchema.optional(),
  net_allow: z.array(z.string().min(1).max(253)).max(20).optional(),
  min_app_version: z.string().regex(SEMVER_PATTERN, "min_app_version: semver").optional(),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export type ParseManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; error: string };

/** Разбор + валидация манифеста. Единая точка входа — используется и
 *  установкой из файла (клиент), и publish-скан (сервер, T45). */
export function parsePluginManifest(raw: unknown): ParseManifestResult {
  const res = PluginManifestSchema.safeParse(raw);
  if (!res.success) {
    const first = res.error.issues[0];
    const path = first?.path?.length ? first.path.join(".") : "manifest";
    return { ok: false, error: `${path}: ${first?.message ?? "невалидный манифест"}` };
  }
  return { ok: true, manifest: res.data };
}

/** `app:full-access` в permissions переводит плагин на уровень 2 (T44b). */
export function isFullAccessManifest(manifest: PluginManifest): boolean {
  return manifest.permissions.includes("app:full-access");
}

/** API-метод (Muza.<ns>.<method>) → право, которым он покрыт. Единая карта:
 *  host.ts сверяет `granted` на каждый req, denied — без права. */
export const METHOD_PERMISSIONS: Record<string, PluginPermission> = {
  "player.getState": "player.read",
  "player.getCurrentTrack": "player.read",
  "player.getQueue": "player.read",
  "player.play": "player.control",
  "player.pause": "player.control",
  "player.next": "player.control",
  "player.prev": "player.control",
  "player.seek": "player.control",
  "player.setVolume": "player.control",
  "player.setRate": "player.control",
  "player.enqueue": "player.queue",
  "player.removeFromQueue": "player.queue",
  "player.reorderQueue": "player.queue",
  "player.clearQueue": "player.queue",
  "player.playTrack": "player.queue",
  "library.getPlaylists": "library.read",
  "library.getPlaylistTracks": "library.read",
  "library.getFavorites": "library.read",
  "library.createPlaylist": "library.write",
  "library.addToPlaylist": "library.write",
  "library.removeFromPlaylist": "library.write",
  "library.like": "library.write",
  "library.unlike": "library.write",
  "ui.toast": "ui.tab",
  "ui.openTab": "ui.tab",
  "ui.setBadge": "ui.slots",
  "ui.setBarButtonState": "ui.slots",
  "ui.applyCss": "ui.theme",
  "ui.removeCss": "ui.theme",
  "strings.override": "strings",
  "strings.reset": "strings",
  "storage.get": "storage",
  "storage.set": "storage",
  "storage.remove": "storage",
  "storage.keys": "storage",
  "net.fetch": "net",
};

/** events.on(type) → право, нужное для подписки на этот тип события. */
export const EVENT_PERMISSIONS: Record<string, PluginPermission> = {
  "track:change": "events.track",
  position: "events.track",
  "playback:state": "events.playback",
  "queue:change": "events.playback",
  "like:change": "events.library",
  "playlist:change": "events.library",
  "view:change": "events.ui",
  "theme:change": "events.ui",
};
