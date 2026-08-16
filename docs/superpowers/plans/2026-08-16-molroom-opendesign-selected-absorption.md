# MolRoom Open Design Selected Absorption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved `/rooms` quick-booking hub, three-way navigation, and clearer page hierarchy while preserving every existing advanced booking flow.

**Architecture:** Keep availability math in a pure domain module, load the day once in a route-level screen, and hand selected room/time values to the existing `BookingDialog`. Add `/rooms` to the existing shell at all responsive breakpoints, then move only existing view controls to new page headers so calendar and booking behavior remain unchanged.

**Tech Stack:** React 19, TypeScript strict mode, React Router, Vite, Vitest, existing MolRoom CSS tokens/components, Playwright browser QA.

**Spec:** `docs/superpowers/specs/2026-08-16-molroom-opendesign-selected-absorption-design.md`

## Global Constraints

- Work on `main` in the shared working tree. Do not stash, switch branches, create a worktree, or use broad staging commands.
- Before every edit, run `git status --short -- <paths>` for the task-owned files. If another session has started modifying one of them, stop editing that file and report the overlap.
- Do not modify the pre-existing dirty files `src/components/ui.tsx`, `src/screens/BookingDialog.tsx`, `src/styles/components.css`, `src/styles/grid.css`, or `src/styles/tokens.css`.
- Read `DESIGN.md`, `src/domain/AGENTS.md`, and `src/screens/AGENTS.md` before implementation. Use only current tokens and public component contracts.
- Preserve the complete behavior list in spec §8. In particular, do not change grid geometry, drag/keyboard interactions, QR booking, recurrence, attendees, conference options, check-in/extend/end, admin cancellation, summaries, exports, or settings.
- Do not expose meeting titles or other organizers on `/rooms`. Today’s intervals are time-only occupancy text.
- There is no React/jsdom test layer. Do not add mock-only screen tests. Prove pure behavior with the adjacent Vitest test and prove route/UI behavior in the real browser.
- Before `npm test`, `npm run typecheck`, `npm run build`, or starting Vite, record `uptime`, CPU count/load, memory/swap, Node/browser process counts, Docker state, and any listener on port 5183. If the host is pressured, stop and report rather than adding load.
- Record every process started for this work as PID/PPID/command/port. At task end, terminate only those PIDs with TERM, wait briefly, use KILL only for surviving owned PIDs, and confirm process/listener counts returned to baseline.
- Stage and commit only the explicit task paths. After every commit, run `git show --stat --oneline HEAD` and confirm no unrelated path was captured.

---

### Task 1: Define and prove room availability

**Files:**
- Create: `src/domain/roomAvailability.test.ts`
- Create: `src/domain/roomAvailability.ts`

**Interfaces:**

```ts
export type RoomAvailabilityState = "free" | "busy" | "mine";

export interface QuickBookingOption {
  id: "30-minutes" | "60-minutes" | "until-boundary";
  label: string;
  start: Date;
  end: Date;
}

export interface RoomAvailability {
  state: RoomAvailabilityState;
  current: Booking | null;
  next: Booking | null;
  availableUntil: Date | null;
  options: QuickBookingOption[];
  unavailableReason: string | null;
}

export function deriveRoomAvailability(
  bookings: readonly Booking[],
  now: Date,
  policy: Policy,
): RoomAvailability;
```

- [ ] **Step 1: Write the failing contract tests**

Create a complete `Booking` factory and cover the boundaries that affect the UI:

```ts
import { describe, expect, it } from "vitest";
import { deriveRoomAvailability } from "./roomAvailability";
import type { Booking, Policy } from "./types";

const POLICY: Policy = {
  maxDurationMinutes: 240,
  maxAdvanceDays: 28,
  gridStartHour: 8,
  gridEndHour: 20,
  slotMinutes: 30,
  checkInGraceMinutes: 10,
  extendStepMinutes: 15,
  admins: ["admin@molcube.com"],
};

const at = (hour: number, minute = 0): Date => new Date(2026, 7, 16, hour, minute, 0, 0);

let sequence = 0;
function booking(
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  overrides: Partial<Booking> = {},
): Booking {
  sequence += 1;
  return {
    id: `booking-${sequence}`,
    roomId: "room-a",
    title: "비공개 회의",
    organizerName: "김몰룸",
    organizerEmail: "user@molcube.com",
    organizerDepartment: "제품팀",
    recurringEventId: null,
    start: at(startHour, startMinute),
    end: at(endHour, endMinute),
    headcount: 2,
    attendeeCount: 1,
    conference: null,
    checkedInAt: null,
    summary: null,
    isMine: false,
    ...overrides,
  };
}

describe("deriveRoomAvailability", () => {
  it("offers 30 minutes and a non-standard until-next boundary inside a 45-minute gap", () => {
    const result = deriveRoomAvailability([booking(10, 45, 11, 30)], at(10, 0), POLICY);

    expect(result.state).toBe("free");
    expect(result.next?.start).toEqual(at(10, 45));
    expect(result.availableUntil).toEqual(at(10, 45));
    expect(result.options.map((option) => [option.id, option.label])).toEqual([
      ["30-minutes", "30분"],
      ["until-boundary", "10:45까지"],
    ]);
  });

  it("offers 30 and 60 minutes but never exceeds the policy maximum", () => {
    const result = deriveRoomAvailability([], at(10, 0), {
      ...POLICY,
      gridEndHour: 15,
      maxDurationMinutes: 60,
    });

    expect(result.options.map((option) => option.id)).toEqual(["30-minutes", "60-minutes"]);
    expect(result.options.every((option) => option.end.getTime() <= at(11, 0).getTime())).toBe(true);
  });

  it("blocks quick booking while another person's meeting is active", () => {
    const result = deriveRoomAvailability([booking(9, 30, 10, 30)], at(10, 0), POLICY);

    expect(result.state).toBe("busy");
    expect(result.current?.end).toEqual(at(10, 30));
    expect(result.options).toEqual([]);
    expect(result.unavailableReason).toBe("10:30에 다시 확인해 주세요.");
  });

  it("distinguishes my active meeting without exposing presentation data", () => {
    const result = deriveRoomAvailability([booking(9, 30, 10, 30, { isMine: true })], at(10, 0), POLICY);

    expect(result.state).toBe("mine");
    expect(result.options).toEqual([]);
  });

  it("returns a visible reason instead of invalid choices after business hours", () => {
    const result = deriveRoomAvailability([], at(20, 0), POLICY);

    expect(result.state).toBe("free");
    expect(result.options).toEqual([]);
    expect(result.unavailableReason).toBe("오늘 예약 가능한 시간이 끝났어요.");
  });
});
```

- [ ] **Step 2: Run only the new test and observe RED**

After the host preflight, run:

```bash
npm test -- src/domain/roomAvailability.test.ts
```

Expected: failure because `roomAvailability.ts` and `deriveRoomAvailability` do not exist yet. Record that exact failure; do not run the full suite.

- [ ] **Step 3: Implement the pure calculation**

Implement with existing time helpers rather than duplicate overlap/gap logic:

```ts
import { currentBooking, hhmm, MINUTE, nextGap } from "./time";
import type { Booking, Policy } from "./types";

export type RoomAvailabilityState = "free" | "busy" | "mine";

export interface QuickBookingOption {
  id: "30-minutes" | "60-minutes" | "until-boundary";
  label: string;
  start: Date;
  end: Date;
}

export interface RoomAvailability {
  state: RoomAvailabilityState;
  current: Booking | null;
  next: Booking | null;
  availableUntil: Date | null;
  options: QuickBookingOption[];
  unavailableReason: string | null;
}

function atHour(day: Date, hour: number): Date {
  const value = new Date(day);
  value.setHours(hour, 0, 0, 0);
  return value;
}

function futureBooking(bookings: readonly Booking[], now: Date): Booking | null {
  return [...bookings]
    .filter((booking) => booking.start.getTime() > now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;
}

function buildOptions(start: Date, end: Date, policy: Policy): QuickBookingOption[] {
  const availableMinutes = Math.floor((end.getTime() - start.getTime()) / MINUTE);
  const options: QuickBookingOption[] = [];

  if (availableMinutes >= 30 && policy.slotMinutes <= 30 && policy.maxDurationMinutes >= 30) {
    options.push({ id: "30-minutes", label: "30분", start, end: new Date(start.getTime() + 30 * MINUTE) });
  }
  if (availableMinutes >= 60 && policy.slotMinutes <= 60 && policy.maxDurationMinutes >= 60) {
    options.push({ id: "60-minutes", label: "1시간", start, end: new Date(start.getTime() + 60 * MINUTE) });
  }
  if (
    availableMinutes > Math.max(30, policy.slotMinutes) &&
    availableMinutes !== 60 &&
    availableMinutes <= policy.maxDurationMinutes
  ) {
    options.push({ id: "until-boundary", label: `${hhmm(end)}까지`, start, end });
  }

  return options;
}

export function deriveRoomAvailability(
  bookings: readonly Booking[],
  now: Date,
  policy: Policy,
): RoomAvailability {
  const active = currentBooking(bookings, now);
  const next = futureBooking(bookings, now);

  if (active) {
    return {
      state: active.isMine ? "mine" : "busy",
      current: active,
      next,
      availableUntil: null,
      options: [],
      unavailableReason: `${hhmm(active.end)}에 다시 확인해 주세요.`,
    };
  }

  const businessStart = atHour(now, policy.gridStartHour);
  const businessEnd = atHour(now, policy.gridEndHour);
  if (now.getTime() >= businessEnd.getTime()) {
    return {
      state: "free",
      current: null,
      next,
      availableUntil: null,
      options: [],
      unavailableReason: "오늘 예약 가능한 시간이 끝났어요.",
    };
  }

  const candidateStart = now.getTime() < businessStart.getTime() ? businessStart : now;
  const gap = nextGap(bookings, candidateStart, businessEnd);
  if (!gap || gap.start.getTime() > candidateStart.getTime()) {
    return {
      state: "free",
      current: null,
      next,
      availableUntil: null,
      options: [],
      unavailableReason: "지금 선택할 수 있는 시간이 없어요.",
    };
  }

  const options = buildOptions(candidateStart, gap.end, policy);
  return {
    state: "free",
    current: null,
    next,
    availableUntil: gap.end,
    options,
    unavailableReason: options.length === 0 ? "30분 이상 비어 있는 시간을 기다려 주세요." : null,
  };
}
```

The copied sort in `futureBooking`, `currentBooking`, and `nextGap` preserves inputs. The returned booking objects are calculation results only; the screen must never render title/organizer fields.

- [ ] **Step 4: Run the focused test and observe GREEN**

```bash
npm test -- src/domain/roomAvailability.test.ts
```

Expected: all new availability tests pass with one Vitest worker.

- [ ] **Step 5: Commit the domain contract**

```bash
git add src/domain/roomAvailability.ts src/domain/roomAvailability.test.ts
git commit -m "feat: derive room quick-booking availability" -- src/domain/roomAvailability.ts src/domain/roomAvailability.test.ts
git show --stat --oneline HEAD
```

---

### Task 2: Build the `/rooms` quick-booking hub

**Files:**
- Create: `src/screens/RoomsScreen.tsx`
- Create: `src/styles/rooms.css`

**Interfaces and state:**

```ts
interface RoomsData {
  bookings: Booking[];
  prefs: UserPrefs;
}

interface SelectedTime {
  roomId: string;
  option: QuickBookingOption;
}
```

- [ ] **Step 1: Guard file ownership and scaffold one data request**

Use one `useAsync` call so each refresh issues exactly one `repo.listByDay(today)` call while also loading shared dialog preferences:

```ts
const todayRef = useRef(appNow());
const state = useAsync<RoomsData>(async () => {
  const [bookings, prefs] = await Promise.all([
    repo.listByDay(todayRef.current),
    repo.getPrefs(),
  ]);
  return { bookings, prefs };
}, []);
```

Keep `selectedTime`, `dialogSlot`, and an `aria-live` announcement in local state. Group `state.data.bookings` into a `Map<string, Booking[]>` once with `useMemo`; do not call the repository from a card.

- [ ] **Step 2: Implement complete async states**

Render these states without silent fallback:

- First load (`data === null && loading`): `role="status"` with `회의실 상태를 불러오는 중…`.
- First failure (`data === null && error`): existing `Alert` plus a `secondary` `다시 불러오기` button wired to `state.reload`.
- Refresh (`data !== null && loading`): keep cards visible and announce `최신 상태를 확인하는 중…`.
- Refresh failure (`data !== null && error`): keep cards visible and show `표시된 상태가 최신이 아닐 수 있어요. 다시 불러와 주세요.` with retry.
- Successful booking: close the dialog, announce the room/time result, clear the selection, and call `state.reload()`.

