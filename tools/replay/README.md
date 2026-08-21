# tools/replay — PulseRank golden replay harness (A6)

Replays one fixture through the staged V1 ingestion pipeline and prints a
stage-by-stage JSON verdict. This is the engine behind
`tests/unit/replay/golden-replay.test.ts`, the golden regression suite over
all 15 fixtures in `src/domain/product/fixtures/`.

## Usage

```sh
bun tools/replay/run.ts --fixture src/domain/product/fixtures/per-item-mint.json
bun tools/replay/run.ts --fixture src/domain/product/fixtures/wrong-host.json --stage contract
```

Stages run **cumulatively**: `--stage validate` also executes `contract` and
`normalize` first, because each stage consumes the previous stage's output.

- `--fixture <path>` (required) — fixture file to replay.
- `--stage all|contract|normalize|validate|promote` (default `all`) — last
  stage to execute.

Output is a single JSON document on stdout; exit code `0` when every executed
stage passed, `1` when a stage failed, `2` on usage/IO errors.

```json
{
  "fixture": "src/domain/product/fixtures/wrong-host.json",
  "requestedStage": "all",
  "ok": false,
  "haltedAt": "contract",
  "stages": [
    {
      "stage": "contract",
      "ok": false,
      "findings": [
        {
          "code": "schema_invalid",
          "message": "source.url must point at caffeineinformer.com",
          "path": "source.url",
          "severity": "error"
        }
      ]
    }
  ],
  "finalRow": null
}
```

## Files

| File | Purpose |
| --- | --- |
| `adapters.ts` | The `PipelineStages` interface (`parse`, `normalize`, `validateRun`, `promote`) plus the local stand-in implementation. |
| `run.ts` | CLI + `replayFixture()` runner used by the golden test suite. |

## Adapter status — TODO-REWIRE-A5

The harness compiles standalone and does **not** import anything from
`src/server/ingestion`: A5 (normalization/promotion) is being built in a
parallel branch, and importing it here would couple the golden suite to
half-merged work.

Current local implementation:

- `parse` — real: validates raw JSON against
  `productScrapeRowV1Schema` from `src/domain/product/contracts/`
  (the contract itself, not a copy).
- `normalize` / `validateRun` / `promote` — **shape-preserving
  pass-throughs** marked `TODO-REWIRE-A5`.

At merge, rewire `localPipelineStages` in `adapters.ts` to the real
`src/server/ingestion` stage implementations behind the same
`PipelineStages` interface. The runner, CLI, and golden suite should not
need to change; the snapshots in
`tests/unit/replay/__snapshots__/` then become the regression gate for A5's
behavior on all 15 fixtures.
