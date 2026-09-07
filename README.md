# MellaFx

A local, self-contained prop-trading-firm management platform: an **Admin** application, a **Trader** application, and a shared PostgreSQL database. Challenge purchases are paid for via **Chapa** (real payment initialization/verification) and identity is verified via **Dojah** (real KYC verification, Ethiopian Fayda ID); trading remains simulated for local/demo use — there is no live broker connection.

## Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS v4
- PostgreSQL + Prisma ORM
- Custom session auth (bcrypt password hashing + signed JWT session cookie backed by a `Session` table so sessions are revocable)
- Zod for validation
- Recharts for charts

## 1. Prerequisites

- Node.js 20+
- Docker (for a local PostgreSQL instance) — or any PostgreSQL 14+ server you already have running

## 2. Install dependencies

```bash
npm install
```

## 3. Configure environment variables

Copy the example file and adjust if needed (the defaults work out of the box with the bundled `docker-compose.yml`):

```bash
cp .env.example .env
```

`.env.example`:

```env
DATABASE_URL="postgresql://mellafx:mellafx_dev_password@localhost:5432/mellafx?schema=public"
JWT_SECRET="change_me_to_a_long_random_string"
SESSION_COOKIE_NAME="mellafx_session"
APP_URL="http://localhost:3000"
CHAPA_SECRET_KEY=
CHAPA_PUBLIC_KEY=
CHAPA_ENCRYPTION_KEY=
CHAPA_MERCHANT_ID=
DOJAH_APP_ID=
DOJAH_PUBLIC_KEY=
DOJAH_SECRET_KEY=
DOJAH_WIDGET_ID=
```

