import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

// frame-src: песочница плагинов уровня 1 (W8) — iframe на кастомном протоколе
// muza-plugin:// (Windows-вебвью сервит его как http://muza-plugin.localhost).
// Директива стоит ПЕРЕД connect-src: DEVELOPMENT_CSP дописывает localhost:8000
// строкой в хвост, и connect-src обязан оставаться последней директивой.
export const PRODUCTION_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: asset: http://asset.localhost; font-src 'self' data:; media-src 'self' blob: https: asset: http://asset.localhost http://muza-stream.localhost muza-stream://localhost; frame-src http://muza-plugin.localhost muza-plugin://localhost; connect-src 'self' https://api.muza.lol ipc: http://ipc.localhost asset: http://asset.localhost";
export const DEVELOPMENT_CSP = `${PRODUCTION_CSP} http://localhost:8000`;

const MAX_ARTIFACT_TEXT_BYTES = 32 * 1024 * 1024;
const MAX_DECODE_PASSES = 4;
const SCANNED_EXTENSIONS = new Set([".js", ".css", ".html", ".json", ".svg", ".map"]);
const HARD_HTTP_LITERAL_DELIMITERS = new Set([" ", "\"", "'", "`", "<", ">", "(", ")", "[", "]", "{", "}", ",", ";"]);
// http://muza-plugin.localhost — origin кастом-протокола песочницы плагинов W8
// на Windows/WebView2 (см. PluginFrames.tsx и frame-src в PRODUCTION_CSP):
// внутренний «домен» вебвью, не сетевой адрес — та же категория, что ipc/asset.
const INTERNAL_TAURI_ORIGINS = ["http://ipc.localhost", "http://asset.localhost", "http://muza-plugin.localhost"];

export const ALLOWED_HTTP_LITERALS = new Set([
  "http://json-schema.org/draft-04/schema#",
  "http://json-schema.org/draft-07/schema#",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/2000/svg",
  "http://f",
  "http://n",
]);

const DEFAULT_FS_OPS = { lstatSync, readFileSync, readdirSync };
const EXPECTED_EXTERNAL_BINS = ["bin/yt-dlp", "bin/deno"];
const EXPECTED_MAIN_PERMISSIONS = [
  "core:default",
  "core:window:allow-start-dragging",
  "dialog:allow-open",
  "dialog:allow-save",
  "autostart:default",
  "updater:default",
  "process:allow-restart",
  "drag:default",
  { identifier: "opener:allow-open-url", allow: [{ url: "https://**" }] },
];
const EXPECTED_MINI_PERMISSIONS = ["core:default", "core:window:allow-start-dragging"];
const EXPECTED_CAPABILITY_KEYS = ["$schema", "identifier", "description", "windows", "permissions"];
const EXPECTED_CAPABILITY_SCHEMA = "../gen/schemas/desktop-schema.json";
const PINNED_ACTIONS = {
  checkout: "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
  pnpm: "pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa",
  node: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  rust: "dtolnay/rust-toolchain@4be7066ada62dd38de10e7b70166bc74ed198c30",
  cache: "Swatinem/rust-cache@42dc69e1aa15d09112580998cf2ef0119e2e91ae",
  tauri: "tauri-apps/tauri-action@fce9c6108b31ea247710505d3aaaa893ee6768d4",
};

