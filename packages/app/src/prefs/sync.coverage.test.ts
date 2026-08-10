/** СТОРОЖ РАЗДЕЛА «ЕДЕТ / НЕ ЕДЕТ».
 *
 *  Каждое поле Prefs при синхронизации попадает в одну из двух судеб: уезжает
 *  на сервер и приходит на другие устройства — или остаётся здесь. Молчаливого
 *  третьего варианта нет: `toServerPrefs` отправляет ВСЁ, кроме `SYNC_LOCAL`,
 *  то есть забытый ключ уезжает по умолчанию.
 *
 *  Именно поэтому нужен снимок: новое поле в Prefs роняет этот тест, и автор
 *  обязан посмотреть на список и решить — вкус это человека (едет) или железо
 *  и экран (остаётся). Без сторожа id микрофона однажды уедет на чужую машину,
 *  и найдут это ушами, а не сборкой.
 *
 *  Тот же приём закрывает разъезд THEME_KEYS/THEME_EXCLUDED (themes.coverage). */

import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "./types";
import { SYNC_LOCAL, fromServerPrefs, toServerPrefs } from "./sync";

describe("что синхронизируется между устройствами", () => {
  it("в SYNC_LOCAL нет выдуманных ключей", () => {
    const unknown = SYNC_LOCAL.filter((k) => !(k in DEFAULT_PREFS));
    expect(unknown, `в SYNC_LOCAL ключи, которых нет в Prefs: ${unknown.join(", ")}`).toEqual([]);
  });

  it("список уезжающих ключей — тот же, что записан в снимке", () => {
    const shared = Object.keys(toServerPrefs(DEFAULT_PREFS)).sort();
    // Снимок обновляется вместе с решением по новому ключу: тест упал → реши,
    // едет поле (обнови снимок) или остаётся (добавь в SYNC_LOCAL).
    expect(shared).toMatchSnapshot();
  });

  it("ключи устройства не перезаписываются серверными", () => {
    const current = { ...DEFAULT_PREFS, uiScale: 90, micDeviceId: "здешний-микрофон" };
    const merged = fromServerPrefs({ uiScale: 175, micDeviceId: "чужой-микрофон", radius: "round" }, current);
    expect(merged.uiScale).toBe(90);
    expect(merged.micDeviceId).toBe("здешний-микрофон");
    // а обычная настройка вида — приезжает
    expect(merged.radius).toBe("round");
  });

  it("поля, которых этот клиент не знает, отбрасываются", () => {
    // Профиль мог записать более новый клиент: его поля не должны просачиваться
    // в состояние настроек этого.
    const merged = fromServerPrefs({ такогоПоляНет: 1 } as Record<string, unknown>, DEFAULT_PREFS);
    expect("такогоПоляНет" in merged).toBe(false);
  });
});
