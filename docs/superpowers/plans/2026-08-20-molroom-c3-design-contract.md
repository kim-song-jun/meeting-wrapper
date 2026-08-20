# MolRoom C3 Design Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `DESIGN.md`와 runtime을 C3 역할·입력 방식별 계약으로 일치시키고, 미세 포인터의 격자 밀도와 터치 가독성을 동시에 보장하며 generic 토큰을 완전히 제거한다.

**Architecture:** `tokens.css`에는 evidence-tagged fine/touch 원천값과 역할별 소비 토큰을 둔다. CSS는 touch-safe 값을 기본으로 쓰고 `(min-width: 768px) and (hover: hover) and (pointer: fine)`에서만 fine 값을 활성화하며, `GridScreen`의 픽셀 계산도 같은 활성 슬롯 토큰을 읽는다. 문서·CSS·TS 계약은 정적 validator와 좁은 순수 함수 테스트로 고정하고, 마지막에 실제 제품 화면과 canonical design examples를 함께 갱신한다.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 3, CSS custom properties, Node.js ESM validation scripts

**Spec:** `docs/superpowers/specs/2026-08-20-molroom-design-contract-reconciliation-design.md`

## Global Constraints

- `DESIGN.md`를 UI 계약의 권위로 유지하고 deprecated 디자인 문서는 수정 근거로 사용하지 않는다.
- 고정값은 fine 슬롯 `24px`, touch 슬롯 `44px`, fine 이벤트 글자 `12px/14px`, touch 이벤트 글자 `14px/20px`, fine 축 `11px/14px`, touch 축 `13px/18px`, fine 이벤트 radius `4px`, touch 이벤트 radius `12px`, 주간 분할 열 하한 `76px`, 입력 radius `12px`, 현재 시각 `#4E5968`이다.
- 기본값은 touch-safe이며 fine query는 정확히 `(min-width: 768px) and (hover: hover) and (pointer: fine)`다. width만으로 fine 모드를 켜지 않는다.
- `--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, `--r-seg`, `--t-grid-size`, `--t-grid-lh`, `--t-axis-size`, `--t-axis-lh`, `--r-event`, `--grid-slot-h`, `--grid-col-min`을 alias나 fallback으로 남기지 않는다.
- `--r-pill`은 배지·점·완전한 원형을 소유하는 역할 토큰이므로 유지한다.
- layout spacing은 `4/8/16/24/32px`, 좁은 micro spacing은 `6px`만 사용한다. `20px`은 `--pad-action-inline`과 `--pad-mobile-inline`로만 표현한다.
- `#E42939`은 파괴적 동작에만 쓰고, ownership 막대에는 `box-shadow`를 쓰지 않는다.
- CSS custom property fallback으로 누락을 숨기지 않는다. 이전 상태 복원이나 `git revert`는 별도 사용자 승인 전에는 실행하지 않는다.
- 기능 버그, 라우트, 데이터 계약, 예약 정책은 이 변경에 포함하지 않는다.
- 공유 작업트리 규칙이 우선한다. 브랜치·worktree·stash를 만들지 않고 `main`에서만 작업하며, `git add -A`, `git commit -a`, reset, restore, clean을 사용하지 않는다.
- 현재 다른 세션이 수정 중인 `DESIGN.md`, `src/styles/tokens.css`, `src/styles/grid.css`, `src/styles/components.css`, `src/styles/landing.css`, `src/styles/rooms.css`, `src/screens/GridScreen.tsx`의 소유권이 해제되기 전에는 구현을 시작하지 않는다.
- 테스트·dev server·browser를 시작하기 전에 호스트 상태와 PID 기준선을 기록한다. 내가 시작한 PID만 TERM 후 필요한 경우에만 KILL하고 포트·프로세스 수를 기준선으로 되돌린다.
- 실제 UI 캡처에는 사용자가 선택한 browser만 쓴다. in-app browser를 쓸 수 없어 direct Playwright가 필요하면 실행 전에 사용자 승인을 받는다.
- `docs/design-examples/standalone/`은 직접 편집하지 않고 generator로만 갱신한다.

## File Structure