export function validateApiEnv(value) {
  if (value !== "https://api.muza.lol/api") throw new Error("API env must equal https://api.muza.lol/api");
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unexpected keys`);
  }
}

export function validateTauriConfig(config) {
  const csp = config.app?.security?.csp ?? "";
  if (csp !== PRODUCTION_CSP) throw new Error("production CSP must equal PRODUCTION_CSP");
  if (!isDeepStrictEqual(config.bundle?.externalBin, EXPECTED_EXTERNAL_BINS)) {
    throw new Error("production externalBin must equal bin/yt-dlp,bin/deno");
  }
}

export function validateDevTauriOverlay(base, overlay) {
  validateTauriConfig(base);
  assertExactKeys(overlay, ["app"], "dev overlay");
  assertExactKeys(overlay.app, ["security"], "dev overlay.app");
  assertExactKeys(overlay.app.security, ["csp"], "dev overlay.app.security");
  if (overlay.app.security.csp !== DEVELOPMENT_CSP) {
    throw new Error("dev CSP must equal DEVELOPMENT_CSP");
  }
}

export function validateCapabilities(mainCapability, miniCapability) {
  assertExactKeys(mainCapability, EXPECTED_CAPABILITY_KEYS, "main capability");
  assertExactKeys(miniCapability, EXPECTED_CAPABILITY_KEYS, "mini capability");
  if (
    mainCapability.$schema !== EXPECTED_CAPABILITY_SCHEMA
    || miniCapability.$schema !== EXPECTED_CAPABILITY_SCHEMA
  ) {
    throw new Error("capability schema mismatch");
  }
  if (mainCapability?.identifier !== "main" || miniCapability?.identifier !== "mini") {
    throw new Error("capability identifier mismatch");
  }
  if (!isDeepStrictEqual(mainCapability.windows, ["main"])) {
    throw new Error("main capability window set mismatch");
  }
  if (!isDeepStrictEqual(miniCapability.windows, ["mini"])) {
    throw new Error("mini capability window set mismatch");
  }
  if (!isDeepStrictEqual(mainCapability.permissions, EXPECTED_MAIN_PERMISSIONS)) {
    throw new Error("main capability permission set mismatch");
  }
  if (!isDeepStrictEqual(miniCapability.permissions, EXPECTED_MINI_PERMISSIONS)) {
    throw new Error("mini capability permission set mismatch");
  }
}

function activeWorkflowText(text, label) {
  if (typeof text !== "string" || text.trim() === "") throw new Error(`${label} workflow is empty`);
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => line.replace(/\s+#.*$/, ""))
    .join("\n");
}

function workflowSteps(text) {
  const lines = text.split("\n");
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^ {6}- (?:name|uses|run):/.test(lines[index])) starts.push(index);
  }
  return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join("\n"));
}

function exactUses(text) {
  return [...text.matchAll(/^ {6}(?:- uses:|  uses:)\s*(\S+)\s*$/gm)].map((match) => match[1]);
}

function requireExactlyOnce(text, marker, label) {
  const first = text.indexOf(marker);
  if (first === -1 || text.indexOf(marker, first + marker.length) !== -1) {
    throw new Error(`${label} workflow must contain exactly once: ${marker}`);
  }
  return first;
}

function validateWorkflow(text, kind) {
  const active = activeWorkflowText(text, kind);
  const steps = workflowSteps(active);
  const expectedUses = kind === "release"
    ? [...Object.values(PINNED_ACTIONS)]
    : Object.values(PINNED_ACTIONS).slice(0, -1);
  if (!isDeepStrictEqual(exactUses(active), expectedUses)) {
    throw new Error(`${kind} workflow action pins or order mismatch`);
  }

  const checkoutStep = steps.find((step) => step.includes(`uses: ${PINNED_ACTIONS.checkout}`));
  if (!checkoutStep || !/^ {10}persist-credentials: false$/m.test(checkoutStep)) {
    throw new Error(`${kind} workflow checkout credential policy mismatch`);
  }

  const permissionHeaders = active.match(/^\s*permissions:\s*$/gm) ?? [];
  if (permissionHeaders.length !== 1) {
    throw new Error(`${kind} workflow permission block mismatch`);
  }
  const permissionBlock = kind === "trust"
    ? "permissions:\n  contents: read\n\njobs:"
    : "    permissions:\n      contents: write\n    steps:";
  requireExactlyOnce(active, permissionBlock, kind);

  requireExactlyOnce(active, "  VITE_API_URL: ${{ vars.MUZA_API_URL }}", kind);
  requireExactlyOnce(active, "  NEXT_PUBLIC_API_URL: ${{ vars.MUZA_API_URL }}", kind);

  const orderedMarkers = [
    "pnpm install --frozen-lockfile",
    "node --test scripts/release-gate.test.mjs",
    "node scripts/release-gate.mjs env VITE_API_URL",
    "node scripts/release-gate.mjs env NEXT_PUBLIC_API_URL",
    "cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib",
    "cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml",
    "pnpm --filter muza-desktop build",
    "pnpm --filter muza-web build",
    "node scripts/release-gate.mjs tauri apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/tauri.dev.conf.json",
    "node scripts/release-gate.mjs capabilities apps/desktop/src-tauri/capabilities/main.json apps/desktop/src-tauri/capabilities/mini.json",
    "node scripts/release-gate.mjs workflows .github/workflows/release.yml .github/workflows/trust-gate.yml",
    "node scripts/release-gate.mjs artifacts apps/desktop/dist apps/web/out",
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const position = requireExactlyOnce(active, marker, kind);
    if (position <= previous) throw new Error(`${kind} workflow gate order mismatch`);
    previous = position;
  }

  for (const marker of [
    "https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/yt-dlp.exe",
    "3a48cb955d55c8821b60ccbdbbc6f61bc958f2f3d3b7ad5eaf3d83a543293a27",
    "https://github.com/denoland/deno/releases/download/v2.9.2/deno-x86_64-pc-windows-msvc.zip",
    "5fe194d26ac5ef77fcc5288c2c438c7a0465f3b6180440ebf04092714bf2dcdf",
    '"yt-dlp-$triple.exe"',
    '"deno-$triple.exe"',
  ]) {
    requireExactlyOnce(active, marker, kind);
  }
  const sidecarMarkers = [
    "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/yt-dlp.exe' -OutFile $ytDlpPath",
    "if ((Get-FileHash -LiteralPath $ytDlpPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne '3a48cb955d55c8821b60ccbdbbc6f61bc958f2f3d3b7ad5eaf3d83a543293a27') { throw 'yt-dlp checksum mismatch' }",
    "Invoke-WebRequest -Uri 'https://github.com/denoland/deno/releases/download/v2.9.2/deno-x86_64-pc-windows-msvc.zip' -OutFile $denoZip",
    "if ((Get-FileHash -LiteralPath $denoZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '5fe194d26ac5ef77fcc5288c2c438c7a0465f3b6180440ebf04092714bf2dcdf') { throw 'Deno checksum mismatch' }",
    "Expand-Archive -LiteralPath $denoZip -DestinationPath $denoExtract -Force",
    "Move-Item -LiteralPath (Join-Path $denoExtract 'deno.exe') -Destination $denoPath -Force",
    "if (-not (Test-Path -LiteralPath $denoPath -PathType Leaf)) { throw 'Deno sidecar missing after extraction' }",
  ];
  let sidecarPrevious = -1;
  for (const marker of sidecarMarkers) {
    const position = requireExactlyOnce(active, marker, kind);
    if (position <= sidecarPrevious) throw new Error(`${kind} workflow sidecar checksum order mismatch`);
    sidecarPrevious = position;
  }
  const nodeTests = active.indexOf(orderedMarkers[1]);
  if (nodeTests === -1 || sidecarPrevious >= nodeTests || sidecarPrevious >= previous) {
    throw new Error(`${kind} workflow sidecar checksum order mismatch`);
  }

  if (kind === "release") {
    const finalStep = steps.at(-1) ?? "";
    if (!finalStep.includes(`uses: ${PINNED_ACTIONS.tauri}`)) {
      throw new Error("release workflow tauri action must be last");
    }
    for (const marker of [
      "GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
      "TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}",
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}",
    ]) {
      requireExactlyOnce(finalStep, marker, "release final step");
    }
    for (const step of steps.slice(0, -1)) {
      if (/\$\{\{\s*secrets\.|GITHUB_TOKEN/.test(step)) {
        throw new Error("release workflow secret escaped the final action");
      }
    }
  } else {
    if (active.includes("tauri-apps/tauri-action") || /\$\{\{\s*secrets\.|GITHUB_TOKEN/.test(active)) {
      throw new Error("trust workflow has release authority or secrets");
    }
    const finalStep = steps.at(-1) ?? "";
    if (!finalStep.includes(orderedMarkers.at(-1))) {
      throw new Error("trust workflow artifact gate must be last");
    }
  }
}

export function validateWorkflows(releaseWorkflow, trustWorkflow) {
  validateWorkflow(releaseWorkflow, "release");
  validateWorkflow(trustWorkflow, "trust");
}

function isHardDelimiter(character) {
  return character !== undefined && HARD_HTTP_LITERAL_DELIMITERS.has(character);
}

function hasHardLeftBoundary(text, index) {
  return index === 0 || isHardDelimiter(text[index - 1]);
}

function hasHardRightBoundary(text, index) {
  return index === text.length || isHardDelimiter(text[index]);
}

function matchZodIpv6ParserRange(text, httpIndex) {
  const callPrefix = "new URL(`";
  const callStart = httpIndex - callPrefix.length;
  if (callStart < 1 || text.slice(callStart, httpIndex) !== callPrefix) return undefined;
  if (text[callStart - 1] !== "{" && text[callStart - 1] !== ";") return undefined;

  const template = /^http:\/\/\[\$\{([A-Za-z_$][A-Za-z0-9_$]*(?:\.value)?)\}\]`\)/.exec(
    text.slice(httpIndex),
  );
  if (!template) return undefined;

  const afterStart = httpIndex + template[0].length;
  if (!text.startsWith("}catch{", afterStart)) return undefined;

  const before = text.slice(Math.max(0, callStart - 512), callStart);
  const after = text.slice(afterStart, afterStart + 256);
  const format = /format\s*:\s*([`"'])(ipv6|cidrv6)\1/.exec(after)?.[2];
  const marker = format === "ipv6" ? "$ZodIPv6" : format === "cidrv6" ? "$ZodCIDRv6" : undefined;
  if (!marker || !before.includes(marker)) return undefined;

  return [httpIndex, httpIndex + "http://[".length];
}

