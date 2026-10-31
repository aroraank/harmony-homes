# Progress

_Last updated: 8 Oct 2026_

## Status: v1 (Days 1–4) built and tested locally — ready for Supabase + Netlify setup

### Done
- **Database** (`supabase/migrations`): multi-tenant schema, RLS on every table, immutable ledger (trigger + grants), reversal-only corrections, due allocations (FIFO, advance carry-forward), gap-free FY receipt numbers, events with expected payers and rounding, month closing/reopen, payment claims, recurring expense drafts, notices + receipts, concerns (private views), contacts, reminders, alerts, failed-login tracking, append-only hash-chained audit log + verify, storage bucket + policies, permission table, daily job function.
- **Tests:** `supabase/tests/database.test.sql` — 23 groups (cross-society isolation, residents cannot write or call admin RPCs, idempotent dues, advance auto-settle, duplicate UTR, reversal rules, ledger immutability for owner, balance = funds = hand calc, shortfall line, 18/3 event split, claims, concerns privacy, notices + no location in audit, closed months, audit chain, super-admin rules, storage, anon access, reports). Shared Vitest suite (19), web Vitest (5), Playwright happy path.
- **Edge Functions:** `admin-users` (bulk logins + slips, reset password, staff logins, approve registration), `account` (self-registration, password change), `push-dispatch` (Web Push via VAPID).
- **Web app:** all resident and admin screens, PWA + offline cache, push, Hindi/English, light/dark, PDF/CSV exports, receipts with QR verification.
- Verified end to end against a local Auth + PostgREST + Functions stack at 390×844 (login, bulk logins, dues, payments, expenses, events, notices + acknowledgement gate, UPI pay + claim, approval → receipt PDF, concerns, audit chain). Lighthouse (login, mobile): performance 94, accessibility 100.

### You need to do (see README → Deploy)
1. Create the Supabase project, `supabase db push`, run `seed.sql`, turn off email sign-ups.
2. Create the admin auth user and run `bootstrap.sql`.
3. Generate VAPID keys, set function secrets, deploy the 3 functions, run `cron.sql`.
4. Create the Netlify site with the 4 `VITE_*` env vars.
5. In the app: UPI details + QR, opening balance, create logins, print slips.

### Added 17 Oct 2026 — vehicles + gate panel
- **Migration** `supabase/migrations/20261017000001_vehicles_and_gate.sql`: `vehicles` (each flat's own
  cars/scooters, readable by every member), `gate_visits` (guest vehicles IN/OUT, auto-purged after
  `society_settings.visitor_log_retention_days`, default 15), `guards` (gate logins that are **not**
  memberships, so a guard can read nothing else), plus the `gate_*`, vehicle and `visitor_log` RPCs.
- **Edge function** `admin-users`: new `create_guard` and `reset_guard_password` actions.
- **Web:** `/vehicles` (directory + my vehicles + one-time popup), `/admin/visitors` (filterable guest log
  with CSV), `/admin/gate-logins`, and a standalone big-button gate screen shown automatically when a gate
  login signs in.
- To deploy: `supabase db push`, then redeploy the `admin-users` function.

### Added 21 Oct 2026 — visitor log time-of-day filter
- **Migration** `supabase/migrations/20261021000001_visitor_log_time_filter.sql`: `visitor_log()` now also
  takes `p_time_from`/`p_time_to` ('HH:MM'), so admins can see which guest vehicles were inside the society
  during a clock-time window (e.g. 2 PM–4 PM) within the selected date range, on top of the existing
  date-range + stay-duration filtering. The old 6-argument overload is dropped so there's only one signature.
- **Web:** `/admin/visitors` gets two time pickers under the existing date/flat/plate/status filters; the
  "stayed how long" badge now always shows the real duration (min / h m / d h) instead of collapsing to
  "Gone out" past 10 hours.
- To deploy: `supabase db push` (safe to re-run; same idempotent pattern as before), no function redeploy needed.

### Added 21 Oct 2026 — vehicle type at the gate + clearer in/out times
- **Migration** `supabase/migrations/20261021000002_gate_vehicle_kind.sql`: `gate_visits` gets a `kind`
  column (car/bike/scooter/truck/other). `gate_check_in` takes a new `p_kind`; `gate_lookup`, `gate_board`
  and `visitor_log` all return it.
