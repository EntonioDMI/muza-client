import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "@muza/api-client";

describe("resolveApiBaseUrl", () => {
  it("uses localhost only in development", () => {
    expect(resolveApiBaseUrl(undefined, "development", "http://localhost:8000/api")).toBe(
      "http://localhost:8000/api",
    );
  });

  it.each([undefined, "", "http://api.muza.lol/api", "https://localhost/api", "https://api.muza.lol/api?x=1"])(
    "rejects unsafe production value %s",
    (raw) => {
      expect(() => resolveApiBaseUrl(raw, "production")).toThrow();
    },
  );

  it("normalizes the canonical production URL", () => {
    expect(resolveApiBaseUrl("https://api.muza.lol/api/", "production")).toBe("https://api.muza.lol/api");
  });
});
