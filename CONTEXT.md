# UNBROKEN

UNBROKEN helps San Francisco Muni riders understand whether a planned step-free journey is supported by current, trusted evidence.

## Language

**Rider**:
A person using UNBROKEN to plan a journey or receive commute updates.
_Avoid_: Customer, passenger, end user

**Operator**:
An owner or administrator who can inspect evidence and perform protected operational actions.
_Avoid_: Public user, rider admin

**Place choice**:
A stop, station, landmark, or one-time current location that a rider has explicitly selected for planning.
_Avoid_: Free-text address, search query

**Journey**:
A requested trip between two place choices at a stated departure time.
_Avoid_: Route when referring to the complete trip

**Journey candidate**:
One possible sequence of walking, waiting, riding, and transfers before accessibility evidence is applied.
_Avoid_: Confirmed journey

**Journey plan**:
The rider-facing result after current accessibility and service evidence has been applied to journey candidates.
_Avoid_: OTP response, AI route

**Step-free details confirmed**:
The rider state used only when every required mapped dependency has current positive evidence.
_Avoid_: Wheelchair-safe, guaranteed accessible

**Some details need checking**:
The rider state used when a journey is possible but at least one required accessibility detail is unknown or older.
_Avoid_: Accessible by assumption

**No step-free route confirmed**:
The rider state used when known evidence blocks every candidate.
_Avoid_: Impossible trip

**Checked by UNBROKEN at**:
The time UNBROKEN obtained and accepted evidence through its validation contract.
_Avoid_: SFMTA updated at, last updated

**SFMTA updated at**:
The source-provided update time, when the official source supplies one.
_Avoid_: Checked by UNBROKEN at, fetched at

**Trusted snapshot**:
The latest source result that passed identity, contract, freshness, coverage, and structural checks.
_Avoid_: Latest response

**Source observation**:
A normalized fact from one official source at a known checked time and, when provided, source-updated time.
_Avoid_: Truth without provenance

**Service event**:
A meaningful equipment state change derived only from a valid contract and stable structural fingerprint.
_Avoid_: Scraper error, layout drift

**Layout drift**:
A structural source change that prevents safe interpretation and freezes publication without creating a service event.
_Avoid_: Elevator outage

**Rider account**:
A Google-authenticated public account admitted under the fixed capacity policy.
_Avoid_: Operator account

**Operator account**:
An owner or administrator account that uses the separate password entry point.
_Avoid_: Rider account

**Admission reservation**:
A short-lived, atomic claim on one remaining rider-account place during first Google signup.
_Avoid_: User row, waitlist place

**Saved commute**:
One recurring journey schedule in either the first-trip or return-trip slot.
_Avoid_: Job, queue item

**Commute update**:
A deterministic email prepared for a saved commute before departure.
_Avoid_: Notification job, AI summary

**Official source**:
The public agency page or feed from which a displayed fact originates.
_Avoid_: UNBROKEN as the transit authority
