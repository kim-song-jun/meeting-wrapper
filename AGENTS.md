## Design System

**Before any UI, styling, copy, or motion change, open and read `./DESIGN.md` in full.** It is the authoritative brand/design spec. Treat its tokens, voice, and component rules as binding unless the user overrides in chat.

# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-29
**Commit:** d6b02f6
**Branch:** main

## OVERVIEW

MolRoom is a static React 19 + TypeScript + Vite meeting-room booking SPA. Runtime auth and bookings currently use in-browser mock adapters; the intended Google Workspace integration has no server, database, or application secrets.

## STRUCTURE

```text
src/
├── main.tsx          # React root, router, room-visibility provider
├── App.tsx           # Auth provider, routes, responsive shell/navigation
├── app/              # Runtime config composition, shared async/context state
├── auth/             # Session state, route guard, mock auth seam
├── components/       # Shared UI primitives
├── config/           # Rooms, teams, policy, shared mock identity
├── data/             # BookingRepository contract and current adapter
├── domain/           # Pure booking/time/recurrence/export rules
├── screens/          # Route screens and booking flow components
└── styles/           # Tokens, shared CSS, screen-specific CSS
docs/design-examples/ # Canonical static examples + checked-in standalone output
scripts/              # Design example generator and validator
```

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Startup/providers | `src/main.tsx` | `BrowserRouter` → `RoomVisibilityProvider` → `App` |
| Routes/shell | `src/App.tsx` | `/login`, `/r/:roomId`, `/`, `/me` |
| Auth behavior | `src/auth/` | `mockAuthAdapter` uses `sessionStorage` |
| Booking data | `src/data/` | UI imports only the singleton `repo` |
| Scheduling rules | `src/domain/time.ts` | Grid math, overlap, extend/reschedule checks |
| Recurrence | `src/domain/recurrence.ts` | Expansion and Google RRULE parity |
| Booking policy | `src/config/policy.json` | Duration, advance window, grid, check-in |
| Shared identity | `src/config/currentUser.ts` | Auth and booking mocks must agree |
| UI tokens | `src/styles/tokens.css` | Preserve `toss`/`logo`/`local`/`a11y` evidence tags |
| Full product spec | `docs/superpowers/specs/2026-07-26-molroom-design.md` | Architecture, flows, security, spike tests |

## CODE MAP

| Symbol | Type | Location | Role |
|---|---|---|---|
| `App` | component | `src/App.tsx` | Route table and application shell |
| `AuthProvider` | context | `src/auth/AuthProvider.tsx` | Session restore/sign-in/sign-out |
| `RequireAuth` | guard | `src/auth/RequireAuth.tsx` | Preserves requested route through login |
| `repo` | singleton | `src/data/index.ts` | One-line adapter selection point |
| `BookingRepository` | interface | `src/data/BookingRepository.ts` | Sole UI/data contract |
| `mockAdapter` | repository | `src/data/mockAdapter.ts` | Seeded in-memory implementation |
| `GridScreen` | component | `src/screens/GridScreen.tsx` | Calendar views and booking mutations |
| `BookingDialog` | component | `src/screens/BookingDialog.tsx` | Create/recurrence/preferences flow |
| `placeInGrid` | pure function | `src/domain/time.ts` | CSS-aligned event geometry |
| `expandRecurrence` | pure function | `src/domain/recurrence.ts` | Occurrence expansion before booking |

## CONVENTIONS

- TypeScript is strict with unused checks, unchecked-index protection, and exact optional properties.
- Keep screens independent of adapter details. Extend `BookingRepository`, implement the adapter, then consume through `repo`.
- Keep scheduling and recurrence calculations pure and covered by adjacent Vitest tests.
- Use `placeInGrid()` and tokenized grid geometry; never hand-calculate event pixels in screens.
- Treat `policy.json`, `currentUser.ts`, and `tokens.css` as their domains' single sources of truth.
- `useAsync` preserves previous data during reload and surfaces errors; do not replace this with silent catches.
- Current tests run in Node and include only `src/**/*.test.ts`; they do not validate React or browser interactions.

## PROJECT ANTI-PATTERNS

- Do not treat `VITE_ALLOWED_HD` or client-side validation as authorization. Google permissions are the security boundary.
- Do not assume recurring booking is atomic. Partial success is normal and rejected occurrences must be shown.
- Do not switch from mock adapters until the integration spikes listed in `README.md` are resolved.
- Do not copy current UI rules from `DESIGN_DEPRECATED*.md`; those files are historical evidence only.
- Do not hand-edit `docs/design-examples/standalone/`; regenerate it with the script.
- Do not commit `.env`, `.playwright-mcp/`, `dist/`, or `.insane-review/`.

## COMMANDS

```bash
npm run dev                         # Vite on port 5183
npm run typecheck
npm test
npm run build
node scripts/build-design-standalone.mjs
node scripts/validate-design-examples.mjs
```

## NOTES

- `src/screens/GridScreen.tsx`, `src/screens/MyBookingsScreen.tsx`, and `src/data/mockAdapter.ts` are the main complexity hotspots.
- CI regenerates standalone design examples and requires a clean diff before validation.
- UI changes require live browser checks; unit tests cover domain rules only.
