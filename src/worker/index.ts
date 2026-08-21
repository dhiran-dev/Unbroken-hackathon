/**
 * Worker entry point (disposition REWRITE, plan 5.3 + A0 scope).
 *
 * Boots the PulseRank worker loop: jobs are claimed from the Postgres queue
 * primitives in `@/server/jobs/queue` and dispatched fail-closed through
 * `@/server/jobs/pulse-jobs` (exact `pulse.*` names only; legacy denylisted
 * names never execute). Collect-family jobs are gated on the PULSERANK_*
 * flags via `@/config/pulserank-flags`, and SIGTERM/SIGINT drain the active
 * job before exit.
 *
 * The lifecycle implementation lives in `./pulse-worker`; this file stays as
 * the stable `bun src/worker/index.ts` / `bun run worker` entry point.
 */

import { startPulseWorker } from "./pulse-worker";

startPulseWorker();
