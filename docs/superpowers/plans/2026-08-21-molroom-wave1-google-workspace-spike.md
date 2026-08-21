# MolRoom Wave 1 Google Workspace Integration Spike Plan

## TL;DR
> Summary:      Build an isolated, non-production Google Workspace spike harness, have an authorized operator provision the minimum Internal OAuth/room setup, and capture redacted empirical evidence for GIS, Calendar, Drive, and People before any production adapter is implemented.
> Deliverables:
> - `scripts/google-spike/` local-only harness, deterministic validators, and focused tests
> - `docs/spikes/google-workspace/` provisioning contract, account matrix, redacted per-probe evidence, manifest, and architecture result
> - explicit teardown/no-secret proof and a fail-closed Wave 2 architecture gate
> Effort:       XL
> Risk:         High - Workspace tenant policy, room propagation, browser privacy behavior, and mobile test-origin availability are empirical and cannot be inferred from documentation.

## Scope
### Must have
- Keep the spike entirely outside the production runtime: no edits under `src/`, no Google adapter, no React provider migration, and no production deployment.
- Use the pinned Node `24.19.0` / npm `11.17.0` toolchain and the repository's serial, one-worker Vitest convention.
- Create a skeleton-first harness whose browser owns OAuth access tokens only in memory; the local server must never receive, persist, log, or echo a token.
- Define a fail-closed evidence schema and redactor before any live Google request. Commit only redacted summaries tied to the candidate Git SHA.
- Require a user/operator-only Google Cloud and Workspace provisioning gate: Internal OAuth web client, authorized origins, Calendar/Drive/People APIs, two room resources, ordinary member account, room-writer admin account, ACL, and auto-accept configuration.
- Exercise ordinary-user and admin roles separately with aliases, isolated browser profiles, and no shared credential material.
- Verify GIS user-gesture sign-in, grant/deny/cancel/popup-blocked paths, account switching, revocation, expiry, and explicit reconnect on desktop Chrome/Safari and on real mobile browser environments when an authorized reachable origin/device is available.
- Verify Calendar room attendee copy behavior, `extendedProperties.shared`, visibility, organizer-field exposure, Meet creation, auto-accept/decline timing, CRUD, conflict/race behavior, and room-writer admin cancellation.
- Verify independent-event recurrence using a shared `molroomSeriesId`, separate operation IDs, organizer/room-copy locators, `id`/`iCalUID` relationships, instance deletion, series lookup, and partial outcomes. Do not create an RRULE master.
- Verify Drive `appDataFolder` create/read/update/delete and same-account cross-browser readback.
- Verify People `searchDirectoryPeople` capability with an ordinary Workspace member and record only capability/count/field-presence summaries.
- Perform complete teardown, token revocation, owned-event/appData deletion verification, ignored-local-state removal, staged-diff secret scanning, and process cleanup.
- Produce a reproducible evidence manifest and an architecture result of `STATIC_SPA_SUPPORTED`, `DECISION_REQUIRED`, or `INCONCLUSIVE`. Never convert an unsupported or blocked tenant result into a guessed success.
- Execute tasks through subagent-driven development sequentially on shared `main`: one implementer per task, then an independent read-only reviewer, then at most five targeted fix/re-review rounds. Dependency waves below describe logical readiness, not permission for concurrent writes.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do not edit `src/**`, `DESIGN.md`, runtime composition, `AuthProvider`, `BookingRepository`, production dependencies, AWS/GitHub configuration, or deployment workflows in Wave 1.
- Do not add a backend, Firebase/Firestore, service account, domain-wide delegation, refresh-token store, OAuth client secret, or server-side authorization-code exchange.
- Do not place access tokens, refresh tokens, authorization headers, cookies, passwords, client secrets, raw names/emails, meeting titles, attendee lists, room email addresses, raw event IDs, raw query strings, or screenshots containing them in git, terminal output, diagnostics, or evidence.
- Do not test Google by wrapping a mock API and asserting the mock was called. Focused tests cover deterministic schema/redaction/request-shape/state-machine invariants; live tenant behavior is proven only by real requests and browser evidence.
- Do not quota-stress Google. The harness may test deterministic retry classification, but live probes stay below documented limits and use bounded, jittered backoff only for retryable `403`/`429` results.
- Do not assume Internal OAuth bypasses tenant approval, that room invitations propagate within a fixed duration, that Meet is enabled, that People directory data is visible, or that a room-writer can cancel another organizer's event.
- Do not label Playwright/WebKit viewport emulation as real iOS Safari or Android Chrome evidence. If no authorized origin/device is available, record `blocked-environment` and stop the architecture gate.
- Do not implement or decide the unresolved 15-minute UI/booking-policy choice. That decision is outside this spike plan.
- Do not branch, create a worktree, stash, reset, clean, use `git add -A`, use `git commit -a`, terminate another session's processes, or stage a path not owned by the active task.

## Verification strategy
> Zero human intervention - all verification is agent-executed. The only exceptions are the unavoidable operator-only Google console/credential/MFA actions described in Tasks 4-6; after those actions, scripts and agents perform every assertion and evidence check.
- Test decision: TDD with Vitest 3 for deterministic harness contracts; real Chrome/Safari/Calendar/Drive/People probes for external behavior
- QA policy: every task has agent-executed scenarios; tenant-dependent observations pass only when they are classified and evidenced, not when they match a preferred architecture
- Evidence: `<attemptDir>/task-<N>-<slug>.<ext>` — use the ignored, session-owned directory `.codex-artifacts/molroom-wave1-google-spike/<session-id>/`; record the literal directory in Task 1 and do not create a second planner-owned evidence tree.
- Before every test/typecheck/server/browser/API command, record `uptime`, `sysctl -n hw.logicalcpu`, `memory_pressure`, `sysctl vm.swapusage`, Node/browser/MCP counts, Docker state, port `5184`, and owned PID/PPID/command/cwd. The user's prior load override permits progress after warning, but not process ownership violations.
- Start only one spike server on `127.0.0.1:5184`; store its exact PID in `scripts/google-spike/.server.pid.local`. At every task boundary, send `TERM`, wait up to five seconds, use `KILL` only for the still-live owned PID/tree, and prove port/process counts returned to baseline.
- If a tool/fablize wrapper reports failure while the underlying command exits `0`, capture both outputs and classify it as an isolated harness baseline; do not silently call the task green.

## Execution strategy
### Parallel execution waves
> Target 5-8 tasks per wave. Because the repository is a shared `main` worktree, implementers run sequentially even within a wave; read-only discovery and review may run in parallel only after recording the MCP/process baseline.

Wave 1 (foundation lanes, no production-runtime dependency):
- Task 1: establish shared-main ownership, host/process baseline, and Wave 0 prerequisite gate
- Task 2: define the redacted evidence contract and validator
- Task 3: build the isolated browser/server harness skeleton
- Task 4: define and satisfy the operator-only Google provisioning gate
- Task 5: define and validate the ordinary/admin account and fixture matrix

Wave 2 (after Wave 1):
- Task 6: capture GIS lifecycle evidence
- Task 7: capture Calendar room-copy/shared-property/visibility/Meet/auto-decline evidence
- Task 8: capture Calendar CRUD, conflict, and admin-cancel evidence
- Task 9: capture independent-event recurrence and shared locator evidence
- Task 10: capture Drive `appDataFolder` evidence
- Task 11: capture People directory evidence

Wave 3 (after Wave 2):
- Task 12: teardown all owned Google/local state and prove no secrets/process leaks
- Task 13: consolidate and validate the reproducible evidence manifest
- Task 14: evaluate the architecture trigger and produce the decision gate