function matchUrlPolyfillPortTableRange(text, httpIndex) {
  const prefix = "ftp:21,file:null,";
  const suffix = "http:80,https:443,ws:80,wss:443";
  const tableStart = httpIndex - prefix.length;
  const tableEnd = httpIndex + suffix.length;
  if (tableStart < 1 || text[tableStart - 1] !== "{") return undefined;
  if (text.slice(tableStart, httpIndex) !== prefix) return undefined;
  if (!text.startsWith(suffix, httpIndex) || text[tableEnd] !== "}") return undefined;
  return [httpIndex, httpIndex + "http:80".length];
}

function collectAllowedRawHttpRanges(text, name) {
  const ranges = [];
  const lowerText = text.toLowerCase();
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const httpIndex = lowerText.indexOf("http:", searchFrom);
    if (httpIndex === -1) break;

    let allowedRange = matchZodIpv6ParserRange(text, httpIndex)
      ?? matchUrlPolyfillPortTableRange(text, httpIndex);
    if (hasHardLeftBoundary(text, httpIndex)) {
      for (const origin of INTERNAL_TAURI_ORIGINS) {
        if (!text.startsWith(origin, httpIndex)) continue;
        const end = httpIndex + origin.length;
        const next = text[end];
        if (end === text.length || next === "/" || next === "?" || next === "#" || isHardDelimiter(next)) {
          allowedRange = [httpIndex, end];
          break;
        }
      }
    }

    if (!allowedRange && hasHardLeftBoundary(text, httpIndex)) {
      for (const literal of ALLOWED_HTTP_LITERALS) {
        if (!text.startsWith(literal, httpIndex)) continue;
        const end = httpIndex + literal.length;
        if (hasHardRightBoundary(text, end)) {
          allowedRange = [httpIndex, end];
          break;
        }
      }
    }

    if (!allowedRange) throw new Error(`disallowed HTTP occurrence: ${name}`);
    ranges.push(allowedRange);
    searchFrom = httpIndex + 1;
  }

  return ranges;
}

