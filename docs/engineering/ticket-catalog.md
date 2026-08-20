# SF Citywide tracer-ticket catalog

This committed catalog is the live tracker. It fixes scope, blocking edges, ownership, acceptance, and checkpoint evidence before implementation.

## Requirements on every ticket

Every ticket records its goal and visible outcome, non-goals, blocking ticket IDs, interfaces consumed/produced, owned paths, shared files it may not edit, migration ownership, required fixtures, unit/integration/browser acceptance, failure and rollback behavior, affected public copy, security checklist, accessibility checklist, owner role, status, verification commands, and completion commit.

All tickets inherit these rules:

- Use `CONTEXT.md`, the product spec, relevant ADRs, and `interfaces.md` as authority.
- Implement with `gpt-5.6-sol` at high reasoning and complete a first-pass spec/standards review with the same model.
- Use TDD at the highest stable interface and keep the existing suite green.
- The implementation agent does not edit shared integration files, push, deploy, or close tickets, alter collector IDs, or change product/architecture decisions.
- The primary agent performs secondary review, shared integration, full testing, Git delivery, deployment, and browser verification.
- Failure closes safely: preserve the last trusted snapshot, keep unknown evidence unknown, suppress unsafe side effects, and expose plain rider wording.
- No secret, raw production payload, email address in job data, internal OTP URL, model reasoning, or unsanitized artifact is committed or returned publicly.
- Keyboard access, focus visibility, semantic labels, reduced motion, text equivalents, 360-pixel layout, dark mode, and contrast are required for every visible change.

## Phase 1 checkpoint

- **Status**: complete
- **Verification**: `BETTER_AUTH_URL=https://unbroken.fifthavatar.com NEXT_PUBLIC_APP_URL=https://unbroken.fifthavatar.com bun run check` — lint, types, 35 unit tests, production build, and release check passed; `bun run test:e2e` — 18 desktop/mobile tests passed and 4 credentialed tests skipped
- **Completion commit**: the commit containing this Phase 1 checkpoint

## Phase 2 — Citywide data foundation

### SF-DATA-01 — Promote a validated Muni schedule snapshot

- **Owner**: Transit data
- **Status**: complete
- **Goal and visible outcome**: Download official operator `SF` GTFS, stage and validate it, atomically promote it, and show database-derived coverage counts.
- **Non-goals**: Realtime, candidate routing, public journey UI.
- **Blocked by**: Phase 1.
- **Interfaces**: Produces active schedule access for `TransitCatalog` and `TransitCoverage`; consumes the source-trust contract.
- **Owned paths**: Transit domain/server, transit schema, import scripts/fixtures, coverage tests.
- **Shared files not edited**: Integration-owner list in `README.md`.
- **Migration**: Sole owner of `0002_citywide_transit.sql` and its generated metadata integration request.
- **Fixtures/tests**: Minimal valid feed; missing required file; broken reference; expired calendar; contraction; invalid coordinate/time; repeat import; empty/current schema migration.
- **Failure/rollback**: Reject before promotion and retain previous active snapshot; disable `CITYWIDE_DATA_ENABLED`.
- **Public copy**: Coverage counts and distinct checked/source times only.
- **Security/accessibility**: Token server-only; coverage table has accessible headings and status text.
- **Verification**: `bun run transit:verify` — current migration present, fresh isolated schema created 16 citywide tables, promotion/repeat/stale paths returned promoted/unchanged/rejected, and database readback matched 2 stops, 1 route, 1 trip, 2 stop times, 1 service, and 2 shape points; official SF feed validation recorded 3,238 stops, 68 routes, 50,690 trips, 1,901,119 stop times, 6 service IDs, and 45,308 shape points; `BETTER_AUTH_URL=https://unbroken.fifthavatar.com NEXT_PUBLIC_APP_URL=https://unbroken.fifthavatar.com bun run check` — lint, types, 78 unit tests, production build, and release check passed; `bun run test:e2e` — 20 desktop/mobile tests passed and 4 credentialed mutation tests skipped.
- **Completion commit**: `864280b5e6d969f4b3986e754b4ae02f71d91c56`.

### SF-DATA-02 — Publish trusted accessibility advisories

- **Owner**: Transit data
- **Status**: complete — verified and pushed
- **Goal and visible outcome**: Collect every filtered accessibility advisory, validate it, and expose normalized current service changes with provenance.
- **Non-goals**: Journey selection and UI layout.
- **Blocked by**: SF-DATA-01.
- **Interfaces**: Produces source observations for `AccessibilityEvidence` and public status.
- **Owned paths**: Transit advisory adapter, contract, fixtures, source tests.
- **Shared files not edited**: Integration-owner list.
- **Migration**: Uses tables created by SF-DATA-01; no migration edit.
- **Fixtures/tests**: Pagination, detail navigation, malformed collection time, missing affected entity, duplicate advisory, stale response, layout drift.
- **Failure/rollback**: Retain previous advisory snapshot; emit no service event; flag unavailable/older.
- **Public copy**: Short service-change wording plus both timestamps and official link.
- **Security/accessibility**: Sanitize source text/URLs; warnings use text and icon, not color alone.
- **Verification**: bun run transit:verify — isolated migration/store checks promoted 11 advisories, refreshed an unchanged snapshot, retained trusted rows after rejection/stale attempts, and recorded safe failure evidence; live fixed-source refresh promoted 11 advisories and public readback returned current with no invented SFMTA timestamp; bun run check — lint, types, 93 unit tests, production build, and release check passed; bun run test:e2e — 20 desktop/mobile tests passed and 4 credentialed mutation tests skipped.
- **Completion commit**: 0e28ed17a614e5df9e58f84d1b9cb573ffa35d39.