Critical path: Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7 -> Task 8 -> Task 9 -> Task 12 -> Task 13 -> Task 14

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1 | none | 2-5 | read-only research only |
| 2 | 1 | 3-14 | none (shared harness contract) |
| 3 | 1, 2 | 6-12 | 4, 5 after exact-path ownership is assigned |
| 4 | 1, 2 | 5-11 | 3 (operator action vs local code) |
| 5 | 1, 2, 4 | 6-11 | none |
| 6 | 3, 4, 5 | 7-11, 14 | none; browser profiles are single-owner |
| 7 | 3-6 | 12-14 | 10, 11 only after separate accounts/fixtures are assigned |
| 8 | 3-7 | 12-14 | 10, 11 only with separate room/event fixtures |
| 9 | 3-8 | 12-14 | 10, 11 only with separate room/event fixtures |
| 10 | 3-6 | 12-14 | 7-9, 11 with separate fixture state |
| 11 | 3-6 | 12-14 | 7-10 with separate fixture state |
| 12 | 6-11 | 13, 14 | none |
| 13 | 2, 4-12 | 14 | none |
| 14 | 13 | final verification | none |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Establish the Wave 1 ownership and process gate

  What to do: Confirm `main`, empty index, current HEAD, Wave 0 runtime/hygiene completion, existing dirty-path hashes, and non-overlap with `scripts/google-spike/**` and `docs/spikes/google-workspace/**`. Capture host/process baselines and create the attempt evidence directory. Record every pre-existing dirty path without modifying it. Define exact per-task path ownership before dispatching each implementer. If an owned path is already being edited by another session, stop that task and request handoff.
  Must NOT do: Do not modify, stage, stash, restore, commit, or clean any repository path. Do not start a server, browser, or subagent before the process baseline is recorded. Do not treat high host load as permission to kill unknown processes.

  Parallelization: Can parallel: NO | Wave 1 | Blocks: [2, 3, 4, 5] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/plans/2026-08-21-molroom-wave0-repository-hygiene.md:15-20` - shared-main, exact-path, and local-artifact ownership precedent
  - Pattern:  `docs/superpowers/plans/2026-08-21-molroom-wave0-runtime-foundation.md:15-18` - serial host/process preflight and owned-process cleanup precedent
  - Pattern:  `docs/superpowers/plans/2026-08-21-molroom-wave0-runtime-foundation.md:15-23` - prior exact-path, serial-test, and production-runtime boundaries
  - Pattern:  `.superpowers/sdd/2026-08-21-molroom-wave0-runtime-foundation/task-5-report.md:1` - Wave 0 integration evidence and intentional mock-bundle RED baseline
  - API/Type: `src/app/runtime/factory.ts:5-15` - completed Wave 0 composition seam that Wave 1 must not wire into the app
  - Test:     `package.json:6-20` - pinned toolchain and one-worker commands

  Acceptance criteria (agent-executable only):
  - [ ] `git branch --show-current` prints `main`; `git diff --cached --name-only` is empty.
  - [ ] `git status --short` plus `shasum -a 256` of every pre-existing dirty path is saved to `<attemptDir>/task-1-ownership.txt` and no dirty path is under either new spike root.
  - [ ] `npm run verify:toolchain` exits `0` and reports exact Node `24.19.0` and npm `11.17.0` after host preflight.
  - [ ] Baseline evidence lists PID, PPID, command, cwd/signature counts, port `5184`, Docker status, load, memory, and swap; no process is terminated.
  - [ ] `git diff --name-only -- src scripts docs package.json vite.config.ts` is unchanged before/after Task 1.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: clean ownership gate
    Tool:     bash
    Steps:    Set `attemptDir=.codex-artifacts/molroom-wave1-google-spike/<session-id>` with a literal unique session ID; run `git branch --show-current`, `git diff --cached --name-only`, `git status --short`, `git diff --name-only`, `uptime`, `sysctl -n hw.logicalcpu`, `memory_pressure`, `sysctl vm.swapusage`, `ps -axo pid=,ppid=,lstart=,rss=,command=`, `docker info`, and `lsof -nP -iTCP:5184 -sTCP:LISTEN`; filter the process output into owned/signature counts without killing anything.
    Expected: branch is `main`, index is empty, port 5184 has no listener, and no existing dirty path overlaps a Wave 1 owned path; otherwise the task stops without mutation.
    Evidence: <attemptDir>/task-1-ownership.txt

  Scenario: overlapping shared path
    Tool:     bash
    Steps:    Compare `git status --short` against literal prefixes `scripts/google-spike/` and `docs/spikes/google-workspace/`; also compare the controller's active-agent ownership ledger.
    Expected: any overlap yields `BLOCKED_PATH_OWNERSHIP` and no write/test/server process starts.
    Evidence: <attemptDir>/task-1-ownership-error.txt
  ```

  Commit: NO | Message: `n/a` | Files: []

