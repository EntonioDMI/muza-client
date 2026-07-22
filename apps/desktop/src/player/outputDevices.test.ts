/** resolveRoutes — чистая функция сопоставления сохранённых маршрутов
 *  (Prefs.audioOutputs) с живыми устройствами (enumerateDevices). Остальные
 *  экспорты файла (listOutputDevices/listInputDevices/ensureDeviceAccess)
 *  требуют navigator.mediaDevices, которого в jsdom нет — не тестируем здесь,
 *  их прикрывает try/catch → [] (см. outputDevices.ts). */
import { describe, expect, it } from "vitest";
import { resolveRoutes, type OutputDeviceInfo } from "./outputDevices";
import type { AudioOutputRoute } from "../types";

const route = (over: Partial<AudioOutputRoute> = {}): AudioOutputRoute => ({
  deviceId: "dev-1",
  label: "Наушники",
  volume: 80,
  ...over,
});

const dev = (over: Partial<OutputDeviceInfo> = {}): OutputDeviceInfo => ({
  deviceId: "dev-1",
  label: "Наушники",
  ...over,
});

describe("outputDevices.resolveRoutes", () => {
  it("матчит по deviceId, когда он совпадает с живым устройством", () => {
    const stored = [route({ deviceId: "dev-1", volume: 55, followsMaster: true })];
    const devices = [dev({ deviceId: "dev-1", label: "Наушники G435" })];

    expect(resolveRoutes(stored, devices)).toEqual([
      { deviceId: "dev-1", volume: 55, followsMaster: true, mixMic: undefined },
    ]);
  });

  it("фолбэк по label, когда deviceId сменился (переподключение устройства)", () => {
    // Chromium перевыдаёт новый deviceId на переподключении того же физического
    // устройства — старый deviceId в prefs больше не матчится ни с чем, но
    // label (уже очищенный от (vid:pid) при listOutputDevices) остаётся тем же.
    const stored = [route({ deviceId: "old-id", label: "USB Наушники", volume: 40 })];
    const devices = [dev({ deviceId: "new-id", label: "USB Наушники" })];

    const resolved = resolveRoutes(stored, devices);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].deviceId).toBe("new-id"); // живой id, не сохранённый
    expect(resolved[0].volume).toBe(40);
  });

  it("deviceId матчит РАНЬШЕ label — приоритет точному совпадению", () => {
    // Ловушка: если бы поиск по label шёл первым, при совпадающих именах
    // (двое одинаковых наушников) маршрут мог бы уехать не на то устройство.
    const stored = [route({ deviceId: "dev-2", label: "Наушники", volume: 10 })];
    const devices = [
      dev({ deviceId: "dev-1", label: "Наушники" }), // тот же label, другой id
      dev({ deviceId: "dev-2", label: "Другое имя" }), // точный id, другой label
    ];

    const resolved = resolveRoutes(stored, devices);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].deviceId).toBe("dev-2");
  });

  it("устройство отсутствует и по id, и по label — маршрут выпадает из живых", () => {
    const stored = [route({ deviceId: "gone-id", label: "Отключённая колонка" })];
    const devices = [dev({ deviceId: "dev-1", label: "Наушники" })];

    expect(resolveRoutes(stored, devices)).toEqual([]);
  });

  it("пустой список сохранённых маршрутов → пустой результат (системный выход)", () => {
    expect(resolveRoutes([], [dev()])).toEqual([]);
  });

  it("пустой список живых устройств → все маршруты выпадают, но prefs не трогаются здесь", () => {
    const stored = [route(), route({ deviceId: "dev-2", label: "Кабель" })];
    expect(resolveRoutes(stored, [])).toEqual([]);
  });

  it("несколько маршрутов: часть матчится, часть выпадает — порядок сохраняется", () => {
    const stored = [
      route({ deviceId: "dev-1", label: "Наушники", volume: 90, mixMic: false }),
      route({ deviceId: "gone", label: "Пропавшее", volume: 20 }),
      route({ deviceId: "dev-3", label: "Кабель", volume: 100, mixMic: true }),
    ];
    const devices = [dev({ deviceId: "dev-1" }), dev({ deviceId: "dev-3", label: "Кабель" })];

    expect(resolveRoutes(stored, devices)).toEqual([
      { deviceId: "dev-1", volume: 90, followsMaster: undefined, mixMic: false },
      { deviceId: "dev-3", volume: 100, followsMaster: undefined, mixMic: true },
    ]);
  });
});