### SF-DATA-03 — Preserve every trusted moved-stop row

- **Owner**: Transit data
- **Status**: complete — verified and pushed
- **Goal and visible outcome**: Collect and validate all relocation rows, including nullable applicants and same-stop records with different destinations.
- **Non-goals**: Rewriting journey instructions.
- **Blocked by**: SF-DATA-02.
- **Interfaces**: Produces moved-stop observations for `AccessibilityEvidence` and public status.
- **Owned paths**: Transit relocation adapter, contract, fixtures, source tests.
- **Shared files not edited**: Integration-owner list.
- **Migration**: Uses SF-DATA-01 schema.
- **Fixtures/tests**: Six-row baseline, null or absent applicant, duplicate stop/different destination, missing coordinates retained as unknown, invalid dates, intercepted JSON drift.
- **Failure/rollback**: Keep prior trusted moves and mark source unavailable/older.
- **Public copy**: “Board at …” and clear effective dates; no applicant shown to riders.
- **Security/accessibility**: Bound/sanitize intercepted content; moved location is always present in text, while map consumers must not invent a moved point when the source omits coordinates.
- **Verification**: The official SFMTA envelope passed the production contract with 6 rows and `sourceUpdatedAt=2026-08-19T12:05:34.000Z`; the fixed live collector returned an empty completed dataset and was rejected with no active snapshot; `bun run transit:verify` passed promotion, unchanged provenance, rejection retention, changed-state promotion, verified A→B→A restoration, and stale-baseline rejection in an isolated schema with 12 historical relocation rows and 1 safe failure record; `bun run check` passed lint, types, 109 unit tests, production build, and release scan; `bun run test:e2e` passed 20 desktop/mobile browser tests with 4 credentialed mutations skipped; `bun run db:generate` reported no schema changes.
- **Completion commit**: `5360ad1`.

### SF-DATA-04 — Publish reviewed accessible-stop guidance

- **Owner**: Transit data
- **Status**: complete
- **Goal and visible outcome**: Deterministically parse v3 underground and surface-rail guidance into reviewed stop evidence.
- **Non-goals**: Inferring sidewalks, curb ramps, or unlisted entrances.
- **Blocked by**: SF-DATA-03.
- **Interfaces**: Produces station/stop evidence for `AccessibilityEvidence` and `TransitCatalog` descriptions.
- **Owned paths**: Transit accessible-stop adapter, parser, fixtures, review tests.
- **Shared files not edited**: Integration-owner list.
- **Migration**: Uses SF-DATA-01 schema.
- **Fixtures/tests**: Underground sections, 41-entry surface baseline, missing wheelchair status, reordered sections, unknown stop, structural drift.
- **Failure/rollback**: Unknown stays unknown; previous reviewed guidance remains active.
- **Public copy**: Exact reviewed guidance only; never “wheelchair-safe.”
- **Security/accessibility**: Sanitize rich text; instructions retain semantic order.
- **Verification**: The fixed live v3 collector promoted 52 reviewed guides; all public stop IDs remain null, all accessibility states remain unknown, no internal guide IDs or “wheelchair-safe” claim are exposed, `checkedAt=2026-08-19T19:59:40.918Z`, and `sourceUpdatedAt=null` because SFMTA publishes no update time for this page. `bun run transit:verify` passed atomic promotion, unchanged provenance, safe rejection retention, equal-time changed-payload rejection, verified A→B→A restoration, public readback, and stale-baseline rejection in an isolated schema with 104 historical guide rows and 1 safe failure record. `BETTER_AUTH_URL=https://unbroken.local bun run check` passed lint, types, 122 unit tests, production build, and release scan. `bun run test:e2e` passed 20 desktop/mobile browser tests with 4 credentialed mutations skipped. T3 reached the canonical SFMTA page and verified its title; its snapshot channel timed out, so the full Playwright suite is the local browser evidence.
- **Completion commit**: `3978119`.

### SF-OTP-01 — Build the private pinned SF routing service

