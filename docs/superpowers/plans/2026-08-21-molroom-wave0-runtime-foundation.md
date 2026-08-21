# MolRoom Wave 0 Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin a reproducible JavaScript toolchain and add the complete, tested configuration/composition/security seams needed for Google runtime work without implementing Google auth or Calendar APIs yet.

**Architecture:** A pure `parseAppConfig` function owns all public runtime configuration and fails closed for production. A dependency-injected factory selects a complete runtime pair without importing mock or Google implementations itself. A standalone bundle scanner provides the production mock/backdoor gate; Wave 0 proves the scanner itself GREEN and records the current mock bundle as expected RED evidence.

**Tech Stack:** Node.js 24.19.0 LTS, npm 11.17.0, React 19, TypeScript 5.9, Vite 7, Vitest 3, Node ESM.

**Spec:** `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md`

## Global Constraints

- Work only on `main`; do not create/switch branches or worktrees, stash, reset, restore unrelated paths, or clean the shared tree.
- Stage and commit only the exact paths owned by the current task. Never use `git add -A`, `git commit -a`, or broad cleanup.
- Before every test, typecheck, or build command, record load, swap, Node/browser counts, Docker status, and owned PIDs; run serially with one worker and clean only owned processes.
- Pin exactly Node `24.19.0` and npm `11.17.0`; major-only pins are invalid.
- `production` requires `VITE_ADAPTER=google`, a nonempty `*.apps.googleusercontent.com` client ID, and `VITE_ALLOWED_HD=molcube.com`; invalid production configuration never falls back to mock.
- `rooms.json` and `policy.json` remain tracked public configuration and are not copied into environment JSON.
- Wave 0 must not implement GIS, Google Calendar, Drive, `SessionManager`, React provider migration, or Google repository behavior.
- The runtime factory is complete through dependency injection; do not add a throwing Google placeholder or dead compatibility export.
- The production bundle scanner must reject mock identity, mock session storage, QA query fixtures, `mockNow`, and title sentinels. The current default mock bundle is expected RED evidence, not a CI-pass target.
- Never put OAuth secrets, refresh tokens, service-account JSON, or AWS keys in source, Vite variables, fixtures, logs, or artifacts.

---

### Task 1: Reproducible Node/npm Toolchain

**Files:**
- Create: `.node-version`
- Create: `scripts/lib/toolchain-policy.mjs`
- Create: `scripts/lib/toolchain-policy.test.mjs`
- Create: `scripts/verify-toolchain.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: official Node 24.19.0 release contract and existing npm scripts.
- Produces: `readExpectedToolchain(root)`, `verifyToolchain(expected, actual)`, `npm run verify:toolchain`, and Vitest discovery for `scripts/**/*.test.mjs` plus `src/**/*.test.{ts,tsx}`.

- [ ] **Step 1: Add the failing toolchain policy tests**

Create `scripts/lib/toolchain-policy.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { verifyToolchain } from "./toolchain-policy.mjs";

describe("toolchain policy", () => {
  it("accepts the exact pinned Node and npm versions", () => {
    expect(() =>
      verifyToolchain(
        { node: "24.19.0", npm: "11.17.0" },
        { node: "24.19.0", npm: "11.17.0" },
      ),
    ).not.toThrow();
  });

  it.each([
    [{ node: "24.18.0", npm: "11.17.0" }, "Node 24.19.0 is required; received 24.18.0"],
    [{ node: "24.19.0", npm: "11.16.0" }, "npm 11.17.0 is required; received 11.16.0"],
  ])("rejects a patch-level mismatch", (actual, message) => {
    expect(() => verifyToolchain({ node: "24.19.0", npm: "11.17.0" }, actual)).toThrow(message);
  });
});
```

Update the `vite.config.ts` test include to:

```ts
include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
```

- [ ] **Step 2: Run the focused test and observe RED**

Run after the required host preflight:

```bash
npm test -- scripts/lib/toolchain-policy.test.mjs
```

Expected: FAIL because `scripts/lib/toolchain-policy.mjs` does not exist.

- [ ] **Step 3: Implement the exact-version policy and CLI**

Create `.node-version` with exactly:

```text
24.19.0
```

Create `scripts/lib/toolchain-policy.mjs`:

```js
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readExpectedToolchain(root) {
  const node = readFileSync(join(root, ".node-version"), "utf8").trim();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const match = /^npm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager ?? "");
  if (!match) throw new Error("packageManager must pin npm with an exact version");
  return { node, npm: match[1] };
}

