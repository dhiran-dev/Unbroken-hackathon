# Citywide source register

Every source is untrusted until its current response passes its versioned contract. A rejected refresh stores only safe evidence and leaves the active trusted snapshot unchanged.

| Source | Identity | Cadence | Older after | Verified baseline | Required validation | Public source |
| --- | --- | ---: | ---: | --- | --- | --- |
| Elevators | Bright Data `c_msyjsllt1r9ej5tdub` | 5 min | 12 min | 11 stations, 33 equipment records | Exact source, contract, station/equipment identity, timestamp, coverage, statuses, stable structure | SFMTA elevator status |
| Accessibility advisories | Bright Data `c_mt00zyx63815q2j9g` | 60 min | 90 min | 11 filtered advisories | Exact source, pagination completeness, advisory identity, affected entity, dates, sanitized text | SFMTA accessibility advisories |
| Stop relocations | Bright Data `c_mt01m8hghrt0swozl` | 30 min | 60 min | 6 rows | Preserve every row, nullable applicant, duplicate stop IDs when destinations differ, coordinates and dates | SFMTA temporary stop changes |
| Accessible-stop guidance | Bright Data `c_mt0719p0vuntmudm6` v3 | Daily | 36 hr | Underground guidance plus 41 surface-rail entries | Deterministic section parsing, stop identity, route association, reviewed prose, stable structure | SFMTA accessible stops |
| Static Muni GTFS | 511 operator `SF` | Daily check | Calendar/validation gate | 3,238 stops; 68 routes; 50,690 trips; 1,901,119 stop times; 45,308 shape points; 10,347,998-byte archive | Required files, hashes, references, service date, row floors/ratios, coordinates, timestamps, fingerprint | 511 transit data |
| Trip updates | 511 operator `SF` | 150 sec | 5 min | HTTP 200; 1,116,501-byte protobuf | Header time, entity identity, route/trip/stop references, cancellation/delay bounds | 511 realtime feed |
| Vehicles | 511 operator `SF` | 180 sec | 5 min | HTTP 200; 63,558-byte protobuf | Header time, entity identity, coordinates in bounds, route/trip references | 511 realtime feed |
| Service alerts | 511 operator `SF` | 600 sec | 15 min | HTTP 200; 21,940-byte JSON | Header time, active period, informed entities, sanitized public text | 511 realtime feed |
| Walking network | Pinned SF extract from a fixed California OSM source | Graph build | New graph only | To be recorded by `SF-OTP-01` | Source hash, fixed bounding box, complete intersecting ways, graph build success | OpenStreetMap attribution |

## Shared 511 budget

The token permits 60 requests per hour. All realtime pollers share a persistent budget of at most 52 requests per rolling hour, leaving eight requests for recovery and operator diagnostics. Pollers defer rather than exceed the allowance.

## Missing GTFS files

The verified static feed has no `transfers.txt`, `pathways.txt`, or `levels.txt`. OTP may derive walking transfers from OpenStreetMap. UNBROKEN must not claim that exact station pathways or accessible entrances came from GTFS. Exact entrance/elevator language requires SFMTA content, existing reviewed access paths, or explicitly curated evidence.

## Public provenance

Each public source record includes:

- `Checked by UNBROKEN at`: accepted collection time.
- `SFMTA updated at`: source-supplied time or omitted when absent.
- Freshness: current, older, or unavailable.
- Official source: a safe public URL.

Relative time may supplement these values and never replaces them.