- Create `scripts/validate-design-contract.mjs`: 문서·토큰·CSS 소비자 계약을 실제 파일에서 검증하는 정적 validator.
- Create `src/screens/gridEventContent.ts`: 이벤트 높이를 `organizer-only` 또는 `organizer-time` 모드로 바꾸는 순수 계약.
- Create `src/screens/gridEventContent.test.ts`: 24/44/48px 경계의 실제 콘텐츠 적합 동작 검증.
- Modify `package.json`: `validate:design-contract` 명령 추가.
- Modify `DESIGN.md`: C3 fine/touch 표, 역할 radius, spacing, color/depth 계약 반영.
- Modify `src/styles/tokens.css`: fine/touch 원천값, 역할 radius·padding, active role tokens 정의; generic 토큰 삭제.
- Modify `src/styles/grid.css`: active grid roles, 76px 주간 하한, 콘텐츠 적합 스타일, neutral now indicator, pseudo ownership stripe 적용.
- Modify `src/screens/GridScreen.tsx`: active 슬롯 토큰 사용, 주간 열 토큰 사용, 이벤트 콘텐츠 모드 및 접근 가능한 이름 적용.
- Modify `src/styles/components.css`, `landing.css`, `login.css`, `mine.css`, `navigation.css`, `rooms.css`, `screens.css`: 역할 radius와 spacing 소비자로 전환.
- Modify `docs/design-examples/examples.css`: production 계약과 동일한 fine/touch·radius·now/ownership 표현 반영.
- Regenerate `docs/design-examples/standalone/{index,login,calendar,room,my-bookings,booking-dialog}.html` with `scripts/build-design-standalone.mjs`.
- Refresh `docs/design-examples/screenshots/{login-mobile,calendar-desktop,room-mobile,my-bookings-mobile,booking-dialog-desktop}.png` from verified product states.
- Store non-committed before/after evidence under `.codex-artifacts/molroom-c3/{before,after}/`.

---

### Task 0: Ownership Gate and Visual Baseline

**Files:**
- Create locally, do not commit: `.codex-artifacts/molroom-c3/before/*.png`
- Do not modify product files in this task.

**Interfaces:**
- Consumes: current shared working tree after other sessions release the files listed in Global Constraints.
- Produces: same-state baseline screenshots and process/PID record used by Task 5.

- [ ] **Step 1: Prove file ownership is clear**

Run:

```bash
git branch --show-current
git status --short
git diff --cached --name-only
```

Expected: branch is `main`; the seven shared files named in Global Constraints are clean or explicitly handed off by their owner; cached output is empty. If not, stop before editing and request the owning session’s handoff.

- [ ] **Step 2: Record host and process baseline before starting UI tooling**

Run:

```bash
uptime
sysctl -n hw.ncpu
vm_stat
ps -axo pid=,ppid=,lstart=,command= | rg 'node|vite|playwright|context-mode|xcodebuildmcp'
lsof -nP -iTCP:5183 -sTCP:LISTEN
```

Expected: no unowned process is terminated. Record the counts plus the PID/PPID/command of every process started in the following step.

- [ ] **Step 3: Start one tracked dev server and capture baseline states**

Run `npm run dev -- --port 5183`, record its PID tree, then capture these exact states with the approved browser:

```text
1440×1000 fine: /, 일간, 방 2개, 30분·60분 예약이 함께 보이는 상태
1440×1000 fine: /, 주간, 방 2개와 방 1개를 각각 확인하는 상태
1024×768 fine: /, 주간, 방 2개
1024×768 coarse: /, 주간, 방 2개
390×844 coarse: /, 모바일 기본 목록과 예약 상세
390×844 coarse: /r/<seeded-room-id>, 빠른 예약 입력
```

Save them under `.codex-artifacts/molroom-c3/before/` with viewport and state in each filename.

- [ ] **Step 4: Clean up the baseline server**

Send TERM to the recorded npm/Vite PID tree, wait briefly, then KILL only remaining recorded PIDs if needed. Re-run `lsof` and the process count; expected port `5183` closed and counts returned to baseline.

### Task 1: Make DESIGN.md the Executable C3 Authority

**Files:**
- Create: `scripts/validate-design-contract.mjs`
- Modify: `package.json:7-13`
- Modify: `DESIGN.md:111-210,249-310,317-338`

**Interfaces:**
- Consumes: approved C3 spec.
- Produces: `npm run validate:design-contract`; initial checks cover the authoritative document, later tasks extend the same validator.

- [ ] **Step 1: Add a validator that initially checks the approved document contract**

Create `scripts/validate-design-contract.mjs` with this base:

```js
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

function requireText(relativePath, fragments) {
  const source = read(relativePath);
  for (const fragment of fragments) {
    if (!source.includes(fragment)) failures.push(`${relativePath}: missing ${JSON.stringify(fragment)}`);
  }
}

function forbidPattern(relativePaths, pattern) {
  for (const relativePath of relativePaths) {
    const source = read(relativePath);
    const matches = source.match(pattern) ?? [];
    for (const match of matches) failures.push(`${relativePath}: forbidden ${JSON.stringify(match)}`);
  }
}

function requirePattern(relativePath, pattern, label) {
  if (!pattern.test(read(relativePath))) failures.push(`${relativePath}: missing ${label}`);
}

requireText("DESIGN.md", [
  "C3 — 역할·입력 방식별 계약",
  "`24px`",
  "`44px`",
  "`12px/14px`",
  "`14px/20px`",
  "`11px/14px`",
  "`13px/18px`",
  "`76px`",
  "`#4E5968`",
]);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("MolRoom design contract: valid");
}
```

Add this script to `package.json`:

```json
"validate:design-contract": "node scripts/validate-design-contract.mjs"
```

- [ ] **Step 2: Run the validator and confirm the old DESIGN contract fails**

Run: `npm run validate:design-contract`

Expected: FAIL listing the missing C3 heading and fine/touch values.

- [ ] **Step 3: Replace the contradictory DESIGN sections with the approved contract**

Insert one C3 subsection containing this exact role table and replace the old Grid Event, axis, event radius, split-column, current-time, and spacing statements:

```markdown
### C3 — 역할·입력 방식별 계약

