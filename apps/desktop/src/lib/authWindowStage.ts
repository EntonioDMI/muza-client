/** Сцены окна на экранах входа: сжать под карточку и развернуть обратно.
 *
 *  Тонкая обёртка над нативными командами (`src-tauri/src/window_stage.rs`) —
 *  там же лежат размеры, анимация и все гочи Windows. Здесь только решение
 *  «анимировать или нет» и молчаливая деградация.
 *
 *  ПОЧЕМУ НЕ ЧЕРЕЗ РОЗЕТКУ. Розетка (packages/app/src/platform) нужна общему
 *  коду, чтобы он не знал про площадку. Этот файл — десктопный, и его
 *  единственный потребитель — десктопный App.tsx: у вкладки браузера своего
 *  окна нет и быть не может, так что порт с одной реализацией был бы
 *  абстракцией ради абстракции.
 *
 *  ⚠️ ОТКАЗ ЗДЕСЬ НЕ ДОЛЖЕН ЛОМАТЬ ВХОД. Размер окна — украшение; если
 *  нативная команда не ответила (окна нет, права урезаны, сборка старее
 *  фронта), человек обязан всё равно войти в приложение. Поэтому обе функции
 *  глотают ошибку и пишут её в журнал, а не пробрасывают наверх. */
import { invoke } from "@tauri-apps/api/core";

/** Уменьшенное движение сильнее настройки: системная просьба важнее вкуса
 *  (то же правило, что у полноэкранного режима и визуализатора). */
export function shouldAnimateStage(anims: boolean): boolean {
  if (!anims) return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Экран входа, регистрации или восстановления — окно под карточку. */
export async function compactForAuth(): Promise<void> {
  try {
    await invoke("window_auth_compact");
  } catch (e) {
    console.warn("[окно] не удалось сжать под карточку входа:", e);
  }
}

/** Вошли (или продолжили анонимно) — окно разворачивается во все стороны. */
export async function expandAfterAuth(animate: boolean): Promise<void> {
  try {
    await invoke("window_auth_expand", { animate });
  } catch (e) {
    console.warn("[окно] не удалось развернуть после входа:", e);
  }
}
