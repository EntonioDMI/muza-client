import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, test } from "node:test";
import * as gate from "./release-gate.mjs";

import {
  ALLOWED_HTTP_LITERALS,
  DEVELOPMENT_CSP,
  PRODUCTION_CSP,
  decodeHttpCandidates,
  main,
  scanArtifacts,
  scanText,
  validateApiEnv,
  validateDevTauriOverlay,
  validateTauriConfig,
} from "./release-gate.mjs";

const scriptPath = fileURLToPath(new URL("./release-gate.mjs", import.meta.url));
const clientRoot = dirname(dirname(scriptPath));
const baseConfigPath = join(clientRoot, "apps", "desktop", "src-tauri", "tauri.conf.json");
const overlayConfigPath = join(clientRoot, "apps", "desktop", "src-tauri", "tauri.dev.conf.json");
const mainCapabilityPath = join(clientRoot, "apps", "desktop", "src-tauri", "capabilities", "main.json");
const miniCapabilityPath = join(clientRoot, "apps", "desktop", "src-tauri", "capabilities", "mini.json");
const releaseWorkflowPath = join(clientRoot, ".github", "workflows", "release.yml");
const trustWorkflowPath = join(clientRoot, ".github", "workflows", "trust-gate.yml");
const webPackagePath = join(clientRoot, "apps", "web", "package.json");
const MAX_ARTIFACT_TEXT_BYTES = 32 * 1024 * 1024;

const EXPECTED_ALLOWED_HTTP_LITERALS = [
  "http://json-schema.org/draft-04/schema#",
  "http://json-schema.org/draft-07/schema#",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/2000/svg",
  "http://f",
  "http://n",
];

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

const EXPECTED_ACTIONS = {
  checkout: "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
  pnpm: "pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa",
  node: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  rust: "dtolnay/rust-toolchain@4be7066ada62dd38de10e7b70166bc74ed198c30",
  cache: "Swatinem/rust-cache@42dc69e1aa15d09112580998cf2ef0119e2e91ae",
  tauri: "tauri-apps/tauri-action@fce9c6108b31ea247710505d3aaaa893ee6768d4",
};

const tempRoots = [];

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), "muza-release-gate-test-"));
  tempRoots.push(root);
  return root;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: clientRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
  });
}

function expectScanRejects(text, name = "artifact.js", pattern = /HTTP|escape|source map/i) {
  assert.throws(() => scanText(text, name), pattern);
}