function maskAllowedRawHttpRanges(text, ranges) {
  let result = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    result += text.slice(cursor, start);
    result += " ".repeat(end - start);
    cursor = end;
  }
  return result + text.slice(cursor);
}

function maskDecodedDataSvgNamespaces(text) {
  const prefix = 'data:image/svg+xml,<svg xmlns="';
  const literal = "http://www.w3.org/2000/svg";
  const ranges = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const dataIndex = text.indexOf(prefix, searchFrom);
    if (dataIndex === -1) break;
    const previous = dataIndex === 0 ? undefined : text[dataIndex - 1];
    const httpIndex = dataIndex + prefix.length;
    const end = httpIndex + literal.length;
    if (
      (dataIndex === 0 || previous === '"' || previous === "'" || previous === "`" || previous === "(")
      && text.startsWith(literal, httpIndex)
      && text[end] === '"'
    ) {
      ranges.push([httpIndex, end]);
    }
    searchFrom = dataIndex + 1;
  }

  return maskAllowedRawHttpRanges(text, ranges);
}

function malformedEscapeTouchesSecurityToken(text, index) {
  const prefix = text
    .slice(Math.max(0, index - 64), index)
    .replace(/[\t\n\r]/g, "")
    .toLowerCase();
  return prefix.endsWith("http") || prefix.endsWith("sourcemappingurl");
}

