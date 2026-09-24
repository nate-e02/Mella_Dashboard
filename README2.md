# MellaFx: Handover (branch `feat/production-readiness`)

This file explains where the platform stands, how to run and check it, what was built on this branch, what only the MellaFx team can do, and how live prices and the trading chart work (with free and cheap options). The shorter `README.md` covers the architecture and security model.

Status on 2026-09-24:
- Every feature below is built and tested: 51 test files, 488 tests, all passing.
- Lint and typecheck are clean.
- The scripted trade (`scripts/e2e-smoke.mjs`) passes against a real web app and trading worker.

What is still missing is not code. It is accounts, credentials, legal work and hosting (section 5).

---

## 1. Run it

### Requirements
- Node 22 or newer. `.nvmrc` pins it, so `nvm use` picks it up.
- Docker, for Postgres 16 and Redis 7. You can use your own Postgres and Redis instead.

### First-time setup
```bash
cd Mella_Dashboard
npm install
cp .env.example .env        # then set JWT_SECRET:  openssl rand -base64 48
```
Port clashes on this machine:
- A system Postgres already uses 5432. Set `POSTGRES_PORT=5433` in `.env`, and put `:5433` in `DATABASE_URL` too.
- Another project already uses Redis on 6379. Set `REDIS_PORT=6380`, and `REDIS_URL=redis://localhost:6380`.
- Another project uses port 3000. Run the web app with `-p 3200`, and set `APP_URL=http://localhost:3200`.

### Local development (web app and worker on your machine)
```bash
# 1. Database + Redis (Docker)
docker compose up -d

# 2. Database schema: apply every migration, generate the Prisma client
npx prisma migrate deploy
npx prisma generate

# 3. Demo data (users, ETB challenges, instruments, FX rate, coupons, referral codes)
npx prisma db seed
#    rebuild only the demo traders' accounts/trades (and reset their passwords):
#    npm run db:seed:reset-demo

# 4. Terminal 1 - web app
npm run dev                         # http://localhost:3000  (or: npx next dev -p 3200)

# 5. Terminal 2 - trading worker (price feeds, execution, risk engine, WebSocket on :4100)
set -a && . ./.env && set +a && SEED_DEFAULT_INSTRUMENTS=true FEED_SOURCES_OVERRIDE=STUB npm run worker
```
`FEED_SOURCES_OVERRIDE=STUB` uses simulated prices. Remove it once the cTrader credentials are set (section 6).

To change the database later: edit `prisma/schema.prisma`, then run `npx prisma migrate dev --name <what-changed>`. That creates the migration file and applies it. Commit the new file under `prisma/migrations/`; CI fails if the schema and the migrations disagree.

### Full stack in Docker (the same images production uses)
```bash
FEED_SOURCES_OVERRIDE=STUB docker compose --profile app up -d --build
docker compose run --rm migrate npx prisma db seed     # demo data, first time only
```
This starts:
- `db` and `redis`
- `migrate`: a one-shot container that runs `prisma migrate deploy` before the others start
- `web` on :3000
- `worker` on :4100
- `backup`: a nightly `pg_dump` at 00:30 EAT, kept for 30 days

You can change the host ports with `WEB_PORT`, `WORKER_HOST_PORT`, `POSTGRES_PORT` and `REDIS_PORT`.

### Demo logins
| Who | Login | Password |
|---|---|---|
| Trader | `alex@mellafx.local` (also `jamie@`, `sam@`, `taylor@`) | `Trader1234!ChangeMe` |
| Trader, by phone | `0911000001`: the SMS code is printed in the web-app terminal | none needed |
| Admin | `admin@mellafx.local` | `Admin12345!ChangeMe` |
| Second admin, for two-person approvals | `finance@mellafx.local` | `Admin12345!ChangeMe` |

Coupons: `WELCOME10` gives 10% off; `FREETRIAL` makes the smallest challenge free (50 uses, one per person).

