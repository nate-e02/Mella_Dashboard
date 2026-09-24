# MellaFx

Ethiopian, ETB-first prop-trading-firm platform: a **trader app** (challenges, live terminal, dashboard, payouts), an **admin console** (accounts, KYC, finance, audit, engine), and a **trading worker** (price feeds, simulated execution, real-time risk engine, WebSocket gateway) on one PostgreSQL database.

- Payments: **Chapa** (telebirr, CBE Birr, M-Pesa, cards) in ETB, verified server-side.
- KYC: provider interface with **Dojah** implemented; Fayda eKYC is the intended production provider.
- Trading: **Mella Terminal Lite** — an in-house simulated execution engine fed by a real price feed (cTrader Open API demo account; Binance public stream for crypto; a random-walk stub for local development).

## Stack

Next.js 16 (App Router, `proxy.ts`), React 19, Tailwind 4, TypeScript, Prisma 6 + PostgreSQL 16, Redis 7 (rate limits, pub/sub), `ws` WebSocket gateway, `lightweight-charts`, Zod, Vitest.

## Run it locally

### 1. Prerequisites
Node 22+, Docker (for Postgres + Redis) or your own PostgreSQL 16 and Redis 7.

### 2. Configure
```bash
cp .env.example .env
# set JWT_SECRET to 32+ random characters (openssl rand -base64 48)
```
`APP_URL`, `WS_PUBLIC_URL`, `WORKER_INTERNAL_TOKEN` and `ENABLE_DEV_OVERRIDES=true` are pre-filled for local use.

### 3. Start infrastructure, migrate, seed
```bash
npm install
docker compose up -d            # Postgres on 127.0.0.1:5432, Redis on 127.0.0.1:6379
                                # (port taken by a local Postgres? set POSTGRES_PORT=5433 in .env and in DATABASE_URL)
npx prisma migrate dev          # apply migrations
npm run db:seed                 # demo users, ETB templates, instruments, FX rate
```
`npm run db:seed:reset-demo` rebuilds only the demo users' accounts and trades (and resets their passwords to the defaults below).
Demo logins (development passwords, override with `SEED_ADMIN_PASSWORD` / `SEED_TRADER_PASSWORD`):

| Role | Email | Password |
|---|---|---|
| Admin | admin@mellafx.local | `Admin12345!ChangeMe` |
| Admin (second approver) | finance@mellafx.local | `Admin12345!ChangeMe` |
| Trader | alex@ / jamie@ / sam@ / taylor@mellafx.local | `Trader1234!ChangeMe` |

### 4. Run the web app and the trading worker (two terminals)
```bash
npm run dev                                      # http://localhost:3000
FEED_SOURCES_OVERRIDE=STUB npm run worker        # feeds + engine + ws gateway on :4100 (simulated prices)
```
Log in as a trader, open **Trade**: the chart, prices, order ticket and account bar update live over the WebSocket. To use real cTrader prices set the `CTRADER_*` variables (see `.env.example`) and drop `FEED_SOURCES_OVERRIDE`. Crypto uses Binance's public stream when `ALLOW_BINANCE=true`.

### 5. Tests, lint, types
```bash
npm test            # unit + integration (uses the DATABASE_URL database; serial)
npm run lint
npm run typecheck
```

## Run with Docker (full stack)
```bash
FEED_SOURCES_OVERRIDE=STUB docker compose --profile app up -d --build   # db, redis, web (:3000), worker (:4100)
# host ports are configurable: WEB_PORT, WORKER_HOST_PORT, POSTGRES_PORT, REDIS_PORT; set WS_PUBLIC_URL to match
docker compose run --rm migrate npx prisma db seed   # optional demo data (development only)
```
A one-shot `migrate` container (worker image) runs `prisma migrate deploy` before web and worker start. Images are also built by CI (`.github/workflows/ci.yml`) to GHCR (`web` and `worker`).

## Security model (summary)
- Sessions: server-side rows, `__Host-` httpOnly cookie in HTTPS, 7 d (trader) / 12 h (admin) lifetime, idle timeout, revoked on password change. Role re-read from the DB on every request.
- Admin console requires **TOTP two-factor** (`ADMIN_MFA_REQUIRED`, always on in production). Email verification is required before purchasing.
- `src/proxy.ts`: per-IP rate limits (Redis), Origin/Sec-Fetch-Site CSRF checks on API mutations, nonce-based CSP, HSTS and the usual hardening headers, `x-request-id` correlation.
- Login lockout after 10 failures, constant-time unknown-user path, generic responses on register/forgot-password.
- Webhooks: body-bound HMAC only, replay table (`WebhookDelivery`), Chapa results re-verified server-to-server before any activation.
- Payouts: eligibility (FUNDED, KYC approved, funded ≥ 14 days, ≤ remaining profit share), **maker-checker** (creator ≠ approver ≠ payer), ledger debit on PAID.
- Dev-only actions (KYC override, mark-paid, simulated trades) return 404 unless `ENABLE_DEV_OVERRIDES=true` outside production.
- Every login, status change, payment, payout, KYC decision, setting and engine action is written to `AuditLog` with actor, IP, user agent and request id (Admin → Audit Log).

## Challenge rules engine
Rules are frozen into the account at purchase (including the whole phase chain). Balance/equity are incremental columns updated in the same transaction as each trade close (`src/lib/services/tradeLedger.ts`); the pure decision function is `src/lib/services/challengeRules.ts`.
- Daily loss: measured from the equity captured at the account's own reset boundary (`dailyLossResetTime`, default `00:00 EAT`), reconstructed from history if nothing ran at the boundary.
- Max loss: `STATIC` (from initial balance) or `TRAILING` (from the equity peak, locking at breakeven).
- Time limit (`durationDays`), minimum trading days, profit target; live evaluation in the worker on every tick, plus a 60-second sweep for accounts the worker is not tracking.

## Trading worker
`src/worker/index.ts` runs feeds (`src/trading/feeds`), the 1-minute candle builder (`Bar` table), the execution + risk engine, the WebSocket gateway (`/ws`, 60-second ticket auth from `POST /api/trader/ws-ticket`) and scheduled jobs. `GET /health`; `GET /status` and `POST /internal/{halt,resume,reload-account}` require `x-internal-token`. Admin → Trading Engine shows feed staleness and provides the kill switch.

## Project structure
```
prisma/                  schema, migrations, seed
src/proxy.ts             rate limiting, CSRF, security headers, CSP nonce
src/env.ts               boot-time environment validation (instrumentation.ts)
src/lib/auth/            sessions, guards, password, MFA, one-time tokens, rate limiter
src/lib/services/        business logic (purchases, payouts, KYC, challenge engine, trade ledger, stats, ...)
src/lib/notify/          email / SMS senders (console fallback in development)
src/trading/             market data adapters, candles, execution + risk engine, gateway, protocol
src/worker/              worker entry point
src/app/api/             route handlers (admin/*, trader/*, auth/*, market/*, payments/*, kyc/*, health)
src/app/(trader)/        trader app (dashboard, trade, challenges, purchases, history, account)
src/app/admin/           admin console
src/components/          UI
tests/                   integration tests (need a database)
```

## Documentation
Product, go-live and operations plan: `docs/PRODUCTION_READINESS_PLAN.md` (kept out of git by `.gitignore`; share it separately).