- [ ] 2. Define the fail-closed redacted evidence contract

  What to do: Add versioned JSON schemas, a pure redactor, schema validator, manifest validator, and adversarial focused tests under `scripts/google-spike/`. Define aliases for accounts/rooms/calendars; hash raw Google event/file identifiers before persistence. Permitted fields are schema version, probe/run ID, candidate SHA, timestamps, role/browser/device aliases, operation ID, endpoint template without query string, HTTP status, Google request ID when present, capability/result category, response counts/field-presence flags, hashed locator fields, teardown status, and notes from a fixed enum. Reject unknown keys recursively. Add fixture values resembling Bearer tokens, JWTs, OAuth client secrets, emails, titles, attendees, cookies, raw room/event/file IDs, and query strings; the RED test must fail before implementation and GREEN after it.
  Must NOT do: Do not add a generic `JSON.stringify` logger, permissive unknown-field fallback, silent catch, raw-response fixture, or npm dependency. Do not write actual tenant data while testing.

  Parallelization: Can parallel: NO | Wave 1 | Blocks: [3-14] | Blocked by: [1]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:202-222` - account matrix and redacted evidence requirements
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:427-433` - allowed diagnostic fields and forbidden PII/secret fields
  - Pattern:  `.gitignore:4-18` - `*.local`, `.env.*`, and local artifact exclusions
  - Test:     `scripts/lib/production-bundle-policy.test.mjs:1` - existing focused Node ESM/Vitest test style
  - External: `https://developers.google.com/identity/protocols/oauth2/policies` - OAuth credential and token handling policy

  Acceptance criteria (agent-executable only):
  - [ ] RED: `npm test -- scripts/google-spike/lib/evidence.test.mjs` fails because the contract module or required rejection behavior is absent.
  - [ ] GREEN: the same command exits `0`, and mutation checks that remove recursive unknown-key rejection, raw-ID hashing, or any forbidden-pattern detector make at least one test fail.
  - [ ] `node scripts/google-spike/validate-evidence.mjs scripts/google-spike/fixtures/safe-evidence.json` exits `0`.
  - [ ] The validator exits nonzero with exact category `FORBIDDEN_EVIDENCE_FIELD` for every adversarial fixture without echoing the forbidden value.
  - [ ] `node scripts/google-spike/scan-sensitive-paths.mjs --redact <explicit-paths...>` scans only literal owned paths, exits nonzero by category when it finds forbidden material, and never prints the matched value.
  - [ ] `rg -n 'access_token|refresh_token|Authorization|Bearer |client_secret|cookie|attendees|summary|@molcube\\.com|\\?.+=' scripts/google-spike/fixtures/safe-evidence.json` has no match.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: valid evidence is accepted
    Tool:     bash
    Steps:    After host preflight, run `npm test -- scripts/google-spike/lib/evidence.test.mjs` then `node scripts/google-spike/validate-evidence.mjs scripts/google-spike/fixtures/safe-evidence.json`.
    Expected: focused tests pass once; validator prints only `evidence-valid schemaVersion=1 probeId=fixture-safe` and exits 0.
    Evidence: <attemptDir>/task-2-evidence-contract.txt

  Scenario: secret and PII payload is rejected
    Tool:     bash
    Steps:    Run the validator separately against committed adversarial fixture files for Bearer token, email/title/attendee, raw locator, unknown nested key, and query-string cases.
    Expected: every invocation exits nonzero with a category and JSON pointer only; stdout/stderr never contains the sensitive fixture value.
    Evidence: <attemptDir>/task-2-evidence-contract-error.txt
  ```

  Commit: YES | Message: `test(spike): define redacted Google evidence contract` | Files: [`scripts/google-spike/lib/evidence.mjs`, `scripts/google-spike/lib/evidence.test.mjs`, `scripts/google-spike/schemas/evidence.schema.json`, `scripts/google-spike/schemas/manifest.schema.json`, `scripts/google-spike/validate-evidence.mjs`, `scripts/google-spike/scan-sensitive-paths.mjs`, `scripts/google-spike/fixtures/safe-evidence.json`, `scripts/google-spike/fixtures/forbidden-token.json`, `scripts/google-spike/fixtures/forbidden-pii.json`, `scripts/google-spike/fixtures/forbidden-locator.json`, `scripts/google-spike/fixtures/forbidden-query.json`, `scripts/google-spike/fixtures/forbidden-unknown-key.json`]

- [ ] 3. Build the isolated local Google probe harness skeleton

  What to do: Add a fixed-port localhost server and diagnostic browser page under `scripts/google-spike/`. The browser loads the official GIS script, reads only public/configured aliases and room IDs from ignored local configuration, owns the access token in a closure, and calls Google APIs directly. The server may serve static files and accept only already-redacted schema-valid evidence at `POST /evidence`; it must reject authorization headers, cookies, unknown fields, and bodies over a small fixed limit. Add a bounded fetch state machine with cancellation, endpoint allowlist, low concurrency, and deterministic jittered retry classification for Calendar `403 rateLimitExceeded`/`429`; do not live quota-test. Read `DESIGN.md` in full before writing the diagnostic page, but do not import product styles or change product UI.
  Must NOT do: Do not import this harness from Vite/React, modify `package.json`, add an SDK dependency, proxy Google requests through localhost, receive a token server-side, store token/session data, bind beyond `127.0.0.1`, or implement a production adapter.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [6-12] | Blocked by: [1, 2]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `DESIGN.md:1` - binding UI/copy/motion authority; read in full before the diagnostic page is authored
  - Pattern:  `src/app/env.ts:5-24,159-199` - immutable config and fail-closed validation pattern; do not modify or couple to it
  - Pattern:  `src/app/runtime/factory.ts:5-15` - runtime seam that remains untouched
  - Pattern:  `vite.config.ts:11-17` - Node test environment and test discovery under `scripts/**/*.test.mjs`
  - Test:     `src/app/runtime/factory.test.ts:1-29` - narrow dependency-injection test pattern
  - External: `https://developers.google.com/identity/gsi/web/guides/integrate` - official GIS browser integration
  - External: `https://developers.google.com/workspace/calendar/api/guides/quota` - quota model
  - External: `https://developers.google.com/workspace/calendar/api/guides/errors` - retryable errors and exponential backoff

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/lib/server.test.mjs scripts/google-spike/lib/google-fetch.test.mjs` first fails on absent behavior, then passes once.
  - [ ] `node scripts/google-spike/serve.mjs --host 127.0.0.1 --port 5184` listens only on `127.0.0.1:5184`, writes its PID to the ignored exact file, and refuses a second server with `PORT_ALREADY_OWNED`.
  - [ ] A static import scan proves no file under `src/` or Vite production entry imports `scripts/google-spike`.
  - [ ] The server accepts one safe fixture and rejects Authorization/Cookie headers, oversized body, and forbidden schema fields without logging payload values.
  - [ ] The browser page contains explicit user-gesture controls for connect, reconnect, revoke, run selected probe, export redacted evidence, and teardown; it has no local/session storage or IndexedDB access.
  - [ ] Retry tests prove max attempts, jitter bounds, abort propagation, and non-retry of ordinary `403` authorization failures.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: isolated harness serves and accepts only redacted evidence
    Tool:     playwright(real Chrome)
    Steps:    Start the tracked server on 127.0.0.1:5184; open `http://localhost:5184`; inspect network requests and storage; submit the built-in safe self-test without signing into Google.
    Expected: page loads, no production app module is requested, local/session/IndexedDB remain empty, `/evidence` receives a schema-valid token-free payload, and no console error occurs.
    Evidence: <attemptDir>/task-3-harness.png

  Scenario: server receives forbidden auth material
    Tool:     curl
    Steps:    POST the adversarial fixture to `http://127.0.0.1:5184/evidence` once with an `Authorization: Bearer REDACT-ME` header and once with a Cookie header; then inspect redacted server logs.
    Expected: both requests return 400 with category `FORBIDDEN_REQUEST_MATERIAL`; the token/cookie value is absent from response, log, and filesystem.
    Evidence: <attemptDir>/task-3-harness-error.txt
  ```

  Commit: YES | Message: `feat(spike): add isolated Google probe harness` | Files: [`scripts/google-spike/serve.mjs`, `scripts/google-spike/browser/index.html`, `scripts/google-spike/browser/app.mjs`, `scripts/google-spike/lib/server.mjs`, `scripts/google-spike/lib/server.test.mjs`, `scripts/google-spike/lib/google-fetch.mjs`, `scripts/google-spike/lib/google-fetch.test.mjs`, `scripts/google-spike/config.example.json`]

- [ ] 4. Define and satisfy the operator-only Google provisioning gate

  What to do: Write an exact provisioning checklist and a validator for an ignored local receipt plus a committed redacted receipt. An authorized human operator must create/select a Google Cloud project, configure an Internal OAuth consent app and browser client, enable Calendar/Drive/People APIs, add only approved origins, designate two Workspace room resources, verify domain read ACL and auto-accept/decline settings, grant the admin test account room-writer access, identify the Workspace edition, and populate `.env.google-spike.local`. The browser client secret must not be downloaded or used. The initial scopes are Calendar events/read-only and Drive appdata; People directory scope is requested incrementally in Task 11. The agent validates the redacted receipt and performs read-only capability preflights after the operator authenticates.
  Must NOT do: Do not ask for or store passwords/MFA codes, OAuth client secret, refresh token, service-account key, domain-wide delegation, or admin SDK credentials. Do not fabricate completion from a checklist. Do not proceed if either role/room/origin is missing.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [5-11] | Blocked by: [1, 2]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `README.md:108-124` - legacy spike and administrator prerequisites
  - Pattern:  `docs/superpowers/specs/2026-07-26-molroom-design.md:421-429` - room/ACL/auto-accept/Internal OAuth/writer setup
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:112-129` - GIS, origins, in-memory token, scopes, and no DWD
  - Pattern:  `.gitignore:4-13` - ignored local receipt/env contract
  - External: `https://developers.google.com/identity/protocols/oauth2/production-readiness/overview` - OAuth production readiness
  - External: `https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification` - scope verification requirements
  - External: `https://developers.google.com/workspace/calendar/api/concepts/domain` - room resource email attendee and admin-created resources
  - External: `https://developers.google.com/people/v1/directory` - Workspace directory scope/capability

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/lib/provisioning.test.mjs` fails before the receipt validator and passes after it.
  - [ ] `node scripts/google-spike/validate-provisioning.mjs .env.google-spike.local provisioning-receipt.local` exits `0` only when app type is Internal, domain is `molcube.com`, required APIs/scopes/origins exist, exactly two room aliases exist, ordinary/admin aliases differ, ordinary is not a writer, admin is a writer, and auto-accept has an observed setting.
  - [ ] `docs/spikes/google-workspace/evidence/provisioning.json` contains only booleans/enums/aliases/client-ID suffix and a Workspace edition category; the evidence validator passes it.
  - [ ] `git check-ignore -v .env.google-spike.local provisioning-receipt.local` proves both local files are ignored.
  - [ ] `node scripts/google-spike/scan-sensitive-paths.mjs --redact docs/spikes/google-workspace/provisioning.md docs/spikes/google-workspace/evidence/provisioning.json scripts/google-spike/lib/provisioning.mjs scripts/google-spike/lib/provisioning.test.mjs scripts/google-spike/validate-provisioning.mjs` exits `0`; it does not scan unrelated tracked fixtures/docs and never prints a matched value.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: complete operator receipt
    Tool:     chrome:control-chrome
    Steps:    In the operator's already-authenticated Google Cloud/Admin Console profile, inspect the selected project, Internal consent type, enabled APIs, literal authorized origins, two room resources, ACL/writer roles, auto-accept policy, and Workspace edition; never reveal credentials. Run the local receipt validator and the redacted evidence validator afterward.
    Expected: every required capability is represented by an observed enum/boolean; validator exits 0; no screenshot or console output contains account or room email.
    Evidence: <attemptDir>/task-4-provisioning.txt

  Scenario: missing or tenant-blocked prerequisite
    Tool:     bash
    Steps:    Validate a fixture with one missing room, wrong app type, absent origin, ordinary writer privilege, or tenant scope block.
    Expected: validator exits nonzero with one of `PROVISIONING_INCOMPLETE` or `TENANT_POLICY_BLOCKED`; live probes do not start.
    Evidence: <attemptDir>/task-4-provisioning-error.txt
  ```

  Commit: YES | Message: `docs(spike): define Google provisioning gate` | Files: [`docs/spikes/google-workspace/provisioning.md`, `docs/spikes/google-workspace/evidence/provisioning.json`, `scripts/google-spike/lib/provisioning.mjs`, `scripts/google-spike/lib/provisioning.test.mjs`, `scripts/google-spike/validate-provisioning.mjs`]

