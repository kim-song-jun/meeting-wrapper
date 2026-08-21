# MolRoom Wave 0 Repository Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy OMD metadata with active repository instructions, archive historical design documents without losing edits, ignore local evidence, and document safe future extraction boundaries for oversized files.

**Architecture:** Active guidance lives in root/scoped `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/design-system.mdc`, and authoritative `DESIGN.md`. Historical design sources move intact under `docs/archive/design/`; all live links are updated. Large-file cleanup is specified as characterization-first contracts only, leaving runtime extraction to Wave 2 after the Google spike.

**Tech Stack:** Git, Markdown, Cursor rule files, repository-local shell validation.

**Spec:** `docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md`

## Global Constraints

- Work only on `main`; never branch, create a worktree, stash, reset, clean, or restore another session's paths.
- Preserve every existing byte of the three modified `DESIGN_DEPRECATED*.md` files while moving them.
- Do not edit, stage, or commit `src/components/ui.tsx`, `src/screens/MyBookingsScreen.tsx`, `src/screens/RecurrenceResult.tsx`, `src/screens/RoomLandingScreen.tsx`, or `src/screens/RoomsScreen.tsx` in this plan.
- Stage and commit exact pathspecs only; verify every commit with `git show --name-only HEAD`.
- Historical specs may mention OMD as migration evidence. Active instructions/runtime configuration must not depend on `.omd` or `omd-design.mdc`.
- `.codex-artifacts/` is local-only. Add it to `.gitignore`; do not remove it until all current decision/visual evidence is finished and ownership checks show no other session is using it.
- File/config-only tasks use baseline acceptance probes in place of production-code TDD. Run the probes against committed HEAD first to prove the old state fails, then against the working tree after the change.

---

### Task 1: Replace Legacy OMD Instructions Safely

**Files:**
- Delete: `.omd/init-context.json`
- Delete: `.omd/sync.lock.json`
- Delete: `.cursor/rules/omd-design.mdc`
- Create: `.cursor/rules/design-system.mdc`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `.gitignore`
- Create: `src/data/AGENTS.md`
- Create: `src/domain/AGENTS.md`
- Create: `src/screens/AGENTS.md`

**Interfaces:**
- Consumes: authoritative `DESIGN.md`, project structure, and existing dirty replacement files.
- Produces: one active instruction chain with scoped domain guidance and no live OMD dependency.

- [ ] **Step 1: Capture exact working-tree ownership**

Record:

```bash
git status --short --untracked-files=all
git diff -- AGENTS.md CLAUDE.md .omd/init-context.json .omd/sync.lock.json .cursor/rules/omd-design.mdc
```

Confirm the five dirty product paths listed in Global Constraints remain unstaged and untouched.

- [ ] **Step 2: Prove the committed baseline still contains legacy OMD**

Create and extract the committed baseline with these exact commands:

```bash
molroom_hygiene_baseline="$(mktemp -d /tmp/molroom-hygiene-baseline.XXXXXX)"
git archive HEAD | tar -x -C "$molroom_hygiene_baseline"
(
  cd "$molroom_hygiene_baseline"
  test ! -e .omd
  test ! -e .cursor/rules/omd-design.mdc
  test -e .cursor/rules/design-system.mdc
)
molroom_hygiene_red_status=$?
test "$molroom_hygiene_red_status" -ne 0
rm -rf -- "$molroom_hygiene_baseline"
```

Expected: at least one assertion fails because committed HEAD still contains the legacy files and lacks the replacement rule. Remove only the exact temporary directory after recording the RED result.

- [ ] **Step 3: Finish the replacement files without broad rewrites**

Keep the already deleted legacy files deleted. Review the current dirty `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/design-system.mdc`, and scoped `AGENTS.md` files for these exact properties:

```text
DESIGN.md is the UI authority.
DESIGN_DEPRECATED files are historical evidence only.
BookingRepository is the sole screen/data contract.
Domain scheduling functions remain pure and adjacent-tested.
UI changes require live browser screenshots.
```

Remove duplicated/conflicting guidance within those owned files only. Add exactly this ignore entry to `.gitignore` if absent:

```gitignore
.codex-artifacts/
```

Do not add `.superpowers/` or documentation directories to `.gitignore`.

- [ ] **Step 4: Verify the replacement GREEN**

Run in the working tree:

```bash
test ! -e .omd
test ! -e .cursor/rules/omd-design.mdc
test -e .cursor/rules/design-system.mdc
test -e AGENTS.md
test -e CLAUDE.md
test -e src/data/AGENTS.md
test -e src/domain/AGENTS.md
test -e src/screens/AGENTS.md
git check-ignore -q .codex-artifacts/example.txt
```

