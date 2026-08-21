# DATA KNOWLEDGE BASE

## OVERVIEW

The booking persistence boundary. `BookingRepository` is the stable UI contract; `mockAdapter` is the current seeded, in-memory implementation.

## WHERE TO LOOK

| Task | File | Notes |
|---|---|---|
| Contract change | `BookingRepository.ts` | Update result/error shapes here first |
| Adapter selection | `index.ts` | Screens import only `repo` from here |
| Mock behavior | `mockAdapter.ts` | CRUD, conflicts, recurrence, prefs, directory |

## CONVENTIONS

- Keep all adapters behaviorally compatible with `BookingRepository`.
- Return cloned bookings and `Date` values so consumers cannot mutate the store indirectly.
- Reuse domain overlap, recurrence, and time-policy helpers; do not duplicate scheduling rules.
- Source mock user identity from `src/config/currentUser.ts` so auth and ownership never drift.
- Preserve deterministic failure triggers documented in `README.md`.
- Recurring creation returns booked and rejected occurrences; partial success is expected.
- Surface meaningful `Error` messages to `useAsync` and screen-level recovery UI.

## ANTI-PATTERNS

- Do not import screen or component modules.
- Do not make `index.ts` contain adapter logic; it is only the composition seam.
- Do not silently swallow repository failures or convert all failures to empty results.
- Do not assume a successful recurring API call means every room occurrence accepted.
- Do not persist application secrets or treat client configuration as access control.

## COVERAGE NOTE

`src/data/mockAdapter.test.ts` is the existing focused repository contract test. Repository behavior changes must extend it for conflict, recurrence, cancellation, or ownership behavior.