### Check that it works
```bash
npm test                                   # unit + integration tests (need the database running)
npm run lint && npm run typecheck
node scripts/e2e-smoke.mjs                 # login -> live prices -> market order -> close -> ledger + history
APP_URL=http://localhost:3200 node scripts/e2e-smoke.mjs   # if the web app runs on 3200
```
Checks by hand:
1. **Trader flow** (log in as alex):
   - **Trade:** the chart and prices move. Place and close an order.
   - **Challenges:** apply `WELCOME10`, and the price drops by 10%.
   - Look at **Leaderboard**, **Referrals** (your share link) and **Certificates**.
   - Switch EN / አማ in the header.
2. **Phone sign-up:** Register → Phone → any `09…` number → take the 6-digit code from the web-app terminal → enter a name, and you are logged in.
3. **Admin screens** (log in as admin):
   - Trading Engine: feed status, backup feeds, kill switch
   - News Calendar
   - Coupons
   - Referrals
   - Finance, for payouts: approving one needs the second admin
4. **Chapa test payment:** buy a challenge without a coupon, pay on Chapa's test checkout, and you return to My Purchases with the challenge active.
   - This works on localhost, because the browser redirect completes it.
   - Chapa's webhook needs a public HTTPS URL. To test the webhook locally:
     1. Run `npx cloudflared tunnel --url http://localhost:3000`.
     2. Set `APP_URL` to the tunnel URL.
     3. In Chapa's dashboard, register the webhook at `<APP_URL>/api/payments/chapa/webhook` with a secret hash.
     4. Put the same secret hash in `CHAPA_WEBHOOK_SECRET`.

### Load tests and backups
```bash
# HTTP load (k6, or the grafana/k6 Docker image with host.docker.internal)
k6 run -e BASE_URL=http://localhost:3000 scripts/load/http.js
# WebSocket load: N concurrent trading terminals, reports tick latency
k6 run -e WS_URL=ws://localhost:4100/ws -e JWT_SECRET=... -e USER_ID=<trader id> -e VUS=1000 scripts/load/ws.js

# Backup / restore (restore refuses a non-empty database unless RESTORE_FORCE=true)
DATABASE_URL=... BACKUP_DIR=./backups ./scripts/db-backup.sh
DATABASE_URL=.../mellafx_restore ./scripts/db-restore.sh backups/mellafx-<timestamp>.dump
```
Local result: 200 terminals, 208k price updates, p95 tick latency 21 ms. The backup and restore round trip was tested.

---

## 2. What was built on this branch

### 2.1 Foundation (earlier commits on this branch)
- **Security:**
  - rate limits, CSRF checks and a strict Content-Security-Policy (`src/proxy.ts`)
  - the server refuses to start with unsafe settings (`src/env.ts`)
  - two-factor login (TOTP), mandatory for admins
  - email verification, password reset, lockout after failed logins
  - hardened session cookies
  - dev-only shortcuts return 404 in production
  - webhook replay protection
- **Money:**
  - everything is priced in ETB; prices come from `Template.price`
  - a ledger of every movement
  - a USD→ETB rate table
  - payouts need two admins: the creator, approver and payer must be different people
  - payouts check KYC, funded status, a 14-day wait and the profit-split cap
- **Challenge rules:**
  - daily loss measured from the equity at the reset time (00:00 EAT)
  - static or trailing max loss, time limit, minimum trading days
  - rules frozen at purchase
  - a risk sweep every 60 seconds
- **Mella Terminal Lite:** our own trading engine and live chart (section 6).
- **Operations:**
  - Dockerfile and compose, health checks, structured logs, audit log page
  - Admin → Trading Engine page with a kill switch
- **Chapa:** real test checkout; payments are verified server-side.
  - Fixed on this branch: the callback route (Chapa calls it with GET) and webhook signature checking (Chapa signs with the dashboard secret hash, not the API key).