Then fail if any active dependency reference remains:

```bash
if rg -n 'oh-my-design|omd-design|\.omd|omd:start|omd:end|preferences\.md' \
  AGENTS.md CLAUDE.md .cursor/rules src --glob '!**/*.test.*'; then
  exit 1
fi
```

Expected: no active dependency references. Historical migration wording in the committed production spec is outside this command and remains intact.

- [ ] **Step 5: Commit only the OMD replacement paths**

```bash
git add -- .omd/init-context.json .omd/sync.lock.json .cursor/rules/omd-design.mdc .cursor/rules/design-system.mdc AGENTS.md CLAUDE.md .gitignore src/data/AGENTS.md src/domain/AGENTS.md src/screens/AGENTS.md
git commit -m "chore: replace legacy OMD project guidance" -- .omd/init-context.json .omd/sync.lock.json .cursor/rules/omd-design.mdc .cursor/rules/design-system.mdc AGENTS.md CLAUDE.md .gitignore src/data/AGENTS.md src/domain/AGENTS.md src/screens/AGENTS.md
git show --stat --oneline HEAD
git show --format= --name-only HEAD
```

### Task 2: Archive Historical Design Documents Without Data Loss

**Files:**
- Move: `DESIGN_DEPRECATED.md` → `docs/archive/design/DESIGN_DEPRECATED.md`
- Move: `DESIGN_DEPRECATED_APPLE_APP.md` → `docs/archive/design/DESIGN_DEPRECATED_APPLE_APP.md`
- Move: `DESIGN_DEPRECATED_MOLCUBE.md` → `docs/archive/design/DESIGN_DEPRECATED_MOLCUBE.md`
- Modify: `DESIGN.md`
- Modify: `src/styles/tokens.css`
- Modify only if it contains an explicit root path: `src/screens/AGENTS.md`

**Interfaces:**
- Consumes: current modified historical documents and their live references.
- Produces: byte-identical archive files and valid references from active documents/source comments.

- [ ] **Step 1: Record source hashes before moving**

```bash
shasum -a 256 DESIGN_DEPRECATED.md DESIGN_DEPRECATED_APPLE_APP.md DESIGN_DEPRECATED_MOLCUBE.md
```

Save the three hashes in the task report.

- [ ] **Step 2: Prove the target archive is absent**

```bash
test -e docs/archive/design/DESIGN_DEPRECATED.md
test -e docs/archive/design/DESIGN_DEPRECATED_APPLE_APP.md
test -e docs/archive/design/DESIGN_DEPRECATED_MOLCUBE.md
```

Expected: the assertions fail before the move.

- [ ] **Step 3: Move exact files and repair only broken references**

Create `docs/archive/design/`, move the three files with exact source/target paths, and replace active root-path references with:

```text
docs/archive/design/DESIGN_DEPRECATED.md
docs/archive/design/DESIGN_DEPRECATED_APPLE_APP.md
docs/archive/design/DESIGN_DEPRECATED_MOLCUBE.md
```

Do not rewrite historical document content. In `DESIGN.md` and `src/styles/tokens.css`, change path text only. Update `src/screens/AGENTS.md` only if it contains an explicit path that is now broken.

- [ ] **Step 4: Verify hashes and references GREEN**

```bash
shasum -a 256 docs/archive/design/DESIGN_DEPRECATED.md docs/archive/design/DESIGN_DEPRECATED_APPLE_APP.md docs/archive/design/DESIGN_DEPRECATED_MOLCUBE.md
test ! -e DESIGN_DEPRECATED.md
test ! -e DESIGN_DEPRECATED_APPLE_APP.md
test ! -e DESIGN_DEPRECATED_MOLCUBE.md
rg -n 'DESIGN_DEPRECATED(_APPLE_APP|_MOLCUBE)?\.md' DESIGN.md src AGENTS.md CLAUDE.md .cursor/rules
```

Expected: destination hashes equal Step 1 exactly; every active reference either uses `docs/archive/design/…` or names the documents generically without a broken path.

Run a repository-wide active-surface assertion as well. Historical archives,
specifications, and implementation plans are excluded; all other tracked surfaces
must use the archive prefix whenever they spell a full deprecated filename:

```bash
rg -n 'DESIGN_DEPRECATED(_APPLE_APP|_MOLCUBE)?\.md' . \
  --glob '!docs/archive/**' \
  --glob '!docs/superpowers/specs/**' \
  --glob '!docs/superpowers/plans/**' \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!.codex-artifacts/**'

if rg --pcre2 -n \
  '(?<!docs/archive/design/)(?:\./)?DESIGN_DEPRECATED(?:_APPLE_APP|_MOLCUBE)?\.md' . \
  --glob '!docs/archive/**' \
  --glob '!docs/superpowers/specs/**' \
  --glob '!docs/superpowers/plans/**' \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!.codex-artifacts/**'; then
  exit 1
fi
```

