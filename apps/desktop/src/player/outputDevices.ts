/** Перечисление устройств аудио-вывода + разовая разблокировка имён (фича
 *  «вывод на устройства», 2026-07-22). Chromium прячет labels и deviceId за
 *  медиа-разрешением, а wry молча гасит промпт WebView2 — поэтому окно
 *  запускается с --use-fake-ui-for-media-stream (tauri.conf.json →
 *  additionalBrowserArgs). Ключ прописан у ОБОИХ окон, main и mini, и это не
 *  копипаста: аргументы читаются при создании общей среды WebView2, то есть у
 *  того окна, которое поднялось первым. Сейчас первым всегда идёт main (он
 *  первый в массиве windows), но стоит кому-то поменять порядок или спрятать
 *  main — и ключ молча не применится, а весь этот файл начнёт возвращать пустой
 *  список без единой ошибки. Дублирование снимает зависимость от порядка;
 *  значения обязаны совпадать байт-в-байт. Разовый getUserMedia проходит тихо,
 *  треки захвата
 *  стопаются немедленно: Muza НИЧЕГО не записывает, захват — только «пропуск»
 *  Chromium'а к списку устройств. Спайк и замеры: корневой
 *  docs/notes/2026-07-22-спайк-вывод-на-устройства.md. */
import type { AudioOutputRoute } from "../types";
import type { OutputRoute } from "./audioEngine";

export interface OutputDeviceInfo {
  deviceId: string;
  label: string;
}

let unlocked = false;
let denied = false;

/** Разблокировка уже случилась в этой сессии (enumeration дальше бесплатна). */
export const deviceAccessUnlocked = (): boolean => unlocked;

/** Разрешение спрашивали и НЕ дали. Пустой список устройств бывает по двум
 *  совершенно разным причинам, и пользователю они видятся одинаково: либо
 *  устройств правда нет, либо Windows не пустила к микрофону (Параметры →
 *  Конфиденциальность), а без этого Chromium не отдаёт имена. Без этого флага
 *  под-экран советовал «проверьте, что они подключены» человеку, у которого с
 *  проводами всё в порядке, — и он застревал. */
export const deviceAccessDenied = (): boolean => denied;

/** Разовая разблокировка enumerateDevices. false — разрешение не дали (флага
 *  нет в аргументах WebView2 или юзер запретил на уровне системы). */
export async function ensureDeviceAccess(): Promise<boolean> {
  if (unlocked) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    unlocked = true;
    denied = false;
    return true;
  } catch {
    denied = true;
    return false;
  }
}

/** Технический хвост Chromium-лейбла: «Наушники (G435 …) (046d:0acb)» → без
 *  (vid:pid). Чистим при перечислении, а не в UI — сохранённый label тоже
 *  чистый, и фолбэк-сопоставление сравнивает одинаково нормализованные имена. */
const cleanLabel = (label: string): string =>
  label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();

/** Реальные устройства вывода. Виртуальные default/communications отфильтрованы:
 *  «системное по умолчанию» в модели маршрутов — это ПУСТОЙ список маршрутов
 *  (движок тогда не трогает граф), а не псевдо-устройство в списке. */
export async function listOutputDevices(): Promise<OutputDeviceInfo[]> {
  if (!(await ensureDeviceAccess())) return [];
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs
      .filter(
        (d) =>
          d.kind === "audiooutput" &&
          d.deviceId &&
          d.deviceId !== "default" &&
          d.deviceId !== "communications" &&
          d.label,
      )
      .map((d) => ({ deviceId: d.deviceId, label: cleanLabel(d.label) }));
  } catch {
    return [];
  }
}

/** Сохранённые маршруты → живые (для движка). deviceId в Chromium может
 *  смениться при переподключении устройства — тогда ищем по label; не нашли
 *  вовсе — маршрут выпадает из живых (в prefs остаётся: устройство вернётся —
 *  вернётся и маршрут). Prefs не переписываем: сопоставление дешёвое и
 *  повторяется при каждом применении/devicechange. */
export function resolveRoutes(stored: AudioOutputRoute[], devices: OutputDeviceInfo[]): OutputRoute[] {
  const routes: OutputRoute[] = [];
  for (const r of stored) {
    const byId = devices.find((d) => d.deviceId === r.deviceId);
    const dev = byId ?? devices.find((d) => d.label === r.label);
    if (dev) routes.push({ deviceId: dev.deviceId, volume: r.volume, followsMaster: r.followsMaster, mixMic: r.mixMic });
  }
  return routes;
}

/** Сохранённый микрофон → живой deviceId. Тот же фолбэк, что у маршрутов
 *  вывода (resolveRoutes выше), и по той же причине: Chromium меняет deviceId
 *  при переподключении устройства, а имя обычно остаётся. Без фолбэка захват
 *  голоса молча уходил на микрофон ПО УМОЛЧАНИЮ (getUserMedia с мёртвым
 *  deviceId: {exact} отказывает, и движок падает на системный) — человек
 *  выбрал один микрофон, а в «голос в устройство» шёл другой. Экран настроек
 *  чинит сам профиль, но только когда в него зайдут; здесь — на каждом
 *  применении, в том числе на devicechange (аудит 2026-08-03).
 *
 *  Пустой сохранённый id — «системный по умолчанию», это не поломка: возвращаем
 *  null и ничего не ищем. Не нашли ни по id, ни по имени — тоже null: пусть
 *  система выберет сама, это ближе к ожиданию, чем отказ захвата. */
export function resolveMicDeviceId(
  storedId: string,
  storedLabel: string,
  devices: OutputDeviceInfo[],
): string | null {
  if (!storedId) return null;
  // Пустой список — это «мы ничего не знаем» (доступ к устройствам не дали,
  // enumerateDevices упала), а не «устройство пропало»: отменять выбор человека
  // по незнанию нельзя, отдаём сохранённый id как есть.
  if (devices.length === 0) return storedId;
  if (devices.some((d) => d.deviceId === storedId)) return storedId;
  const byLabel = storedLabel ? devices.find((d) => d.label === storedLabel) : undefined;
  return byLabel?.deviceId ?? null;
}

/** Микрофоны (audioinput) — для выбора «какой голос подмешивать» (v2).
 *  Виртуальные default/communications отфильтрованы так же, как у выводов:
 *  «системный по умолчанию» — это пустой deviceId в Prefs.micDeviceId. */
export async function listInputDevices(): Promise<OutputDeviceInfo[]> {
  if (!(await ensureDeviceAccess())) return [];
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs
      .filter(
        (d) =>
          d.kind === "audioinput" &&
          d.deviceId &&
          d.deviceId !== "default" &&
          d.deviceId !== "communications" &&
          d.label,
      )
      .map((d) => ({ deviceId: d.deviceId, label: cleanLabel(d.label) }));
  } catch {
    return [];
  }
}