- [ ] **Step 3: Render the approved page header and privacy-safe room cards**

Use the approved copy exactly:

```tsx
<header className="mr-page-head rooms-head">
  <div>
    <h1 className="t-title mr-page-head__title">어느 방을 사용할까요?</h1>
    <p className="mr-page-head__description">
      지금 상태와 다음 예약을 비교하고, 가능한 시간을 골라보세요.
    </p>
  </div>
  <Link className="mr-page-action" to="/">전체 일정 보기</Link>
</header>
```

For every configured `ROOMS` entry:

- Render name and floor.
- Map `free`, `busy`, and `mine` to the exact status sentences from the spec.
- Render only the next start time or `오늘 남은 시간은 모두 비어 있어요.`.
- Render today’s occupied intervals as `${hhmm(start)}–${hhmm(end)} 예약됨`; never render `title`, `organizerName`, or `organizerEmail`.
- Render option buttons as one `role="group"` labelled with the room name. Each button uses `aria-pressed`, visible selected styling, and a minimum 44px target.
- Use `<Button variant="secondary">이 시간 예약하기</Button>` so every repeated action uses the existing Weak pair.
- If no time is selected or booking is blocked, disable the action and keep the reason visible next to it.

- [ ] **Step 4: Reuse the full booking dialog**

Render the existing component unchanged:

```tsx
{dialogSlot && state.data ? (
  <BookingDialog
    roomId={dialogSlot.roomId}
    start={dialogSlot.option.start}
    end={dialogSlot.option.end}
    prefs={state.data.prefs}
    onClose={() => setDialogSlot(null)}
    onCreated={(booking) => {
      setDialogSlot(null);
      setSelectedTime(null);
      setAnnouncement(`${roomById(booking.roomId)?.name ?? "회의실"} 예약을 만들었어요.`);
      state.reload();
    }}
  />
) : null}
```

Do not add a quick-save repository method or duplicate title/headcount/attendee/recurrence/conference fields.

- [ ] **Step 5: Add token-only responsive styling**

In `rooms.css`:

- Use a two-column card grid where width permits and one column on narrow screens.
- Use white cards, `1px solid var(--c-border)`, 16px radius from the existing radius token, no shadow, no blur, no glass.
- Keep status text at Body or Small token size; no 11–13px primary UI.
- Style time choices with surface/Weak states and visible focus.
- Preserve 44px touch targets and remove press transforms under `prefers-reduced-motion`.
- Keep cards’ action rows aligned without forcing equal heights that create large empty areas.

- [ ] **Step 6: Typecheck the screen in the shared tree**

After the host preflight:

```bash
npm run typecheck
```

Expected: strict TypeScript passes. If an error comes from a pre-existing dirty file, isolate it with the exact path and error before deciding whether it is baseline; do not edit that file.

- [ ] **Step 7: Commit the route screen**

```bash
git add src/screens/RoomsScreen.tsx src/styles/rooms.css
git commit -m "feat: add room quick-booking hub" -- src/screens/RoomsScreen.tsx src/styles/rooms.css
git show --stat --oneline HEAD
```

---

### Task 3: Add `/rooms` and three-way responsive navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles/navigation.css`

- [ ] **Step 1: Add the authenticated route without changing existing paths**

Import `RoomsScreen` and add this sibling route between `/` and `/me`:

```tsx
<Route
  path="/rooms"
  element={
    <RequireAuth>
      <Shell>
        <RoomsScreen />
      </Shell>
    </RequireAuth>
  }
/>
```

Keep `/`, `/me`, `/r/:roomId`, `/login`, and the catch-all behavior unchanged.

- [ ] **Step 2: Add the middle destination to all three navigation surfaces**

Use the fixed order `예약 현황 · 회의실 · 내 예약` in `Sidebar`, the tablet app bar, and `MobileNavigation`:

```tsx
<NavLink to="/rooms" className="mr-mobile-nav__item">
  회의실
</NavLink>
```

Use the matching existing class for each surface. `NavLink` supplies `aria-current="page"`; keep `end` only on `/` so `/rooms` does not activate the calendar link.

- [ ] **Step 3: Rebalance the mobile and tablet navigation**

Update only `navigation.css`:

- Change the mobile grid to `repeat(3, minmax(0, 1fr))`.
- Keep every item at least 44px high and allow Korean labels to fit without clipping.
- Keep the tablet three-link cluster inside the app bar at 768–1023px.
- Preserve Weak active fill, focus ring, and reduced-motion behavior.
- Update stale comments that say “two destinations” so documentation matches the code.

- [ ] **Step 4: Perform a narrow route/type check**

After the host preflight, run `npm run typecheck` once. Confirm there are no missing imports or route element errors.

- [ ] **Step 5: Commit route and navigation together**

```bash
git add src/App.tsx src/styles/navigation.css
git commit -m "feat: add three-way room navigation" -- src/App.tsx src/styles/navigation.css
git show --stat --oneline HEAD
```

---

### Task 4: Clarify page hierarchy without changing advanced controls

**Files:**
- Modify: `src/screens/GridScreen.tsx`
- Modify: `src/screens/MyBookingsScreen.tsx`
- Modify: `src/styles/screens.css`
- Modify: `src/styles/mine.css`

- [ ] **Step 1: Add the calendar page header**

Insert above `.grid-controlbar`:

```tsx
<header className="mr-page-head mr-page-head--pane">
  <div>
    <h1 className="t-title mr-page-head__title">예약 현황</h1>
    <p className="mr-page-head__description">
      빈 시간을 골라 예약하고, 내 예약은 바로 바꿀 수 있어요.
    </p>
  </div>
  <div className="mr-page-head__controls">
    {view === "day" || view === "agenda" ? (
      <Segmented
        items={DAY_MODES}
        active={view === "agenda" ? "agenda" : "day"}
        onChange={setView}
        label="표시 방식"
        small
      />
    ) : null}
    <Segmented
      items={RANGE_TABS}
      active={view === "agenda" ? "day" : view}
      onChange={(id) => setView(id === "day" && view === "agenda" ? "agenda" : id)}
      label="기간 전환"
    />
  </div>
</header>
```

Move the existing day/agenda `Segmented` and range `Segmented` JSX verbatim from `.grid-controlbar__right` into `mr-page-head__controls`. Do not change `DAY_MODES`, `RANGE_TABS`, `view`, or their callbacks. Leave date, room visibility, department, grid, hints, and all drag/keyboard handlers in place.

- [ ] **Step 2: Add the My Bookings page header**

Replace only the current title/user block with:

```tsx
<header className="mr-page-head mine-head">
  <div>
    <h1 className="t-title mine-title">내 예약</h1>
    <p className="mr-page-head__description">
      다가오는 회의를 확인하고 변경하거나 취소할 수 있어요.
    </p>
    <p className="mine-user t-small t-muted">
      {user.name} · {user.email}{user.isAdmin ? " · 관리자" : ""}
    </p>
  </div>
  <Link className="mr-page-action" to="/rooms">새 예약</Link>
</header>
```

Do not alter tab IDs, tab filtering, list fetches, card actions, admin behavior, summary/export behavior, or settings.

- [ ] **Step 3: Add shared hierarchy styles and screen-specific spacing**

In `screens.css`, define shared `.mr-page-head`, title, description, controls, and Weak link styles with existing tokens. In `mine.css`, adjust only the page-header/user/tabs spacing required after the reflow.

Responsive requirements:

- Desktop: title/description left, page action or view switch right.
- Tablet 1024×768: no collision with the shell and three-link navigation.
- Mobile: one-column header, description remains visible, action aligns without pushing the first meaningful content excessively far down.
- Pane mode: the calendar remains one viewport-high shell with the existing inner grid as the only scroll container.

- [ ] **Step 4: Verify structure and types once**

After the host preflight, run `npm run typecheck`. Also run targeted searches to prove advanced controls remain present:

```bash
rg -n "DAY_MODES|RANGE_TABS|onGridKeyDown|onPointerDown|BookingDialog|roomVisibility" src/screens/GridScreen.tsx
rg -n "MineTab|PastTab|AllTab|SettingsTab|summaryToMarkdown|CancelDialog" src/screens/MyBookingsScreen.tsx
```

- [ ] **Step 5: Commit the hierarchy change**

```bash
git add src/screens/GridScreen.tsx src/screens/MyBookingsScreen.tsx src/styles/screens.css src/styles/mine.css
git commit -m "feat: clarify booking page hierarchy" -- src/screens/GridScreen.tsx src/screens/MyBookingsScreen.tsx src/styles/screens.css src/styles/mine.css
git show --stat --oneline HEAD
```