- **Owner**: OTP deployment
- **Status**: complete — verified and pushed
- **Goal and visible outcome**: Build and serve a reproducible OTP 2.9.0 graph from the active GTFS and pinned SF OSM input; verify a candidate from 24th Street to Fisherman’s Wharf.
- **Non-goals**: Public OTP exposure and UNBROKEN evidence decisions.
- **Blocked by**: SF-DATA-01.
- **Interfaces**: Produces the private OTP health and GraphQL seam consumed by `RouteEngine`.
- **Owned paths**: `deploy/otp/**`, OTP fixtures, health and deployment tests.
- **Shared files not edited**: Dockerfile and environment schema.
- **Migration**: None.
- **Fixtures/tests**: Pinned hashes/digest, graph success/failure, readiness, no-public-port assertion, sample candidate.
- **Failure/rollback**: Retain prior healthy graph/service; disable citywide planner if no valid graph.
- **Public copy**: Only “Current updates are unavailable” when planning cannot operate.
- **Security/accessibility**: Private network only; no credentials or internal URLs in errors.
- **Verification**: The authoritative active-database export matched 3,238 stops, 68 routes, 50,690 trips, 1,901,119 stop times, 6 services, and 45,308 shape points; it produced a deterministic 109,852,353-byte GTFS ZIP with SHA-256 `001ead2000773e7569435a6e14b0906bbef907900388dd81e506df472c34d9ae`, bound to active archive SHA-256 `e3fa3823286462e892aba89f3764e3e5bde8d9aaf9760b89261faf434c27192c`. The real OTP 2.9.0 build produced a 62,091,935-byte graph with SHA-256 `086089d02d2ad6ef3758ed1be19537a49ffd51a35b3a52f79bd080e39c50e582`, 121,795 vertices, 330,433 edges, 3,238 stops, 287 patterns, and 46,657 constrained transfers. The private service reported `UP`; the 24th Street-to-Fisherman’s Wharf probe returned 5/5 transit candidates, while the hard-wheelchair probe correctly returned zero because GTFS accessibility is unknown. Six focused files / 19 tests passed, including the real operator shell seam for failed-probe retention, success-only promotion, runtime restrictions, and stale-current refusal. `BETTER_AUTH_URL=https://unbroken.local NEXT_PUBLIC_APP_URL=https://unbroken.local bun run check` passed lint, types, 141 unit tests, production build, and release scan. `bun run test:e2e` passed 20 desktop/mobile tests with 4 credentialed tests skipped. T3 could not attach to the environment’s private ports; Playwright is the browser evidence and the inaccessible OTP port is consistent with no public exposure.
- **Completion commit**: `29aca6f`.

### SF-PLACE-01 — Search every selectable stop and approved place

- **Owner**: Transit data
- **Status**: complete
- **Goal and visible outcome**: Search all active stops/stations and approved landmarks by name, code, route, parent, and alias.
- **Non-goals**: Arbitrary addresses or accepting unselected text.
- **Blocked by**: SF-DATA-01 and SF-DATA-04.
- **Interfaces**: Implements `TransitCatalog` and `GET /api/public/places`.
- **Owned paths**: Transit catalog module, place endpoint, landmark seed, fixtures/tests.
- **Shared files not edited**: Root navigation and environment schema.
- **Migration**: Uses SF-DATA-01 schema.
- **Fixtures/tests**: All mandatory landmarks, route/stop-code aliases, nearby grouping, invalid coordinates, inactive stops, performance dataset.
- **Failure/rollback**: Return no speculative choices; compatibility station list remains.
- **Public copy**: Nearby stops, Stations, Places, and “Choose a place from the list.”
- **Security/accessibility**: Bound and normalize queries; list semantics and stable option labels.
- **Verification**: The configured database seed was idempotent at 24/24 active reviewed landmarks. The public `TransitCatalog` seam exhaustively resolved all 3,238 active stops/stations and all 24 approved landmarks, with zero missing choices, while retaining the trusted active coverage of 68 routes, 50,690 trips, 1,901,119 stop times, 6 services, and 45,308 shape points. Route associations are scanned once per active GTFS snapshot; reviewed-place changes use a deterministic content revision and reuse the cached transit scan. Three focused files / 22 tests passed, including bounded search, route/parent/alias matching, inactive-stop exclusion, landmark invalidation, defensive result copies, and a 12,000-stop warm-search performance fixture. `BETTER_AUTH_URL=https://unbroken.local NEXT_PUBLIC_APP_URL=https://unbroken.local bun run check` passed lint, types, 163 unit tests, production build, and release scan. `CITYWIDE_PLANNER_ENABLED=true bun run test:e2e` passed 20 desktop/mobile tests with 4 credentialed tests skipped. The T3 preview could not navigate to this environment, so Playwright is the browser evidence. Remote configured-database warm samples were 307–510 ms; the ticket's in-process p95 gate passes, while production-topology p95 remains an explicit Phase 4 deployment verification item.
- **Completion commit**: `e0f360d`.

## Phase 3 — Realtime accessibility-aware journey engine

### SF-REALTIME-01 — Poll current Muni updates within one shared budget

