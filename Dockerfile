# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS builder
WORKDIR /app
COPY . .
RUN bun run build
RUN bun build src/worker/index.ts --target=bun --outfile=dist/worker.js

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup -S unbroken && adduser -S unbroken -G unbroken
COPY --from=builder --chown=unbroken:unbroken /app/.next/standalone ./
COPY --from=builder --chown=unbroken:unbroken /app/.next/static ./.next/static
COPY --from=builder --chown=unbroken:unbroken /app/dist ./dist
USER unbroken
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server.js"]