- [ ] 5. Define the ordinary-user/admin account and fixture matrix

  What to do: Encode a matrix with two distinct Internal Workspace users (`ordinary`, `room-writer-admin`), two room aliases (`room-a`, `room-b`), separate browser profiles, owner/non-owner events, and expected permission classes. The matrix must cover ordinary room reads, own-event mutations, denied room-copy write, admin room-copy write attempt, same-account cross-browser Drive readback, People search, and two-browser conflict. Actual emails and calendar IDs stay only in ignored local config; committed files use aliases. Add a validator that prevents role collapse, fixture reuse across concurrent probes, or use of a personal/non-test meeting.
  Must NOT do: Do not encode `isAdmin` as a security boundary, reuse a human production meeting, grant the ordinary account writer access, or put account identifiers in evidence.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [6-11] | Blocked by: [1, 2, 4]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:166-172` - Google permissions, not UI state, are the security boundary
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:202-222` - full ordinary/admin acceptance matrix
  - API/Type: `src/data/BookingRepository.ts:13-107` - repository surfaces whose capabilities are being empirically mapped, not implemented
  - API/Type: `src/auth/types.ts:10-28` - current auth seam and user shape; Wave 1 does not modify it
  - Test:     `src/data/mockAdapter.test.ts:1` - focused repository test conventions only; do not reuse its fake outcomes as evidence

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/lib/account-matrix.test.mjs` fails before validation and then passes.
  - [ ] `node scripts/google-spike/validate-account-matrix.mjs docs/spikes/google-workspace/account-matrix.json .env.google-spike.local` exits `0` only for two distinct accounts, two distinct rooms, non-overlapping mutable fixture IDs, and complete matrix rows.
  - [ ] The committed matrix contains aliases/capability expectations only; `node scripts/google-spike/validate-evidence.mjs docs/spikes/google-workspace/account-matrix.json --kind account-matrix` passes.
  - [ ] A negative fixture that makes ordinary and admin the same user, grants ordinary writer, or reuses an event across probes is rejected.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: least-privilege role matrix
    Tool:     bash
    Steps:    Run the focused matrix test and validator against the committed alias matrix plus ignored local bindings.
    Expected: two distinct roles and two rooms resolve; every Wave 1 row has an owner, actor, resource alias, cleanup owner, and expected capability class.
    Evidence: <attemptDir>/task-5-account-matrix.txt

  Scenario: collapsed roles or reused fixture
    Tool:     bash
    Steps:    Run the validator against committed negative fixtures for same-account roles, ordinary writer, and shared mutable event.
    Expected: each fails with `INVALID_ACCOUNT_MATRIX` and a non-sensitive JSON pointer.
    Evidence: <attemptDir>/task-5-account-matrix-error.txt
  ```

  Commit: YES | Message: `test(spike): define Google account capability matrix` | Files: [`docs/spikes/google-workspace/account-matrix.json`, `scripts/google-spike/lib/account-matrix.mjs`, `scripts/google-spike/lib/account-matrix.test.mjs`, `scripts/google-spike/validate-account-matrix.mjs`, `scripts/google-spike/fixtures/account-matrix-invalid-same-user.json`, `scripts/google-spike/fixtures/account-matrix-invalid-writer.json`, `scripts/google-spike/fixtures/account-matrix-invalid-shared-fixture.json`]