- **Owner**: Transit data
- **Status**: complete
- **Goal and visible outcome**: Persist validated trip updates, vehicles, and alerts while staying at or below 52 requests per hour.
- **Non-goals**: Candidate ranking or live map UI.
- **Blocked by**: SF-DATA-01.
- **Interfaces**: Implements `RealtimeTransit`; produces current feed snapshots.
- **Owned paths**: Realtime transit adapters, poll jobs, budget module, fixtures/tests.
- **Shared files not edited**: Queue integration and environment schema.
- **Migration**: Uses SF-DATA-01 schema.
- **Fixtures/tests**: Cancellation, delay, vehicle bounds, alert periods, bad references, stale headers, protobuf/JSON failure, concurrent budget claims.
- **Failure/rollback**: Ignore invalid/stale realtime and preserve static planning; stop polling via data flag.
- **Public copy**: Updates unavailable/older; no protocol names.
- **Security/accessibility**: Token never logged; live markers have text equivalents.
- **Verification**: The shared rolling-hour ledger admitted exactly 52 of 53 concurrent claims across 12 independent Postgres connections, used the database clock, and still deferred after a fresh connection; its disposable schema was removed. The production 511 boundary was verified without saving raw payloads: exact PascalCase service-alert JSON normalized successfully, vehicle positions with no trip assignment stayed outside `VehicleView`, partial descriptors still rejected, and the normal entrypoint returned `not_due` for all three feeds immediately after polling. Configured reads published 333 referenced vehicles from 566 source entities and 16 current alerts. Trip updates remained unavailable because 58 of 21,036 delay fields exceeded the fixed ±6-hour plausibility bound, including extreme negative values; the deterministic gate was deliberately retained. Ten focused files / 34 tests and 36 repository files / 197 tests passed. The full lint, type, production build, and release gate passed before the final narrow regression; the settled source then passed focused tests, full typecheck, formatting, and diff checks. T3 preview status was available but navigation/open/snapshot failed; this ticket adds no rider-facing route, so the successful production build is the applicable surface-regression evidence.
- **Completion commit**: `0870be0`.

### SF-ROUTE-01 — Normalize up to five static journey candidates

- **Owner**: Journey planning
- **Status**: complete
- **Goal and visible outcome**: Convert private OTP GraphQL results into stable walking, waiting, riding, and transfer candidates.
- **Non-goals**: Accessibility confirmation or rider wording.
- **Blocked by**: SF-OTP-01 and SF-PLACE-01.
- **Interfaces**: Implements `RouteEngine`; consumes private OTP seam and catalog place resolution.
- **Owned paths**: Journey engine adapter, normalization, fixtures/tests.
- **Shared files not edited**: Environment schema.
- **Migration**: None.
- **Fixtures/tests**: Bus, Metro, mixed, zero/one/multiple transfer, no itinerary, malformed geometry/time, timeout.
- **Failure/rollback**: Return typed unavailable result; never leak GraphQL/internal URL.
- **Public copy**: None directly.
- **Security/accessibility**: Validate response size/shape; geometry supports later text-equivalent itinerary.
- **Verification**: The production boundary posts the fixed neutral static query to a private-only OTP origin, caps and validates the response, cancels rejected bodies, and collapses provider detail to one safe typed error. Normalization rejects disconnected places or geometry, preserves valid null headsigns, emits stable deduplicated candidates, and makes no accessibility claim. Thirty-eight focused seam tests and 235 repository tests passed, along with full lint, TypeScript, production build, release scan, formatting, and diff checks. The collaborative browser was attached but its navigation, open, and snapshot actions failed while the local server was ready; this ticket adds no rider-facing route, so the successful production build is the applicable surface-regression evidence. The private OTP runtime URL and container tooling were not attached to this environment, so a live private plan query remains an integration risk for deployment verification.
- **Completion commit**: `fa7898f`.

### SF-ROUTE-02 — Apply current accessibility and service evidence

- **Owner**: Journey planning
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Block disrupted candidates and classify every leg dependency as confirmed, unknown, or blocked.
- **Non-goals**: Final wording and API handler.
- **Blocked by**: SF-DATA-02, SF-DATA-03, SF-DATA-04, SF-REALTIME-01, and SF-ROUTE-01.
- **Interfaces**: Implements `AccessibilityEvidence`; consumes trusted source observations and realtime views.
- **Owned paths**: Journey evidence module, fixtures/tests.
- **Shared files not edited**: Existing collector/incident implementation and integration files.
- **Migration**: None.
- **Fixtures/tests**: Elevator outage, unknown stop, move, cancellation, delay, alert, stale realtime, unavailable source, mismatched entity.
- **Failure/rollback**: Unknown remains unknown; invalid realtime is excluded; no source failure becomes a transit event.
- **Public copy**: Reason codes map later to approved plain warnings.
- **Security/accessibility**: Public reasons are allowlisted and never expose raw source text.

### SF-ROUTE-03 — Select and describe journeys deterministically

- **Owner**: Journey planning
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Rank assessed candidates, calculate current duration, create stable instructions, and produce an internal change fingerprint.
- **Non-goals**: HTTP handling, map rendering, or AI wording.
- **Blocked by**: SF-ROUTE-02.
- **Interfaces**: Provides the core `JourneyPlanner` behavior consumed by route/API and notification modules.
- **Owned paths**: Journey selection, instruction templates, fingerprint module, fixtures/tests.
- **Shared files not edited**: Fireworks modules and integration files.
- **Migration**: None.
- **Fixtures/tests**: Ranking order, confirmed vs faster unknown, transfers, walking duration, same input determinism, each change-fingerprint category.
- **Failure/rollback**: Return check/unavailable states conservatively; compatibility planner continues behind flag.
- **Public copy**: Exact four state labels and mapped-stairs sidewalk caveat.
- **Security/accessibility**: No LLM/network other than module adapters; instructions have ordered text.

