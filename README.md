# Harmony Homes

A mobile-first Progressive Web App for running a residential society's common funds in India: dues, payments, expenses, special collections (events), notices with read receipts, private member concerns, UPI pay, receipts, contacts and maintenance reminders.

Correct money, a tamper-evident audit trail and a simple green UI come first.

- **Frontend:** React 18, TypeScript, Vite, React Router, TanStack Query, React Hook Form + Zod, Tailwind + shadcn-style components (Radix), Recharts, i18next (English + Hindi), vite-plugin-pwa (Workbox).
- **Backend:** Supabase (Postgres, Auth, Row Level Security, RPC functions, triggers, Storage, Edge Functions).
- **Hosting:** GitHub → Netlify (free) + Supabase (free).

---

## What's inside

| Area | Highlights |
| --- | --- |
| Ledger | Single source of truth. Integer paise only. Entries are **immutable** (blocked by trigger and grants, even for the table owner). Corrections = reversal with a reason + new entry. Balance is always computed. |
| Dues | Monthly dues for every billable flat (1st of month via cron, or "Generate dues"; idempotent). Per-type amounts. Payments settle the oldest dues first; extra becomes **advance** and auto-settles the next month. Waivers with reason. |
| Payments | Admin records (allocation preview, duplicate-UTR warning, backdating > 30 days needs a reason) or members submit **"I paid"** claims with UTR + screenshot; admins approve/reject. |
| Receipts | Issued only when a ledger credit is posted. Gap-free numbers per financial year (`HH/2026-27/0001`), amount in words, QR verify page (`/r/<code>`), PDF + share. Reversed → CANCELLED watermark + member notified. |
| Events | Scope (all / flat types / hand-picked), untick expected payers with reasons, share = ceil(total ÷ payers) rounded up to ₹10 (configurable), own fund, dues, close with surplus/shortfall transfer to/from General. |
| Reports | Dashboard, month view (opening, collected, from advances, spent by category, surplus/shortfall, "covered from previous balance", closing), flat statement, pending list (WhatsApp share), event report, payee history, 12-month charts, PDF/CSV exports, month closing + super-admin reopen. |
| Notices | Audience (all / types / flats), Web Push, **blocking acknowledgement modal**, IP + device + optional location at acknowledgement, delivered/opened/acknowledged per flat, remind pending only, archive (never delete). |
| Concerns | Private helpdesk: only the member, admins and super admin can see a concern (enforced in the database). Threads, attachments, assign, statuses, reopen within 7 days, "hide my name from other admins". |
| People | Unit-code usernames (`P1-GF`), bulk logins with unique one-time passwords on printable slips, forced first-login password change, reset password (signs out devices), multiple devices at once, active-devices screen, self-registration with admin approval + duplicate-flat alert, roles and per-permission toggles. |
| Security | RLS on every table, every write through `security definer` RPCs, append-only **hash-chained audit log** with a "Verify audit chain" button, alerts for failed sign-ins / duplicate registrations / UPI changes, CSP and security headers. |
| PWA | Installable, offline read cache with an offline banner (writes disabled), install prompt incl. iOS instructions, push notifications, light/dark, English/हिन्दी. |

---

## Repository layout

```
apps/web/                 React PWA (Vite)
  src/pages/...           screens (resident + admin)
  src/lib/...             Supabase client, auth, queries, PDF/CSV, push, i18n
  src/locales/hi.json     Hindi strings (English text is the key)
  e2e/                    Playwright happy path
packages/shared/          money, allocation, event-share, validation (Zod), UPI helpers + Vitest tests
supabase/
  migrations/             schema, RLS, audit chain, ledger + feature RPCs, reports, storage
  functions/              Edge Functions: admin-users, account, push-dispatch
  tests/database.test.sql RLS / ledger / privacy test suite
  seed.sql                Plot Colony, Ludhiana (30 units, ₹800 dues, guard salary, example event)
  bootstrap.sql           make yourself super admin
  cron.sql                daily jobs + push dispatcher schedule
netlify.toml              build, SPA redirect, security headers
PROGRESS.md               what is done / next steps
```