| 역할 | 미세 포인터 | 터치·거친 포인터 | 증거 |
|---|---:|---:|---|
| 30분 슬롯 | `24px` | `44px` | `local` / `a11y` |
| Grid Event | `12px/14px` | `14px/20px` | `local` |
| 시간축 | `11px/14px` | `13px/18px` | `local` |
| 이벤트 radius | `4px` | `12px` | `local` |
| 주간 분할 열 하한 | `76px` | `76px` 이상 | `local` |

기본값은 터치 안전값이다. `(min-width: 768px) and (hover: hover) and (pointer: fine)`에서만 미세 포인터 값을 활성화한다.
```

Also state exactly: input `12px`, filter `12px`, segment `12px`, navigation item `12px`, card `16px`, dialog `20px`, action `14px` and mobile action `16px`; current time uses neutral `#4E5968`; ownership uses a logical border or pseudo-element; `12px` is not layout spacing and `20px` is allowed only by named component-geometry tokens.

- [ ] **Step 4: Run the document contract validator**

Run: `npm run validate:design-contract`

Expected: `MolRoom design contract: valid`.

- [ ] **Step 5: Commit only the document authority and validator**

```bash
git add -- DESIGN.md package.json scripts/validate-design-contract.mjs
git commit -m "docs: align MolRoom design authority with C3" -- DESIGN.md package.json scripts/validate-design-contract.mjs
git show --stat --oneline HEAD
```

Expected: exactly three paths in the commit.

### Task 2: Implement the Fine/Touch Grid Contract

**Files:**
- Create: `src/screens/gridEventContent.ts`
- Create: `src/screens/gridEventContent.test.ts`
- Modify: `scripts/validate-design-contract.mjs`
- Modify: `src/styles/tokens.css:100-281`
- Modify: `src/styles/grid.css:528-1005,1199-1425,1620-1700`
- Modify: `src/screens/GridScreen.tsx:127-162,560-575,1168-1173,1605-1625,1830-1925,1988-2035,2184-2202`

**Interfaces:**
- Produces tokens: `--grid-slot-fine`, `--grid-slot-touch`, `--grid-slot-block-size`, `--grid-day-column-min`, `--grid-split-column-min`, `--grid-week-single-fine-min`, `--grid-week-single-touch-min`, `--grid-week-single-column-min`, `--t-grid-fine-size`, `--t-grid-fine-lh`, `--t-grid-touch-size`, `--t-grid-touch-lh`, `--t-axis-fine-size`, `--t-axis-fine-lh`, `--t-axis-touch-size`, `--t-axis-touch-lh`, `--t-grid-event-size`, `--t-grid-event-lh`, `--t-grid-axis-size`, `--t-grid-axis-lh`, `--r-event-fine`, `--r-event-touch`, `--r-grid-event`.
- Produces TypeScript: `eventContentMode(heightPx: number): "organizer-only" | "organizer-time"` and `GRID_EVENT_TWO_LINE_MIN_PX = 44`.
- `GridEventBlock` additionally consumes `roomName: string` for its accessible name.

- [ ] **Step 1: Extend the validator and write the failing content-fit test**

Insert the helper and assertions immediately before the validator’s final `if (failures.length > 0)` block:

```js
function requireTokenEvidence(token, evidence) {
  const line = read("src/styles/tokens.css").split(/\r?\n/).find((candidate) => candidate.includes(`${token}:`));
  if (!line || !line.includes(`[${evidence}]`)) {
    failures.push(`src/styles/tokens.css: ${token} must carry [${evidence}] evidence`);
  }
}

requireText("src/styles/tokens.css", [
  "--grid-slot-fine: 24px;",
  "--grid-slot-touch: 44px;",
  "--grid-split-column-min: 76px;",
  "--t-grid-fine-size: 12px;",
  "--t-grid-touch-size: 14px;",
  "--t-axis-fine-size: 11px;",
  "--t-axis-touch-size: 13px;",
  "--r-event-fine: 4px;",
  "--r-event-touch: 12px;",
  "--c-now: #4E5968;",
]);
forbidPattern(
  ["src/styles/tokens.css", "src/styles/grid.css", "src/screens/GridScreen.tsx"],
  /--(?:t-grid-size|t-grid-lh|t-axis-size|t-axis-lh|r-event|grid-slot-h|grid-col-min)(?=\s*[:),;])/g,
);
requirePattern("src/styles/grid.css", /\.grid-event\s*\{[\s\S]*?border-inline-start:\s*4px solid transparent;/, "grid ownership stripe geometry");
requirePattern("src/styles/grid.css", /\.grid-mobile__item--mine::before[\s\S]*?inline-size:\s*4px;/, "mobile ownership pseudo stripe");
requirePattern("src/styles/grid.css", /\.agenda-row--mine::before[\s\S]*?inline-size:\s*4px;/, "agenda ownership pseudo stripe");
forbidPattern(["src/styles/grid.css"], /box-shadow:\s*inset 4px 0 0 var\(--c-mine-border\)/g);
requirePattern("src/styles/tokens.css", /--grid-slot-fine:\s*24px;[^\n]*\[local\]/, "fine slot evidence");
requirePattern("src/styles/tokens.css", /--grid-slot-touch:\s*44px;[^\n]*\[a11y\]/, "touch slot evidence");
requirePattern("src/styles/tokens.css", /--c-now:\s*#4E5968;[^\n]*\[local\]/, "current-time evidence");
for (const [token, evidence] of [
  ["--grid-slot-fine", "local"], ["--grid-slot-touch", "a11y"],
  ["--grid-split-column-min", "local"], ["--t-grid-fine-size", "local"],
  ["--t-grid-touch-size", "local"], ["--t-axis-fine-size", "local"],
  ["--t-axis-touch-size", "local"], ["--r-event-fine", "local"],
  ["--r-event-touch", "local"], ["--c-now", "local"],
]) requireTokenEvidence(token, evidence);
```