- [ ] 6. Capture GIS desktop/mobile/Safari lifecycle evidence

  What to do: Implement the browser-only GIS probe using `initTokenClient`. Test explicit user-gesture connect/reconnect, consent denial, popup cancellation/block, wrong-domain/tenant policy rejection, account switching, token revocation, and expiry. The token remains in a closure and every Google fetch is blocked when the local expiry budget is exhausted. Keep one real session alive through returned `expires_in + 60s` to observe the expired state, then require a fresh user gesture to reconnect. Run desktop Chrome and Safari. Run real iOS Safari and Android Chrome only when the operator provides a reachable authorized origin/device; otherwise record `blocked-environment`, never emulated success. User credential/MFA entry is an unavoidable operator action; all post-auth assertions are agent-executed.
  Must NOT do: Do not request an auth code, refresh token, offline access, silent iframe refresh, One Tap assumption, token persistence, or automatic popup. Do not mislabel a missing mobile cell as tested: Task 6 may complete with explicit `blocked-environment` evidence so independent API lanes can continue, but Task 14 must return `INCONCLUSIVE` and Wave 2 production runtime work cannot begin.

  Parallelization: Can parallel: NO | Wave 2 | Blocks: [7, 8, 9, 10, 11, 14] | Blocked by: [3, 4, 5]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:110-129` - `initTokenClient`, memory-only token, reconnect, and browser matrix
  - Pattern:  `src/auth/types.ts:17-28` - current terminal auth variants; observe only, do not modify
  - External: `https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model` - implicit token vs authorization-code model
  - External: `https://developers.google.com/identity/oauth2/web/guides/how-user-authz-works` - GIS token lifecycle and user gesture
  - External: `https://developers.google.com/identity/protocols/oauth2` - OAuth overview and revocation
  - External: `https://developers.google.com/identity/gsi/web/guides/fedcm-migration` - FedCM browser behavior
  - External: `https://developers.google.com/identity/gsi/web/guides/personalized-button` - browser/privacy limitations for personalized/automatic UI

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/probes/gis-lifecycle.test.mjs` proves the local state machine blocks token use after expiry, clears state on switch/revoke, and requires a gesture for reconnect.
  - [ ] Evidence exists for desktop Chrome and desktop Safari for success, denial/cancel, revoke, account switch, expiry, and explicit reconnect.
  - [ ] Mobile cells are backed by actual iOS Safari/Android Chrome evidence or explicitly `blocked-environment`; Playwright emulation evidence cannot satisfy them. A `blocked-environment` cell is a valid Task 6 terminal observation but forces Task 14 to `INCONCLUSIVE`.
  - [ ] Browser storage inspection before/after every cell shows no token/session artifact; local server request inspection shows no authorization material.
  - [ ] `node scripts/google-spike/validate-evidence.mjs docs/spikes/google-workspace/evidence/gis-lifecycle.json` exits `0` and evidence contains no raw account identity.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: user-gesture connect, expiry, and reconnect
    Tool:     chrome:control-chrome
    Steps:    Open `http://localhost:5184` in isolated ordinary profile; click Connect; operator completes Google credential/MFA if prompted; run a read-only Calendar preflight; record returned lifetime without token; keep the real session until expires_in+60s; attempt another preflight; click Reconnect and repeat. Repeat desktop Safari with computer-use, then actual iOS Safari/Android Chrome on the operator-provided authorized origin/device.
    Expected: first request succeeds or is tenant-classified; expired request is blocked before fetch; no silent renewal occurs; only explicit reconnect restores request capability; each browser cell is evidenced or explicitly blocked.
    Evidence: <attemptDir>/task-6-gis-lifecycle.json

  Scenario: deny, popup block, revoke, and account switch
    Tool:     computer-use
    Steps:    In isolated profiles, deny a newly requested scope, block/cancel popup, revoke an obtained token through GIS, then connect the other role account; inspect storage/network after each transition.
    Expected: harness never reports signed-in without a usable token; stale identity/token state is cleared; denied/blocked results are typed and token-free; storage remains empty.
    Evidence: <attemptDir>/task-6-gis-lifecycle-error.json
  ```

  Commit: YES | Message: `test(spike): record GIS lifecycle evidence` | Files: [`scripts/google-spike/probes/gis-lifecycle.mjs`, `scripts/google-spike/probes/gis-lifecycle.test.mjs`, `docs/spikes/google-workspace/evidence/gis-lifecycle.json`]

- [ ] 7. Capture Calendar room copy, shared property, visibility, Meet, and auto-decline evidence

  What to do: With the ordinary account, create disposable organizer events that invite `room-a` as a resource attendee, include a unique private operation ID and shared `molroomSeriesId`, and optionally request Meet with `conferenceDataVersion=1`. Poll attendee response exactly at the spec's 0-5s/500ms then 5-20s/1s cadence. Read the organizer event and room copy, recording hashed IDs, `iCalUID` relationship, shared-property equality, visibility/organizer field presence, conference status, and propagation time. Create a blocker then an overlapping invite to observe auto-decline and rollback. Capture Workspace edition and policy-dependent results as observed categories.
  Must NOT do: Do not assume room copy IDs equal organizer IDs, expose titles/organizers in evidence, force `accepted`, or leave declined/timeout fixtures behind. Do not use a real employee meeting.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [12, 13, 14] | Blocked by: [3, 4, 5, 6]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/specs/2026-07-26-molroom-design.md:404-419` - original unresolved spike items 1-4 and 7
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:131-149` - insert/poll/rollback contract
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:174-200` - organizer/room-copy locator and shared series rules
  - API/Type: `src/domain/types.ts:29-65` - current screen-facing Booking shape; evidence must not mutate it
  - External: `https://developers.google.com/workspace/calendar/api/concepts/domain` - resource attendee booking
  - External: `https://developers.google.com/workspace/calendar/api/v3/reference/events` - event fields, `id`, `iCalUID`, `recurringEventId`, shared properties, conference data
  - External: `https://developers.google.com/workspace/calendar/api/guides/create-events` - attendee and conference creation
  - External: `https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events` - organizer/attendee copies and propagation
  - External: `https://developers.google.com/workspace/calendar/api/guides/extended-properties` - shared property behavior/limits
  - External: `https://developers.google.com/workspace/calendar/api/v3/reference/events/insert` - `conferenceDataVersion=1`

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/probes/calendar-capabilities.test.mjs` proves request shape, polling schedule, classification, rollback requirement, and redaction without asserting a preferred tenant outcome.
  - [ ] Live evidence contains organizer and room-copy readback for one accepted/declined/timeout-classified event and the overlap case, with cleanup state.
  - [ ] Shared property, visibility, organizer-field exposure, Meet result, auto-accept/decline, propagation duration, and Workspace edition each have one observed enum; none is inferred.
  - [ ] Any `declined`, timeout, or inconclusive insert is rolled back and GET-verified as `404/410`, or evidence records `unknown-outcome` and blocks architecture approval.
  - [ ] Evidence validator passes `calendar-capabilities.json` and raw PII/IDs are absent.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: accepted room copy and shared-property readback
    Tool:     chrome:control-chrome
    Steps:    Connect ordinary account; run `calendar-capabilities` against room-a with a disposable title kept only in memory, shared series UUID, private operation UUID, private/default visibility variants, and Meet createRequest; poll and read both calendar copies.
    Expected: harness records the actual response category, hashed organizer/room locators, iCalUID relation, shared-property equality, field-visibility flags, Meet status, and propagation duration; no preferred value is fabricated.
    Evidence: <attemptDir>/task-7-calendar-capabilities.json

  Scenario: overlap auto-decline or timeout
    Tool:     chrome:control-chrome
    Steps:    Create one disposable accepted blocker, then an overlapping room invitation; poll for 20 seconds using the required cadence and execute rollback/GET verification for non-accepted result.
    Expected: observed accepted/declined/needsAction/timeout category is recorded; any non-accepted second event is absent after cleanup, or `unknown-outcome` blocks the architecture gate.
    Evidence: <attemptDir>/task-7-calendar-capabilities-error.json
  ```

  Commit: YES | Message: `test(spike): record Calendar room capability evidence` | Files: [`scripts/google-spike/probes/calendar-capabilities.mjs`, `scripts/google-spike/probes/calendar-capabilities.test.mjs`, `docs/spikes/google-workspace/evidence/calendar-capabilities.json`]

- [ ] 8. Capture Calendar CRUD, conflict, and room-writer admin-cancel evidence

  What to do: Run separate disposable fixtures for ordinary own-event create/read/update/shorten/extend/reschedule/cancel, non-owner denial, same/cross-room changes, simultaneous two-browser booking, and admin room-copy cancellation. Re-read immediately before every mutation. For the race, issue both inserts from isolated profiles and observe final room attendee status; record whether exactly one becomes accepted. For admin cancel, identify the room copy by room calendar plus hashed room event locator and observe organizer-copy consequences. Classify tenant-specific `403/404/409/412/429` results rather than normalizing them to success.
  Must NOT do: Do not infer authority from app roles, delete a guessed organizer event, reuse Task 7 fixtures, or hide partial/ambiguous cleanup.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [12, 13, 14] | Blocked by: [3, 4, 5, 6]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:166-172` - Google authorization boundary and verified room-writer requirement
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:202-222` - CRUD/admin/concurrency acceptance rows
  - API/Type: `src/data/BookingRepository.ts:13-107` - current mutation surfaces being mapped
  - API/Type: `src/data/BookingRepository.ts:109-139` - current result unions reserved for Wave 2 migration
  - Test:     `src/data/mockAdapter.test.ts:1` - behavior-focused test style; mock results are not Google evidence
  - External: `https://developers.google.com/workspace/calendar/api/concepts/events-calendars` - event/calendar ownership concepts
  - External: `https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events` - attendee copy semantics
  - External: `https://developers.google.com/workspace/calendar/api/guides/errors` - Calendar error classification

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/probes/calendar-crud.test.mjs` proves fixture ownership checks, pre-mutation reread, exclusive outcome classification, and no guessed deletion.
  - [ ] Ordinary account evidence covers own CRUD and denied non-owner/room-copy write; admin evidence covers the configured room-copy writer path.
  - [ ] Two-browser evidence records both operation IDs and final accepted counts; `acceptedCount !== 1` is a real blocker, not a test harness failure.
  - [ ] Same-room and cross-room reschedule capture original/destination room statuses and restoration/cleanup result.
  - [ ] All owned CRUD/race/admin fixtures are absent or recorded as `unknown-outcome` before Task 8 commit.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: own CRUD and two-browser conflict
    Tool:     chrome:control-chrome
    Steps:    In two isolated profiles, execute disposable own-event create/read/update/extend/shorten/same-room/cross-room/cancel flows; then synchronize two distinct operation IDs to insert the same room/time and poll both attendee responses.
    Expected: every mutation has a pre-read and terminal category; conflict evidence reports the actual final accepted count, with exactly one required for static conflict safety.
    Evidence: <attemptDir>/task-8-calendar-crud.json

  Scenario: non-admin denial and admin room-copy cancel
    Tool:     chrome:control-chrome
    Steps:    Ordinary profile attempts a room-copy cancellation for another account's fixture; admin room-writer profile attempts the same using configured roomCalendarId + located roomEventId; re-read room and organizer copies.
    Expected: ordinary path is denied; admin path is recorded as supported/unsupported/blocked with observed copy consequences; no organizer event is guessed or silently deleted.
    Evidence: <attemptDir>/task-8-calendar-crud-error.json
  ```

  Commit: YES | Message: `test(spike): record Calendar mutation evidence` | Files: [`scripts/google-spike/probes/calendar-crud.mjs`, `scripts/google-spike/probes/calendar-crud.test.mjs`, `docs/spikes/google-workspace/evidence/calendar-crud.json`]