export function verifyToolchain(expected, actual) {
  if (actual.node !== expected.node) {
    throw new Error(`Node ${expected.node} is required; received ${actual.node}`);
  }
  if (actual.npm !== expected.npm) {
    throw new Error(`npm ${expected.npm} is required; received ${actual.npm}`);
  }
}
```

Create `scripts/verify-toolchain.mjs`; parse npm from `npm_config_user_agent` and fail if it is absent instead of guessing:

```js
import { readExpectedToolchain, verifyToolchain } from "./lib/toolchain-policy.mjs";

const npm = /(?:^| )npm\/(\d+\.\d+\.\d+)(?: |$)/.exec(process.env.npm_config_user_agent ?? "")?.[1];
if (!npm) throw new Error("npm version is unavailable; run this command through npm");
verifyToolchain(readExpectedToolchain(process.cwd()), { node: process.versions.node, npm });
console.log("MolRoom toolchain: valid");
```

Add to `package.json`:

```json
"packageManager": "npm@11.17.0",
"engines": { "node": "24.19.0", "npm": "11.17.0" }
```

and scripts:

```json
"verify:toolchain": "node scripts/verify-toolchain.mjs"
```

Regenerate only `package-lock.json` metadata with npm 11.17.0.

Change CI `setup-node` to:

```yaml
with:
  node-version-file: .node-version
  cache: npm
```

Immediately after `setup-node`, install and verify the exact npm patch inside that
pinned Node environment, then install dependencies before any repository script:

```yaml
      - name: Pin npm
        run: npm install --global npm@11.17.0

      - name: Verify toolchain
        run: npm run verify:toolchain

      - name: Install
        run: npm ci
```

Move standalone generation/validation after `npm ci`. The remaining CI order is:
standalone generation and clean-diff proof, example validation, typecheck, test,
then build. Do not rely on the npm version bundled with Node 24.19.0.

- [ ] **Step 4: Verify GREEN with the pinned toolchain**

Use a temporary official Node 24.19.0 installation or an existing version manager
without changing system-wide defaults. Install npm 11.17.0 into that isolated Node
environment first, regenerate lock metadata through that exact npm, then run serially:

```bash
npm install --global npm@11.17.0
npm run verify:toolchain
npm test -- scripts/lib/toolchain-policy.test.mjs
```

Expected: `MolRoom toolchain: valid`; 3 focused tests PASS.

- [ ] **Step 5: Commit only the toolchain paths**

```bash
git add -- .node-version package.json package-lock.json vite.config.ts .github/workflows/ci.yml scripts/lib/toolchain-policy.mjs scripts/lib/toolchain-policy.test.mjs scripts/verify-toolchain.mjs
git commit -m "build: pin the MolRoom toolchain" -- .node-version package.json package-lock.json vite.config.ts .github/workflows/ci.yml scripts/lib/toolchain-policy.mjs scripts/lib/toolchain-policy.test.mjs scripts/verify-toolchain.mjs
git show --stat --oneline HEAD
```

### Task 2: Immutable Fail-Closed AppConfig

**Files:**
- Create: `src/app/env.ts`
- Create: `src/app/env.test.ts`
- Modify: `src/main.tsx`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `Room`, `Policy`, `rooms.json`, and `policy.json`.
- Produces: `Deployment`, `AdapterMode`, `AppConfig`, `ParseAppConfigInput`,
  `parseAppConfig(input)`, and `assertBrowserConfiguration(modeEnv)`.

- [ ] **Step 1: Write the failing configuration contract tests**

Create `src/app/env.test.ts` with narrow tests that use copied room/policy fixtures and assert:

```ts
const productionEnv = {
  VITE_DEPLOYMENT: "production",
  VITE_ADAPTER: "google",
  VITE_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  VITE_ALLOWED_HD: "molcube.com",
} as const;

function production(overrides: Record<string, string | undefined> = {}) {
  return parseAppConfig({ commandEnv: { ...productionEnv, ...overrides } });
}

