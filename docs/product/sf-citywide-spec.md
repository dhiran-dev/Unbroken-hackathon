# SF Citywide product specification

Status: approved
Product language: `CONTEXT.md`
Architecture contracts: `docs/engineering/interfaces.md`

## Problem statement

UNBROKEN currently helps riders plan between the 11 underground stations covered by the official elevator page. A rider traveling elsewhere in San Francisco still has to combine schedules, live changes, moved stops, elevator status, and accessibility guidance from several sources. Those sources update at different times and sometimes omit accessibility details. A polished citywide product must make that uncertainty visible without turning missing data into a safety claim.

## Solution

UNBROKEN will offer a citywide, wheelchair-aware Muni journey planner for buses, Metro, walking, and transfers. A rider selects a valid start and destination, sees short step-free guidance on a smooth map, and can tell what is confirmed, what changed, and what needs checking. Every result prominently distinguishes when UNBROKEN checked evidence from when SFMTA says it was updated and links to the official source.

Public accounts use Google only. Admission is capped atomically at forty rider accounts. Each rider can save a first trip and a return trip and receive one deterministic email per active schedule and service day within strict daily and monthly budgets.

## User stories

1. As a rider, I want to search every active Muni stop and station, so I can plan beyond the initial underground stations.
2. As a rider, I want common San Francisco places in search, so I do not need to know a stop name.
3. As a rider, I want results grouped as nearby stops, stations, and places, so choices are easy to scan.
4. As a rider, I want typed text to remain only a query, so an accidental free-text value cannot plan the wrong journey.
5. As a rider, I want a clear prompt to choose a result, so I know how to correct an incomplete selection.
6. As a rider, I want to use my current location once, so I can plan from where I am.
7. As a rider, I want a useful fallback when location access is denied or inaccurate, so I can continue by selecting a place.
8. As a rider, I want to swap From and To, so planning a return is quick.
9. As a rider, I want to leave now or choose a departure time, so the plan fits my trip.
10. As a rider, I want bus-only, Metro-only, and mixed options, so the planner covers citywide travel.
11. As a rider, I want cancelled trips removed, so I am not sent to a trip that will not run.
12. As a rider, I want current delays reflected in the arrival estimate, so timing is useful.
13. As a rider, I want moved boarding stops in my instructions, so I go to the current location.
14. As a rider, I want active elevator outages to block dependent underground paths, so a known outage is not hidden.
15. As a rider, I want relevant service changes shown as warnings, so I can make an informed choice.
16. As a rider, I want a confirmed option preferred over a faster uncertain one, so confidence is not traded away silently.
17. As a rider, I want fewer transfers preferred between equally confirmed options, so the journey is simpler.
18. As a rider, I want unknown details called out, so I can decide whether to check further.
19. As a rider, I want “Step-free details confirmed” only when every required dependency is current and positive, so the label has a strict meaning.
20. As a rider, I want “Some details need checking” when evidence is incomplete, so uncertainty is not disguised.
21. As a rider, I want “No step-free route confirmed” when known evidence blocks all options, so I am not given false reassurance.
22. As a rider, I want “Current updates are unavailable” when live sources cannot be trusted, so a technical outage is not presented as a transit fact.
23. As a rider, I want walking guidance to state that some sidewalk details may be missing, so mapped stair avoidance is not overstated.
24. As a rider, I want short, stable instructions, so the same journey does not change wording unpredictably.
25. As a rider, I want an estimated arrival and duration, so I can plan my time.
26. As a rider, I want each leg to show confirmed, unknown, or blocked accessibility, so I can locate the uncertainty.
27. As a rider, I want to see when UNBROKEN checked each source, so I understand evidence freshness.
28. As a rider, I want to see SFMTA's update time separately when provided, so I do not confuse collection time with agency time.
29. As a rider, I want an official-source link beside current facts, so I can verify details directly.
30. As a rider, I want older and unavailable information identified, so it is never presented as current.
31. As a rider, I want every stop shown as an individual map point, so exact boarding locations are not hidden inside clusters.
32. As a rider, I want selected stops, transfers, elevators, moves, and warnings to stand out, so the map supports the steps.
33. As a rider, I want the map to move to a selected place and frame the full journey, so geographic context is clear.
34. As a rider who reduces motion, I want map movement to be immediate, so the interface respects my preference.
35. As a keyboard rider, I want to select places and plan without a pointer, so the planner is usable for me.
36. As a screen-reader rider, I want a complete text itinerary, so the map is never the only presentation.
37. As a mobile rider, I want the planner to work at 360 pixels without sideways scrolling, so it works on my phone.
38. As a rider, I want Google to be the only public signup choice, so the account flow is simple.
39. As an operator, I want the password login kept separate, so public Google signup cannot become operator access.
40. As an existing rider, I want to sign in when admission is full, so capacity affects only new accounts.
41. As a prospective rider, I want a plain message when UNBROKEN is full, so I understand that existing members may continue.
42. As a prospective rider rejected at capacity, I want no partial account left behind, so the failed attempt is clean.
43. As a rider, I want exactly a first trip and a return trip, so saved commutes remain simple.
44. As a rider, I want to select days, usual Pacific departure time, and a reminder lead, so updates fit my routine.
45. As a rider, I want reminder choices of 15, 30, 45, or 60 minutes, so timing is predictable.
46. As a rider, I want 30 minutes selected by default, so setup is quick.
47. As a rider, I want to pause, edit, or delete either saved commute, so I control future updates.
48. As a rider, I want a current location rejected for a saved commute, so a temporary coordinate is not reused later.
49. As a rider, I want to preview an update before saving, so I know what the email will contain.
50. As a rider, I want one email per schedule and service date, so retries never become duplicates.
51. As a rider, I want warning emails when a route cannot be confirmed, so silence is not mistaken for a safe journey.
52. As a rider, I want no retry after departure, so late updates do not create confusion.
53. As a rider, I want emails to say what changed, what works, and what needs checking, so I can scan them quickly.
54. As a rider, I want HTML and plain-text emails, so the update works in my email client.
55. As a rider, I want my email address kept out of job data and logs, so operational data does not duplicate it.
56. As an operator, I want real coverage counts and source times, so I can show judges what is processed.
57. As an operator, I want a failed static import to leave current coverage active, so refreshing data cannot erase the planner.
58. As an operator, I want all source pollers to share a bounded 511 allowance, so they stay below the provider limit.
59. As an operator, I want realtime data rejected when stale or invalid, so it cannot corrupt a journey.
60. As an operator, I want citywide release flags to roll back surfaces independently, so migrations need not be reversed during an incident.
61. As an operator, I want Bright Data evidence and human approval history visible without secrets, so the trust story is auditable.
62. As an operator, I want Google riders denied from every admin route and action, so roles remain separate.
63. As a judge, I want to plan 24th Street to Fisherman’s Wharf and see buses, Metro, transfers, current changes, and source times, so the citywide value is obvious.
64. As a judge, I want the human-gated healing workflow demonstrated with the same stable collector ID, so automatic repair is never implied.
65. As a maintainer, I want deterministic output and an internal fingerprint, so meaningful commute changes can be identified reliably.
66. As a maintainer, I want the full suite to cover current, older, unavailable, mobile, dark, reduced-motion, authenticated, and anonymous states, so release confidence matches the safety claim.