- [ ] 9. Capture independent-event recurrence and shared locator evidence

  What to do: Create three independent organizer events, each with its own private operation ID and the same shared `molroomSeriesId`; do not set `recurrence`. Read organizer and room copies, query each calendar by `sharedExtendedProperty`, compare hashed event IDs and `iCalUID`, and record `recurringEventId`/`originalStartTime` presence. Delete one instance and prove the other two remain. Execute ordinary series lookup/delete and admin room-calendar series lookup/cancel as separate disposable series, deduplicating by observed `iCalUID`. Record 0/1/multiple locator counts and never guess when ambiguous.
  Must NOT do: Do not create an RRULE master, assume shared property propagation, use `seriesId` as authorization, modify/remove `toRRule()`, or collapse partial deletion into success.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [12, 13, 14] | Blocked by: [3, 4, 5, 6]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:174-200` - canonical organizer/room-copy locator and independent recurrence contract
  - Pattern:  `src/domain/recurrence.ts:11-25,60-137` - current pure recurrence expansion and 26-occurrence cap; leave unchanged
  - Test:     `src/domain/recurrence.test.ts:137-169` - current RRULE parity tests that remain until Wave 2 consumer audit
  - API/Type: `src/domain/types.ts:29-43` - current `recurringEventId` screen model
  - External: `https://developers.google.com/workspace/calendar/api/guides/recurringevents` - Google RRULE master/instance semantics used only for contrast
  - External: `https://developers.google.com/workspace/calendar/api/v3/reference/events` - `id`, `iCalUID`, `recurringEventId`, and `originalStartTime`
  - External: `https://developers.google.com/workspace/calendar/api/guides/extended-properties` - shared-property query behavior and limits

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/probes/calendar-series.test.mjs` proves three independent insert shapes, distinct operation IDs, identical shared series ID, no `recurrence`, ambiguity refusal, and partial-result preservation.
  - [ ] Organizer and room-copy readback evidence records shared-series equality, hashed IDs, iCalUID relationship, and recurring-field presence for every occurrence.
  - [ ] Instance deletion leaves the other occurrences observable, and series lookup returns the actual expected count on both relevant calendars.
  - [ ] Ordinary and admin series-cancel probes return per-occurrence results and cleanup verification; any missing/multiple locator is `event-locator-ambiguous`.
  - [ ] If shared series ID does not read back identically on organizer and room copies, evidence sets `architectureTrigger=shared-series-copy-mismatch` and Task 14 cannot approve admin series cancellation.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: independent series readback and one-instance cancel
    Tool:     chrome:control-chrome
    Steps:    Ordinary profile creates three independent events with one shared series UUID and three private operation UUIDs; query organizer and room calendars by shared property; delete the middle organizer instance; reread all locators.
    Expected: no event has an RRULE/recurringEventId unless Google unexpectedly adds it; shared readback and ID/iCalUID relations are empirically recorded; first/third remain after middle deletion.
    Evidence: <attemptDir>/task-9-calendar-series.json

  Scenario: ambiguous or partial series cancellation
    Tool:     chrome:control-chrome
    Steps:    Run ordinary series cancellation on one disposable series and admin room-calendar cancellation on another; before each delete validate calendar alias, shared property, time, organizer alias, and locator cardinality.
    Expected: 0/multiple locators stop without guessed mutation; per-occurrence success/already-gone/failure remains visible; shared-copy mismatch raises the architecture trigger.
    Evidence: <attemptDir>/task-9-calendar-series-error.json
  ```

  Commit: YES | Message: `test(spike): record Calendar series locator evidence` | Files: [`scripts/google-spike/probes/calendar-series.mjs`, `scripts/google-spike/probes/calendar-series.test.mjs`, `docs/spikes/google-workspace/evidence/calendar-series.json`]

- [ ] 10. Capture Drive appDataFolder capability evidence

  What to do: Request `drive.appdata`, list `spaces=appDataFolder`, create a uniquely named disposable preferences file, read it, update it, read it from a second browser profile using the same account, prove the other test account cannot see the first account's file, then delete and verify absence. Keep the file body in browser memory and commit only byte count, content hash, version/change categories, and file-ID hash.
  Must NOT do: Do not use broad Drive scope, normal My Drive, localStorage fallback, production preference types, raw file ID/content, or another employee's account.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [12, 13, 14] | Blocked by: [3, 4, 5, 6]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/specs/2026-07-26-molroom-design.md:414` - unresolved appDataFolder spike
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:123-129,219` - minimal scope and cross-device preference acceptance
  - API/Type: `src/domain/types.ts:114-117` - current preference model; leave production type unchanged
  - External: `https://developers.google.com/workspace/drive/api/guides/appdata` - hidden per-user appDataFolder operations
  - External: `https://developers.google.com/workspace/drive/api/guides/api-specific-auth` - narrow `drive.appdata` scope

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/probes/drive-appdata.test.mjs` proves `spaces=appDataFolder`, narrow scope, content-hash evidence, and cleanup requirements.
  - [ ] Live ordinary-account evidence covers list/create/read/update/second-profile read/delete.
  - [ ] Cross-account evidence records only visibility count/category and never the other account's file metadata.
  - [ ] Delete verification finds zero matching owned files; otherwise teardown remains open.
  - [ ] Evidence validator passes `drive-appdata.json` with no file body, raw ID, email, or token.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: same-account cross-browser preference round trip
    Tool:     chrome:control-chrome
    Steps:    Ordinary profile creates and updates one appDataFolder JSON fixture; a second isolated profile authenticates the same test account and reads the fixture; compare in-memory content hashes; delete it and list again.
    Expected: observed create/read/update/readback/delete categories and equal hashes are recorded; final owned-file count is zero.
    Evidence: <attemptDir>/task-10-drive-appdata.json

  Scenario: account isolation or scope denial
    Tool:     chrome:control-chrome
    Steps:    Authenticate the other role account with only `drive.appdata`; list its appDataFolder for the first account's unique hash alias, or capture tenant/scope denial.
    Expected: other account cannot observe the first account fixture; scope/tenant denial is classified without falling back to broader Drive scope.
    Evidence: <attemptDir>/task-10-drive-appdata-error.json
  ```

  Commit: YES | Message: `test(spike): record Drive appDataFolder evidence` | Files: [`scripts/google-spike/probes/drive-appdata.mjs`, `scripts/google-spike/probes/drive-appdata.test.mjs`, `docs/spikes/google-workspace/evidence/drive-appdata.json`]

