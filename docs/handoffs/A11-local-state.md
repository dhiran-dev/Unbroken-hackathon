# A11 Handoff — Browser-Only Personalization Layer (local-state)

**Status: DONE — 9 modules, 10 test files, `bun run typecheck` + `bun run test` green (1133 tests / 120 files).**

Branch `agent/local-state` (worktree `.worktrees/local-state`), fast-forwarded onto
`pulserank-rebuild` (94f423f → 2174c46) before starting; untracked local-state files preserved.

## What was created

Under `src/lib/local-state/` — browser-only personalization state, all namespaced under
`pulserank:v1`, all SSR-safe (importing or calling any function without `window`/`indexedDB`
never throws; reads degrade to empty results, writes degrade to no-ops):

| File | Purpose |
| --- | --- |
| `keys.ts` | Namespaced constants: `pulserank:v1:preferences`, `:saved-products`, `:compare`, `:my-day`, `:last-seen`; `PULSERANK_LOCAL_STATE_VERSION = 1`. Never touches legacy `unbroken:*`. |
| `storage.ts` | Lazy guarded `localStorage` helpers (`readJsonStorage`/`writeJsonStorage`/`removeStorageKey`). Corrupt JSON parses as "missing"; throwing storage (quota, private mode, hardened browsers) degrades to no-ops. |
| `db.ts` | Shared IndexedDB plumbing: database `pulserank` v1, one `upgradeneeded` pass creating stores `saved-products` (keyPath `slug`, index `savedAt`), `my-day` (keyPath `id`, index `date`), `recently-viewed` (keyPath `slug`, index `viewedAt`). `withDatabase()` resolves `null` instead of throwing when IDB is missing/blocked. |
| `preferences.ts` | `PulsePreferences` (theme, reducedMotionOverride, defaultCategory) in localStorage. Safe-parse: unknown/mistyped fields dropped, corrupt payloads → defaults; `updatePreferences` merges patches. |
| `saved-products.ts` | Saved product snapshots (`SavedProductRef` DTO + `savedAt`) in IndexedDB. Record-level sanitizers guard reads/imports; list ordered `savedAt` desc. |
| `compare.ts` | Compare tray in localStorage: string slug array capped at `MAX_COMPARE_ITEMS = 4`. Adding to a full tray is a silent no-op (no eviction). Mutations report `added` only when the write actually persisted. |
| `my-day.ts` | Per-date caffeine entries in IndexedDB, grouped by validated `YYYY-MM-DD` strings (impossible dates like `2026-02-31` rejected). Pure grouping/sorting helpers; in-day order `timeLabel` asc then `createdAt`. |
| `recently-viewed.ts` | Viewed-product records in IndexedDB capped at `RECENTLY_VIEWED_CAP = 50`: touching a slug dedupes it, bumps it to newest, evicts the oldest beyond the cap. Stored key always mirrors the embedded ref's slug. |
| `export-import.ts` | Whole-store export/import as a versioned envelope (`pulserankLocalStateVersion: 1` + `exportedAt`). `validateLocalStateEnvelope` rejects structural violations (non-object, wrong version, bad `exportedAt`, section of wrong type) and drops individual invalid records so one bad row can't lose a backup. Import validates everything before writing anything; each store is replaced wholesale (clear-then-write) with original timestamps preserved. |

Fixes applied during review (previous agent left the suite red):

- `compare.ts`: `addCompareSlug`/`removeCompareSlug`/`replaceCompareSlugs` ignored the
  `writeJsonStorage` result, so server/quota-failed writes reported success
  (`added: true`, stale list). They now report only persisted state.
- `export-import.ts`: the envelope's `compare` section is now canonicalized through the
  same sanitizer as the tray (strings only, trimmed, deduped, capped at 4), so validated
  envelopes match what `importAll` actually writes.
- `recently-viewed.test.ts`: two assertions contradicted the module's documented
  key-mirroring semantics; tests updated (invalid-key and invalid-ref-body now cover
  the `TypeError` paths; divergent outer slug now asserts normalization).

