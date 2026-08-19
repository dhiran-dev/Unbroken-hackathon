# Public accessibility and journey semantics

## Product promise

UNBROKEN shows a journey only when every elevator group required at the selected
stations is backed by the latest trusted SFMTA snapshot. It never converts an
unknown value into a working elevator and never routes from rejected collection
output.

The public wording is intentionally rider-facing:

- `in_service` becomes **Working**.
- `out_of_service` becomes **Out of service**.
- missing or unknown evidence becomes **Status not confirmed**.
- collection, contract, fingerprint, collector, incident, and model details stay
  on protected owner pages.

## Sources and reviewed topology

Live state comes from the official
[SFMTA Muni Metro elevator status](https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod)
page through the configured Bright Data collector.

Station movement rules are manually reviewed against SFMTA's published access
guidance:

- [Access on Muni Metro](https://www.sfmta.com/getting-around/accessibility/muni-accessibility/muni-access-guide/access-muni-metro)
  describes underground street, concourse, and platform elevator movement and
  the direction-specific Church and Castro platforms.
- [Central Subway frequently asked questions](https://www.sfmta.com/project-updates/new-t-third-service-frequently-asked-questions)
  describes the Central Subway stations and transfer signage.
- SFMTA's elevator page states that Powell and Union Square / Market Street are
  connected at concourse level and their entrances may be used interchangeably.

`src/domain/accessibility/topology.ts` maps exact stable equipment identities to
reviewed street, platform, and direction-specific groups. The planner never
infers station architecture from words in an elevator name.

## Station state

The latest trusted snapshot is reduced conservatively:

- **Step-free access available**: SFMTA reports access and every observed
  elevator is working.
- **Step-free access with changes**: the station remains reported accessible,
  but at least one elevator is unavailable or unconfirmed; station details show
  a reviewed working alternative when one exists.
- **No confirmed step-free access**: SFMTA reports the station unavailable.
- **Access not confirmed**: the station report is unknown, no elevator rows are
  present, or the required evidence cannot be confirmed.

An explicit station-level unavailable or unknown state always fails closed,
even if an individual elevator row says it is working.

## Journey gate

The initial surface covers the 11 stations in the SFMTA elevator source.

For a same-corridor journey, the planner requires:

1. a reviewed, working street entrance where the station topology needs one;
2. a reviewed, working platform elevator for the correct direction, or a
   reviewed redundant elevator in the same group; and
3. the same checks at the destination.

For a Market Street to Central Subway journey, the planner additionally
requires working platform access at both Powell and Union Square / Market
Street. These elevators appear in the connection step so the rider can see the
full dependency.

If one chosen endpoint is not usable, UNBROKEN may suggest the closest verified
station on the same subway corridor. It does not invent walking time: the UI
explicitly says that extra time is not estimated. If the transfer itself is not
verified, no alternative cross-network route is claimed.

## Freshness and held updates

Only `trusted_snapshots` feed the public service. A newer rejected, failed, or
unfinished collection does not replace the trusted snapshot.

- A snapshot no more than 10 minutes old with no newer held update is current.
- Otherwise the status page may show the last verified station details with a
  non-dismissible warning, the exact source verification time, the age in plain
  language, and the official SFMTA link. The route planner and public route API
  do not claim a step-free route until a fresh update is available.
- If no trusted snapshot exists, the UI reports that information is unavailable;
  fixtures are never shown as live data.

## Public API boundary

- `GET /api/public/accessibility` returns station/elevator state, reviewed role,
  working alternative, and trust time.
- `POST /api/public/routes` accepts only catalog station slugs and returns the
  conservative journey result.

The public API excludes equipment source keys, collector IDs, collection IDs,
fingerprints, raw fields, incident details, operator identity, and LLM output.