`CHAPA_SECRET_KEY` is required for real trader-initiated purchases to work (get it from your Chapa dashboard - never commit it). Without it, purchase initialization fails cleanly and the [admin test-paid action](#payments-chapa) remains available for local development.

`DOJAH_APP_ID` / `DOJAH_PUBLIC_KEY` / `DOJAH_SECRET_KEY` / `DOJAH_WIDGET_ID` are required for real trader-initiated KYC verification to work (get them from your Dojah dashboard, where you also configure `DOJAH_WIDGET_ID`'s EasyOnboard flow for Fayda ID verification - never commit real values). Without them, starting a verification fails cleanly and the [admin dev override](#kyc-dojah) remains available for local development.

## 4. Start PostgreSQL

A `docker-compose.yml` is included, exposing Postgres on `localhost:5432` with credentials matching the default `.env`:

```bash
docker compose up -d
```

(If you'd rather use an existing PostgreSQL server, just point `DATABASE_URL` at it instead.)

## 5. Run migrations

```bash
npx prisma migrate dev
```

This creates all tables (`User`, `Session`, `Template`, `Purchase`, `TradingAccount`, `Trade`, `KycSubmission`, `CrmLead`, `SupportTicket`, `Payout`, `Notification`, `AuditLog`, etc.) as defined in `prisma/schema.prisma`.

## 6. Seed the database

```bash
npm run db:seed
```

This creates:

- 1 admin user
- 4 demo traders (in various states: active, failed, funded, brand-new/no trades)
- ~17 challenge templates across Standard, Aggressive, and a Draft Crypto program, at multiple account sizes with linked Phase 1 → Phase 2 → Funded progressions
- Demo purchases, trading accounts, and randomized trade history
- KYC submissions (pending/approved/rejected), CRM leads, a support ticket, and a payout record

**Demo credentials** (also printed to the console after seeding):

| Role   | Email                  | Password       |
| ------ | ---------------------- | -------------- |
| Admin  | admin@mellafx.local    | Admin12345!    |
| Trader | alex@mellafx.local     | Trader1234!    |
| Trader | jamie@mellafx.local    | Trader1234!    |
| Trader | sam@mellafx.local      | Trader1234!    |
| Trader | taylor@mellafx.local   | Trader1234!    |

You can override the admin/trader seed passwords with the `SEED_ADMIN_PASSWORD` / `SEED_TRADER_PASSWORD` environment variables before running the seed script.

The seed script can be re-run at any time (`npm run db:seed`) — it upserts users and clears/recreates templates, so it's safe to run repeatedly during development. `npx prisma migrate reset` will fully wipe and reseed the database if you want a clean slate.

## 7. Start the app

```bash
npm run dev
```

Visit `http://localhost:3000`:

- `/` — public landing page (challenge cards are pulled live from active Phase 1 templates in the database)
- `/login`, `/register` — auth for both admins and traders (role is read from the database session, not the client)
- `/admin` — admin application (Overview, Accounts, Users, KYC, CRM, Templates, Finance, Settings)
- `/dashboard`, `/trade`, `/challenges`, `/purchases`, `/history`, `/account` — trader application

## Other useful commands

```bash
npm run db:studio     # Prisma Studio — browse/edit the database visually
npx prisma migrate dev --name <description>   # create a new migration after editing schema.prisma
```

## Payments (Chapa)

Challenge purchases are paid for via [Chapa](https://developer.chapa.co). The flow:

1. Trader clicks **Purchase** on a challenge → the server looks up the template's **current database price** (never a client-supplied amount) and creates a `PENDING` `Purchase` with a unique `tx_ref`.
2. The server calls Chapa's `POST /v1/transaction/initialize` for exactly that amount in `ETB` and the trader is redirected to Chapa's hosted checkout.
3. After checkout, Chapa redirects the browser back to `/api/payments/chapa/return`, and/or POSTs to `/api/payments/chapa/webhook` (configure this URL in your Chapa dashboard for local testing via a tunnel, e.g. ngrok, pointed at `APP_URL`).
4. Both routes call the same function, which **re-verifies the transaction directly with Chapa** (`GET /v1/transaction/verify/<tx_ref>`) and cross-checks the returned amount/currency/reference against the local `Purchase` before doing anything - a browser redirect or webhook delivery is never trusted on its own.
5. Only on a verified match does the purchase become `PAID` and the existing TradingAccount-creation logic run. This is guarded by the same database-transaction/compare-and-swap pattern the challenge engine uses, so a retried callback, a duplicate webhook delivery, or the callback and webhook arriving at the same time can never create a second purchase or account.

The webhook is authenticated via Chapa's documented `x-chapa-signature` / `chapa-signature` headers (HMAC-SHA256) - an unverified webhook request is rejected before it can touch any purchase.

**Admin test-paid action (temporary, development only):** in Admin → CRM → Purchased, any `PENDING` or `FAILED` purchase has a **"Mark Paid (Test)"** button, visible to admins only. It runs through the exact same activation logic a verified Chapa payment does (not a separate code path), so it produces identical purchase/account state - useful for testing the rest of the app without live Chapa credentials.

## KYC (Dojah)

Identity verification (Ethiopian Fayda ID) runs through [Dojah](https://docs.dojah.io). The application depends only on a small `KycProvider` interface (`src/lib/services/kycProvider.ts`); Dojah is one implementation of it (`src/lib/services/dojahKycProvider.ts`), so a future provider can be swapped in without touching the KYC state machine, routes, or trader/admin UI beyond that one file.

Dojah has no dedicated single-call REST endpoint for Fayda documented at integration time - Ethiopian ID + biometric verification is delivered through Dojah's "Hosted Flow / EasyOnboard" **widget**, configured in your Dojah dashboard (that's what `DOJAH_WIDGET_ID` identifies). The flow:

1. Trader clicks **Start Verification** in Account → KYC → the server creates a `PENDING` `KycSubmission` with a unique `providerReference` and returns the widget config the browser needs (`app_id` / public key - both explicitly documented by Dojah as safe for client-side use; the secret key never leaves the server).
2. The browser loads `https://widget.dojah.io/widget.js` and launches Dojah's hosted verification UI for that reference.
3. The widget's own `onSuccess` callback is **not** trusted as proof of verification (per Dojah's own documented guidance) - only Dojah's signed webhook, `POST /api/kyc/dojah/webhook`, authenticated via the documented `x-dojah-signature` / `x-dojah-signature-v2` headers (HMAC-SHA256), is authoritative. Configure this URL in your Dojah dashboard for local testing via a tunnel (e.g. ngrok) pointed at `APP_URL`.
4. The webhook handler normalizes Dojah's `verification_status`/`status` into `PENDING` / `VERIFIED` / `FAILED` and, only on a verified pass, marks the submission `APPROVED` (mapped 1:1 to this app's existing `KycStatus.APPROVED`/`REJECTED` - no new status values were introduced). This is guarded by the same compare-and-swap pattern the challenge engine and Chapa flow use, so duplicate webhook delivery can never double-apply a result.
5. Only normalized, minimal data is stored: status, provider name, the provider reference, timestamps, and (on failure) a short safe category string - never a raw Fayda ID number, document/selfie images, or Dojah's raw response payload.

**Admin dev override (temporary, development only):** in Admin → CRM → KYC, opening a submission shows a clearly-labeled **"Developer Override"** panel, admin-only, that force-sets a submission's status (`PENDING`/`APPROVED`/`REJECTED`) without a real Dojah verification - useful for testing without live Dojah credentials. Every use is audit-logged as `KYC_ADMIN_OVERRIDE`, distinct from the real `KYC_VERIFIED`/`KYC_FAILED` events a Dojah webhook produces.

## How the other demo systems work

- **Template snapshots**: at purchase time, the relevant Template fields (price, targets, drawdown limits, leverage, etc.) are frozen into a JSON `snapshot` on the `Purchase` and `TradingAccount`. Later admin edits to the live `Template` never rewrite an already-purchased challenge's rules; new purchases pick up the latest active configuration.
- **Challenge status engine** (`src/lib/services/challengeEngine.ts`): a single, centralized service recomputes balance/equity/drawdown from an account's trades and transitions `ACTIVE → PASSED/FAILED`, then auto-creates the next linked phase's account (Phase 1 → Phase 2 → Funded) using each Template's `nextPhaseId`. It runs whenever an account is viewed (admin or trader) since there is no live trading engine to push updates in real time.
- **Simulating trades**: since there's no live broker connection, an admin can generate demo trade history for any account from its detail page ("Run 10 Demo Trades", with a selectable win-bias preset including "Breach Drawdown") to exercise the pass/fail/fund engine end-to-end.
- **Safe template deletion**: deleting a template that has never been purchased hard-deletes it; a template referenced by any purchase/account is archived instead, preserving historical data.

## Project structure

```
prisma/schema.prisma        Database schema
prisma/seed.ts               Seed script
src/lib/auth/                 Password hashing, session management, route guards
src/lib/services/             Business logic (templates, users, accounts, purchases, kyc, crm, stats, calculations, challengeEngine, audit, chapa)
src/lib/validation/schemas.ts Zod schemas shared by API routes and forms
src/app/api/                  API routes (admin/*, trader/*, auth/*, account/*, payments/chapa/*)
src/app/admin/                Admin application pages
src/app/(trader)/             Trader application pages (auth-guarded route group)
src/app/login, /register, /   Public pages
src/components/ui/            Reusable table/filter/pagination/modal/toast/chart primitives
src/components/admin/         Admin-specific components
src/components/trader/        Trader-specific components
```

All authorization is enforced server-side (`requireAdmin` / `requireTrader` in `src/lib/auth/guards.ts`) inside API routes and server components — hiding a nav link is never the only protection, and every trader-scoped query is filtered/verified by the authenticated user's own id.