expect(parseAppConfig()).toMatchObject({
  deployment: "local",
  adapter: "mock",
  googleClientId: null,
  allowedHostedDomain: "molcube.com",
});
```

Add cases with these exact expectations:

```ts
expect(parseAppConfig({
  modeEnv: { VITE_DEPLOYMENT: "preview", VITE_ADAPTER: "mock" },
  commandEnv: { VITE_DEPLOYMENT: "production", VITE_ADAPTER: "google", VITE_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com", VITE_ALLOWED_HD: "molcube.com" },
}).deployment).toBe("production");

expect(() => production({ VITE_ADAPTER: "mock" })).toThrow("Invalid production configuration: VITE_ADAPTER");
expect(() => production({ VITE_GOOGLE_CLIENT_ID: "" })).toThrow("Invalid production configuration: VITE_GOOGLE_CLIENT_ID");
expect(() => production({ VITE_GOOGLE_CLIENT_ID: "client.example.com" })).toThrow("Invalid production configuration: VITE_GOOGLE_CLIENT_ID");
expect(() => production({ VITE_ALLOWED_HD: "example.com" })).toThrow("Invalid production configuration: VITE_ALLOWED_HD");
```

Add room failures for empty `id`, `name`, `email`, and duplicate values. Add policy failures for non-integers, non-positive durations, `gridStartHour >= gridEndHour`, hours outside `0..24`, a grid span not divisible by `slotMinutes`, `maxDurationMinutes < slotMinutes`, and `slotMinutes % extendStepMinutes !== 0`.

Finally assert `Object.isFrozen` for config, rooms array, every room, policy, and `policy.admins`, and assert that a mutation attempt throws in strict mode.

Add a boot-path test which calls the exported browser entry helper and proves it
throws the same exact production error rather than falling back:

```ts
expect(() => assertBrowserConfiguration({
  VITE_DEPLOYMENT: "production",
  VITE_ADAPTER: "mock",
  VITE_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  VITE_ALLOWED_HD: "molcube.com",
})).toThrow("Invalid production configuration: VITE_ADAPTER");
```

- [ ] **Step 2: Run the focused test and observe RED**

```bash
npm test -- src/app/env.test.ts
```

Expected: FAIL because `src/app/env.ts` does not exist.

- [ ] **Step 3: Implement the parser with a single precedence rule**

Create `src/app/env.ts` with this public shape:

```ts
export type Deployment = "local" | "preview" | "production";
export type AdapterMode = "mock" | "google";

export interface AppConfig {
  readonly deployment: Deployment;
  readonly adapter: AdapterMode;
  readonly googleClientId: string | null;
  readonly allowedHostedDomain: string;
  readonly rooms: readonly Readonly<Room>[];
  readonly policy: Omit<Readonly<Policy>, "admins"> & { readonly admins: readonly string[] };
}

type Env = Readonly<Record<string, string | undefined>>;
export interface ParseAppConfigInput {
  readonly commandEnv?: Env;
  readonly modeEnv?: Env;
  readonly rooms?: readonly Room[];
  readonly policy?: Policy;
}

export function parseAppConfig(input: ParseAppConfigInput = {}): AppConfig;
export function assertBrowserConfiguration(modeEnv: Env): void;
```

Resolve every `VITE_*` value through one helper: `commandEnv[name] ?? modeEnv[name] ?? defaultValue`. Clone tracked JSON before validation, validate the exact contracts above, then recursively freeze the returned object. Error messages are `Invalid production configuration: <field>` in production and `Invalid configuration: <field>` otherwise. Do not read `process.env` or `import.meta.env` inside the pure parser.

`assertBrowserConfiguration(modeEnv)` must call `parseAppConfig({ modeEnv })` and
discard only the returned value; it exists so the browser entrypoint has one tested,
named fail-closed boundary. Call it in `src/main.tsx` before looking up `#root` or
calling `createRoot`:

```ts
assertBrowserConfiguration(import.meta.env);
```

Change `vite.config.ts` to `defineConfig(({ mode }) => ...)`, import Vite's
`loadEnv`, and call:

```ts
parseAppConfig({
  commandEnv: process.env,
  modeEnv: loadEnv(mode, process.cwd(), ""),
});
```

before returning the existing Vite config. This is the build-time fail-closed
boundary. It must preserve the test include introduced by Task 1.

- [ ] **Step 4: Run focused tests and typecheck GREEN**

```bash
npm test -- src/app/env.test.ts
npm run typecheck
```

Expected: configuration tests PASS; typecheck exits 0.

Then prove the actual build boundary rejects an invalid production configuration:

```bash
VITE_DEPLOYMENT=production \
VITE_ADAPTER=mock \
VITE_GOOGLE_CLIENT_ID=client.apps.googleusercontent.com \
VITE_ALLOWED_HD=molcube.com \
npm run build
```

Expected: exit 1 before bundling with
`Invalid production configuration: VITE_ADAPTER`. This expected RED is a successful
security assertion. Do not weaken it to a unit-only claim. A valid Google-marked
configuration may pass this configuration boundary in Wave 0, but Task 4 must still
reject the resulting mock-composed bundle.

- [ ] **Step 5: Commit only AppConfig**

```bash
git add -- src/app/env.ts src/app/env.test.ts src/main.tsx vite.config.ts
git commit -m "feat: define fail-closed runtime configuration" -- src/app/env.ts src/app/env.test.ts src/main.tsx vite.config.ts
git show --stat --oneline HEAD
```

### Task 3: Dependency-Injected Runtime Factory Seam

**Files:**
- Create: `src/app/runtime/factory.ts`
- Create: `src/app/runtime/factory.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `AuthAdapter`, and `BookingRepository` types only.
- Produces: `RuntimeServices`, `RuntimeFactory`, `RuntimeFactories`, and `createRuntimeServices(config, factories)`.

- [ ] **Step 1: Write the failing selection tests**

Create `src/app/runtime/factory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRuntimeServices } from "./factory";
import type { RuntimeFactories, RuntimeServices } from "./factory";
import type { AppConfig } from "../env";

