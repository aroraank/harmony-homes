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

### Next (v1.1 ideas)
- Weekly emailed backup (needs an email provider), resident transparency feed screen, multi-society onboarding wizard UI, native wrapper (TWA/Capacitor) if needed.