### 2.2 Added in this round
| Feature | What it does | Where |
|---|---|---|
| **CI fix** | CI failed on `LayoutProps`: route types are generated by `next typegen`, which now runs before `tsc` | `package.json` |
| **CI pipeline** | **quality** (lint, types, schema validity, `npm audit`) → **test** (Postgres + Redis, migrations, a check that schema and migrations match, 488 tests) → **e2e** (production build, real web app + worker, page and security-header checks, dev shortcuts absent, scripted trade over the WebSocket) → **docker** (web and worker images to GHCR, Trivy fails on fixable critical vulnerabilities). Dependabot runs weekly. | `.github/` |
| **Phone + SMS login** | Phone is the default on login and register. Ethiopian numbers are normalised (09/07/+251…). 6-digit codes: 5-minute expiry, 60 s resend wait, 5 per hour, 5 attempts, single use. Only a hash of the code is stored; Android autofills it. New numbers get a name / optional-email step. Password login also accepts a phone number. On the Account page: add/change phone, add email, set a password. Purchases accept a verified phone *or* a verified email. | `src/lib/phone.ts`, `src/lib/services/phoneOtp.ts`, `phoneAuth.ts`, `src/app/api/auth/otp/*`, `src/components/shared/PhoneAuthFlow.tsx` |
| **SMS providers** | AfroMessage (Ethiopian) or any generic HTTP gateway. With no provider, codes print to the console in development, and phone login answers 503 in production instead of silently failing. | `src/lib/notify/sms.ts` |
| **Amharic interface** | Full EN/አማ interface: landing page, navigation, auth, dashboard, terminal, challenges, purchases, history, account, referrals, leaderboard, certificates, error pages. The admin console stays in English. Every English string must have an Amharic version or the build fails. Language follows the browser, can be switched in the header, and is saved on the user for SMS. Uses the Noto Sans Ethiopic font. A glossary sits at the top of `src/i18n/messages/am/common.ts`. | `src/i18n/*` |
| **Public pages** | `/rules`: trading rules with worked ETB examples, computed by the same code as the engine. `/faq`: 14 questions and answers. | `src/app/rules`, `src/app/faq` |
| **Coupons** | Percent or fixed ETB off; limited per template, by dates, in total uses and per user. A 100% coupon activates the challenge without Chapa, and the last free slot is claimed safely under concurrency. Chapa charges exactly the discounted amount. Admin → Coupons. | `src/lib/services/coupons.ts` |
| **Referrals** | Share link `/r/<CODE>` (30-day cookie), credited on email or phone sign-up. The referrer earns a commission (default 10%, set on Admin → Referrals) on what the referred user actually paid. Voided on refund. Paid out with two-admin approval and recorded in the ledger. Trader page with Telegram and WhatsApp share buttons. | `src/lib/services/referrals.ts` |
| **Certificates** | Issued automatically on phase pass, on becoming funded and on each paid payout. Public verification page `/certificates/<id>`, printable, with a share image for Telegram. Shows the first name plus last initial only. | `src/lib/services/certificates.ts`, `src/app/certificates/[publicId]` |
| **Leaderboard** | Opt-in with an alias only. Return % over 30 days or all time; best account per trader; at least 5 closed trades; failed accounts excluded. | `src/lib/services/leaderboard.ts` |
| **Weekend / overnight rules** | Where a program doesn't allow holding, positions close automatically at 16:45 New York time on Friday (weekend), or at the daily rollover (overnight). New orders are refused while the FX market is closed. Correct across daylight-saving changes. Crypto is exempt. | `src/trading/sessions.ts`, `engine.ts` |
| **News-trading rule** | Where not allowed: no new orders on affected pairs ±2 minutes around high-impact events (window set by `rules.newsWindowMinutes`). Pending orders wait; stop-loss and take-profit still run. The terminal shows a warning banner. Admin → News Calendar: add, delete, CSV import, optional automatic import (`NEWS_CALENDAR_URL`). | `src/trading/news.ts`, `src/app/admin/news` |
| **Consistency rule** | The best day's profit must be ≤ X% of total profit to pass a phase or request a payout. An account is never failed for this; the trader just keeps trading. Shown on the dashboard. | `challengeRules.ts`, `challengeEngine.ts`, `payouts.ts` |
| **Backup feed + failover** | Each instrument can have a backup feed that is always connected. It switches over after 3 s of silence and switches back after 30 s of stable primary data (no flapping). Ops get an alert, and Admin → Trading Engine shows the active source. Adds a TraderMade adapter (licensed paid backup). | `src/trading/feeds/router.ts`, `tradermade.ts` |
| **Security fix: client IP** | Rate limits used to trust `cf-connecting-ip` and the left-most `X-Forwarded-For`, which any client can fake to bypass every limit. Now only the header your edge proxy sets is used (`CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS`). | `src/lib/auth/rateLimit.ts` |
| **Backups** | `scripts/db-backup.sh` and `db-restore.sh` (checked, tested round trip), plus a nightly backup container. | `scripts/`, `docker-compose.yml` |
| **Load tests** | k6 scripts for HTTP and for WebSocket terminals. | `scripts/load/` |