const services = (label: string) => ({ label }) as unknown as RuntimeServices;
const config = (adapter: "mock" | "google") => ({ adapter }) as AppConfig;

describe("runtime factory", () => {
  it.each(["mock", "google"] as const)("selects only the %s factory", (adapter) => {
    const calls: string[] = [];
    const mockResult = services("mock");
    const googleResult = services("google");
    const mock = () => { calls.push("mock"); return mockResult; };
    const google = () => { calls.push("google"); return googleResult; };
    const factories: RuntimeFactories = { mock, google };

    const result = createRuntimeServices(config(adapter), factories);

    expect(result).toBe(adapter === "mock" ? mockResult : googleResult);
    expect(calls).toEqual([adapter]);
  });
});
```

- [ ] **Step 2: Run the focused test and observe RED**

```bash
npm test -- src/app/runtime/factory.test.ts
```

Expected: FAIL because `factory.ts` does not exist.

- [ ] **Step 3: Implement the complete injection seam**

Create `src/app/runtime/factory.ts`:

```ts
import type { AuthAdapter } from "../../auth/types";
import type { BookingRepository } from "../../data/BookingRepository";
import type { AppConfig } from "../env";

export interface RuntimeServices {
  readonly auth: AuthAdapter;
  readonly repository: BookingRepository;
}

export type RuntimeFactory = (config: AppConfig) => RuntimeServices;
export type RuntimeFactories = Readonly<Record<AppConfig["adapter"], RuntimeFactory>>;

export function createRuntimeServices(config: AppConfig, factories: RuntimeFactories): RuntimeServices {
  return factories[config.adapter](config);
}
```

Do not add a default factory map, import `mockAdapter`, or create a Google placeholder. Wave 2 supplies concrete factories after Wave 1 proves the API architecture.

- [ ] **Step 4: Run focused tests and typecheck GREEN**

```bash
npm test -- src/app/runtime/factory.test.ts
npm run typecheck
```

Expected: focused test PASS; typecheck exits 0.

- [ ] **Step 5: Commit only the runtime seam**

```bash
git add -- src/app/runtime/factory.ts src/app/runtime/factory.test.ts
git commit -m "feat: add the runtime composition seam" -- src/app/runtime/factory.ts src/app/runtime/factory.test.ts
git show --stat --oneline HEAD
```

### Task 4: Production Bundle Backdoor Scanner

**Files:**
- Create: `scripts/lib/production-bundle-policy.mjs`
- Create: `scripts/lib/production-bundle-policy.test.mjs`
- Create: `scripts/scan-production-bundle.mjs`
- Modify: `src/config/currentUser.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: a directory containing built static assets.
- Produces: `FORBIDDEN_PRODUCTION_MARKERS`, `scanProductionBundle(root)`, and `npm run scan:production-bundle`.

- [ ] **Step 1: Write the failing scanner tests**

Create a Vitest test using `mkdtemp`, `mkdir`, and `writeFile` only inside its temporary directory. Cover:

```js
expect(await scanProductionBundle(cleanRoot)).toEqual([]);
expect(await scanProductionBundle(dirtyRoot)).toEqual([
  { marker: "__declined", path: "assets/app.js" },
  { marker: "molroom.mock.identity", path: "assets/app.js" },
  { marker: "molroom.mockAuth.session", path: "index.html" },
]);
```

