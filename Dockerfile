# syntax=docker/dockerfile:1.7
# Multi-stage build producing two images from one Dockerfile:
#   --target web    : Next.js standalone server (port 3000)
#   --target worker : trading worker (feeds, engine, WebSocket gateway; port 4100)
# Database migrations run as a separate one-shot container from the worker
# image (see the `migrate` service in docker-compose.yml) before web/worker start.

FROM node:25-bookworm-slim AS base
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- dependencies (includes devDependencies needed for build + prisma generate) ----
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

# ---- build ----
FROM deps AS build
# deps installs devDependencies with NODE_ENV=development; the Next.js build
# itself must run as production or React dev/prod builds get mixed.
ENV NODE_ENV=production
COPY . .
RUN npm run build

# ---- web runtime ----
FROM base AS web
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=app:app /app/node_modules/@prisma ./node_modules/@prisma
USER app
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]

# ---- worker runtime (also used for one-shot jobs: `npx prisma migrate deploy`, seeding) ----
FROM deps AS worker
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app app
COPY --chown=app:app . .
USER app
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://localhost:4100/health || exit 1
CMD ["npm", "run", "worker"]
