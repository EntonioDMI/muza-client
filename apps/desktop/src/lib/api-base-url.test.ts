import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "@muza/api-client";

describe("resolveApiBaseUrl", () => {
  it("uses localhost only in development", () => {
    expect(resolveApiBaseUrl(undefined, "development", "http://localhost:8000/api")).toBe(
      "http://localhost:8000/api",
    );
  });

  it.each([undefined, "", "http://api.muza.lol/api", "https://localhost/api"])(
    "rejects unsafe production value %s",
    (raw) => {
      expect(() => resolveApiBaseUrl(raw, "production")).toThrow();
    },
  );

  it.each([
    ["development", "credentials", "http://@localhost:8000/api"],
    ["development", "credentials", "http://user:pass@localhost:8000/api"],
    ["development", "query", "http://localhost:8000/api?"],
    ["development", "query", "http://localhost:8000/api?x=1"],
    ["development", "fragment", "http://localhost:8000/api#"],
    ["development", "fragment", "http://localhost:8000/api#section"],
    ["production", "credentials", "https://@api.muza.lol/api"],
    ["production", "credentials", "https://user:pass@api.muza.lol/api"],
    ["production", "query", "https://api.muza.lol/api?"],
    ["production", "query", "https://api.muza.lol/api?x=1"],
    ["production", "fragment", "https://api.muza.lol/api#"],
    ["production", "fragment", "https://api.muza.lol/api#section"],
  ] as const)("rejects %s URL with %s (%s)", (mode, _part, raw) => {
    expect(() => resolveApiBaseUrl(raw, mode)).toThrow();
  });

  it.each([
    ["development", "backslash authority", String.raw`http:\@localhost:8000/api`],
    ["development", "surplus-slash authority", "http:////@localhost:8000/api"],
    ["production", "backslash authority", String.raw`https:\@api.muza.lol/api`],
    ["production", "surplus-slash authority", "https:////@api.muza.lol/api"],
  ] as const)("rejects %s URL with %s (%s)", (mode, _syntax, raw) => {
    expect(() => resolveApiBaseUrl(raw, mode)).toThrow();
  });

  it.each(
    ([
      ["TAB", "\t"],
      ["LF", "\n"],
      ["CR", "\r"],
    ] as const).flatMap(([controlName, control]) =>
      [
        ["development", controlName, "/@host", `http://${control}/@localhost:8000/api`],
        ["development", controlName, "//@host", `http://${control}//@localhost:8000/api`],
        ["production", controlName, "/@host", `https://${control}/@api.muza.lol/api`],
        ["production", controlName, "//@host", `https://${control}//@api.muza.lol/api`],
      ] as const,
    ),
  )("rejects %s URL with %s-only authority before %s", (mode, _control, _slashes, raw) => {
    expect(() => resolveApiBaseUrl(raw, mode)).toThrow();
  });

  it("allows @ in a development path", () => {
    expect(resolveApiBaseUrl("http://localhost:8000/api/@scope", "development")).toBe(
      "http://localhost:8000/api/@scope",
    );
  });

  it("normalizes the canonical production URL", () => {
    expect(resolveApiBaseUrl("https://api.muza.lol/api/", "production")).toBe("https://api.muza.lol/api");
  });
});