- [ ] 11. Capture ordinary-member People directory capability evidence

  What to do: Incrementally request `https://www.googleapis.com/auth/directory.readonly` only for this probe. From the ordinary account, call `people.searchDirectoryPeople` with `querySources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE`, a bounded page size, and a minimal read mask needed to decide whether name/email/organization department fields exist. Record status, result count, pagination presence, and field-presence booleans only. Repeat with admin account for comparison. If tenant sharing or approval blocks the ordinary user, classify the result; do not switch to Admin SDK.
  Must NOT do: Do not persist returned people, names, emails, photos, organizations, search text, or next-page token. Do not add Admin SDK, service account, DWD, or broaden scopes silently.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [12, 13, 14] | Blocked by: [3, 4, 5, 6]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `src/data/BookingRepository.ts:93-107` - intended People search surface and empty/error behavior target for later Wave 2
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:129,220` - ordinary-account capability decision and direct-email fallback
  - External: `https://developers.google.com/people/v1/directory` - Workspace directory access model
  - External: `https://developers.google.com/people/api/rest/v1/people/searchDirectoryPeople` - exact method, query source, read mask, and scope
  - External: `https://developers.google.com/people` - People API overview
  - External: `https://developers.google.com/workspace/admin/directory/reference/rest` - admin-oriented alternative explicitly excluded from Wave 1/runtime

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/probes/people-directory.test.mjs` proves bounded query shape, minimal read mask, incremental scope, in-memory discard, and count/field-only evidence.
  - [ ] Ordinary and admin live results are each classified `supported`, `empty`, `tenant-policy-blocked`, `scope-denied`, or `inconclusive`.
  - [ ] No returned person object, query value, nextPageToken, email, name, photo URL, or organization text reaches disk/log/evidence.
  - [ ] If ordinary access is unavailable, evidence sets `architectureTrigger=directory-direct-input-only`; it does not install or call Admin SDK.
  - [ ] Evidence validator passes `people-directory.json`.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: ordinary member directory capability
    Tool:     chrome:control-chrome
    Steps:    In ordinary profile, explicitly grant directory.readonly; run one bounded domain-profile search using an in-memory test query supplied by the operator; immediately reduce response to status/count/field-presence and discard raw objects.
    Expected: actual capability category is recorded with no raw person/query data; supported and empty are distinct.
    Evidence: <attemptDir>/task-11-people-directory.json

  Scenario: denial or tenant sharing restriction
    Tool:     chrome:control-chrome
    Steps:    Deny the incremental scope or run under the tenant restriction, then repeat with admin profile for comparison.
    Expected: denial/block is typed and does not trigger Admin SDK or broader scope; direct-email-only architecture trigger is recorded when ordinary capability is absent.
    Evidence: <attemptDir>/task-11-people-directory-error.json
  ```

  Commit: YES | Message: `test(spike): record People directory evidence` | Files: [`scripts/google-spike/probes/people-directory.mjs`, `scripts/google-spike/probes/people-directory.test.mjs`, `docs/spikes/google-workspace/evidence/people-directory.json`]

- [ ] 12. Teardown owned Google state and prove no secret or process leaks

  What to do: Use the in-memory/ignored local ownership ledger and private operation IDs to delete every owned organizer event, residual room copy that the verified admin path can safely delete, and appDataFolder fixture. Verify event/file absence with GET/list/shared-property queries; revoke both role tokens through GIS; close all isolated profiles; TERM/KILL only owned server/browser processes; prove port/count return to baseline. Scan tracked files, staged paths, process command lines, logs, browser storage, and evidence for forbidden material. Remove exact ignored local state/PID/log files after their hashes and cleanup status are recorded; list removed paths and recovery status.
  Must NOT do: Do not delete an event without matching operation/series/fixture ownership, broad-kill processes, leave tokens active, retain screenshots/raw responses, or mark unknown cleanup as success.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [13, 14] | Blocked by: [6, 7, 8, 9, 10, 11]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/plans/2026-08-21-molroom-wave0-runtime-foundation.md:15-18` - exact-path work, host/process preflight, and owned-process cleanup baseline
  - Pattern:  `docs/superpowers/plans/2026-08-21-molroom-wave0-repository-hygiene.md:363-381` - session-final artifact ownership gate and recoverable cleanup pattern
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:139-164` - reconciliation, rollback verification, and unknown outcome
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:427-433` - no-secret/no-PII diagnostics
  - Pattern:  `.gitignore:4-18` - local state exclusions
  - External: `https://developers.google.com/identity/protocols/oauth2` - token revocation behavior

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/teardown.test.mjs` proves ownership-match requirements, idempotent already-gone handling, and unknown-outcome refusal.
  - [ ] Every owned operation/series/file alias has terminal teardown evidence: `deleted-and-verified`, `already-gone`, or blocking `unknown-outcome`.
  - [ ] GIS revoke callback completes for both role tokens; subsequent protected preflight cannot run without explicit reconnect.
  - [ ] Port `5184` is closed; owned PIDs are absent; Node/browser/MCP signature counts return to baseline or every unrelated delta is documented without termination.
  - [ ] `git diff --cached --name-only` contains only the exact Task 12 paths; repository/evidence forbidden-pattern scanner exits `0` without printing secret candidates.
  - [ ] Exact ignored local state, PID, and raw-log files are removed only after the final ownership verification, and the report names what was removed and whether it is recoverable.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: idempotent owned-state teardown
    Tool:     chrome:control-chrome
    Steps:    Run teardown for every ledger alias; query Calendar by private operation/shared series property and Drive appDataFolder by owned hash; rerun teardown once; revoke both role tokens; close profiles and tracked server.
    Expected: first pass deletes or reports already-gone; second pass is idempotent; zero owned aliases remain; revoked sessions require explicit reconnect.
    Evidence: <attemptDir>/task-12-teardown.json

  Scenario: ambiguous owner or failed delete
    Tool:     bash
    Steps:    Run focused teardown test with missing ownership proof, duplicate locator, and simulated delete/verification failure; compare process/port signatures after cleanup.
    Expected: no deletion occurs for ambiguous ownership; failure is `unknown-outcome`; architecture gate remains blocked; only owned PIDs are terminated.
    Evidence: <attemptDir>/task-12-teardown-error.txt
  ```

  Commit: YES | Message: `test(spike): prove Google fixture teardown` | Files: [`scripts/google-spike/teardown.mjs`, `scripts/google-spike/teardown.test.mjs`, `docs/spikes/google-workspace/evidence/teardown.json`]