## Implementation decisions

- Official 511 static GTFS is staged, validated, and atomically promoted as an active snapshot. The current active snapshot survives failed or suspicious imports.
- OpenTripPlanner 2.9.0 runs only on the private deployment network and returns at most five static wheelchair-aware journey candidates.
- UNBROKEN overlays elevator, accessible-stop, advisory, relocation, trip-update, vehicle, alert, and freshness evidence after candidate retrieval.
- Candidate selection rejects known inaccessible or disrupted options, then prefers complete evidence, fewer transfers, shorter confirmed walking, and lower current duration.
- Every source has an identity contract, validation report, checked time, nullable source-updated time, freshness state, official URL, and stable fingerprint where structure matters.
- Search accepts only catalog references or a validated one-time current location. All approved landmarks are part of the catalog.
- MapLibre GL JS renders CARTO Positron and Dark Matter vector styles. Every active stop is an individual feature; clustering is disabled.
- Existing owner/admin password login remains at `/login`. Public Google OAuth requests only `openid`, `email`, and `profile`, disables implicit account linking, and does not offer password signup.
- Atomic reservations gate first-time Google account creation at forty riders. Existing riders do not consume a new reservation.
- A database uniqueness constraint enforces the first-trip and return-trip slots.
- Pacific time and explicit DST handling govern saved commute schedules.
- A transactional outbox, permanent idempotency keys, provider idempotency, and locked daily/monthly ledgers govern sending.
- Four independent feature flags control citywide data, public planning, Google signup, and commute emails.
- Rider instructions and email copy use deterministic templates. No route-planning or notification path calls an LLM.
- The Fireworks integration remains limited to scraper-healing advisory review using the fixed DeepSeek model, high reasoning, strict structured output, and no fallback.

## Testing decisions

- Test through the highest public seam: source import activation, journey plan output, admission outcome, schedule behavior, and rendered browser/email behavior.
- Use in-memory adapters only behind established module interfaces. Do not test private implementation steps when the interface result proves the behavior.
- Safety fixtures cover missing fields, structural drift, contraction, stale sources, moves, outages, cancellation, delay, and unavailable dependencies.
- Concurrency tests prove one winner for the final rider place, duplicate-notification suppression, and race-safe budget ledgers.
- Browser acceptance covers keyboard, screen reader, reduced motion, light/dark, mobile/desktop, GPS allowed/denied, and anonymous/rider/operator roles.
- The complete gate remains `bun run check`; database migration checks and Playwright acceptance supplement it at phase exits.

## Out of scope

- Arbitrary typed street addresses.
- More than two saved commutes.
- SMS, push notifications, or native mobile apps.
- Other Bay Area operators.
- Claims that every sidewalk or curb ramp has been physically verified.
- AI-generated rider instructions or change summaries.
- Automatic approval of scraper healing.
- Public access to OpenTripPlanner.

## Further notes

The existing `/api/public/routes` remains an 11-station compatibility adapter during the hackathon. Citywide surfaces roll out behind flags in the sequence documented by `docs/engineering/README.md`. Production secrets and raw source payloads remain outside Git and committed local documentation.
