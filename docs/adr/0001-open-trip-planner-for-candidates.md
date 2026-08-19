# Use OpenTripPlanner for internal journey candidates

Status: accepted

UNBROKEN will use a pinned OpenTripPlanner 2.9.0 service on the private deployment network to derive static multimodal journey candidates from official Muni GTFS and a pinned OpenStreetMap extract. Building and maintaining a routing engine would consume the project while providing weaker walking and transfer behavior; a public third-party router would make availability and data versions harder to control. OTP supplies candidates only: UNBROKEN remains responsible for current elevator, stop, advisory, relocation, and freshness evidence and may reject every candidate.

## Consequences

The graph input hashes and image digest are recorded, the service has no public domain or host port, and an OTP outage degrades journey planning without weakening the last trusted source state.