Database migration for this round: `prisma/migrations/20260924090000_phone_i18n_growth_rules_failover`. It makes email and password optional, adds phone OTP codes, locale, referral and leaderboard fields, coupons, referral rewards, certificates, the economic calendar, instrument backup feeds, and the new close reasons (WEEKEND / OVERNIGHT / NEWS).

---

## 3. What is left in the code (small, optional)
- **Should test live, once credentials exist:**
  - the cTrader feed
  - AfroMessage SMS
  - the TraderMade backup feed
  - the Chapa webhook on a public URL

  The code for each is written and covered by tests with simulated replies.
- **Notifications** (in-app messages) are stored in English. They should be translated into the user's language when sent.
- **TradingView Advanced Charts:** swap it in once TradingView approves you (about a day of work; section 6).
- **Decimal money:** money is stored as rounded floats; moving to `Decimal` is planned before large volumes.
- **Split the Amharic/English text sent to the browser by namespace:** smaller pages on slow mobile data.
- **Known behaviours to confirm (business decisions):**
  - a refunded purchase still uses up a coupon slot
  - referral commission is paid on every purchase, not only the first
  - a manual admin change to FUNDED does not issue a certificate

  The "fee refunded with the first payout" claim was removed, because nothing pays it; add it back only if you want that policy (then it needs building).

---

## 4. What we (the MellaFx team) must do: nobody can do it in code

### Accounts and credentials (put the values in the server's `.env`)
| # | Task | Why | Setting(s) | Cost |
|---|---|---|---|---|
| 1 | **Chapa live merchant account.** Enable Transfers for payouts. In Dashboard → Webhooks, register `https://<domain>/api/payments/chapa/webhook` with a secret hash. | Real payments | `CHAPA_SECRET_KEY`, `CHAPA_WEBHOOK_SECRET` (+ public/encryption keys) | Per-transaction fee |
| 2 | **SMS gateway**: AfroMessage recommended. Register the sender name "MellaFx" (the Ethiopian Communications Authority, ECA, must approve it). | Phone login and alerts; phone login is **off** in production without it | `SMS_PROVIDER=afromessage`, `AFROMESSAGE_TOKEN`, `AFROMESSAGE_IDENTIFIER_ID`, `AFROMESSAGE_SENDER_NAME` | About 0.3–0.6 birr per SMS |
| 3 | **cTrader Open API**: register an app at openapi.ctrader.com, and open a free demo account with a broker that offers cTrader. | Real live prices (free) | `CTRADER_*`; remove `FEED_SOURCES_OVERRIDE` | Free |
| 4 | **Backup price feed** (TraderMade or similar) before real money depends on prices | Failover when cTrader stops | `TRADERMADE_API_KEY`, then set the backup per instrument on Admin → Trading Engine | About $100–300/month |
| 5 | **Fayda eKYC** partner application (partner.fayda.et, about 2 working days) | Identity checks before payouts | KYC provider (Dojah is the current fallback: `DOJAH_*`) | Per NIDP terms |
| 6 | **Email sender** (Resend or similar) + domain DNS (SPF/DKIM) | Verification and reset emails | `RESEND_API_KEY`, `EMAIL_FROM` | Free tier, then about $20/month |
| 7 | **Telegram bot** + an ops group | Alerts: feed down, market halted, failover, over-redeemed coupons | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OPS_CHAT_ID` | Free |
| 8 | **TradingView Advanced Charts** application (tradingview.com → Advanced Charts → request) | Better chart (section 6) | none | Free with attribution |
| 9 | **Domain + Cloudflare** (it has an Addis Ababa location) | HTTPS, WAF, DDoS protection | `APP_URL=https://…`, `WS_PUBLIC_URL=wss://…`, `CLIENT_IP_HEADER=cf-connecting-ip` (and firewall the origin so only Cloudflare IPs can reach it) | About $0–25/month |

