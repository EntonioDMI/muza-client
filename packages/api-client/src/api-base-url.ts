export type ApiBuildMode = "development" | "production";

const PROD_API = "https://api.muza.lol/api";

export function resolveApiBaseUrl(
  raw: string | undefined,
  mode: ApiBuildMode,
  devFallback?: string,
): string {
  const value = raw?.trim() || (mode === "development" ? devFallback : undefined);
  if (!value) throw new Error("Production API URL is required");

  const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i.exec(value)?.[1] ?? "";
  if (value.includes("?") || value.includes("#") || authority.includes("@")) {
    throw new Error("API URL contains forbidden parts");
  }

  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API URL contains forbidden parts");
  }

  const normalized = url.toString().replace(/\/$/, "");
  if (mode === "production" && normalized !== PROD_API) {
    throw new Error(`Production API must be ${PROD_API}`);
  }
  return normalized;
}