- [ ] 13. Consolidate the reproducible spike evidence manifest

  What to do: Build a manifest from the committed redacted per-probe files only after teardown. Include schema version, candidate SHA, exact probe/harness commit SHAs, official-doc URLs, role/browser/device coverage, capability category, architecture trigger list, evidence file SHA-256, and teardown terminal status. Generate a human-readable report that says what was observed, unsupported, tenant-blocked, environment-blocked, or inconclusive without repeating PII. Validate from a fresh clone/clean checkout of the committed paths conceptually by using `git show HEAD:<path>` in a temporary directory rather than building the dirty working tree.
  Must NOT do: Do not rerun the full live mutation suite merely to obtain duplicate evidence, edit an earlier probe result, omit blocked cells, include raw console screenshots, or claim CI/build health from the dirty working tree.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [14] | Blocked by: [2, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:202-222` - matrix-to-evidence linkage
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:506-513` - reproducible Wave 1 report requirement
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:487-493` - clean-room reproducibility and evidence requirements
  - Test:     `scripts/google-spike/lib/evidence.test.mjs` - manifest/evidence validation contract produced by Task 2

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/lib/manifest.test.mjs` rejects missing probe, SHA mismatch, missing browser/role cell, open teardown, and unknown category before passing the complete manifest.
  - [ ] `node scripts/google-spike/validate-manifest.mjs docs/spikes/google-workspace/evidence/manifest.json` exits `0` and verifies every referenced file hash.
  - [ ] Before committing, a temporary staged-tree extraction using `git show :<path>` passes the same validator without relying on untracked local config or dirty product files; immediately after the exact-path commit, repeat against `git show HEAD:<path>` and require byte-identical validation.
  - [ ] Report counts exactly match manifest categories and explicitly lists all `blocked-*`, `unsupported`, `unknown-outcome`, and `inconclusive` rows.
  - [ ] `git diff --check -- scripts/google-spike docs/spikes/google-workspace` exits `0`; no full product build runs in Wave 1.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: complete manifest from committed redacted evidence
    Tool:     bash
    Steps:    After host preflight, run the focused manifest test, evidence validator on every JSON, manifest validator, SHA-256 comparison, and report-count comparison; stage only Task 13's literal files, extract each with `git show :<path>` into a temporary directory, and validate it. Make the exact-path Task 13 commit, then extract the same files with `git show HEAD:<path>` and validate again.
    Expected: staged-tree and post-commit HEAD validations are byte-identical; all references/hashes/categories/coverage cells agree and validation needs no local secret/config file.
    Evidence: <attemptDir>/task-13-manifest.txt

  Scenario: missing or altered evidence
    Tool:     bash
    Steps:    Validate negative fixtures with one omitted browser cell, changed evidence byte, unsupported category removed, and teardown left open.
    Expected: each fails closed with `MANIFEST_INCOMPLETE` or `EVIDENCE_HASH_MISMATCH`; no report is generated from invalid input.
    Evidence: <attemptDir>/task-13-manifest-error.txt
  ```

  Commit: YES | Message: `docs(spike): consolidate Google capability evidence` | Files: [`scripts/google-spike/lib/manifest.mjs`, `scripts/google-spike/lib/manifest.test.mjs`, `scripts/google-spike/validate-manifest.mjs`, `scripts/google-spike/fixtures/manifest-invalid-missing-probe.json`, `scripts/google-spike/fixtures/manifest-invalid-hash.json`, `scripts/google-spike/fixtures/manifest-invalid-browser-cell.json`, `scripts/google-spike/fixtures/manifest-invalid-open-teardown.json`, `docs/spikes/google-workspace/evidence/manifest.json`, `docs/spikes/google-workspace/report.md`]

- [ ] 14. Evaluate the static-SPA architecture decision trigger

  What to do: Evaluate the validated manifest against explicit invariants. `STATIC_SPA_SUPPORTED` requires: Internal token flow usable with explicit reconnect; no token persistence; required desktop and real mobile cells complete; room-copy shared property supports check-in/series needs; room acceptance/conflict behavior is safe; required own CRUD works; every owned mutation reconciles; appDataFolder supports required preferences; and teardown is closed. Meet, People, admin cancel, visibility detail, and Workspace edition may produce scoped feature reductions, but the report must state each reduction. Any shared-property failure, unsafe conflict outcome, unacceptable reconnect behavior, missing real-mobile evidence, or unknown cleanup becomes `DECISION_REQUIRED`/`INCONCLUSIVE`. If a decision is required, generate a local interactive HTML Decision Matrix under `<attemptDir>` with A/B/C choices, recommendation, impact, non-impact, evidence, and validation criteria; stop for explicit user selection and never auto-approve. The eventual selected architecture is Wave 2 input, not a Wave 1 implementation.
  Must NOT do: Do not add backend code, choose Firebase/Firestore/server storage, remove a feature, implement a Google adapter, or call a blocked/inconclusive matrix supported. Do not include the unrelated 15-minute UI policy.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [F1, F2, F3, F4] | Blocked by: [13]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `docs/superpowers/specs/2026-07-26-molroom-design.md:404-419` - high-risk shared-property and token-lifecycle triggers
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:91-106` - static SPA baseline and runtime composition reserved for later
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:174-200` - series-copy mismatch trigger
  - Pattern:  `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md:515-524` - Wave 2 adapter/contract work that cannot begin until this decision
  - External: `https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model` - backend-vs-browser authorization model tradeoff

  Acceptance criteria (agent-executable only):
  - [ ] RED then GREEN: `npm test -- scripts/google-spike/architecture-gate.test.mjs` covers supported, scoped-feature-reduction, shared-copy failure, conflict failure, missing mobile, unknown cleanup, and tenant-policy-blocked manifests.
  - [ ] `node scripts/google-spike/evaluate-architecture.mjs docs/spikes/google-workspace/evidence/manifest.json` emits exactly one terminal category and a complete trigger list.
  - [ ] `docs/spikes/google-workspace/architecture-result.md` cites evidence file hashes and distinguishes mandatory blockers from optional feature reductions.
  - [ ] When result is `DECISION_REQUIRED`, `<attemptDir>/task-14-architecture-decision.html` contains working radio/card controls, current selection, copy-result action, A/B/C choices grounded in actual evidence, and no preselected approval; the executor stops for explicit user choice.
  - [ ] When result is `INCONCLUSIVE`, the report names the exact missing empirical cell and does not propose implementation.
  - [ ] No file under `src/`, `package.json`, Vite config, workflow, AWS, or production README is changed by Task 14.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: architecture gate consumes a complete supported/scoped manifest
    Tool:     bash
    Steps:    Run focused gate tests, then evaluate the real validated manifest; compare terminal category, feature reductions, evidence hashes, and teardown status.
    Expected: exactly one terminal result is produced; every optional unsupported capability is a named reduction; no runtime code is generated.
    Evidence: <attemptDir>/task-14-architecture.txt

  Scenario: mandatory blocker or missing mobile evidence
    Tool:     browser:control-in-app-browser
    Steps:    Evaluate negative manifests for shared-copy mismatch, acceptedCount != 1, unknown cleanup, and missing real-mobile cell; open the generated local decision HTML and exercise selection/copy controls without selecting on the user's behalf.
    Expected: result is `DECISION_REQUIRED` or `INCONCLUSIVE`; interactive A/B/C artifact accurately reflects the actual blocker and awaits explicit user selection.
    Evidence: <attemptDir>/task-14-architecture-decision.html
  ```

  Commit: YES | Message: `docs(spike): record Google architecture gate` | Files: [`scripts/google-spike/evaluate-architecture.mjs`, `scripts/google-spike/architecture-gate.test.mjs`, `docs/spikes/google-workspace/architecture-result.md`]

## Final verification wave (MANDATORY - after all implementation tasks)
> Runs in PARALLEL. ALL must APPROVE. Surface results to the caller and wait for an explicit "okay" before declaring complete.
- [ ] F1. Plan compliance audit - verify every task/evidence file/commit against this plan; confirm Wave 1 did not edit `src/`, production config, dependencies, deployment, or the 15-minute policy.
- [ ] F2. Code quality review - inspect deterministic harness code for fail-closed validation, no silent catch/fallback/dead code, bounded requests, exact cleanup ownership, and clean diagnostics.
- [ ] F3. Real manual QA - independently replay every live QA scenario from the redacted manifest with the required ordinary/admin/browser/device cells and evidence; tenant outcomes may differ only if a fresh run is separately recorded and reconciled.
- [ ] F4. Scope fidelity - prove no production adapter/backend/deployment or external non-Google mutation shipped, no secrets/PII are tracked, all fixtures/tokens/processes are cleaned, and every unsupported/inconclusive result remains visible.
- [ ] After each reviewer returns, query agent status, interrupt any still-running/idle child, and compare PID/signature counts to the pre-review baseline. If a command signature rises by 54 or owned processes cannot be reclaimed, stop new fan-out and report the leak.

## Commit strategy
- Commit this plan itself first with exact pathspec only; implementation tasks never amend the plan commit.
- One logical change per commit. Conventional Commits (`<type>(<scope>): <subject>` body + footer).
- Atomic: every commit builds its own local harness contract and passes its focused tests; empirical evidence commits additionally pass schema/no-secret validation.
- Before each commit, run `git diff --cached --name-only` and compare it to the task's literal file list; use `git commit -m "..." -- <explicit paths>` and immediately inspect `git show --stat HEAD`.
- Never use `git add -A`, `git commit -a`, stash, branch/worktree changes, or remote sync before the active task's exact-path commit is fixed locally.
- No "WIP" / "fix typo squash later" commits on the final branch - clean up before merge.
- Reference the plan file path in the final commit footer: `Plan: docs/superpowers/plans/2026-08-21-molroom-wave1-google-workspace-spike.md`.

## Success criteria
- All Must-Have capability cells are either empirically observed with redacted evidence or explicitly blocked/unsupported/inconclusive; no tenant/browser outcome is guessed.
- All deterministic focused tests pass once under the pinned one-worker toolchain, all evidence/manifest/no-secret validators pass, and all Google/local fixtures/tokens/processes are cleaned.
- The architecture gate emits one honest terminal result and any required A/B/C decision is presented to, and explicitly selected by, the user before Wave 2 begins.
- No `src/**`, production runtime, deployment, dependency, or 15-minute policy change is included.
- F1-F4 approve, process counts return to baseline, commit history is clean, and the caller explicitly says `okay`.