Create `src/screens/gridEventContent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eventContentMode, GRID_EVENT_TWO_LINE_MIN_PX } from "./gridEventContent";

describe("eventContentMode", () => {
  it("keeps a fine-pointer 30-minute block to the organizer line", () => {
    expect(eventContentMode(24)).toBe("organizer-only");
  });

  it("shows time only when two 20px lines fit", () => {
    expect(GRID_EVENT_TWO_LINE_MIN_PX).toBe(44);
    expect(eventContentMode(43.99)).toBe("organizer-only");
    expect(eventContentMode(44)).toBe("organizer-time");
    expect(eventContentMode(48)).toBe("organizer-time");
  });
});
```

- [ ] **Step 2: Run both narrow checks and confirm they fail for the intended reasons**

Run:

```bash
npm run validate:design-contract
npm test -- src/screens/gridEventContent.test.ts
```

Expected: validator FAILs on missing role/input tokens; Vitest FAILs because `gridEventContent.ts` does not exist.

- [ ] **Step 3: Add fixed input-mode sources and active role tokens**

Replace the old grid declarations in `tokens.css` with:

```css
--grid-slot-fine: 24px;                       /* [local] */
--grid-slot-touch: 44px;                      /* [a11y] */
--grid-slot-block-size: var(--grid-slot-touch);
--grid-day-column-min: 160px;                 /* [local] */
--grid-split-column-min: 76px;                /* [local] */
--grid-week-single-fine-min: 132px;           /* [local] */
--grid-week-single-touch-min: 108px;          /* [local] */
--grid-week-single-column-min: var(--grid-week-single-touch-min);

--t-grid-fine-size: 12px;   --t-grid-fine-lh: 14px;   /* [local] */
--t-grid-touch-size: 14px;  --t-grid-touch-lh: 20px;  /* [local] */
--t-axis-fine-size: 11px;   --t-axis-fine-lh: 14px;   /* [local] */
--t-axis-touch-size: 13px;  --t-axis-touch-lh: 18px;  /* [local] */
--r-event-fine: 4px;                              /* [local] */
--r-event-touch: 12px;                            /* [local] */

--t-grid-event-size: var(--t-grid-touch-size);
--t-grid-event-lh: var(--t-grid-touch-lh);
--t-grid-axis-size: var(--t-axis-touch-size);
--t-grid-axis-lh: var(--t-axis-touch-lh);
--r-grid-event: var(--r-event-touch);
--c-now: #4E5968;                                 /* [local] */
```

Inside the existing fine query, set only the active role values:

```css
--grid-slot-block-size: var(--grid-slot-fine);
--grid-week-single-column-min: var(--grid-week-single-fine-min);
--t-grid-event-size: var(--t-grid-fine-size);
--t-grid-event-lh: var(--t-grid-fine-lh);
--t-grid-axis-size: var(--t-axis-fine-size);
--t-grid-axis-lh: var(--t-axis-fine-lh);
--r-grid-event: var(--r-event-fine);
```

Delete the coarse/mobile repetitions of the old grid token; base is already touch-safe.

- [ ] **Step 4: Implement the pure content-fit contract**

Create `src/screens/gridEventContent.ts`:

```ts
export const GRID_EVENT_TWO_LINE_MIN_PX = 44;

export function eventContentMode(heightPx: number): "organizer-only" | "organizer-time" {
  if (!Number.isFinite(heightPx) || heightPx <= 0) {
    throw new Error(`Grid event height must be a positive number; received ${String(heightPx)}`);
  }
  return heightPx >= GRID_EVENT_TWO_LINE_MIN_PX ? "organizer-time" : "organizer-only";
}
```

- [ ] **Step 5: Migrate grid CSS and geometry consumers without aliases**

Apply these exact replacements:

```text
--grid-slot-h          -> --grid-slot-block-size
--grid-col-min         -> --grid-day-column-min
--r-event              -> --r-grid-event
--t-grid-size/lh       -> --t-grid-event-size/lh
--t-axis-size/lh       -> --t-grid-axis-size/lh
--grid-week-col-min    -> remove; use --grid-split-column-min or --grid-week-single-column-min
```

In `GridScreen.tsx`, read `useCssPx("--grid-slot-block-size")`; make day columns use `--grid-day-column-min`; make week columns choose `--grid-split-column-min` when `split` and `--grid-week-single-column-min` otherwise. Remove the inline `--grid-slot-h`, the `44px`/`96px`/`108px`/`132px` branching, and pass the same `slotPx` to `placeInGrid` for day and week.

- [ ] **Step 6: Apply content fit, accessible names, neutral now color, and non-shadow ownership**

Import `eventContentMode`. Add `roomName` to `GridEventBlock`, pass `room.name` from both callers, and build the label as:

```ts
const contentMode = eventContentMode(placement.height);
const accessibleLabel = `${booking.organizerName}, ${roomName}, ${hhmm(booking.start)}~${hhmm(booking.end)}${noShow ? ", 미체크인" : ""}`;
```

Render only organizer text in `organizer-only`; render organizer plus the time line in `organizer-time`. Keep the complete information in `aria-label` and the detail dialog.

Replace both inset ownership shadows with a shared pseudo-element pattern:

```css
.grid-mobile__item--mine,
.agenda-row--mine {
  position: relative;
  background: var(--c-mine-bg);
}
.grid-mobile__item--mine::before,
.agenda-row--mine::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: 4px;
  background: var(--c-mine-border);
}
```

Change the grid event itself from a physical 3px left border to `border-inline-start: 4px solid transparent`, keep mine/other colors on `border-inline-start-color`, and rebalance the event’s inline-start padding so the organizer text remains aligned after the extra pixel.

Update the current-time comment to state that neutral `--c-now` is a time locator and danger red remains destructive-only.

- [ ] **Step 7: Run the narrow grid contract checks**

Run:

```bash
npm test -- src/screens/gridEventContent.test.ts
npm run validate:design-contract
npm run typecheck
```

Expected: 2 content-fit tests PASS, validator prints valid, typecheck exits 0.

- [ ] **Step 8: Commit the grid contract**

```bash
git add -- scripts/validate-design-contract.mjs src/styles/tokens.css src/styles/grid.css src/screens/GridScreen.tsx src/screens/gridEventContent.ts src/screens/gridEventContent.test.ts
git commit -m "feat: apply MolRoom fine and touch grid contract" -- scripts/validate-design-contract.mjs src/styles/tokens.css src/styles/grid.css src/screens/GridScreen.tsx src/screens/gridEventContent.ts src/screens/gridEventContent.test.ts
git show --stat --oneline HEAD
```

Expected: exactly six paths.

### Task 3: Replace Generic Radius Tokens Atomically

**Files:**
- Modify: `scripts/validate-design-contract.mjs`
- Modify: `src/styles/tokens.css:156-170,272-283`
- Modify: `src/styles/components.css`, `grid.css`, `landing.css`, `login.css`, `mine.css`, `navigation.css`, `rooms.css`, `screens.css`

**Interfaces:**
- Produces fixed tokens: `--r-action: 14px`, `--r-action-mobile: 16px`, `--r-input: 12px`, `--r-filter: 12px`, `--r-segment: 12px`, `--r-nav-item: 12px`, `--r-card: 16px`, `--r-dialog: 20px`.
- Removes all generic radius declarations and consumers in one commit; no compatibility alias.

- [ ] **Step 1: Extend the validator to demand role ownership and reject generic radius**

Insert this block before the final failure check:

```js
// Also add readdirSync to the node:fs import at the top of this script.
const styleFiles = readdirSync(join(root, "src/styles"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
  .map((entry) => `src/styles/${entry.name}`);
requireText("src/styles/tokens.css", [
  "--r-action: 14px;", "--r-action-mobile: 16px;", "--r-input: 12px;",
  "--r-filter: 12px;", "--r-segment: 12px;", "--r-nav-item: 12px;",
  "--r-card: 16px;", "--r-dialog: 20px;",
]);
forbidPattern(styleFiles, /--r-(?:sm|md|lg|xl|seg)(?=\s*[:),;])/g);
for (const [token, evidence] of [
  ["--r-action", "toss"], ["--r-action-mobile", "toss"],
  ["--r-input", "local"], ["--r-filter", "local"],
  ["--r-segment", "local"], ["--r-nav-item", "local"],
  ["--r-card", "local"], ["--r-dialog", "local"],
]) requireTokenEvidence(token, evidence);
```

- [ ] **Step 2: Run the validator and confirm it fails on the generic declarations and consumers**

Run: `npm run validate:design-contract`