- **Web — gate screen:** the guard taps a vehicle-type icon (no typing/dropdown) when marking a guest IN;
  "Inside now" and "Already inside" show that icon, the full date + 12-hour AM/PM time, and a live,
  ticking "Inside Xh Ym" counter that keeps counting across shifts — a vehicle marked in yesterday and
  still open today just shows a bigger number, so the guard can tell at a glance whether to check on it.
- **Web — visitor log:** same vehicle-type icon per row, and times switched from 24-hour to 12-hour AM/PM
  (date was already shown).
- To deploy: `supabase db push`, no function redeploy needed.

### Fixed 21 Oct 2026 — vehicle type wasn't visible on the gate screen
The icon-only badge from the previous change was silent for any entry with no type recorded (including
every entry made before this feature existed) and, even when set, bike and scooter shared one icon shape
with only colour to tell them apart — not readable at a glance. Replaced it everywhere (gate screen,
visitor log) with a single shared `VehicleKindChip` component: a coloured pill with both an icon and the
word itself ("Car", "Bike", "Scooter", "Truck", "Other"), and an explicit "Type not noted" pill for older
entries so the slot is never blank. Moved the chip to its own line above the plate number on every card so
it's the first thing read, not a small corner icon. No migration needed — purely a frontend change.

### Fixed 21 Oct 2026 — "Inside now" card layout on the gate screen
Reworked just that one list per feedback: a big vehicle-type tile (icon + word, e.g. "Car") now sits on
the left, with the plate number and flat on the same first line beside it, the date/time on the line
below, and the live elapsed counter under that — easier to scan at a glance than the earlier small pill
above the plate. Added `VehicleKindTile` next to the existing `VehicleKindChip` in
`components/VehicleKindChip.tsx`; the "Already inside" card, "Went out recently" list and the visitor log
keep the smaller pill, which was already fine. No migration needed.

### Fixed 21 Oct 2026 — untyped guest entries now flagged, not just labelled
A guest vehicle whose type was never recorded now shows as "Other" with an amber alert icon (⚠), not a
neutral grey "Type not noted" — it's meant to catch the eye, since a gate entry with no vehicle type is
itself worth a second look. Guard-chosen "Other" keeps its original quiet grey "…" styling; only the
unrecorded case got the stronger treatment. One change, in `components/VehicleKindChip.tsx`.

### Next (v1.1 ideas)
- Weekly emailed backup (needs an email provider), resident transparency feed screen, multi-society onboarding wizard UI, native wrapper (TWA/Capacitor) if needed.

## 2026-10-31
- Redesigned the one-time "add your vehicle" popup (`VehiclePrompt.tsx`) as a vibrant, interactive announcement: full-bleed `.hero-gradient` header band with a pop-in animated vehicle icon badge, decorative faded icons, single big `hero`-styled CTA button that navigates straight to the Add Vehicle page, and a quiet "Maybe later" dismiss. No backend/RPC changes — reuses the existing `my_vehicle_prompt` / `dismiss_vehicle_prompt` show-once logic. Added matching Hindi translations.
- Added a warm "Namaste, {name}! 🙏 Welcome back" toast for members returning to the app after 3+ days away (`WelcomeBackToast.tsx`, wired into `AppShell.tsx`). Purely client-side — compares this device's last-visit timestamp in localStorage, no backend changes. Doesn't interfere with the existing one-time `WelcomeDialog` shown on a brand-new member's first-ever login. Hindi translations added.

## 2026-10-31 (cont.)
- Fixed VehiclePrompt popup staying visibly open after clicking a button — it now closes instantly (local state) instead of waiting on the dismiss RPC/cache round trip.
- Changed WelcomeBackToast from a 3-day-gap nudge to a simple every-app-open greeting, running as a limited campaign through 2026-12-31 (hardcoded cutoff), after which it stops firing automatically.
- "Add my vehicle" in the popup now navigates to /vehicles AND opens the add-vehicle form automatically (passed via router nav state, consumed once on VehiclesPage mount then cleared) — no second click needed.

## 2026-10-31 (cont. 2)
- Slimmed the home screen's quick-actions grid from 9 tiles to the 4 most-used: My dues, My vehicles, Ledger, Society position. Pay/mark paid is unaffected — it already has its own prominent button on the "My flat" card. The other 4 (Meetings, Events, Profile, Raise a concern) moved to the Menu/More page — Meetings, Profile and Concerns were already there; added an "Events" tile to the Society section so nothing was lost.