function malformedEscape(text, index, kind) {
  if (malformedEscapeTouchesSecurityToken(text, index)) {
    throw new Error(`malformed ${kind} escape near HTTP or sourceMappingURL`);
  }
}

function codePoint(value) {
  const parsed = Number.parseInt(value, 16);
  return Number.isSafeInteger(parsed) && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : undefined;
}

function decodeSecurityPass(text) {
  let decoded = "";

  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (character === "\t" || character === "\n" || character === "\r") {
      index += 1;
      continue;
    }

    if (character === "\\") {
      const next = text[index + 1];
      if (next === "/" || next === "\\") {
        decoded += next;
        index += 2;
        continue;
      }

      if (next === "u" && text[index + 2] === "{") {
        const match = /^\\u\{([0-9a-fA-F]{1,6})\}/.exec(text.slice(index));
        const value = match ? codePoint(match[1]) : undefined;
        if (match && value !== undefined) {
          decoded += value;
          index += match[0].length;
          continue;
        }
        malformedEscape(text, index, "Unicode");
      } else if (next === "u") {
        const match = /^\\u([0-9a-fA-F]{4})/.exec(text.slice(index));
        if (match) {
          decoded += String.fromCharCode(Number.parseInt(match[1], 16));
          index += match[0].length;
          continue;
        }
        malformedEscape(text, index, "Unicode");
      } else if (next === "x") {
        const match = /^\\x([0-9a-fA-F]{2})/.exec(text.slice(index));
        if (match) {
          decoded += String.fromCharCode(Number.parseInt(match[1], 16));
          index += match[0].length;
          continue;
        }
        malformedEscape(text, index, "hex");
      }

      decoded += character;
      index += 1;
      continue;
    }

    if (character === "%") {
      const match = /^%([0-9a-fA-F]{2})/.exec(text.slice(index));
      if (match) {
        decoded += String.fromCharCode(Number.parseInt(match[1], 16));
        index += match[0].length;
        continue;
      }
      malformedEscape(text, index, "percent");
      decoded += character;
      index += 1;
      continue;
    }

    if (character === "&") {
      const fragment = text.slice(index);
      const hexEntity = /^&#[xX]([0-9a-fA-F]+);/.exec(fragment);
      const decimalEntity = /^&#([0-9]+);/.exec(fragment);
      const entity = hexEntity ?? decimalEntity;
      if (entity) {
        const radix = hexEntity ? 16 : 10;
        const parsed = Number.parseInt(entity[1], radix);
        if (Number.isSafeInteger(parsed) && parsed <= 0x10ffff) {
          decoded += String.fromCodePoint(parsed);
          index += entity[0].length;
          continue;
        }
        malformedEscape(text, index, "HTML entity");
      }
      if (fragment.slice(0, 7).toLowerCase() === "&colon;") {
        decoded += ":";
        index += 7;
        continue;
      }
      if (fragment.startsWith("&#") || fragment.slice(0, 6).toLowerCase() === "&colon") {
        malformedEscape(text, index, "HTML entity");
      }
    }

    decoded += character;
    index += 1;
  }

  return decoded.replace(/[\t\n\r]/g, "");
}