Expected: FAIL listing `--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, and `--r-seg` occurrences.

- [ ] **Step 3: Replace declarations and every consumer using this exact ownership map**

Replace the radius declaration block with evidence-tagged roles:

```css
--r-action: 14px;         /* [toss] */
--r-action-mobile: 16px;  /* [toss] */
--r-input: 12px;          /* [local] */
--r-filter: 12px;         /* [local] */
--r-segment: 12px;        /* [local] */
--r-nav-item: 12px;       /* [local] */
--r-card: 16px;           /* [local] */
--r-dialog: 20px;         /* [local] */
--r-pill: 980px;          /* [local] badge/circle only */
```

Then replace every consumer using this exact ownership map:

```text
--r-action:
  components.css .mr-btn--primary/.mr-btn--secondary/.mr-btn--compact/.mr-btn--danger
  grid.css .grid-viewswitch/.grid-datestepper/.grid-datepick
  screens.css .mr-page-action

--r-action-mobile (inside max-width: 767px only):
  the action selectors above

--r-input:
  components.css .mr-input
  grid.css .grid-deptselect__input

--r-filter:
  grid.css .grid-roomtoggle__btn/.grid-deptchip
  rooms.css .rooms-time-option

--r-segment:
  grid.css .grid-viewswitch__btn

--r-nav-item:
  navigation.css .mr-skip-link/.mr-navlink/.mr-mobile-nav__item
  screens.css .mr-sidebar__item/.mr-sidebar__room

--r-card:
  components.css .mr-card/.mr-alert/.mr-picker__results/.mr-recur-fail__list
  grid.css .grid-skeleton-card/.grid-mobile__list/.grid-mobile__empty/.agenda__list/.agenda__empty
  landing.css .mr-landing__item/.mr-landing__roomlink
  login.css .mr-login__failure .mr-alert div:focus-visible
  mine.css .mine-list
  rooms.css .rooms-card

--r-dialog:
  components.css .mr-dialog, including the mobile top-corner shorthand
```

Keep `--r-pill` for badges, dots, and circles. Delete the mobile overrides of `--r-sm` and `--r-md`; mobile action changes are selector-level and inputs stay `12px`.

- [ ] **Step 4: Run the radius contract check**

Run:

```bash
npm run validate:design-contract
rg -n --glob '*.css' -- '--r-(sm|md|lg|xl|seg)\b' src/styles
```

Expected: validator valid; `rg` exits 1 with no matches.

- [ ] **Step 5: Commit the atomic radius migration**

```bash
git add -- scripts/validate-design-contract.mjs src/styles/tokens.css src/styles/components.css src/styles/grid.css src/styles/landing.css src/styles/login.css src/styles/mine.css src/styles/navigation.css src/styles/rooms.css src/styles/screens.css
git commit -m "refactor: give MolRoom radii explicit roles" -- scripts/validate-design-contract.mjs src/styles/tokens.css src/styles/components.css src/styles/grid.css src/styles/landing.css src/styles/login.css src/styles/mine.css src/styles/navigation.css src/styles/rooms.css src/styles/screens.css
git show --stat --oneline HEAD
```

Expected: exactly ten paths.

### Task 4: Reconcile Spacing and Component Geometry

**Files:**
- Modify: `scripts/validate-design-contract.mjs`
- Modify: `src/styles/tokens.css:172-222,272-283`
- Modify: `src/styles/components.css`, `grid.css`, `landing.css`, `login.css`, `mine.css`, `navigation.css`, `screens.css`

**Interfaces:**
- Produces `--pad-action-inline: 20px`, `--pad-action-compact-inline: 16px`, `--pad-card: 16px`, `--pad-mobile-inline: 20px`.
- Removes `--pad-action`, `--pad-action-compact`, `--pad-content` and raw `12px`/`20px` layout declarations.

- [ ] **Step 1: Extend the validator with a real declaration scan**

Insert this block before the final failure check:

```js
requireText("src/styles/tokens.css", [
  "--pad-action-inline: 20px;",
  "--pad-action-compact-inline: 16px;",
  "--pad-card: 16px;",
  "--pad-mobile-inline: 20px;",
]);
forbidPattern(styleFiles, /--pad-(?:action|action-compact|content)(?=\s*[:),;])/g);

const layoutDeclaration = /^\s*(?:gap|row-gap|column-gap|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)\s*:[^;]*(?:12|20)px[^;]*;/gm;
forbidPattern(styleFiles.filter((file) => file !== "src/styles/tokens.css"), layoutDeclaration);
for (const [token, evidence] of [
  ["--pad-action-inline", "toss"], ["--pad-action-compact-inline", "toss"],
  ["--pad-card", "toss"], ["--pad-mobile-inline", "local"],
]) requireTokenEvidence(token, evidence);
```

- [ ] **Step 2: Run the validator and confirm the existing layout declarations fail**

Run: `npm run validate:design-contract`

Expected: FAIL listing raw `12px` and `20px` gap/margin/padding declarations and old padding tokens.

- [ ] **Step 3: Split component geometry tokens and migrate consumers**

Define:

```css
--pad-action-inline: 20px;          /* [toss] */
--pad-action-compact-inline: 16px;  /* [toss] */
--pad-card: 16px;                   /* [toss] */
--pad-mobile-inline: 20px;          /* [local] */
```

Use `padding-inline` for action and mobile-inline geometry, and use `padding: var(--pad-card)` for cards. Remove the mobile reassignment of generic `--pad-content`.

- [ ] **Step 4: Apply the approved scale using this exact mapping**

```text
components.css
  .mr-textarea 12px 16px -> 8px 16px
  .mr-schedule__grid gap 12px -> 16px
  .mr-dialog__actions gap 12px -> 16px
  .mr-alert 12px 14px -> 8px 16px
  .mr-stepper gap 12px -> 8px
  .mr-picker__result 8px 12px -> 8px 16px
  .mr-stack gap 12px -> 16px
  .mr-row gap 12px -> 8px
  .mr-recur-fail__item 10px 12px -> 8px 16px