## Test coverage

`tests/unit/lib/local-state/` (vitest, node environment, `@` → `src` alias; no config changes):

| File | Coverage |
| --- | --- |
| `mock-storage.ts` | Map-backed `MockLocalStorage` + `installBrowserStorage`/`uninstallBrowserStorage` (the shared browser-faking pattern; also seeds corrupt raw payloads). |
| `fixtures.ts` | `makeSavedProductRef` valid-ref factory. |
| `keys.test.ts` | Exact key constants, `pulserank:v1` namespace (never `unbroken:*`), version pin. |
| `storage.test.ts` | SSR no-storage degradation; browser round-trip/remove; primitive + `null` serialization; corrupt JSON as missing; throwing `getItem`/`setItem`/`removeItem` degrade; throwing `localStorage` **accessor** → `null`. |
| `db.test.ts` | Constants; `isIndexedDbAvailable` both ways; `withDatabase` resolves `null` on SSR and when `indexedDB.open` throws; `requestToPromise`/`transactionToPromise` resolve/reject via manually-fired callbacks (fake request/transaction stand-ins). |
| `preferences.test.ts` | SSR defaults/no-op saves; browser round-trip, corrupt payload → defaults, unknown-field dropping, patch merging, clear; pure sanitizer cases. |
| `compare.test.ts` | SSR reads-empty + mutations report `added: false`; add/dedupe, hard cap of 4 without eviction, remove/toggle, membership, corrupt recovery, sanitize-on-read, replace, clear; pure parse/sanitize. |
| `saved-products.test.ts` | SSR reads-empty/writes-no-op; pure ref sanitizers (13 invalid shapes), `toStoredSavedProduct` stamping + deep copy, `sanitizeStoredSavedProduct` savedAt handling. |
| `my-day.test.ts` | SSR reads-empty/writes-no-op with input validation (`TypeError` on bad date/entry); `isDateString` real vs impossible dates; record building + distinct ids; grouping (sorted keys, in-day order, storage-field stripping); non-mutating sort; entry/record sanitizers. |
| `recently-viewed.test.ts` | SSR reads-empty/writes-no-op with `TypeError` on invalid key/ref; merge dedupe + newest-first + cap-50 eviction + non-mutation; sanitizer accept/reject/normalize (key mirrors ref slug). |
| `export-import.test.ts` | Envelope validation: minimal + full acceptance, 15 structural rejections with reasons, per-record drop-not-reject, corrupt preferences → defaults; SSR empty export / zero-count import / throw-before-write on invalid; localStorage-only import + export round-trip; absent/empty compare section leaves tray untouched. |
| `ssr-safety.test.ts` | Imports **all nine modules** fresh in a runtime with no `window`/`localStorage`/`indexedDB` — import must be side-effect free; pins db name/version/store names. |

## Gaps / known limitations

1. **No real IndexedDB round-trip under test.** `fake-indexeddb` is NOT in
   `package.json` and installing dependencies was out of scope for A11, so the
   browser-path IDB code (`withDatabase` upgrade pass, put/get/getAll/index reads,
   transaction commit) is covered only by SSR-null paths, pure logic, and
   manually-fired promise-wrapper fakes. **Follow-up:** add `fake-indexeddb` as a dev
   dependency and add round-trip tests for saved-products / my-day /
   recently-viewed / export-import against a real IDB implementation.
2. **`db.onversionchange` / `onblocked` paths** (connection close + cache reset) are
   untestable without a real IDB — same follow-up as above.
3. `SAVED_PRODUCTS_STORAGE_KEY`, `MY_DAY_STORAGE_KEY`, and `LAST_SEEN_STORAGE_KEY` are
   reserved (constants + tests) but unused: saved products and my-day live in IndexedDB
   by spec. They keep the namespace stable for a future lightweight mirror/fallback.
4. No React integration yet — this layer is headless by design; UI wiring (save button,
   compare tray, my-day planner, export/import settings panel) is downstream work.
