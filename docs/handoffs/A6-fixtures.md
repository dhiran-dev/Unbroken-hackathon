# A6 Handoff — Golden Fixtures + Replay Harness

**Status: complete on branch `agent/fixtures` (worktree `.worktrees/fixtures`).**

A6 owns the golden regression suite for the PulseRank V1 ingestion pipeline:
the four fixture classes A3 deferred, a standalone replay harness that drives
the staged pipeline, and a snapshot-backed Vitest suite over the full
15-fixture corpus.

## What was created

| File | Purpose |
| --- | --- |
| `src/domain/product/fixtures/per-item-candy.json` | Per-item candy class: 45 mg per piece, serving `unit: "candy"`, `form: "item"`, `normalizedMl: null`. Positive. |
| `src/domain/product/fixtures/flavour-list.json` | Flavour list with mixed availability: 2 listed, 1 `appears_inactive` via strikethrough evidence, 1 `explicitly_discontinued` via explicit text; one flavour carries its own caffeine/serving (`caffeineRelation: "different"`). Positive. |
| `src/domain/product/fixtures/struck-through-flavours.json` | Strikethrough-evidence class: 2 of 3 flavours struck through on page → `appears_inactive` + `evidence: "strikethrough"`. Positive. |
| `src/domain/product/fixtures/missing-serving.json` | Total caffeine present (120 mg per container) with `serving.state: "not_published"` — the normalization edge case for A5. Positive. |
| `tools/replay/adapters.ts` | Local `PipelineStages` interface (`parse`, `normalize`, `validateRun`, `promote`) + stand-in implementation. **TODO-REWIRE-A5.** |
| `tools/replay/run.ts` | CLI (`bun tools/replay/run.ts --fixture <path> [--stage all\|contract\|normalize\|validate\|promote]`) and the exported `replayFixture()` runner used by the test suite. |
| `tools/replay/README.md` | Harness usage, output contract, and the rewire-at-merge instructions. |
| `tests/unit/replay/golden-replay.test.ts` | Golden regression suite over all 15 fixtures. |
| `tests/unit/replay/__snapshots__/golden-replay.test.ts.snap` | Committed golden snapshots of stage verdicts + final-row shape projection per fixture. |
| `docs/handoffs/A6-fixtures.md` | This handoff. |

## Fixture content notes

All four follow the exact shape/key order of the existing fixtures (same
collector block, `schemaVersion: "1.0"`, Caffeine Informer-style rawText).
They are synthetic but realistic; no real product claims are asserted.

- **per-item-candy**: mirrors `per-item-mint.json`; the point is that a
  non-ml unit passes through with `normalizedMl: null`.
- **flavour-list**: exercises every `availability` value and three of four
  `flavourEvidence` values in one row.
- **struck-through-flavours**: dedicated density case for strikethrough
  evidence (A3 only had one such flavour inside `conflicting-variant.json`).
- **missing-serving**: caffeine total present while serving is
  `not_published` — downstream ranking must not invent a per-serving number.

## Harness design

- Stages run **cumulatively** (`--stage validate` also runs contract +
  normalize); each executed stage prints a `{stage, ok, findings}` verdict;
  exit code 0 only when all executed stages pass.
- `parse` uses the real zod schemas from
  `src/domain/product/contracts/product-scrape-row.schema.ts` — the contract,
  not a copy. The two negative classes fail here:
  `invalid-negative.json` on the non-negativity refinement,
  `wrong-host.json` on the caffeineinformer.com host pin.
- `normalize` / `validateRun` / `promote` are **shape-preserving
  pass-throughs marked TODO-REWIRE-A5** so the harness compiles standalone.
  A5 runs in a parallel branch and is deliberately NOT imported.

### Rewire at merge (for A5)

Replace the bodies of `normalize`, `validateRun`, and `promote` in
`tools/replay/adapters.ts` with calls into `src/server/ingestion`, keeping
the `PipelineStages` signature (`StageResult<T>` with `{stage, ok, output,
findings}`). The CLI, runner, and golden suite should need no changes; once
rewired, the committed snapshots become the regression gate for A5's actual
behavior on all 15 fixtures (snapshots will need one intentional update via
`vitest -u` if A5's stage outputs legitimately differ).

## Test run

Vitest resolves from the parent checkout's `node_modules` (worktree has none
of its own), same as recorded in A3's handoff.

```
$ bun tools/replay/run.ts --fixture src/domain/product/fixtures/per-item-mint.json
→ ok: true, all four stages pass, exit code 0

$ bun tools/replay/run.ts --fixture src/domain/product/fixtures/wrong-host.json --stage contract
→ ok: false, haltedAt: "contract",
  finding: "source.url must point at caffeineinformer.com", exit code 1

$ bun run vitest run tests/unit/replay/golden-replay.test.ts   # twice
Test Files  1 passed (1)
      Tests  37 passed (37)      # second run validates against committed snapshots
  Snapshots  15 written          # first run only
```

Full-suite result appended below after the final run.

<!-- TEST_RUN -->

```
$ bun run test   # vitest 4.1.11, run 2026-08-21 from the worktree
Test Files  99 passed (99)    # full suite, includes the new golden-replay file
     Tests  865 passed (865)
```

## Assumptions

- "The two negatives" = `invalid-negative.json` + `wrong-host.json`, per the
  A3 handoff and §8.6; the four new classes are all positives.
- Snapshot scope: verdicts (`ok`, `haltedAt`, per-stage `{stage, ok,
  findings}`) plus a compact final-row shape projection (flavour
  availability/evidence, primary caffeine state/value/qualifier, serving
  state). Full rows are already pinned by the fixture files themselves; this
  keeps the .snap reviewable while still catching contract drift.
- `import.meta.main` guards the CLI entrypoint so importing `run.ts` from
  Vitest does not execute `main()`.

## Unresolved risks

- Snapshots encode current pass-through behavior; the first A5 rewire will
  require a deliberate `vitest -u` refresh. That refresh should be reviewed
  like any contract change.
- If A5's real stages emit their own findings (e.g. normalization warnings),
  the suite's assertion that placeholder stages return empty findings must be
  relaxed at rewire time (it lives in
  `tests/unit/replay/golden-replay.test.ts`, "every positive fixture passes
  all four stages").
