# Reserve rider capacity atomically before account creation

Status: accepted

Public access is limited to forty Google-authenticated rider accounts and two saved commutes per rider so planned delivery remains within eighty emails per day and 2,480 per month. A first-time Google signup must atomically reserve capacity before any user or provider-account row is committed; existing riders bypass reservation, and abandoned reservations expire after ten minutes. Counting rows after OAuth would race at the final place and could leave rejected account residue.

## Consequences

Email-service circuit state can pause new admission while existing riders retain access. Operator password accounts are separate and cannot be linked implicitly from Google.