---

## Run locally (≈10 minutes)

Prerequisites: Node 20+, [Supabase CLI](https://supabase.com/docs/guides/cli), Docker.

```bash
npm install
supabase start                      # local Postgres/Auth/Storage/Functions
supabase db reset                   # applies migrations + seed.sql
```

Create your super admin: open Studio (http://127.0.0.1:54323) → Authentication → Add user → `admin@plot-colony.local` + password (auto-confirm), then in the SQL editor run `supabase/bootstrap.sql`.

Edge Functions:

```bash
npx web-push generate-vapid-keys    # copy keys into supabase/functions/.env (see .env.example)
supabase functions serve --env-file supabase/functions/.env
```

Web app:

```bash
cp apps/web/.env.example apps/web/.env.local   # URL + anon key from `supabase status`, VAPID public key
npm run dev                                    # http://localhost:5173
```

Sign in with society code `plot-colony`, username `admin`.

### Tests

```bash
npm test             # shared maths + web unit tests (Vitest)
npm run typecheck
npm run lint
npm run test:db      # resets the local DB and runs supabase/tests/database.test.sql
E2E_ADMIN_PASSWORD=... npm run test:e2e   # Playwright: login → record payment → month report
```

---

## Deploy (Supabase + Netlify, ≈20 minutes)

1. **Supabase project** (free) → Project settings → API: note the URL and the anon (or publishable) key.
2. Push the schema: `supabase link --project-ref <ref>` then `supabase db push`. Then run `supabase/seed.sql` in the SQL editor (it creates Plot Colony).
3. **Auth settings:** Authentication → Sign In / Providers → Email: turn **off** "Allow new users to sign up" and "Confirm email". (Members never sign up directly; logins are created by the admin or by the registration function.)
4. **Super admin:** follow `supabase/bootstrap.sql`.
5. **Edge Functions:** `npx web-push generate-vapid-keys`, fill `supabase/functions/.env`, then
   `supabase secrets set --env-file supabase/functions/.env` and
   `supabase functions deploy admin-users account push-dispatch --no-verify-jwt` (JWTs are verified inside each function).
6. **Cron:** enable `pg_cron` and `pg_net`, edit and run `supabase/cron.sql`.
7. **Netlify:** New site from GitHub → keep base directory empty (uses `netlify.toml`) → add env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DEFAULT_SOCIETY_SLUG=plot-colony`, `VITE_VAPID_PUBLIC_KEY` → deploy. Put the Netlify URL into `ALLOWED_ORIGINS` and Supabase Auth → URL configuration → Site URL.
8. In the app: Settings → add the society UPI ID / payee / QR, record the opening bank balance; Members & logins → Create logins → print the slips.

Secrets never go in the repo: only the anon/publishable key is used in the browser (safe because of RLS). The service-role key exists only inside Edge Functions.

---

## Notes and limits

- **UPI deep links:** some UPI apps warn about or cap `upi://pay` payments to personal UPI IDs. QR scan is the fallback; a current-account / merchant UPI ID avoids the warning. The app never marks anything paid by itself — an admin always verifies first.
- **iPhone push** works only for the installed PWA (Share → Add to Home Screen) on iOS 16.4+.
- **Free plan backups:** no point-in-time restore. Super admin → Settings → "Download backup (JSON)" weekly.
- **Usernames** are mapped to synthetic emails `<username>@<society-slug>.local`. Unit codes cannot be renamed later.
- **Location** at notice acknowledgement is optional, never collected in the background, excluded from the audit log, and purged after the retention period (Settings).
- **Hindi:** UI strings are translated; a few server messages stay in English.
- Postgres limits regex repetition to 255, so a UPI handle may be up to 255 characters (spec said 256).