The first command is evidence; the second is the gate. A generic phrase such as
`DESIGN_DEPRECATED files` is allowed because it is not a path.

- [ ] **Step 5: Commit only the archive move and references**

```bash
git add -- DESIGN_DEPRECATED.md DESIGN_DEPRECATED_APPLE_APP.md DESIGN_DEPRECATED_MOLCUBE.md docs/archive/design/DESIGN_DEPRECATED.md docs/archive/design/DESIGN_DEPRECATED_APPLE_APP.md docs/archive/design/DESIGN_DEPRECATED_MOLCUBE.md DESIGN.md src/styles/tokens.css src/screens/AGENTS.md
git commit -m "docs: archive historical design sources" -- DESIGN_DEPRECATED.md DESIGN_DEPRECATED_APPLE_APP.md DESIGN_DEPRECATED_MOLCUBE.md docs/archive/design/DESIGN_DEPRECATED.md docs/archive/design/DESIGN_DEPRECATED_APPLE_APP.md docs/archive/design/DESIGN_DEPRECATED_MOLCUBE.md DESIGN.md src/styles/tokens.css src/screens/AGENTS.md
git show --stat --oneline HEAD
git show --format= --name-only HEAD
```

### Task 3: Characterize Future Large-File Extraction Boundaries

**Files:**
- Create: `docs/architecture/large-file-extraction-contracts.md`

**Interfaces:**
- Consumes: current imports/exports/tests for `GridScreen.tsx`, `grid.css`, `MyBookingsScreen.tsx`, `mockAdapter.ts`, `ui.tsx`, and `validate-design-contract.mjs`.
- Produces: an extraction sequence with preserved public seams and focused characterization commands for Wave 2.

- [ ] **Step 1: Capture the current baseline mechanically**

Record line counts, exported symbols, direct importers, and adjacent tests for exactly:

```text
src/screens/GridScreen.tsx
src/styles/grid.css
src/screens/MyBookingsScreen.tsx
src/data/mockAdapter.ts
src/components/ui.tsx
scripts/validate-design-contract.mjs
```

Do not edit these implementation files.

- [ ] **Step 2: Write the architecture contract with complete sections**

Create `docs/architecture/large-file-extraction-contracts.md` with this exact top-level structure:

```markdown
# MolRoom large-file extraction contracts

## Rules shared by every extraction
## GridScreen.tsx
## grid.css
## MyBookingsScreen.tsx
## mockAdapter.ts
## ui.tsx
## validate-design-contract.mjs
## Ordered Wave 2 extraction sequence
## Characterization command matrix
```

For each file include: current line count, responsibility groups, existing public imports/exports, proposed target files, preserved signatures, tests that must be RED/GREEN for the move, UI routes requiring screenshots, and explicit forbidden compatibility exports. Use these target responsibilities:

```text
GridScreen: range/query orchestration; pointer interaction; dialog orchestration; day/week/month views.
grid.css: axis; event; view; interaction; media-query sections.
MyBookingsScreen: booking item; past-summary editor; cancellation dialog; admin/settings tabs.
mockAdapter: seed fixtures; fault fixtures; read model; mutation implementation.
ui.tsx: input primitives; dialog lifecycle; navigation/display primitives.
validator: parser; runtime rules; canonical example rules; CLI.
```

The ordered sequence must put Wave 1 spike results before any runtime extraction and must prohibit unused re-export shims.

- [ ] **Step 3: Self-check for placeholders and broken references**

```bash
if rg -n 'TBD|TODO|FIXME|similar to|implement later|add appropriate|write tests for' docs/architecture/large-file-extraction-contracts.md; then exit 1; fi
test -e src/screens/GridScreen.tsx
test -e src/styles/grid.css
test -e src/screens/MyBookingsScreen.tsx
test -e src/data/mockAdapter.ts
test -e src/components/ui.tsx
test -e scripts/validate-design-contract.mjs
git diff --check -- docs/architecture/large-file-extraction-contracts.md
```

Expected: no placeholder match; all referenced source files exist; diff check is clean.

- [ ] **Step 4: Commit only the architecture contract**

```bash
git add -- docs/architecture/large-file-extraction-contracts.md
git commit -m "docs: define large-file extraction contracts" -- docs/architecture/large-file-extraction-contracts.md
git show --stat --oneline HEAD
```

