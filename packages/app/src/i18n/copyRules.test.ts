/** Сторож языка разработчика в пользовательских словарях (задание владельца
 *  19.07: «не разговаривать на языке разработчика и на языке маркетолога»).
 *
 *  Правило тона (спека 2026-07-19-настройки-ясность-и-кастомизация-дизайн):
 *  название = что это; подсказка = что произойдёт, если тронуть. Здесь
 *  проверяется механическая часть — запрещённые лексемы. Смысловая часть
 *  («это предложение?», «отвечает на „что изменится“?») — на ревью текста.
 *
 *  В бан-листе только ОДНОЗНАЧНЫЙ жаргон. Контекстные слова (сервер, лог,
 *  стрим, хост) сюда не входят — их вычищает волна 2 руками: механическая
 *  проверка по ним дала бы ложные срабатывания («каталог» содержит «лог»).
 *
 *  KNOWN_DEBT — снапшот нарушений, существовавших ДО волны 2 переписывания.
 *  Тест не даёт появляться НОВЫМ нарушениям и требует вычёркивать
 *  исправленные (запись в долге, которая больше не нарушает, — ошибка).
 *  Когда волна 2 закончится, массив станет пустым — удалить его совсем. */
import { describe, expect, it } from "vitest";
import { ru } from "./ru";
import { en } from "./en";

/** Однозначный жаргон. Лукбехайнды вместо \b: JS-\b не понимает кириллицу. */
const BANNED: { name: string; re: RegExp }[] = [
  { name: "добыча", re: /добыч/i },
  { name: "фолбэк", re: /фолб[эе]к|fallback/i },
  { name: "yt-dlp", re: /yt-dlp/i },
  { name: "токен", re: /(?<![а-яёa-z])токен|(?<![a-z])tokens?(?![a-z])/i },
  { name: "кэш", re: /(?<![а-яёa-z])к[эе]ш|(?<![a-z])cache/i },
  { name: "эндпоинт", re: /эндпо[ий]нт|endpoint/i },
  { name: "инстанс", re: /инстанс/i },
  { name: "namespace", re: /namespace/i },
  { name: "манифест", re: /манифест|manifest/i },
  { name: "дефолт", re: /дефолт/i },
  { name: "бэкенд/фронтенд", re: /б[эе]кенд|фронтенд|backend|frontend/i },
  { name: "DRM", re: /(?<![a-z])DRM(?![a-z])/ },
  { name: "битрейт/кодек", re: /битрейт|кодек|bitrate|codec/i },
];

/** Точечные разрешения: путь-префикс ключа, где термин — название, а не жаргон.
 *  - customize.css: «CSS» — имя функции для тех, кто умеет (спека §3);
 *  - system.licenses: лицензии обязаны называть библиотеки по имени (yt-dlp);
 *  - integrations.listenbrainz: «user token» — термин самого ListenBrainz,
 *    пользователь копирует его со страницы сервиса — переименование запутает;
 *  - views.admin: админ-панель видит только владелец — это инструмент
 *    разработчика, правило тона на него не распространяется. */
const ALLOWED_PREFIXES = [
  "settings.customize.css.",
  "settings.system.licenses.",
  "settings.integrations.listenbrainz.",
  "views.admin.",
];

function walk(node: unknown, path: string, out: { path: string; hit: string }[]) {
  if (typeof node === "string") {
    if (ALLOWED_PREFIXES.some((p) => path.startsWith(p))) return;
    for (const b of BANNED) {
      if (b.re.test(node)) out.push({ path, hit: b.name });
    }
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, out);
  }
}

function violations(dict: object, lang: string): string[] {
  const out: { path: string; hit: string }[] = [];
  walk(dict, "", out);
  return out.map((v) => `${lang}:${v.path} [${v.hit}]`).sort();
}

const KNOWN_DEBT: string[] = [
  "en:app.hotkeysDialog.footerHint [кэш]",
  "en:plugins.install.manifestRejected [манифест]",
  "en:settings.data.deviceOnly.item1 [кэш]",
  "en:settings.library.cache.hintEmpty [кэш]",
  "en:settings.library.cache.limitLabel [кэш]",
  "en:settings.library.cache.title [кэш]",
  "en:settings.privacy.deleteAccount.hint [кэш]",
  "en:settings.privacy.deleteDialog.body [кэш]",
  "en:settings.privacy.export.hint [токен]",
  "en:views.home.notice.errorText [кэш]",
  "ru:app.hotkeysDialog.footerHint [кэш]",
  "ru:media.player.errors.desktopOnly [добыча]",
  "ru:plugins.install.manifestRejected [манифест]",
  "ru:settings.account.telemetry.hint [добыча]",
  "ru:settings.customize.glass.zoneSidebar.hint [дефолт]",
  "ru:settings.customize.shape.buttons.hint [дефолт]",
  "ru:settings.customize.shape.tabs.hint [дефолт]",
  "ru:settings.data.anonymousStats.item1 [добыча]",
  "ru:settings.data.deviceOnly.item1 [кэш]",
  "ru:settings.library.cache.hintEmpty [кэш]",
  "ru:settings.library.cache.limitLabel [кэш]",
  "ru:settings.library.cache.title [кэш]",
  "ru:settings.privacy.deleteAccount.hint [кэш]",
  "ru:settings.privacy.deleteDialog.body [кэш]",
  "ru:settings.privacy.export.hint [токен]",
  "ru:views.home.notice.errorText [кэш]",
];

describe("словари не говорят языком разработчика", () => {
  it("новых нарушений нет; исправленные вычеркнуты из долга", () => {
    const found = [...violations(ru, "ru"), ...violations(en, "en")];
    const fresh = found.filter((f) => !KNOWN_DEBT.includes(f));
    const stale = KNOWN_DEBT.filter((d) => !found.includes(d));
    expect(fresh, "НОВЫЙ жаргон в словаре — перепиши по правилу тона").toEqual([]);
    expect(stale, "исправлено — вычеркни из KNOWN_DEBT").toEqual([]);
  });
});