function insertPort(literal, port) {
  const tail = literal.slice("http://".length);
  const slash = tail.indexOf("/");
  if (slash === -1) return `http://${tail}:${port}`;
  return `http://${tail.slice(0, slash)}:${port}${tail.slice(slash)}`;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe("API environment and exact CSP contracts", () => {
  test("pins the TypeScript 7 CLI beside the Next-compatible TypeScript 6 API", () => {
    const webPackage = readJson(webPackagePath);
    assert.equal(webPackage.devDependencies?.["@typescript/native"], "npm:typescript@^7.0.2");
    assert.equal(webPackage.devDependencies?.typescript, "npm:@typescript/typescript6@^6.0.2");
  });

  test("accepts only the canonical production API environment", () => {
    assert.doesNotThrow(() => validateApiEnv("https://api.muza.lol/api"));
    for (const value of [undefined, "", "http://api.muza.lol/api", "http://localhost:8000/api", "https://api.muza.lol", "https://api.muza.lol/api/"]) {
      assert.throws(() => validateApiEnv(value), /API env must equal https:\/\/api\.muza\.lol\/api/);
    }
  });

  test("exports and accepts the exact production CSP scalar", () => {
    assert.equal(
      PRODUCTION_CSP,
      // frame-src перед connect-src: песочница плагинов W8 (см. комментарий у
      // PRODUCTION_CSP); connect-src остаётся последним ради DEVELOPMENT_CSP-конкатенации.
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: asset: http://asset.localhost; font-src 'self' data:; media-src 'self' blob: https: asset: http://asset.localhost; frame-src http://muza-plugin.localhost muza-plugin://localhost; connect-src 'self' https://api.muza.lol ipc: http://ipc.localhost asset: http://asset.localhost",
    );
    assert.equal(DEVELOPMENT_CSP, `${PRODUCTION_CSP} http://localhost:8000`);
    assert.doesNotThrow(() => validateTauriConfig({
      app: { security: { csp: PRODUCTION_CSP } },
      bundle: { externalBin: ["bin/yt-dlp", "bin/deno"] },
    }));
  });

  test("rejects deleted, duplicated, reordered, extra, and weakened production CSP", () => {
    const directives = PRODUCTION_CSP.split("; ");
    const variants = [
      directives.slice(1).join("; "),
      `${PRODUCTION_CSP}; default-src 'self'`,
      [directives[1], directives[0], ...directives.slice(2)].join("; "),
      `${PRODUCTION_CSP}; object-src 'none'`,
      `${PRODUCTION_CSP} https:`,
    ];

    for (const directive of directives.slice(0, -1)) {
      variants.push(PRODUCTION_CSP.replace(directive, `${directive} *`));
    }

    for (const csp of variants) {
      assert.throws(() => validateTauriConfig({ app: { security: { csp } } }), /production CSP/);
    }
  });

  test("rejects missing or unsafe connect-src variants", () => {
    const connect = "connect-src 'self' https://api.muza.lol ipc: http://ipc.localhost asset: http://asset.localhost";
    const variants = [
      PRODUCTION_CSP.replace(`; ${connect}`, ""),
      `${PRODUCTION_CSP}; ${connect}`,
      PRODUCTION_CSP.replace("https://api.muza.lol", "http://localhost:8000"),
      PRODUCTION_CSP.replace("https://api.muza.lol", "https:"),
      PRODUCTION_CSP.replace("https://api.muza.lol", "https://api.muza.lol.evil"),
    ];
    for (const csp of variants) {
      assert.throws(() => validateTauriConfig({ app: { security: { csp } } }), /production CSP/);
    }
  });

  test("validates the real base and exact dev overlay files", () => {
    const base = readJson(baseConfigPath);
    const overlay = readJson(overlayConfigPath);
    assert.doesNotThrow(() => validateTauriConfig(base));
    assert.doesNotThrow(() => validateDevTauriOverlay(base, overlay));

    for (const mutate of [
      (value) => { value.extra = true; },
      (value) => { value.app.extra = true; },
      (value) => { value.app.security.extra = true; },
    ]) {
      const invalid = clone(overlay);
      mutate(invalid);
      assert.throws(() => validateDevTauriOverlay(base, invalid), /unexpected keys/);
    }

    for (const csp of [PRODUCTION_CSP, `${DEVELOPMENT_CSP} https:`, DEVELOPMENT_CSP.replace(" http://localhost:8000", ""), DEVELOPMENT_CSP.replace("localhost", "127.0.0.1")]) {
      const invalid = clone(overlay);
      invalid.app.security.csp = csp;
      assert.throws(() => validateDevTauriOverlay(base, invalid), /dev CSP/);
    }
  });

  test("requires exactly the two logical sidecars in canonical order", () => {
    const base = readJson(baseConfigPath);
    assert.deepEqual(base.bundle?.externalBin, ["bin/yt-dlp", "bin/deno"]);
    for (const externalBin of [
      [],
      ["bin/yt-dlp"],
      ["bin/deno", "bin/yt-dlp"],
      ["bin/yt-dlp", "bin/deno", "bin/extra"],
      ["bin/yt-dlp.exe", "bin/deno"],
    ]) {
      const invalid = clone(base);
      invalid.bundle.externalBin = externalBin;
      assert.throws(() => validateTauriConfig(invalid), /externalBin/);
    }
  });
});

describe("least-privilege capabilities", () => {
  test("accepts only the exact main and mini real-file contracts", () => {
    const mainCapability = readJson(mainCapabilityPath);
    const miniCapability = readJson(miniCapabilityPath);

    assert.deepEqual(mainCapability.windows, ["main"]);
    assert.deepEqual(mainCapability.permissions, EXPECTED_MAIN_PERMISSIONS);
    assert.deepEqual(miniCapability.windows, ["mini"]);
    assert.deepEqual(miniCapability.permissions, [
      "core:default",
      "core:window:allow-start-dragging",
    ]);
    assert.doesNotThrow(() => gate.validateCapabilities(mainCapability, miniCapability));
  });

  test("rejects window crossover, permission drift and privileged mini permissions", () => {
    const canonicalMain = {
      $schema: "../gen/schemas/desktop-schema.json",
      identifier: "main",
      description: "main",
      windows: ["main"],
      permissions: clone(EXPECTED_MAIN_PERMISSIONS),
    };
    const canonicalMini = {
      $schema: "../gen/schemas/desktop-schema.json",
      identifier: "mini",
      description: "mini",
      windows: ["mini"],
      permissions: ["core:default", "core:window:allow-start-dragging"],
    };
    assert.doesNotThrow(() => gate.validateCapabilities(canonicalMain, canonicalMini));

    const variants = [
      [Object.assign(clone(canonicalMain), { windows: ["main", "mini"] }), canonicalMini],
      [canonicalMain, Object.assign(clone(canonicalMini), { windows: ["main", "mini"] })],
      [Object.assign(clone(canonicalMain), { permissions: EXPECTED_MAIN_PERMISSIONS.slice(0, -1) }), canonicalMini],
      [Object.assign(clone(canonicalMain), { permissions: [...EXPECTED_MAIN_PERMISSIONS, "shell:default"] }), canonicalMini],
      [canonicalMain, Object.assign(clone(canonicalMini), { permissions: [...canonicalMini.permissions, "updater:default"] })],
      [Object.assign(clone(canonicalMain), { remote: { urls: ["https://evil.test"] } }), canonicalMini],
      [canonicalMain, Object.assign(clone(canonicalMini), { remote: { urls: ["https://evil.test"] } })],
      [Object.assign(clone(canonicalMain), { identifier: "default" }), canonicalMini],
      [canonicalMain, Object.assign(clone(canonicalMini), { identifier: "default" })],
    ];
    for (const [mainCapability, miniCapability] of variants) {
      assert.throws(() => gate.validateCapabilities(mainCapability, miniCapability), /capabilit|permission|window|identifier/i);
    }
  });
});

describe("pinned trust and release workflows", () => {
  test("validates both real workflows and exact immutable action sets", () => {
    const release = readFileSync(releaseWorkflowPath, "utf8");
    const trust = readFileSync(trustWorkflowPath, "utf8");
    assert.doesNotThrow(() => gate.validateWorkflows(release, trust));

    const uses = (text) => [...text.matchAll(/^ {6}(?:- uses:|  uses:)\s*(\S+)\s*$/gm)].map((match) => match[1]);
    assert.deepEqual(uses(release), [...Object.values(EXPECTED_ACTIONS)]);
    assert.deepEqual(uses(trust), Object.values(EXPECTED_ACTIONS).slice(0, -1));
  });

  test("rejects mutable actions, credential persistence, env drift and reordered authority", () => {
    const release = readFileSync(releaseWorkflowPath, "utf8");
    const trust = readFileSync(trustWorkflowPath, "utf8");
    const denoChecksumLine = trust.split("\n").find((line) => line.includes("Deno checksum mismatch"));
    const extractionLine = trust.split("\n").find((line) => line.includes("Expand-Archive"));
    assert.ok(denoChecksumLine && extractionLine);
    const checksumAfterExtraction = trust.replace(
      `${denoChecksumLine}\n${extractionLine}`,
      `${extractionLine}\n${denoChecksumLine}`,
    );
    const mutations = [
      [release.replace(EXPECTED_ACTIONS.checkout, "actions/checkout@v4"), trust],
      [release, trust.replace(EXPECTED_ACTIONS.node, "actions/setup-node@v4")],
      [release.replace("persist-credentials: false", "persist-credentials: true"), trust],
      [release, trust.replace("persist-credentials: false", "persist-credentials: true")],
      [release.replace("VITE_API_URL: ${{ vars.MUZA_API_URL }}", "VITE_API_URL: http://localhost:8000/api"), trust],
      [release, trust.replace("NEXT_PUBLIC_API_URL: ${{ vars.MUZA_API_URL }}", "NEXT_PUBLIC_API_URL: https://api.muza.lol/api/")],
      [release.replace("node scripts/release-gate.mjs env VITE_API_URL", "node -e \"process.exit(0)\""), trust],
      [release, trust.replace("node scripts/release-gate.mjs env NEXT_PUBLIC_API_URL", "node -e \"process.exit(0)\"")],
      [release.replace("apps/desktop/dist apps/web/out", "apps/desktop/dist"), trust],
      [release, trust.replace("apps/desktop/dist apps/web/out", "apps/web/out")],
      [release.replace("tauri.conf.json apps/desktop/src-tauri/tauri.dev.conf.json", "tauri.conf.json"), trust],
      [release, `${trust}\n      - name: late step\n        run: echo late\n`],
      [`${release}\n      - name: forbidden after release\n        run: echo late\n`, trust],
      [release.replace("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}", ""), trust],
      [release.replace("- name: Установка зависимостей", "- name: Установка зависимостей\n        env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}"), trust],
      [release.replace("      contents: write", "      contents: write\n      id-token: write"), trust],
      [release, trust.replace("  contents: read", "  contents: read\n  id-token: write")],
      [release, checksumAfterExtraction],
    ];
    for (const [badRelease, badTrust] of mutations) {
      assert.throws(() => gate.validateWorkflows(badRelease, badTrust), /workflow|action|credential|env|gate|artifact|secret|last|order|tauri/i);
    }
  });
});

describe("raw HTTP compatibility is frozen and canonical", () => {
  test("pins exactly eight standalone non-network literals", () => {
    assert.ok(ALLOWED_HTTP_LITERALS instanceof Set);
    assert.deepEqual([...ALLOWED_HTTP_LITERALS], EXPECTED_ALLOWED_HTTP_LITERALS);
    assert.equal(ALLOWED_HTTP_LITERALS.size, 8);
    for (const literal of EXPECTED_ALLOWED_HTTP_LITERALS) {
      assert.doesNotThrow(() => scanText(literal, "schema.js"));
      assert.doesNotThrow(() => scanText(`const value = "${literal}";`, "schema.js"));
      assert.doesNotThrow(() => scanText(`(${literal});`, "schema.js"));
    }
  });

  test("accepts canonical internal Tauri origins with paths only at hard boundaries", () => {
    for (const host of ["ipc.localhost", "asset.localhost"]) {
      const url = `http://${host}/path?x=1#y`;
      assert.doesNotThrow(() => scanText(url, "bundle.js"));
      assert.doesNotThrow(() => scanText(`const url="${url}";`, "bundle.js"));
      assert.doesNotThrow(() => scanText(`connect-src 'self' ${url} ;`, "bundle.js"));
    }
    expectScanRejects("xhttp://ipc.localhost");
    expectScanRejects("prefixhttp://asset.localhost/path");
  });

  test("accepts only the structural Zod IPv6 parser sentinel", () => {
    const ipv6 = 'const kind="$ZodIPv6";check=n=>{try{new URL(`http://[${n.value}]`)}catch{issues.push({format:"ipv6"})}}';
    const cidrv6 = 'const kind="$ZodCIDRv6";check=e=>{try{new URL(`http://[${e}]`)}catch{issues.push({format:`cidrv6`})}}';
    assert.doesNotThrow(() => scanText(ipv6, "zod.js"));
    assert.doesNotThrow(() => scanText(cidrv6, "zod.js"));

    for (const hostile of [
      'try{new URL(`http://[${n.value}]`)}catch{issues.push({format:"ipv6"})}',
      'const kind="$ZodIPv6";try{new URL(`http://[${n.value}]`)}catch{issues.push({format:"ipv4"})}',
      'const kind="$ZodIPv6";try{fetch(`http://[${n.value}]`)}catch{issues.push({format:"ipv6"})}',
      'const kind="$ZodIPv6";try{new URL(`http://[${n.call()}]`)}catch{issues.push({format:"ipv6"})}',
      'const kind="$ZodIPv6";try{new URL(`http://[${n.value}]/path`)}catch{issues.push({format:"ipv6"})}',
      'const kind="$ZodIPv6";try{const parsed=new URL(`http://[${n.value}]`)}catch{issues.push({format:"ipv6"})}',
    ]) {
      expectScanRejects(hostile, "zod.js");
    }
  });

  test("accepts only the structural URL-polyfill default-port table", () => {
    const safe = "const ports={ftp:21,file:null,http:80,https:443,ws:80,wss:443};";
    assert.doesNotThrow(() => scanText(safe, "polyfills.js"));

    for (const hostile of [
      "const ports={http:80,https:443,ws:80,wss:443};",
      "const ports={ftp:21,file:null,http:8000,https:443,ws:80,wss:443};",
      "const ports={ftp:21,file:null,http:80,https:444,ws:80,wss:443};",
      "const ports={ftp:21,file:null,http:80,https:443,ws:81,wss:443};",
      "const ports={ftp:21,file:null,http:80,https:443,ws:80,wss:444};",
      "const value='ftp:21,file:null,http:80,https:443,ws:80,wss:443';",
      "const ports={ftp:21,file:null,http:80,https:443,ws:80,wss:443,evil:1};",
    ]) {
      expectScanRejects(hostile, "polyfills.js");
    }
  });

  test("rejects every extension and noncanonical spelling of frozen literals", () => {
    for (const literal of EXPECTED_ALLOWED_HTTP_LITERALS) {
      const tail = literal.slice("http://".length);
      for (const hostile of [
        `${literal}.evil`,
        `${literal}/extra`,
        `${literal}?next=http://localhost:8000/api`,
        `HTTP://${tail}`,
        `http%3A%2F%2F${tail}`,
        `http://user@${tail}`,
        insertPort(literal, 80),
        insertPort(literal, 443),
      ]) {
        expectScanRejects(hostile);
      }
      expectScanRejects(`http://ipc.localhost/?next=${literal}`);
    }
  });

  test("rejects hostile hosts, controls, backslashes, and split schemes", () => {
    for (const hostile of [
      "HTTP://localhost:8000/api",
      "http://ipc.localhost:80",
      "http://:@ipc.localhost",
      "http://ipc.localhost.evil",
      "http://ipc.localhost\t@evil.test",
      "http://ipc.localhost\t/path",
      "ht\ttp://localhost:8000/api",
      "ht\ntp://localhost:8000/api",
      "ht\rtp://localhost:8000/api",
      String.raw`http:\\localhost:8000/api`,
      "http://ipc.localhost/?next=http://localhost:8000/api",
    ]) {
      expectScanRejects(hostile);
    }
  });
});

describe("whole-file security decoding", () => {
  test("exposes supported encoded HTTP spellings without making them allowable", () => {
    const hostile = [
      String.raw`http\u003a\u002f\u002flocalhost:8000/api`,
      String.raw`http\x3a\/\/localhost:8000/api`,
      String.raw`\u{68}ttp://localhost:8000/api`,
      "http%3A%2F%2Flocalhost%3A8000%2Fapi",
      "http&#58;&#47;&#47;localhost:8000/api",
      "http&colon;//localhost:8000/api",
      String.raw`http\u003a\u002f\u002fipc.localhost/path`,
      String.raw`http\u003a\u002f\u002fasset.localhost/path`,
      String.raw`http\u003a\u002f\u002fwww.w3.org\u002f2000\u002fsvg`,
    ];
    for (const text of hostile) expectScanRejects(text);

    const passes = decodeHttpCandidates(String.raw`ht\u0074p\u003a\u002f\u002flocalhost:8000/api`);
    assert.ok(passes.length >= 1 && passes.length <= 4);
    assert.ok(passes.some((value) => value.includes("http://localhost:8000/api")));
  });

  test("accepts only the structural encoded data-SVG namespace sentinel", () => {
    const safe = "const image=`data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22176%22%3E%3C%2Fsvg%3E`;";
    assert.doesNotThrow(() => scanText(safe, "bundle.js"));

    for (const hostile of [
      "http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg",
      "const image=`data:image/svg+xml,%3Csvg%20href%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E`;",
      "const image=`data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg.evil%22%3E`;",
      "const image=`data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%2Fextra%22%3E`;",
      "const image=`data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Flocalhost%3A8000%2Fapi%22%3E`;",
      "const image=`data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20data-api%3D%22http%3A%2F%2Flocalhost%3A8000%2Fapi%22%3E`;",
    ]) {
      expectScanRejects(hostile, "bundle.js");
    }
  });

  test("same-length masking preserves raw allows and exposes unrelated hostile decoding", () => {
    const safe = String.raw`const svg="http://www.w3.org/2000/svg"; const schema="http://json-schema.org/draft-07/schema#"; const u="\u0041"; const slash="\/";`;
    assert.doesNotThrow(() => scanText(safe, "bundle.js"));

    const hostile = String.raw`const svg="http://www.w3.org/2000/svg"; const api="http\u003a\u002f\u002flocalhost:8000/api";`;
    expectScanRejects(hostile);
  });

  test("scans decoded payloads after more than 4096 benign characters", () => {
    const text = `${"a".repeat(5000)}${String.raw`http\u003a\u002f\u002flocalhost:8000/api`}`;
    expectScanRejects(text);
  });

  test("fails closed on malformed supported escapes adjacent to HTTP", () => {
    for (const malformed of [
      String.raw`http\u00G0`,
      String.raw`http\x3`,
      "http%3",
      "http&#xZZ;",
    ]) {
      expectScanRejects(malformed, "artifact.js", /escape|HTTP/i);
    }
  });

  test("rejects map extensions and raw or decoded sourceMappingURL directives", () => {
    for (const name of ["bundle.map", "bundle.MAP", "bundle.mAp"]) {
      expectScanRejects("{}", name, /source map/i);
    }
    for (const text of [
      "//# sourceMappingURL=bundle.js.map",
      "/*# SOURCEMAPPINGURL = bundle.css.map */",
      String.raw`sourceMappingURL\u003ddata:application/json;base64,e30=`,
      "sourceMappingURL%3Ddata:application/json;base64,e30=",
      String.raw`sourceMappingURL%255Cu003ddata:application/json;base64,e30=`,
    ]) {
      expectScanRejects(text, "bundle.js", /source map/i);
    }
  });
});

describe("artifact traversal fails closed", () => {
  test("rejects oversize text before readFileSync", () => {
    let reads = 0;
    const fsOps = {
      lstatSync: () => ({
        size: MAX_ARTIFACT_TEXT_BYTES + 1,
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      }),
      readFileSync: () => { reads += 1; return ""; },
      readdirSync: () => { throw new Error("unexpected directory read"); },
    };
    assert.throws(() => scanArtifacts(["oversize.js"], fsOps), /exceeds 32 MiB/);
    assert.equal(reads, 0);
  });

  test("scans a regular tree and rejects missing/stat/read failures", () => {
    const root = makeTempRoot();
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested", "safe.js"), 'const svg="http://www.w3.org/2000/svg";', "utf8");
    writeFileSync(join(root, "ignored.txt"), 'http://localhost:8000/api', "utf8");
    assert.doesNotThrow(() => scanArtifacts([root]));
    assert.throws(() => scanArtifacts([join(root, "missing")]), /ENOENT|cannot find/i);

    const fsOps = {
      lstatSync: () => ({ size: 1, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true }),
      readFileSync: () => { throw new Error("injected read failure"); },
      readdirSync: () => [],
    };
    assert.throws(() => scanArtifacts(["broken.js"], fsOps), /injected read failure/);
  });

  test("deterministically rejects links, cycles, and non-regular nodes", () => {
    let reads = 0;
    const linkStat = {
      size: 0,
      isSymbolicLink: () => true,
      isDirectory: () => false,
      isFile: () => false,
    };
    const linkFs = {
      lstatSync: () => linkStat,
      readFileSync: () => { reads += 1; return ""; },
      readdirSync: () => [],
    };
    assert.throws(() => scanArtifacts(["virtual-link"], linkFs), /link\/reparse node/);
    assert.equal(reads, 0);

    const cycleFs = {
      lstatSync: (path) => path === "virtual-root"
        ? { size: 0, isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }
        : linkStat,
      readFileSync: () => { reads += 1; return ""; },
      readdirSync: () => ["cycle"],
    };
    assert.throws(() => scanArtifacts(["virtual-root"], cycleFs), /link\/reparse node/);

    const otherFs = {
      lstatSync: () => ({ size: 0, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false }),
      readFileSync: () => { reads += 1; return ""; },
      readdirSync: () => [],
    };
    assert.throws(() => scanArtifacts(["virtual-reparse"], otherFs), /not a regular file/);
    assert.equal(reads, 0);
  });

  test("best-effort real file links, junctions, and self-cycles do not touch outside targets", (t) => {
    const root = makeTempRoot();
    const outside = makeTempRoot();
    const outsideFile = join(outside, "outside.js");
    writeFileSync(outsideFile, 'const marker="outside-unchanged";', "utf8");
    const before = sha256(outsideFile);
    let created = 0;

    const attempts = [
      { path: join(root, "file-link.js"), target: outsideFile, type: "file" },
      { path: join(root, "dir-junction"), target: outside, type: "junction" },
      { path: join(root, "self-cycle"), target: root, type: "junction" },
    ];
    for (const attempt of attempts) {
      try {
        symlinkSync(attempt.target, attempt.path, attempt.type);
        created += 1;
        assert.throws(() => scanArtifacts([attempt.path]), /link\/reparse node/);
      } catch (error) {
        if (error?.code !== "EPERM" && error?.code !== "EACCES" && error?.code !== "UNKNOWN") throw error;
      }
    }
    if (created === 0) t.diagnostic("real Windows link creation unavailable; deterministic injected-fs proof still ran");
    assert.equal(sha256(outsideFile), before);
    assert.equal(readFileSync(outsideFile, "utf8"), 'const marker="outside-unchanged";');
  });

  test("rejects source maps before reading them", () => {
    let reads = 0;
    const fsOps = {
      lstatSync: () => ({ size: 2, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true }),
      readFileSync: () => { reads += 1; return "{}"; },
      readdirSync: () => [],
    };
    assert.throws(() => scanArtifacts(["bundle.MaP"], fsOps), /source map/);
    assert.equal(reads, 0);
  });
});

describe("CLI is synchronous, import-safe, and works from this Windows path", () => {
  test("main dispatches public commands and rejects invalid usage", () => {
    const previous = process.env.MUZA_GATE_TEST_API;
    process.env.MUZA_GATE_TEST_API = "https://api.muza.lol/api";
    try {
      assert.doesNotThrow(() => main(["env", "MUZA_GATE_TEST_API"]));
      assert.doesNotThrow(() => main(["tauri", baseConfigPath, overlayConfigPath]));
      assert.doesNotThrow(() => main(["capabilities", mainCapabilityPath, miniCapabilityPath]));
      assert.doesNotThrow(() => main(["workflows", releaseWorkflowPath, trustWorkflowPath]));
      assert.throws(() => main(["env"]), /usage/);
      assert.throws(() => main(["tauri", baseConfigPath]), /usage/);
      assert.throws(() => main(["capabilities", mainCapabilityPath]), /usage/);
      assert.throws(() => main(["workflows", releaseWorkflowPath]), /usage/);
      assert.throws(() => main(["unknown"]), /usage/);
    } finally {
      if (previous === undefined) delete process.env.MUZA_GATE_TEST_API;
      else process.env.MUZA_GATE_TEST_API = previous;
    }
  });

  test("subprocess env command reports pass and failure via exit code and stderr", () => {
    const goodEnv = { ...process.env, MUZA_GATE_TEST_API: "https://api.muza.lol/api" };
    const good = runCli(["env", "MUZA_GATE_TEST_API"], { env: goodEnv });
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.stderr, "");

    const badEnv = { ...process.env, MUZA_GATE_TEST_API: "http://localhost:8000/api" };
    const bad = runCli(["env", "MUZA_GATE_TEST_API"], { env: badEnv });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /API env must equal https:\/\/api\.muza\.lol\/api/);
  });

  test("subprocess tauri command requires and validates both paths", () => {
    const good = runCli(["tauri", baseConfigPath, overlayConfigPath]);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.stderr, "");

    const missingOverlay = runCli(["tauri", baseConfigPath]);
    assert.equal(missingOverlay.status, 1);
    assert.match(missingOverlay.stderr, /usage/);

    const root = makeTempRoot();
    const badOverlay = join(root, "bad-overlay.json");
    writeFileSync(badOverlay, JSON.stringify({ app: { security: { csp: PRODUCTION_CSP } } }), "utf8");
    const bad = runCli(["tauri", baseConfigPath, badOverlay]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /dev CSP/);
  });

  test("subprocess artifacts command scans real files and rejects localhost", () => {
    const root = makeTempRoot();
    const safe = join(root, "safe.js");
    writeFileSync(safe, 'const svg="http://www.w3.org/2000/svg";', "utf8");
    const good = runCli(["artifacts", root]);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.stderr, "");

    const hostile = join(root, "hostile.js");
    writeFileSync(hostile, 'const api="http://localhost:8000/api";', "utf8");
    const bad = runCli(["artifacts", hostile]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /HTTP occurrence/i);

    const empty = runCli(["artifacts"]);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /at least one path/);
  });

  test("importing the module performs no CLI work", () => {
    const moduleUrl = pathToFileURL(scriptPath).href;
    const imported = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `await import(${JSON.stringify(moduleUrl)})`],
      { cwd: clientRoot, encoding: "utf8" },
    );
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "");
    assert.equal(imported.stderr, "");
    assert.equal(basename(scriptPath), "release-gate.mjs");
  });
});
