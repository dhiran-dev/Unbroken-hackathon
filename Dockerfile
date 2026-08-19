# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS builder
WORKDIR /app
COPY . .
# Next.js discovers server routes during the image build. These non-secret,
# unreachable placeholders let that discovery validate configuration while the
# real server-only values remain runtime variables supplied by Coolify.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:5432/unbroken_build?sslmode=require \
  BETTER_AUTH_SECRET=build-only-not-a-runtime-secret-000000000000 \
  BETTER_AUTH_URL=https://127.0.0.1:3000 \
  BRIGHTDATA_API_TOKEN=build-placeholder \
  BRIGHTDATA_COLLECTOR_ID=c_msyjsllt1r9ej5tdub \
  SFMTA_SOURCE_URL=https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod \
  FIREWORKS_API_KEY=build-placeholder \
  FIREWORKS_API_BASE_URL=https://api.fireworks.ai/inference/v1 \
  FIREWORKS_MODEL=accounts/fireworks/models/deepseek-v4-flash-0731 \
  FIREWORKS_REASONING_EFFORT=high \
  bun run build
RUN bun build src/worker/index.ts --target=bun --outfile=dist/worker.js


# A private one-off image target for migrations and account bootstrap. It is
# never exposed as the public runtime image; Coolify runs the commands below
# against the same release before starting the app and worker targets.
FROM builder AS ops
CMD ["bun", "run", "db:migrate"]

FROM dependencies AS runtime-dependencies
RUN bun install --production --frozen-lockfile

FROM oven/bun:1.3.14-alpine AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apk add --no-cache curl \
  && addgroup -S unbroken \
  && adduser -S unbroken -G unbroken \
  && mkdir -p /data/incidents \
  && chown -R unbroken:unbroken /data
COPY --from=builder --chown=unbroken:unbroken /app/.next/standalone ./
COPY --from=builder --chown=unbroken:unbroken /app/.next/static ./.next/static
COPY --from=builder --chown=unbroken:unbroken /app/dist ./dist
COPY --from=runtime-dependencies --chown=unbroken:unbroken /app/node_modules ./node_modules
USER unbroken

FROM runtime-base AS worker
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "try{process.kill(1,0);process.exit(0)}catch{process.exit(1)}"
CMD ["bun", "dist/worker.js"]

FROM runtime-base AS runtime
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server.js"]