### SF-ROUTE-04 — Serve one citywide journey vertical slice

- **Owner**: Journey planning
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Validate a citywide request and return one complete `JourneyPlan` with legs, warnings, changes, sources, and map data.
- **Non-goals**: Browser UI and saved commutes.
- **Blocked by**: SF-ROUTE-03.
- **Interfaces**: Implements `JourneyPlanner` public seam and `POST /api/public/journeys`.
- **Owned paths**: Journey facade, public endpoint, contract/integration tests.
- **Shared files not edited**: Environment schema and root navigation.
- **Migration**: None.
- **Fixtures/tests**: Catalog/current location, invalid/unselected place, same endpoints, out of area, OTP down, all four result states, source provenance.
- **Failure/rollback**: Flagged endpoint returns plain unavailable; existing route adapter remains.
- **Public copy**: Full journey wording and prominent source labels.
- **Security/accessibility**: Rate/size/coordinate validation; safe URLs; response supports a complete text itinerary.

## Phase 4 — Public planner and map

### SF-UI-01 — Select places and use current location accessibly

- **Owner**: Public experience
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Deliver keyboard-accessible From/To selection, swap, leave-time choice, and a clear GPS flow.
- **Non-goals**: Map and journey cards.
- **Blocked by**: SF-PLACE-01 and SF-ROUTE-04.
- **Interfaces**: Consumes places/journey routes; produces validated `JourneyRequest` intent.
- **Owned paths**: Public planner components/page and browser tests.
- **Shared files not edited**: Root navigation, package/lock, environment schema.
- **Migration**: None.
- **Fixtures/tests**: Search/select, unselected text, swap, GPS allowed/denied/inaccurate/outside, now/future, keyboard.
- **Failure/rollback**: Form remains usable without GPS/map; disable planner flag for compatibility surface.
- **Public copy**: From, To, Use my location, Leave now, Find a step-free route.
- **Security/accessibility**: No coordinates logged; combobox roles, focus, errors, and touch targets pass.

### SF-MAP-01 — Render every active stop without clustering

- **Owner**: Map
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Lazy-load a CARTO/MapLibre map and display every active stop as an individual point in light/dark mode.
- **Non-goals**: Journey geometry and live vehicles.
- **Blocked by**: SF-DATA-01.
- **Interfaces**: Implements stops GeoJSON route and consumes versioned active feed hash.
- **Owned paths**: Map components/hooks/icons, stop route, performance/browser tests.
- **Shared files not edited**: Package/lock and environment schema.
- **Migration**: None.
- **Fixtures/tests**: Full 3,238-stop baseline, `cluster: false`, cache headers/version, style switch, zoom labels, hit areas, load failure.
- **Failure/rollback**: Text planner remains complete; map error is non-blocking; flag can hide citywide map.
- **Public copy**: Plain map unavailable fallback.
- **Security/accessibility**: Safe style allowlist, attribution, no token in client URL, text alternative.

### SF-MAP-02 — Show the selected journey and current changes

- **Owner**: Map
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Draw legs and emphasize origin, destination, transfers, entrances, moved stops, warnings, and current vehicles.
- **Non-goals**: Candidate selection.
- **Blocked by**: SF-MAP-01, SF-ROUTE-04, and SF-REALTIME-01.
- **Interfaces**: Consumes `JourneyPlan`, stops GeoJSON, and public live route.
- **Owned paths**: Map layers, camera/source hooks, icons, browser/performance tests.
- **Shared files not edited**: Integration files.
- **Migration**: None.
- **Fixtures/tests**: Fly-to, fit-bounds, 500–700 ms animation, reduced motion, source-only vehicle refresh, moves/outages, dense stops.
- **Failure/rollback**: Preserve text result; stop live refresh without rebuilding map.
- **Public copy**: Accessible legend names and current-warning descriptions.
- **Security/accessibility**: Validate bounds/filter; non-color icon shapes and synchronized text selection.

### SF-UI-02 — Present a plain-language citywide journey

- **Owner**: Public experience
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Show status, arrival, short steps, warnings, changes, and source provenance in a responsive journey result.
- **Non-goals**: Account/schedule controls.
- **Blocked by**: SF-UI-01, SF-MAP-02, and SF-ROUTE-04.
- **Interfaces**: Consumes `JourneyPlan`; produces the public itinerary surface.
- **Owned paths**: Public journey components/page and browser/accessibility tests.
- **Shared files not edited**: Root navigation.
- **Migration**: None.
- **Fixtures/tests**: Four states, current/older/unavailable, long names, 360 px, dark mode, reduced motion, jargon scan, axe.
- **Failure/rollback**: Existing planner remains behind flag; map failure does not remove steps.
- **Public copy**: Exact approved states, caveat, Checked by UNBROKEN, SFMTA updated, Official source.
- **Security/accessibility**: Safe external links; heading/focus/live-region order; no color-only state.