Also assert that nested files are scanned, results are stable-sorted by path then marker, and binary files do not crash the scanner.

The clean fixture must contain the legitimate public configuration value
`sungjun@molcube.com` and still produce no findings. The dirty fixture must also
contain `molroom.mock.identity` and report it. This distinguishes a mock-runtime
identity marker from the same public email in `policy.json`.

- [ ] **Step 2: Run the focused test and observe RED**

```bash
npm test -- scripts/lib/production-bundle-policy.test.mjs
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the scanner and CLI**

The exported marker list is exactly:

```js
export const FORBIDDEN_PRODUCTION_MARKERS = [
  "molroom.mock.identity",
  "molroom.mockAuth.session",
  "[MolRoom QA]",
  "QA fixture:",
  "mockSaveDelayMs",
  "mockReadError",
  "mockPrefsSaveError",
  "mockNow",
  "__taken",
  "__declined",
];
```

Add an explicit stable mock-only runtime marker to `src/config/currentUser.ts`:

```ts
export const MOCK_IDENTITY = {
  runtimeSource: "molroom.mock.identity",
  email: "sungjun@molcube.com",
  name: "성준",
} as const;
```

The property must remain part of the mock identity objects used by both mock
adapters so it survives optimized bundling. Do not blacklist the email address,
room calendar IDs, or any tracked `rooms.json` / `policy.json` value.

`scanProductionBundle(root)` recursively reads regular files, returns project-relative POSIX paths, and reports every marker once per file. The CLI defaults to `dist`, prints `MolRoom production bundle: valid` on zero findings, and otherwise prints the stable finding list and exits 1. It must fail if the target directory does not exist or is empty.

Add:

```json
"scan:production-bundle": "node scripts/scan-production-bundle.mjs dist"
```

- [ ] **Step 4: Verify scanner GREEN and current mock bundle RED**

After the required host preflight, run serially:

```bash
npm test -- scripts/lib/production-bundle-policy.test.mjs
npm run build
npm run scan:production-bundle
```

Expected: scanner tests PASS; build exits 0; bundle scan exits 1 and reports at least one exact forbidden marker. Save the RED command, exit code, and findings in this plan's SDD report. Do not weaken markers, do not add the failing scan to CI in Wave 0, and do not call the current mock bundle production-safe.

- [ ] **Step 5: Commit the complete scanner**

```bash
git add -- scripts/lib/production-bundle-policy.mjs scripts/lib/production-bundle-policy.test.mjs scripts/scan-production-bundle.mjs src/config/currentUser.ts package.json package-lock.json
git commit -m "build: add the production bundle policy gate" -- scripts/lib/production-bundle-policy.mjs scripts/lib/production-bundle-policy.test.mjs scripts/scan-production-bundle.mjs src/config/currentUser.ts package.json package-lock.json
git show --stat --oneline HEAD
```

### Task 5: Runtime Foundation Integration Proof

**Files:**
- Modify only if a real defect is found: files owned by Tasks 1–4.
- Evidence: this plan's `.superpowers/sdd/2026-08-21-molroom-wave0-runtime-foundation/` workspace only.

**Interfaces:**
- Consumes: Tasks 1–4 commits.
- Produces: a reviewable Wave 0 runtime-foundation commit range and exact verification evidence.

- [ ] **Step 1: Audit committed-path scope**

Record `git log --oneline` and `git show --name-only` for every task commit. Confirm none of the pre-existing dirty product, design archive, OMD, README, or `.codex-artifacts` paths were included.

- [ ] **Step 2: Run the minimum integrated checks serially**

After a fresh host preflight:

```bash
npm test -- scripts/lib/toolchain-policy.test.mjs src/app/env.test.ts src/app/runtime/factory.test.ts scripts/lib/production-bundle-policy.test.mjs
npm run typecheck
git diff --check
```

Expected: all focused tests PASS, typecheck exits 0, diff check is clean. Do not repeat the build; Task 4 already supplies the only Wave 0 build evidence.

- [ ] **Step 3: Preserve the intentional production RED**

Record that `npm run scan:production-bundle` is RED only because the current app still imports mock runtime paths. Link the exact findings to Wave 2's mock/production composition task. A GREEN claim for production deployment is forbidden in Wave 0.

- [ ] **Step 4: Request task-range review**

Generate a review package from the plan base through current HEAD. The reviewer must verify spec coverage, exact toolchain pins, configuration fail-closed behavior, absence of throwing placeholders, scanner completeness, test quality, and shared-tree path isolation.