### Hosting and operations
- **Host in Ethiopia.** Proclamation 1321/2024 Art. 22(1) requires personal data to be stored in-country. Options: Ethio Telecom **Telecloud** VMs, **Wingu.Africa** or **Raxio** colocation.
- **Suggested starting size:** 2 app VMs (4 vCPU / 8 GB), 1 worker VM (4 vCPU / 8 GB), 1 database VM (4 vCPU / 16 GB, NVMe), 1 backup VM.
- **Deploy tooling:** Dokploy or Coolify on those VMs, pulling the GHCR images CI builds (`ghcr.io/<repo>/web` and `/worker`).
- **Production `.env` checklist:**
  - `NODE_ENV=production`
  - `APP_URL` on https
  - a 48-byte random `JWT_SECRET`
  - `REDIS_URL`
  - `WORKER_INTERNAL_TOKEN`
  - `ADMIN_MFA_REQUIRED=true`
  - `ENABLE_DEV_OVERRIDES` **unset**

  The server refuses to start if any of these is unsafe.
- **Copy the backup volume to a second Ethiopian facility**, and practise a restore on staging each week.
- **Uptime monitoring** on `/api/health` and the worker's `/health` (Better Stack or UptimeRobot, free tier).
- **Protect `main` on GitHub:** require CI to pass before merging.

### Legal and business
- A lawyer's opinion on National Bank of Ethiopia (NBE) and Ethiopian Capital Market Authority (ECMA) rules; retail FX is a grey area.
- **Register as a data controller** with the Ethiopian Communications Authority (ECA) (Art. 33).
- Name a data protection officer, and write a 72-hour breach-notification runbook.
- **Terms, privacy policy, refund policy and risk disclosure** in Amharic and English. These were deliberately *not* written in code; they need the lawyer.
- **Final product numbers:** prices per account size, rules per program (which ones allow weekend or news trading, consistency %), payout minimum, referral commission.
- **Native Amharic review** of the wording, especially these terms: ፈንድድ አካውንት, ኢክዊቲ, ተከታይ (trailing), የወጥነት ህግ, and the status labels.

### Before public launch
- External penetration test. Run `npm audit` and Trivy with nothing critical.
- Load test on the real servers: `scripts/load/*`. Target: p95 under 300 ms at 500 requests/s, and 10k WebSocket clients.
- Soft launch to about 100 invited traders; staff support in Amharic; open the Telegram channel and a status page.

---

## 5. How to deploy (summary)
1. Merge `feat/production-readiness` into `main`. CI builds and pushes `web` and `worker` images tagged `latest` and with the git sha.
2. On the servers, run the images with the production `.env`. Run the `migrate` container (`npx prisma migrate deploy`) before starting `web` and `worker` on every release.
3. Run a single worker replica. The engine keeps account state in memory; background jobs already use database locks, but the engine itself is not yet multi-replica.
4. Put the reverse proxy (Traefik or Caddy) or Cloudflare in front, terminate TLS, and forward `/ws` to the worker on port 4100.
5. Only on a fresh production database, to import the challenge catalogue: `ALLOW_PRODUCTION_SEED=true npx prisma db seed`. Then change the admin passwords and enrol two-factor.

