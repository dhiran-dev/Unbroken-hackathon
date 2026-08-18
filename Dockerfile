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
RUN DATABASE_URL=postgres://build:build@127.0.0.1:5432/unbroken_build \
  BETTER_AUTH_SECRET=build-only-not-a-runtime-secret-000000000000 \
  BETTER_AUTH_URL=http://127.0.0.1:3000 \
  bun run build
RUN bun build src/worker/index.ts --target=bun --outfile=dist/worker.js

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
USER unbroken

FROM runtime-base AS worker
HEALTHCHECK NONE
CMD ["bun", "dist/worker.js"]

FROM runtime-base AS runtime
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server.js"]