---

### Task 5: Validate the committed product and real responsive flows

**Files:**
- Verify: all task-owned files and commits
- Create only temporary QA artifacts outside tracked product paths

- [ ] **Step 1: Run the required host/process preflight**

Record:

```bash
uptime
sysctl -n hw.ncpu
vm_stat
sysctl vm.swapusage
ps -Ao pid,ppid,lstart,rss,command | rg "node|vite|playwright|Chromium|Google Chrome"
docker info
lsof -nP -iTCP:5183 -sTCP:LISTEN
```

Treat an unavailable Docker daemon as environment state, not an app failure. Do not kill processes that were already present.

- [ ] **Step 2: Run the minimum automated evidence**

Run serially, not in parallel:

```bash
npm test -- src/domain/roomAvailability.test.ts
npm run typecheck
```

Then verify the committed tree, not the shared uncommitted working tree:

```bash
molroom_qa_dir="$(mktemp -d -t molroom-commit-build.XXXXXX)"
git archive HEAD | tar -x -C "$molroom_qa_dir"
ln -s "/Users/sungjun/Dev/projects/meeting-room/node_modules" "$molroom_qa_dir/node_modules"
(cd "$molroom_qa_dir" && npm run build)
case "$molroom_qa_dir" in
  /var/folders/*/molroom-commit-build.*|/tmp/molroom-commit-build.*) rm -rf "$molroom_qa_dir" ;;
  *) echo "Unexpected temp path; leave it in place: $molroom_qa_dir" >&2; exit 1 ;;
esac
```

Expected: focused tests, strict typecheck, and committed-tree build all pass.

- [ ] **Step 3: Start one owned Vite process and record it**

Start Vite on port 5183 only if no listener exists. Record shell PID, Vite PID/PPID, command, port, start time, and the pre-start Node/browser counts. Keep this one server for the complete browser pass.

- [ ] **Step 4: Capture required real-route screenshots**

Use Playwright against the real app and inspect each image, not only element presence:

- 1440×1000: `/`, `/rooms`, `/me`.
- 1024×768: shell/navigation and `/rooms` to cover the tablet breakpoint required by `src/screens/AGENTS.md`.
- 390×844: three-way bottom navigation, `/rooms`, and the opened `BookingDialog`.

Check alignment, visual weight, wrapping, card balance, no horizontal overflow, touch targets, the calendar’s single-scroll-container rule, and no title/organizer disclosure on `/rooms`.

- [ ] **Step 5: Exercise the core and keyboard flows**

Core flow:

1. Enter `/rooms`.
2. Choose a room and an available time.
3. Open `BookingDialog`.
4. Fill and save a real mock-adapter booking.
5. Confirm the dialog closes, the live message announces success, and the room card refreshes.

Keyboard flow:

1. Navigate through the three destinations.
2. Tab to a time option, select it, and open the dialog.
3. Close with Escape and confirm focus returns to the opener.
4. Reopen and complete the booking without a pointer.

Regression spot-check:

- On `/`, switch day/agenda/week/month and confirm existing controls remain available.
- On `/me`, visit every visible tab and confirm existing actions remain available.
- Open `/r/:roomId` and confirm the QR landing remains shell-free and functional.

- [ ] **Step 6: Compare against design intent**

Place current captures next to the approved Open Design reference and record each intentional difference as one of:

- required by `DESIGN.md` (real MolCube mark, token typography, no shadows/glass), or
- required to preserve advanced product behavior.

Fail the QA if the temporary MR logo, shadow/glass treatment, 11–13px primary controls, fake undo, or hidden existing functionality appears.

- [ ] **Step 7: Clean owned processes and verify the final diff**

Terminate only the recorded Vite/Playwright process tree, confirm port 5183 and process counts returned to baseline, then run:

```bash
git status --short
git diff --check HEAD~4..HEAD
git log -4 --oneline --stat
```

Confirm only the explicit task-owned files were committed and all pre-existing unrelated working-tree changes remain untouched.

- [ ] **Step 8: Report evidence inline**

The completion message must include the focused test/typecheck/build results, screenshots inline for desktop/tablet/mobile, the core-flow and keyboard-flow outcomes, preserved-feature spot checks, and process cleanup status. Do not make the user open a report file to see the evidence.