---

## 6. Live trading chart: how it works and what it costs

### How it works now
```
price feed (cTrader / Binance / TraderMade / simulated)
      │  primary + optional backup, automatic failover (3 s)
      ▼
trading worker (src/worker): execution engine + real-time risk rules + 1-minute candles
      │  WebSocket gateway /ws (60-second login tickets, updates batched per client)
      ▼
browser: lightweight-charts terminal at /trade (chart, order ticket, positions, live account bar)
```
- The price on the chart is the same price used for fills, stop-losses and the daily-loss rule. That makes disputes defensible, and it is why scraping or chart widgets must never supply prices.
- Expected delay from the price source to an Ethiopian user's screen: about 0.25–0.35 s when hosted in Addis (the feed leg from Europe is about 150–200 ms).
- If data stops for more than 3 s, the engine halts new orders and shows "market data delayed". That protects traders during international link cuts.

### Price data options (cheapest first)
| Option | Cost | Can we show it to customers? | Use |
|---|---|---|---|
| **cTrader Open API + a broker demo account** | **Free** | **Yes**: their terms allow apps for your customers | **Main feed.** Adapter built (`src/trading/feeds/ctrader.ts`); add the credentials. |
| Binance public stream | Free | Public market data | Crypto pairs; already works (`ALLOW_BINANCE=true`) |
| **TraderMade streaming** | About $100–300/month (check current pricing) | Yes, on commercial plans | **Best paid backup.** Adapter + failover built. |
| Massive (formerly Polygon) currencies, Twelve Data | About $50–200+/month | Only on business or commercial tiers | Alternative backup |
| FXCM ForexConnect | Ask for a quote | With a data licence | Alternative |
| OANDA practice, Finnhub free, Alpha Vantage, TradingView widgets | Free | **No**: personal use only, or no redistribution | Don't use |
| Scraping TradingView or Investing.com | Free | Against their terms; IP bans; no price we can defend | Never |
| White-label MT5, cTrader or Match-Trader platform | About $2.5k–5k setup + $1k–5k/month | Yes | Only if traders demand MT5 |

### Chart library options
| Library | Cost | Notes |
|---|---|---|
| **lightweight-charts** (current) | Free (Apache-2.0) | Fast and small; candles, live updates, order and stop lines |
| **TradingView Advanced Charts** | Free with approval + attribution | 100+ indicators, drawing tools, familiar to traders; uses *our* feed. **Apply now**; swapping it in is about a day of work. |
| KLineChart | Free (Apache-2.0) | Fallback with indicators and drawings, no approval needed |
| ChartIQ | Expensive commercial licence | Not worth it at this stage |

### Recommended path
1. **Now:** get cTrader Open API credentials (free), remove `FEED_SOURCES_OVERRIDE`, and keep Binance for crypto.
2. **Before real money depends on prices:** add TraderMade as the backup (Admin → Trading Engine → backup feed per instrument). Failover is automatic.
3. **In parallel:** apply for TradingView Advanced Charts, and replace lightweight-charts once approved.

Feed cost at launch: **$0**. With a licensed backup: about **$100–300/month**.

---

## 7. Useful paths
| Path | What |
|---|---|
| `src/proxy.ts` | Rate limits, CSRF, security headers |
| `src/env.ts` | Environment validation (refuses unsafe production config) |
| `src/lib/services/` | Business logic: purchases, payouts, challenge rules, coupons, referrals, certificates, leaderboard, phone OTP |
| `src/trading/` | Feeds, failover router, engine, market sessions, news rule, WebSocket gateway |
| `src/worker/` | Worker entry point and scheduled jobs |
| `src/i18n/` | English/Amharic dictionaries and helpers |
| `prisma/` | Schema, migrations, seed |
| `scripts/` | End-to-end smoke test, load tests, backup/restore |
| `.github/workflows/ci.yml` | CI pipeline |