### SF-UI-03 — Expand public status to all current citywide changes

- **Owner**: Public experience
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Show elevators, advisories, moved stops, accessible-stop guidance, freshness, and official links in one searchable status surface.
- **Non-goals**: Operator evidence and raw feeds.
- **Blocked by**: SF-DATA-02, SF-DATA-03, SF-DATA-04, and SF-REALTIME-01.
- **Interfaces**: Implements expanded `GET /api/public/status` and consumes trusted source snapshots.
- **Owned paths**: Public status module/page/components and tests.
- **Shared files not edited**: Root navigation.
- **Migration**: None.
- **Fixtures/tests**: Current/older/unavailable per source, empty changes, moves, advisories, 11-station compatibility, search, jargon scan.
- **Failure/rollback**: Each source degrades independently; trusted elevator behavior remains.
- **Public copy**: Short source-specific status plus distinct time labels.
- **Security/accessibility**: Public allowlist excludes collector/internal evidence; semantic filters and lists.

## Phase 5 — Google riders and saved commutes

### SF-AUTH-01 — Separate Google riders from password operators

- **Owner**: Rider admission
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Add the rider role and Google-only public entry while preserving separate owner/admin password login.
- **Non-goals**: Capacity reservation and saved schedules.
- **Blocked by**: SF-UI-02 and SF-UI-03.
- **Interfaces**: Extends authentication session/role seams and Google callback policy.
- **Owned paths**: Auth module, rider schema, public sign-in components, role tests.
- **Shared files not edited**: Package/lock, environment schema, schema index.
- **Migration**: Sole owner of `0003_rider_accounts.sql` integration request.
- **Fixtures/tests**: New/existing Google rider, password signup disabled, operator login, linking attempt, rider admin denial, scope list.
- **Failure/rollback**: Turn off public Google flag; operator login remains.
- **Public copy**: Continue with Google; operator page retains Sign in.
- **Security/accessibility**: `openid email profile` only; tokens/state never logged; focused, labeled provider action.

### SF-AUTH-02 — Admit at most forty rider accounts atomically

- **Owner**: Rider admission
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Reserve capacity before first Google account creation, activate success, expire abandoned claims, and pause on email circuit state.
- **Non-goals**: Provider email sending.
- **Blocked by**: SF-AUTH-01.
- **Interfaces**: Implements `AdmissionPolicy`; consumes Better Auth create hooks.
- **Owned paths**: Admission module/jobs, auth hook adapter, concurrency tests.
- **Shared files not edited**: Queue integration and schema index.
- **Migration**: Uses SF-AUTH-01 schema.
- **Fixtures/tests**: 39/40/41 accounts, parallel final place, existing rider while full, callback failure, ten-minute expiry, paused circuit, no residue.
- **Failure/rollback**: Pause new admission; never delete existing riders.
- **Public copy**: “UNBROKEN is full for now. If you already joined, you can still continue with Google.”
- **Security/accessibility**: Normalize email only for reservation; no counts/public leakage; capacity message announced.

### SF-COMMUTE-01 — Store exactly two recurring commutes

- **Owner**: Commute updates
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Let a rider create, replace, pause, and delete first-trip and return-trip schedules with Pacific time and fixed reminder choices.
- **Non-goals**: Account page design and sending.
- **Blocked by**: SF-AUTH-02, SF-PLACE-01, and SF-ROUTE-04.
- **Interfaces**: Implements authenticated commute routes and schedule persistence consumed by `NotificationPlanner`.
- **Owned paths**: Commute domain/server, notification schema, authenticated endpoints, tests.
- **Shared files not edited**: Queue integration and schema index.
- **Migration**: Sole owner of `0004_commute_notifications.sql` integration request.
- **Fixtures/tests**: First/return, third slot, GPS reference, invalid place, days/time/lead, pause/delete, cross-rider access, DST-ready storage.
- **Failure/rollback**: Disable sending while keeping schedules editable; reject invalid update atomically.
- **Public copy**: First trip, Return trip, Days, Usual departure time, Remind me.
- **Security/accessibility**: Owner-scoped queries; CSRF/session checks; form labels/errors and keyboard order.

### SF-COMMUTE-02 — Manage and preview saved trips

- **Owner**: Public experience
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Provide My trips UI for both slots, editing, pause/delete, deterministic preview, and safe email history.
- **Non-goals**: Sending a real provider email.
- **Blocked by**: SF-COMMUTE-01 and SF-UI-02.
- **Interfaces**: Consumes authenticated commute, preview, and email-history routes.
- **Owned paths**: Rider account pages/components and browser tests.
- **Shared files not edited**: Root navigation.
- **Migration**: None.
- **Fixtures/tests**: Empty/one/two slots, edit/pause/delete, preview states, history, unauthorized, mobile/dark/axe.
- **Failure/rollback**: Account surface can hide behind Google flag without affecting public planning.
- **Public copy**: My trips and Send a test preview; no operational vocabulary.
- **Security/accessibility**: No other rider data; destructive confirmation; focus restoration and status announcements.

