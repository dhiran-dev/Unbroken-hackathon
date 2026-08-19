# Private San Francisco OpenTripPlanner

This directory builds and serves the pinned OpenTripPlanner 2.9.0 graph used only for internal journey candidates. OTP does not decide whether a journey is safe or confirmed; UNBROKEN applies current accessibility evidence after OTP returns candidates.

## Fixed inputs

- OCI index: `docker.io/opentripplanner/opentripplanner@sha256:a7eac7da397faa9ec9dee407d4204895d24df4981500662fa6793aae0e71fd8f`
- Linux manifests: amd64 `sha256:f5e8e6cf771d0e7c742ce54e79770f0dc8b921f3382d7ad9507e4d13447e97de`; arm64 `sha256:b43dee5a664d5b130eb72d69c9cef7876251bec1b0a9168056ccf12e9646daf9`
- NorCal OSM: `norcal-260818.osm.pbf`, 649,346,007 bytes, MD5 `c768ad7dc1b4f2d15ff551f9c8016641`, SHA-256 `f25984fd70d3516b2753bae457fbf25dbe985817d198c746d87b4a1557ec186d`
- SF bounds: `-122.58,37.68,-122.31,37.86`
- Verified extraction: Osmium 1.16.0/libosmium 2.20.0, `complete_ways --set-bounds`, 19,894,206 bytes, SHA-256 `c7b3a04f1bd447be696ccd8bad0c94aa63a92e54ec499c3e260536448458e910`, zero missing way-node references
- OTP release evidence: commit `9babe45ffc9327933129f705c648137ecd96cdbe`; JAR 183,261,367 bytes; SHA-256 `112824122cd1a89e2dff6b5b3088ffbd4f04c3c0a400ca9f08f17b762f5325f6`
- Configuration evidence: `unbroken-sf-otp-v1`
- Verified authoritative GTFS export: 109,852,353 bytes, SHA-256 `001ead2000773e7569435a6e14b0906bbef907900388dd81e506df472c34d9ae`, bound to active archive SHA-256 `e3fa3823286462e892aba89f3764e3e5bde8d9aaf9760b89261faf434c27192c`
- Verified current graph evidence: 62,091,935 bytes, SHA-256 `086089d02d2ad6ef3758ed1be19537a49ffd51a35b3a52f79bd080e39c50e582`, 121,795 vertices, 330,433 edges, 3,238 stops, 287 patterns, and 46,657 constrained transfers

The build refuses any pin drift. It exports a deterministic GTFS ZIP directly from the active trusted database snapshot, verifies persisted row counts against that snapshot’s coverage metadata, and binds the generated archive hash to the active archive hash and coverage fingerprint. Caller-provided GTFS files or hashes are not accepted. A 511 token is never an argument, environment input, manifest value, or log value in this workflow.

## Build a candidate

Install Docker, Bun, curl, core checksum tools, and the exact verified Osmium/libosmium versions on the private build worker. Configure these secure worker values without committing them:

- `OTP_STATE_DIR`: absolute durable directory owned by the OTP operator
- `DATABASE_URL`: server-only connection to the database containing the active trusted transit snapshot
- `OTP_SERVICE_DATETIME`: an explicit service date and time with UTC offset for the bounded candidate probes

Run `deploy/otp/build-graph.sh`. It downloads and verifies the pinned source, extracts complete ways for the fixed bounds, checks references, streams the active database snapshot into deterministic GTFS files, builds `graph.obj`, and writes `manifest.json`. Before promotion it starts the exact pinned image on a temporary internal Docker network with no host port, inspects its runtime restrictions, and runs health plus neutral and wheelchair probes against its private address. It rechecks the active transit identity and current graph under the build lock immediately before atomically moving the `current` symlink. A failed command leaves the prior `current` graph unchanged. Build and serve are deliberately separate.

## Coolify private service

Create a manual Docker Compose service from `deploy/otp/compose.json`.

1. Set `OTP_STATE_DIR` to the same durable private state directory used by the builder.
2. Do not configure a public domain or host port. The Compose file has no `ports` entry and joins only the internal `otp_private` network.
3. Connect the UNBROKEN application to that private network and configure its server-only OTP base URL with the service name and container port. Never expose that URL to a browser or logs.
4. Confirm the container resolves the appropriate pinned platform manifest before starting it.
5. Start or restart the service only after a candidate has been promoted. The serving container loads the graph read-only with bounded JVM/container memory.

The healthcheck calls `/otp/actuators/health`; OTP returns 200 only after the graph is loaded and ready. The private routing seam is `/otp/gtfs/v1`.

## Verify readiness and the sample candidate

Provide these values securely to the verification process:

- `OTP_BASE_URL`: private service base URL
- `OTP_GRAPH_MANIFEST_PATH`: promoted manifest path
- `OTP_PLATFORM_MANIFEST`: resolved amd64 or arm64 manifest digest
- `OTP_SERVICE_DATETIME`: explicit service date and time with UTC offset

Run `bun run deploy/otp/verify-cli.ts`. It checks health, runtime/config/graph evidence, then requests at most five neutral static transit candidates from 24th Street and Mission to Fisherman's Wharf. Verification succeeds only when at least one neutral itinerary contains transit. A separate hard-wheelchair diagnostic records the expected zero-candidate `NO_STOPS_IN_RANGE` result caused by unknown GTFS accessibility flags; that result is neither an outage nor an accessibility claim. UNBROKEN applies AccessibilityEvidence later. Failure output is intentionally limited to “Current updates are unavailable” and never includes the internal URL or provider details.

## Rollback

Every promoted candidate directory remains available. To roll back, stop the private OTP service, create a replacement symlink pointing to the selected previously verified directory under `candidates/`, atomically replace `OTP_STATE_DIR/current`, then restart and rerun verification. Do not point `current` at a directory whose manifest and graph hashes were not previously verified.

## OpenStreetMap attribution

The walking graph contains data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/). Preserve this attribution anywhere the derived walking data is presented.