export function decodeHttpCandidates(maskedText) {
  if (Buffer.byteLength(maskedText, "utf8") > MAX_ARTIFACT_TEXT_BYTES) {
    throw new Error("artifact text exceeds 32 MiB");
  }

  const passes = [];
  let current = maskedText;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const decoded = decodeSecurityPass(current);
    passes.push(decoded);
    if (decoded === current) break;
    current = decoded;
  }
  return passes;
}

export function scanText(text, name) {
  if (extname(name).toLowerCase() === ".map") throw new Error(`source map: ${name}`);
  if (/sourceMappingURL\s*=/iu.test(text)) throw new Error(`source map directive: ${name}`);
  const allowedRanges = collectAllowedRawHttpRanges(text, name);
  const maskedText = maskAllowedRawHttpRanges(text, allowedRanges);
  for (const decodedText of decodeHttpCandidates(maskedText)) {
    if (/sourceMappingURL\s*=/iu.test(decodedText)) throw new Error(`source map directive: ${name}`);
    const decodedWithoutSafeNamespaces = maskDecodedDataSvgNamespaces(decodedText);
    const decodedHttpIndex = decodedWithoutSafeNamespaces.search(/http:/iu);
    if (decodedHttpIndex !== -1) {
      const context = decodedText.slice(Math.max(0, decodedHttpIndex - 40), decodedHttpIndex + 120);
      throw new Error(`decoded HTTP occurrence: ${name}: ${JSON.stringify(context)}`);
    }
  }
}

export function scanArtifacts(paths, fsOps = DEFAULT_FS_OPS) {
  if (paths.length === 0) throw new Error("artifacts requires at least one path");
  const visit = (path) => {
    const stat = fsOps.lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`artifact link/reparse node: ${path}`);
    if (stat.isDirectory()) {
      for (const entry of fsOps.readdirSync(path)) visit(join(path, entry));
      return;
    }
    if (!stat.isFile()) throw new Error(`artifact node is not a regular file: ${path}`);
    const extension = extname(path).toLowerCase();
    if (!SCANNED_EXTENSIONS.has(extension)) return;
    if (extension === ".map") throw new Error(`source map: ${path}`);
    if (stat.size > MAX_ARTIFACT_TEXT_BYTES) throw new Error(`artifact text exceeds 32 MiB: ${path}`);
    scanText(fsOps.readFileSync(path, "utf8"), path);
  };
  for (const path of paths) visit(path);
}

export function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === "env" && args.length === 1) return validateApiEnv(process.env[args[0]]);
  if (command === "tauri" && args.length === 2) {
    const base = JSON.parse(readFileSync(args[0], "utf8"));
    const overlay = JSON.parse(readFileSync(args[1], "utf8"));
    return validateDevTauriOverlay(base, overlay);
  }
  if (command === "capabilities" && args.length === 2) {
    return validateCapabilities(
      JSON.parse(readFileSync(args[0], "utf8")),
      JSON.parse(readFileSync(args[1], "utf8")),
    );
  }
  if (command === "workflows" && args.length === 2) {
    return validateWorkflows(readFileSync(args[0], "utf8"), readFileSync(args[1], "utf8"));
  }
  if (command === "artifacts") return scanArtifacts(args);
  throw new Error("usage: release-gate.mjs env NAME | tauri BASE_PATH DEV_OVERLAY_PATH | capabilities MAIN MINI | workflows RELEASE TRUST | artifacts PATH...");
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryUrl === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