### Task 4: Repository Hygiene Integration Proof

**Files:**
- Evidence: this plan's `.superpowers/sdd/2026-08-21-molroom-wave0-repository-hygiene/` workspace only.

**Interfaces:**
- Consumes: Tasks 1–3 commits.
- Produces: an archive-level proof that active OMD files and local artifacts are
  absent from Git while historical evidence remains accessible, plus the executable
  handoff for the production program's session-final artifact cleanup.

- [ ] **Step 1: Verify committed archive contents**

Create this plan's evidence directory first with the SDD workspace helper. Then
extract a fresh committed archive with explicit commands:

```bash
molroom_hygiene_archive="$(mktemp -d /tmp/molroom-hygiene-archive.XXXXXX)"
git archive HEAD | tar -x -C "$molroom_hygiene_archive"
(
  cd "$molroom_hygiene_archive"
  test ! -e .omd
  test ! -e .cursor/rules/omd-design.mdc
  test ! -e .codex-artifacts
  test -e .cursor/rules/design-system.mdc
  test -e docs/archive/design/DESIGN_DEPRECATED.md
  test -e docs/archive/design/DESIGN_DEPRECATED_APPLE_APP.md
  test -e docs/archive/design/DESIGN_DEPRECATED_MOLCUBE.md
  test -e docs/architecture/large-file-extraction-contracts.md
)
molroom_hygiene_archive_status=$?
rm -rf -- "$molroom_hygiene_archive"
test "$molroom_hygiene_archive_status" -eq 0
```

- [ ] **Step 2: Confirm shared-tree isolation**

Inspect every plan commit with `git show --name-only`. Confirm none of the five dirty product paths entered the hygiene commits and the index is empty.

- [ ] **Step 3: Handle local artifacts recoverably at the correct time**

The production-readiness spec requires `.codex-artifacts/` to move to Trash at the
end of the overall active session, not during this Wave 0 plan while the 15-minute
decision and later browser/security evidence still use it. Prove the directory is
already isolated from Git now:

```bash
test -d /Users/sungjun/Dev/projects/meeting-room/.codex-artifacts
git check-ignore -q .codex-artifacts/example.txt
if git ls-files -- .codex-artifacts | rg .; then
  exit 1
fi
```

Record these results and the exact spec authority
`docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md`
(“현재 세션 종료 시” artifact-hygiene requirement) in:

```text
.superpowers/sdd/2026-08-21-molroom-wave0-repository-hygiene/task-4-artifact-cleanup-report.md
```

The report must carry this exact session-final ownership gate for the controller to
run only after every Wave 0–4 decision, visual, and security artifact is no longer
active. The final program cannot be reported complete until this gate and move run:

```bash
test -d /Users/sungjun/Dev/projects/meeting-room/.codex-artifacts
test ! -e /Users/sungjun/.Trash/meeting-room-codex-artifacts-20260821-wave0
lsof +D /Users/sungjun/Dev/projects/meeting-room/.codex-artifacts \
  > .superpowers/sdd/2026-08-21-molroom-wave0-repository-hygiene/task-4-artifact-lsof.txt 2>&1
molroom_artifact_lsof_status=$?
test "$molroom_artifact_lsof_status" -eq 1
ps -axo pid=,ppid=,lstart=,command= | awk \
  -v self="$$" \
  -v root="/Users/sungjun/Dev/projects/meeting-room/.codex-artifacts" \
  '$1 != self && $2 != self && index($0, root) { found = 1; print } END { exit found ? 0 : 1 }' \
  > .superpowers/sdd/2026-08-21-molroom-wave0-repository-hygiene/task-4-artifact-ps.txt
molroom_artifact_ps_status=$?
test "$molroom_artifact_ps_status" -eq 1
```

Expected: `lsof` exit 1 with no owners and the process-signature scan has no
matches. Only after those checks, move the exact directory recoverably:

```bash
mv /Users/sungjun/Dev/projects/meeting-room/.codex-artifacts \
  /Users/sungjun/.Trash/meeting-room-codex-artifacts-20260821-wave0
```

Never use `rm`, `git clean`, a glob, or an environment variable for this move. If
the destination already exists or either ownership check finds a process, stop only
this cleanup step without overwriting anything and record the collision/owner. The
report must include the Trash destination and recovery command that moves it back.
Task 4 records and reviews this mandatory handoff; it deliberately does not execute
the move while its source contains live program evidence.

- [ ] **Step 4: Request task-range review**

Generate a review package covering this plan's commit range. The reviewer must verify byte-preserving archives, live-reference correctness, active OMD absence, pathspec isolation, and that the extraction contract contains no implementation or compatibility debt.
