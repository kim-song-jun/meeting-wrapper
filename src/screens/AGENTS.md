# SCREENS KNOWLEDGE BASE

## OVERVIEW

Route screens and booking-flow components. This is the React orchestration layer between shared UI, app contexts, domain helpers, and `repo`.

## WHERE TO LOOK

| Surface | File | Dependencies |
|---|---|---|
| Login | `LoginScreen.tsx` | Auth state machine and post-login redirect |
| Reservation calendar | `GridScreen.tsx` | Day/agenda/week/month, drag/keyboard flows |
| Booking form | `BookingDialog.tsx` | Attendees, recurrence, preferences |
| QR room | `RoomLandingScreen.tsx` | Availability, check-in, extension |
| My bookings | `MyBookingsScreen.tsx` | Mine/history/admin/settings |
| Partial recurrence | `RecurrenceResult.tsx` | Explicit rejected-occurrence reporting |

## CONVENTIONS

- Read root `DESIGN.md` in full before UI, styling, copy, or motion changes.
- Screens consume `repo`; they do not import adapter implementations.
- Keep scheduling calculations in `src/domain/`; screens coordinate state and render outcomes.
- Preserve explicit loading, error, empty, success, and disabled-reason states.
- Keep `BookingDialog` shared across grid and QR-room entry points.
- Recurring partial failures must remain visible until the user acknowledges them.
- `GridScreen.tsx` is a large orchestration hotspot; prefer local extraction only when it clarifies an existing flow.
- CSS lives in `src/styles/`; use existing tokens and surface classes.

## VISUAL CONTRACTS

- Validate real routes, not only static design examples.
- Check mobile (`390×844`), tablet (`1024×768`), and desktop (`1440×1000`) when responsive layout changes.
- Preserve the single-scroll-container rule on desktop grid screens and bottom-sheet dialogs on mobile.
- Do not reveal meeting titles inside booking grid cells.
- Use visible text alongside state color; opacity alone cannot communicate disabled state.

## ANTI-PATTERNS

- Do not add adapter-specific branching to a screen.
- Do not duplicate room-visibility or policy state locally.
- Do not hand-calculate grid pixels; use domain helpers and CSS geometry tokens.
- Do not hide async errors, recurrence rejections, or disabled reasons.
- Do not use deprecated Apple/MolCube design documents as current UI authority.

## COVERAGE NOTE

There is no React/jsdom test layer. Browser interaction and screenshot evidence are required for screen behavior; domain unit tests alone are insufficient.
