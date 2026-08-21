# DOMAIN KNOWLEDGE BASE

## OVERVIEW

Pure scheduling, recurrence, booking-shape, and summary-export logic. Keep this directory independent of React, repositories, and browser state.

## WHERE TO LOOK

| Task | File | Contract |
|---|---|---|
| Shared entities | `types.ts` | `Booking`, `BookingDraft`, rooms, policy, recurrence types |
| Grid/time math | `time.ts` | Overlap, placement, slot math, extension/reschedule rules |
| Recurrence | `recurrence.ts` | Occurrence expansion, RRULE generation, display labels |
| Summary export | `summaryExport.ts` | Markdown copied to external tools |
| Behavior evidence | `*.test.ts` | Node/Vitest pure-function contracts |

## CONVENTIONS

- Functions accept explicit `Date`/policy inputs; do not read UI state, storage, or the repository.
- Preserve the distinction between headcount and attendee count.
- Keep room capacity absent unless product policy changes; current rooms have no capacity constraint.
- Recurrence expansion and generated RRULE must describe the same dates.
- Enforce `MAX_OCCURRENCES` and advance-window rules before adapter calls.
- Use `placeInGrid()` and slot helpers as the only source of event geometry.
- Add the narrowest adjacent test for changed boundary behavior.

## ANTI-PATTERNS

- Do not use browser-side validation as authorization.
- Do not mutate input bookings or dates; return new values.
- Do not expose meeting titles in grid-oriented helpers.
- Do not collapse recurrence results to a boolean; per-occurrence outcomes matter.
- Do not move data fetching, React hooks, or presentation copy into this directory.

## TEST COMMAND

```bash
npm test -- src/domain/<file>.test.ts
```