## Phase 6 — Commute updates

### SF-NOTIFY-01 — Find due schedules in Pacific time

- **Owner**: Commute updates
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Identify each active saved commute once at departure minus its reminder lead.
- **Non-goals**: Journey comparison, message rendering, or sending.
- **Blocked by**: SF-COMMUTE-01.
- **Interfaces**: Provides due-schedule calculation consumed by `NotificationPlanner`.
- **Owned paths**: Notification scheduling module and time fixtures/tests.
- **Shared files not edited**: Queue integration.
- **Migration**: Uses SF-COMMUTE-01 schema.
- **Fixtures/tests**: Weekdays, four leads, spring-forward, fall-back, restart, paused schedule, missed departure.
- **Failure/rollback**: No due row is sent directly; email flag stops preparation.
- **Public copy**: Explicit Pacific time.
- **Security/accessibility**: No email address in due result; preview describes timezone textually.

### SF-NOTIFY-02 — Explain meaningful journey changes

- **Owner**: Commute updates
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Compare current/previous journey fingerprints and deterministically summarize route, stop, elevator, warning, and material ETA changes.
- **Non-goals**: Provider delivery.
- **Blocked by**: SF-ROUTE-03 and SF-NOTIFY-01.
- **Interfaces**: Produces change summary and journey snapshot input for `NotificationPlanner`.
- **Owned paths**: Notification comparison/templates and tests.
- **Shared files not edited**: Fireworks modules.
- **Migration**: Uses SF-COMMUTE-01 schema.
- **Fixtures/tests**: Unchanged, each change type, ETA below/above five minutes, no confirmed plan, deterministic repetition.
- **Failure/rollback**: Default to needs-checking summary; never invent a change.
- **Public copy**: What changed, what is working, what needs checking.
- **Security/accessibility**: No LLM; semantic ordered content supports HTML/text.

### SF-NOTIFY-03 — Prepare and send once within strict budgets

- **Owner**: Commute updates
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Use a transactional outbox, permanent idempotency, locked budgets, bounded retries, and circuit state so one schedule/date sends at most once.
- **Non-goals**: Final email presentation.
- **Blocked by**: SF-AUTH-02 and SF-NOTIFY-01.
- **Interfaces**: Implements outbox portion of `NotificationPlanner` and Resend adapter.
- **Owned paths**: Notification outbox/budget/provider modules, jobs, concurrency tests.
- **Shared files not edited**: Queue integration and environment schema.
- **Migration**: Uses SF-COMMUTE-01 schema.
- **Fixtures/tests**: Duplicate prepare/send, restart, timeout, 429, daily/monthly exhaustion, concurrent final unit, retry before/after departure, circuit pause.
- **Failure/rollback**: Disable email flag/pause admission; retain outbox audit; no late retry.
- **Public copy**: Sending paused/full messages only through approved surfaces.
- **Security/accessibility**: Address resolved only at send boundary; provider response/token redacted.

### SF-NOTIFY-04 — Render accessible email and delivery history

- **Owner**: Commute updates
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Render matching responsive HTML and plain text in the approved information order and expose safe current-rider history.
- **Non-goals**: Production domain verification.
- **Blocked by**: SF-NOTIFY-02 and SF-NOTIFY-03.
- **Interfaces**: Completes `buildMessage` and email-history route behavior.
- **Owned paths**: Email templates, preview/history adapter, rendering/accessibility tests.
- **Shared files not edited**: Package/lock.
- **Migration**: Uses SF-COMMUTE-01 schema.
- **Fixtures/tests**: Unchanged/changed/unconfirmed subject, HTML/text parity, long names, dark client fallback, link safety, jargon scan.
- **Failure/rollback**: Rendering failure leaves outbox retryable and unsent.
- **Public copy**: Approved subject/body order and source labels.
- **Security/accessibility**: Escaping, safe URLs, logical headings, alt text, readable contrast/plain text.

### SF-NOTIFY-05 — Verify one controlled production update

- **Owner**: Release
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Verify the sending domain and receive one controlled update matching the browser preview.
- **Non-goals**: Bulk enablement.
- **Blocked by**: SF-NOTIFY-04.
- **Interfaces**: Exercises production `NotificationPlanner`, Resend adapter, and delivery audit end to end.
- **Owned paths**: Notification runbook and sanitized acceptance evidence only.
- **Shared files not edited**: Application modules unless a separate bug ticket is opened.
- **Migration**: None.
- **Fixtures/tests**: One owner/judge schedule, preview comparison, provider receipt, idempotent retry check.
- **Failure/rollback**: Keep `COMMUTE_EMAILS_ENABLED` off; no general admission enablement.
- **Public copy**: Received subject/body must match approved templates.
- **Security/accessibility**: User supplies secrets in Coolify; evidence contains no recipient/token; received HTML is checked.

## Phase 7 — Judge experience and release

### SF-JUDGE-01 — Show current citywide coverage evidence

