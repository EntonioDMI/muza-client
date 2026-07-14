import { describe, expect, it } from "vitest";
import { isFullAccessManifest, METHOD_PERMISSIONS, parsePluginManifest, PERMISSION_INFO, PLUGIN_PERMISSIONS } from "./manifest";

const VALID = {
  id: "sync-translator",
  name: "Синхро-переводчик",
  version: "1.2.0",
  api_version: 1,
  description: "Перевод строк текста на лету",
  author: "polyglot",
  entry: "index.js",
  permissions: ["player.read", "ui.slots"],
  contributes: { tabs: [{ id: "translator", title: "Перевод", icon: "languages" }] },
};

describe("parsePluginManifest", () => {
  it("валидный манифест разбирается", () => {
    const res = parsePluginManifest(VALID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.manifest.id).toBe("sync-translator");
      expect(res.manifest.permissions).toEqual(["player.read", "ui.slots"]);
    }
  });

  it("permissions необязателен — дефолт []", () => {
    const { permissions: _drop, ...rest } = VALID;
    const res = parsePluginManifest(rest);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.manifest.permissions).toEqual([]);
  });

  it("плохой id отклоняется", () => {
    const res = parsePluginManifest({ ...VALID, id: "Not_Valid!" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("id");
  });

  it("api_version != 1 отклоняется", () => {
    const res = parsePluginManifest({ ...VALID, api_version: 2 });
    expect(res.ok).toBe(false);
  });

  it("неизвестное право отклоняется", () => {
    const res = parsePluginManifest({ ...VALID, permissions: ["hack:everything"] });
    expect(res.ok).toBe(false);
  });

  it("entry с traversal отклоняется", () => {
    const res = parsePluginManifest({ ...VALID, entry: "../../evil.js" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("entry");
  });

  it("contributes с чужим ключом отклоняется (strict)", () => {
    const res = parsePluginManifest({ ...VALID, contributes: { evilKey: true } });
    expect(res.ok).toBe(false);
  });

  it("version не semver отклоняется", () => {
    const res = parsePluginManifest({ ...VALID, version: "v1" });
    expect(res.ok).toBe(false);
  });
});

describe("isFullAccessManifest", () => {
  it("app:full-access в permissions -> уровень 2", () => {
    const res = parsePluginManifest({ ...VALID, permissions: ["app:full-access"] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(isFullAccessManifest(res.manifest)).toBe(true);
  });

  it("без app:full-access -> уровень 1", () => {
    const res = parsePluginManifest(VALID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(isFullAccessManifest(res.manifest)).toBe(false);
  });
});

describe("PERMISSION_INFO / METHOD_PERMISSIONS", () => {
  it("у каждого права из enum есть человекочитаемое описание", () => {
    for (const p of PLUGIN_PERMISSIONS) {
      expect(PERMISSION_INFO[p]).toBeDefined();
      expect(PERMISSION_INFO[p].label.length).toBeGreaterThan(0);
    }
  });

  it("методы API покрыты правами из enum", () => {
    const known = new Set<string>(PLUGIN_PERMISSIONS);
    for (const method of Object.keys(METHOD_PERMISSIONS)) {
      expect(known.has(METHOD_PERMISSIONS[method])).toBe(true);
    }
  });
});