grid.css
  .grid-viewswitch__btn inline 20px -> var(--pad-action-inline)
  .grid-controlbar gap 8px 12px -> 8px; margin-bottom 12px -> 16px
  fine .grid-controlbar gap 8px 20px -> 8px 16px
  .grid-room-header 10px 12px and 8px 12px -> 8px
  resize handle margin-left -12px -> transform: translateX(-50%)
  .grid-mobile__schedule-head gap/margin 12px -> 8px
  small view switch inline 12px -> 16px
  .grid-deptselect__input 0 28px 0 12px -> 0 32px 0 16px

landing.css
  header/main inline 20px -> var(--pad-mobile-inline)
  preset/item/action-row gaps 12px -> 8px
  gap-card/gap-action/alert/today-title separations 12px -> 16px

login.css
  outer inline 20px and safe-area 20px -> var(--pad-mobile-inline)
  failure gap 12px -> 16px

mine.css
  first-section margin 20px -> 24px
  heading margins 12px -> 8px
  settings action gap 12px -> 8px

navigation.css and screens.css
  nav/sidebar inline 12px -> 16px
```

- [ ] **Step 5: Run the spacing contract check**

Run:

```bash
npm run validate:design-contract
rg -n --glob '*.css' '(gap|row-gap|column-gap|margin|padding)(-[a-z]+)?\s*:[^;]*(12px|20px)' src/styles
```

Expected: validator valid; `rg` exits 1 with no raw layout matches. Token declarations may still contain the permitted role-owned `20px` values because their property names are custom properties, not layout declarations.

- [ ] **Step 6: Commit the spacing reconciliation**

```bash
git add -- scripts/validate-design-contract.mjs src/styles/tokens.css src/styles/components.css src/styles/grid.css src/styles/landing.css src/styles/login.css src/styles/mine.css src/styles/navigation.css src/styles/screens.css
git commit -m "refactor: align MolRoom spacing with role geometry" -- scripts/validate-design-contract.mjs src/styles/tokens.css src/styles/components.css src/styles/grid.css src/styles/landing.css src/styles/login.css src/styles/mine.css src/styles/navigation.css src/styles/screens.css
git show --stat --oneline HEAD
```

Expected: exactly nine paths.

### Task 5: Canonical Examples, Live Visual QA, and Final Evidence

**Files:**
- Modify: `scripts/validate-design-contract.mjs`
- Modify: `docs/design-examples/examples.css`
- Modify binary screenshots: `docs/design-examples/screenshots/login-mobile.png`, `calendar-desktop.png`, `room-mobile.png`, `my-bookings-mobile.png`, `booking-dialog-desktop.png`
- Generate: `docs/design-examples/standalone/index.html`, `login.html`, `calendar.html`, `room.html`, `my-bookings.html`, `booking-dialog.html`
- Create locally, do not commit: `.codex-artifacts/molroom-c3/after/*.png`

**Interfaces:**
- Consumes: the product UI after Tasks 1–4 and the before captures from Task 0.
- Produces: checked-in canonical examples plus same-state before/after, keyboard, touch, and axe evidence.

- [ ] **Step 1: Extend the validator to cover canonical example roles**

Insert these exact checks before the final failure check:

```js
requireText("docs/design-examples/examples.css", [
  "--radius-action: 14px;",
  "--radius-action-mobile: 16px;",
  "--radius-input: 12px;",
  "--radius-filter: 12px;",
  "--radius-segment: 12px;",
  "--radius-nav-item: 12px;",
  "--radius-card: 16px;",
  "--radius-dialog: 20px;",
  "--radius-event-fine: 4px;",
  "--radius-event-touch: 12px;",
  "--color-now: #4E5968;",
]);
```

Run `npm run validate:design-contract`; expected FAIL until `examples.css` is aligned.

- [ ] **Step 2: Align canonical example CSS with production roles**

Add the checked tokens, make the desktop calendar use fine event/axis typography and `4px` event radius, make touch examples use `12px` event/input/filter/navigation radii, use `#4E5968` for current time, and replace ownership inset shadow with the same 4px pseudo-element language as production.

- [ ] **Step 3: Run pre-browser static checks**

Before load work, run the mandatory host/process gate. Then run:

```bash
npm run validate:design-contract
npm test -- src/screens/gridEventContent.test.ts
npm run typecheck
node scripts/validate-design-examples.mjs
```

Expected: all exit 0.

- [ ] **Step 4: Start one tracked server and validate the four C3 viewports**

Use the same states and viewport/input modes as Task 0. Verify visibly:

```text
1440×1000 fine: full 08:00–20:00 day, 30-minute organizer-only, 60-minute organizer+time
1440×1000 fine week: two rooms fit without horizontal scroll; one room omits the repeated second-level room header
1024×768 fine: every split week column >=76px and only the grid scrolls horizontally
1024×768 coarse: 44px slots, 14/20 event text, 12px event radius, touch activation
390×844 coarse: 12px inputs/filter/nav items, 44px targets, readable list and bottom sheet
all states: neutral now line; ownership stripe and focus ring visible at the same time
```

Exercise keyboard Tab/Enter/Space, touch emulation, focus visibility, and axe. Fix any C3 regression in the owning task’s files and repeat only the failed viewport.

- [ ] **Step 5: Capture after evidence and compare like-for-like**

Save after images under `.codex-artifacts/molroom-c3/after/`. Compare each before/after pair at the same viewport and state. Reject the result if the time grid clips, alignment shifts, touch text truncates, focus ring is obscured, or removal of generic tokens changes unrelated component roles.

- [ ] **Step 6: Refresh canonical screenshots from the verified states**

Write the five checked-in PNGs at their existing exact dimensions:

```text
login-mobile.png 390×844
calendar-desktop.png 1440×1000
room-mobile.png 390×844
my-bookings-mobile.png 390×844
booking-dialog-desktop.png 1440×1000
```

- [ ] **Step 7: Regenerate standalone output; never hand-edit it**

Run:

```bash
node scripts/build-design-standalone.mjs
node scripts/validate-design-examples.mjs
git diff --check -- docs/design-examples scripts/validate-design-contract.mjs
```

Expected: generator and validator exit 0; diff check is empty; generated changes are limited to the six standalone HTML files plus the intended source CSS/screenshots.

- [ ] **Step 8: Clean up every owned UI process**

TERM the recorded dev-server/browser PID trees, KILL only remaining recorded children if necessary, verify port `5183` closed, and confirm Node/browser/MCP signature counts returned to the Task 0 baseline.

- [ ] **Step 9: Commit canonical examples and evidence sources**

```bash
git add -- scripts/validate-design-contract.mjs docs/design-examples/examples.css docs/design-examples/screenshots/login-mobile.png docs/design-examples/screenshots/calendar-desktop.png docs/design-examples/screenshots/room-mobile.png docs/design-examples/screenshots/my-bookings-mobile.png docs/design-examples/screenshots/booking-dialog-desktop.png docs/design-examples/standalone/index.html docs/design-examples/standalone/login.html docs/design-examples/standalone/calendar.html docs/design-examples/standalone/room.html docs/design-examples/standalone/my-bookings.html docs/design-examples/standalone/booking-dialog.html
git commit -m "docs: refresh MolRoom C3 design evidence" -- scripts/validate-design-contract.mjs docs/design-examples/examples.css docs/design-examples/screenshots/login-mobile.png docs/design-examples/screenshots/calendar-desktop.png docs/design-examples/screenshots/room-mobile.png docs/design-examples/screenshots/my-bookings-mobile.png docs/design-examples/screenshots/booking-dialog-desktop.png docs/design-examples/standalone/index.html docs/design-examples/standalone/login.html docs/design-examples/standalone/calendar.html docs/design-examples/standalone/room.html docs/design-examples/standalone/my-bookings.html docs/design-examples/standalone/booking-dialog.html
git show --stat --oneline HEAD
```

Expected: only the validator, canonical source CSS, five screenshots, and six generated HTML files.

### Task 6: Final Contract Verification and Handoff

**Files:**
- No new product files unless a preceding narrow check exposes a C3 regression.

**Interfaces:**
- Consumes: all prior commits and Task 5 visual evidence.
- Produces: final proof that committed C3 behavior, source generation, and process cleanup agree.

- [ ] **Step 1: Verify the committed diff contains only the planned scope**

Run:

```bash
git log --oneline --max-count=6
git diff --name-only 56eb726..HEAD
git status --short
```

Expected: only plan-listed files belong to C3; other sessions’ unrelated dirty paths remain untouched.

- [ ] **Step 2: Run the minimal final proof after the host gate**

Run serially:

```bash
npm run validate:design-contract
npm test -- src/screens/gridEventContent.test.ts
npm run typecheck
node scripts/build-design-standalone.mjs
git diff --exit-code -- docs/design-examples/standalone
node scripts/validate-design-examples.mjs
```

Expected: every command exits 0 and regeneration leaves no diff. Do not run the full Vitest suite or full build unless a narrow failure shows cross-domain risk or the user asks for push/deploy readiness.

- [ ] **Step 3: Report evidence inline**

The completion message must include the contract values, exact narrow command results, changed-file/commit summary, four viewport findings, and the before/after image pairs inline. Also state the final port and owned-process cleanup result; do not make the user open a report file to see QA.
