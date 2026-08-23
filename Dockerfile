# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS builder
WORKDIR /app
COPY . .
# Route discovery needs schema-valid placeholders. They are unreachable build
# values; Coolify supplies the real server-only values at runtime.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:5432/pulserank_build?sslmode=require \
  BRIGHTDATA_API_TOKEN=build-placeholder \
  BRIGHTDATA_COLLECTOR_ID=c_mt33nlnkq376z132b \
  FIREWORKS_API_KEY=build-placeholder \
  FIREWORKS_API_BASE_URL=https://api.fireworks.ai/inference/v1 \
  FIREWORKS_MODEL=accounts/fireworks/models/deepseek-v4-flash-0731 \
  FIREWORKS_REASONING_EFFORT=high \
  NEXT_PUBLIC_APP_URL=https://example.invalid \
  node node_modules/next/dist/bin/next build
RUN bun build src/worker/index.ts --target=bun --outfile=dist/worker.js

# Private one-off target for forward-only migrations.
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
  && addgroup -S pulserank \
  && adduser -S pulserank -G pulserank \
  && mkdir -p /data/incidents \
  && chown -R pulserank:pulserank /data
COPY --from=builder --chown=pulserank:pulserank /app/.next/standalone ./
COPY --from=builder --chown=pulserank:pulserank /app/.next/static ./.next/static
COPY --from=builder --chown=pulserank:pulserank /app/dist ./dist
COPY --from=runtime-dependencies --chown=pulserank:pulserank /app/node_modules ./node_modules
USER pulserank

FROM runtime-base AS worker
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "try{process.kill(1,0);process.exit(0)}catch{process.exit(1)}"
CMD ["bun", "dist/worker.js"]

FROM runtime-base AS runtime
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
