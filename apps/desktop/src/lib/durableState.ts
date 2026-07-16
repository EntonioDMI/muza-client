/** Долговечное зеркало критичного localStorage (пара к src-tauri/state_kv.rs).
 *
 *  Болезнь: LevelDB WebView2 коммитит localStorage на диск лениво, батчем в
 *  памяти browser-процесса. «Завершить задачу» убивает всё до коммита:
 *  prefs откатываются («настройки сбросились»), а сессия — хуже: ротация
 *  refresh-токена на сервере уже прошла, на диске остаётся отозванный токен,
 *  и его повтор на следующем старте стоит пользователю входа
 *  (жалоба 2026-07-16 «после завершения задачи вход слетает»).
 *
 *  Схема: каждый setItem/removeItem белого списка ключей зеркалится в файл
 *  app_data/state/<key>.json; на старте, ДО первого чтения prefs/сессии,
 *  побеждает БОЛЕЕ НОВАЯ из двух копий.
 *
 *  ⚠️ Направление «файл всегда истина» — ловушка (наступили 2026-07-16):
 *  запись файла асинхронна, перезагрузка страницы может её потерять, и файл
 *  оказывается СТАРЕЕ LevelDB; слепое восстановление из него подсовывает
 *  api-client уже ротированный токен → сервер видит «кражу». Поэтому у
 *  каждой копии есть номер версии: файл хранит {seq, value}, localStorage —
 *  парный ключ muza.mirror.seq:<key> (он живёт и умирает ВМЕСТЕ с основным
 *  ключом в одном LevelDB — после kill оба отстают согласованно). На старте
 *  сравниваем номера и берём новее; проигравшую копию догоняем.
 *
 *  Патчим Storage.prototype, а не оборачиваем вызовы: сессию пишет
 *  @muza/api-client (общий с вебом пакет — Tauri туда не затащить), prefs —
 *  App.tsx; одна точка зеркалирования ловит всех писателей разом. */

import { invoke, isTauri } from "@tauri-apps/api/core";

/** Что зеркалим. Ровно то, чья потеря = потеря входа или кастомизации.
 *  Ключи обязаны проходить valid_key() в state_kv.rs ([a-z0-9._-]). */
export const MIRROR_KEYS = ["muza.session.v1", "muza.prefs.v1"] as const;

const mirrored = new Set<string>(MIRROR_KEYS);
/** Парный ключ счётчика в localStorage ("...seq:<key>" валиден для state_kv). */
const seqKey = (key: string) => `muza.mirror.seq:${key}`;

interface Envelope {
  seq: number;
  value: string;
}

function parseEnvelope(raw: string): Envelope {
  try {
    const p = JSON.parse(raw) as Partial<Envelope>;
    if (typeof p.seq === "number" && typeof p.value === "string") return { seq: p.seq, value: p.value };
  } catch {
    /* не JSON-конверт */
  }
  // Легаси/чужое содержимое — считаем нулевой версией, localStorage победит
  return { seq: 0, value: raw };
}

const memSeq = (key: string): number => {
  const n = Number(window.localStorage.getItem(seqKey(key)));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Восстановить более новую копию и включить зеркалирование записей.
 *  Зовётся из main.tsx ДО рендера (App читает prefs при монтировании). */
export async function initDurableState(): Promise<void> {
  if (!isTauri()) return; // web/тесты: живут на голом localStorage
  for (const key of MIRROR_KEYS) {
    try {
      const raw = await invoke<string | null>("state_get", { key });
      const disk = raw === null ? null : parseEnvelope(raw);
      const mem = window.localStorage.getItem(key);
      const seq = memSeq(key);
      if (disk !== null && (mem === null || disk.seq > seq)) {
        // Файл новее (типичный случай — kill убил хвост LevelDB): догоняем память
        window.localStorage.setItem(key, disk.value);
        window.localStorage.setItem(seqKey(key), String(disk.seq));
      } else if (mem !== null && (disk === null || seq >= disk.seq)) {
        // Память новее (файл-запись потерялась/первый запуск): догоняем файл
        await invoke("state_set", { key, value: JSON.stringify({ seq, value: mem } satisfies Envelope) });
      }
    } catch {
      /* нет команды (старый Rust) — работаем как раньше, на localStorage */
    }
  }
  patchStorage();
}

let patched = false;
function patchStorage(): void {
  if (patched) return;
  patched = true;
  const set = Storage.prototype.setItem;
  const del = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    if (this === window.localStorage && mirrored.has(key)) {
      const seq = memSeq(key) + 1;
      set.call(this, seqKey(key), String(seq));
      set.call(this, key, value);
      // Promise.resolve поверх invoke: зеркалирование не имеет права ронять
      // сам setItem, даже если мост вернул не-Promise (тесты, чужие среды)
      void Promise.resolve(invoke("state_set", { key, value: JSON.stringify({ seq, value } satisfies Envelope) })).catch(
        () => undefined,
      );
      return;
    }
    set.call(this, key, value);
  };
  Storage.prototype.removeItem = function (key: string) {
    del.call(this, key);
    if (this === window.localStorage && mirrored.has(key)) {
      del.call(this, seqKey(key));
      void Promise.resolve(invoke("state_del", { key })).catch(() => undefined);
    }
  };
}