- **Owner**: Quality
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Give operators a private coverage page with real static/realtime/source counts and both timestamps.
- **Non-goals**: Hard-coded demo values and raw payload display.
- **Blocked by**: SF-REALTIME-01 and all Phase 2 data tickets.
- **Interfaces**: Consumes `TransitCoverage`, realtime/source snapshot summaries, and operator authorization.
- **Owned paths**: Admin coverage page/service/tests.
- **Shared files not edited**: Root navigation except primary integration.
- **Migration**: None.
- **Fixtures/tests**: Full/partial/unavailable sources, operator roles, rider denial, timestamp labels, no-secret scan.
- **Failure/rollback**: Page degrades per source and never fabricates counts.
- **Public copy**: Private technical vocabulary allowed; public wording unchanged.
- **Security/accessibility**: Summary allowlist only; table captions/headings/keyboard filters.

### SF-JUDGE-02 — Demonstrate trusted Bright Data functions and healing

- **Owner**: Quality
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Present collectors, extraction functions, preview validation, advisory review, approval history, and verification without secrets.
- **Non-goals**: Automatic healing approval or collector replacement.
- **Blocked by**: SF-DATA-02, SF-DATA-03, and SF-DATA-04.
- **Interfaces**: Consumes existing incident/healing and new source-summary seams.
- **Owned paths**: Admin evidence presentation, synthetic judge fixtures, tests/runbook.
- **Shared files not edited**: Core healing/collector safety modules unless separate safety ticket.
- **Migration**: None.
- **Fixtures/tests**: Navigate/wait/parser, JSON interception, drift, preview rejection/approval/verification, fixed collector ID.
- **Failure/rollback**: Existing freeze and human gate remain; hide new presentation if incomplete.
- **Public copy**: Private judge wording only.
- **Security/accessibility**: Redaction/hash checks; typed approval; timeline semantics and focus.

### SF-QUALITY-01 — Pass full safety, browser, performance, and recovery acceptance

- **Owner**: Quality
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Exercise the complete matrix and document release evidence for current, older, unavailable, role, device, and recovery states.
- **Non-goals**: Product scope changes.
- **Blocked by**: SF-UI-03, SF-COMMUTE-02, SF-NOTIFY-04, SF-JUDGE-01, and SF-JUDGE-02.
- **Interfaces**: Tests all public module and browser seams.
- **Owned paths**: Test fixtures/suites, quality docs, sanitized reports.
- **Shared files not edited**: Application modules; defects become focused tickets.
- **Migration**: Verifies all migrations on empty/current copies; owns none.
- **Fixtures/tests**: Complete matrix in the product plan, p95 search/journey targets, map responsiveness, security and axe scans.
- **Failure/rollback**: Any failed safety/security/accessibility gate blocks release and public flags.
- **Public copy**: Jargon scan and exact provenance labels.
- **Security/accessibility**: No serious/critical axe issue, secret scan, authz/CSRF/rate bounds, all specified modes.

### SF-RELEASE-01 — Deploy and rehearse rollback on Coolify

- **Owner**: Release
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Apply migrations, build OTP, deploy web/worker, verify health/logs/database/browser, and rehearse flag rollback.
- **Non-goals**: Force-push, history rewrite, or unreviewed production mutation.
- **Blocked by**: SF-NOTIFY-05 and SF-QUALITY-01.
- **Interfaces**: Exercises deployment, health, migration, feature-flag, and browser seams.
- **Owned paths**: Deployment/rollback/monitoring runbooks and sanitized evidence.
- **Shared files not edited**: Application code unless a separate verified fix is required.
- **Migration**: Applies 0002–0004 through ops target; owns none.
- **Fixtures/tests**: Empty/current migration rehearsal, OTP graph/health, web ready, worker heartbeat, flags, rollback, deployed browser suite.
- **Failure/rollback**: Disable flags or roll back service image; preserve schema/data and prior trusted snapshots.
- **Public copy**: Production domain has no demo/prototype language.
- **Security/accessibility**: User-only secret/volume steps; TLS/database exception exactness; production axe/browser checks.

### SF-DEMO-01 — Deliver the 90-second judge path

- **Owner**: Release
- **Status**: pending — verification and commit not recorded
- **Goal and visible outcome**: Record and document the approved coverage → journey → change → sources → Google save → email preview → Bright Data trust story.
- **Non-goals**: Fabricated live data or exposed secrets.
- **Blocked by**: SF-RELEASE-01, SF-JUDGE-01, and SF-JUDGE-02.
- **Interfaces**: Consumes deployed public/operator experiences and submission assets.
- **Owned paths**: Judge runbook, README/submission assets, sanitized recording link.
- **Shared files not edited**: Application code without a new defect ticket.
- **Migration**: None.
- **Fixtures/tests**: Rehearsed 24th Street → Fisherman’s Wharf path, current change or safe fixture, Google schedule, preview, healing evidence.
- **Failure/rollback**: Do not publish a misleading recording; keep flags conservative until acceptance passes.
- **Public copy**: Simple rider language and prominent Checked by UNBROKEN vs SFMTA updated.
- **Security/accessibility**: Crop/redact private material; captions/transcript; keyboard-visible demo path.
