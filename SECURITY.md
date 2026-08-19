# Security policy

UNBROKEN handles database, scraper, and AI-provider credentials. Please do not
open a public issue with a token, password, database URL, raw Bright Data
payload, incident artifact, or private deployment address.

## Reporting a vulnerability

For a suspected security issue, contact the repository owner privately through
the maintainer contact associated with the repository. Include a concise
description, affected commit or component, reproduction steps that contain no
secrets, and the potential impact. Allow time for a private response before
public disclosure.

If you accidentally commit a secret, revoke or rotate it first, then notify the
owner. Removing the file from a later commit does not invalidate the exposed
credential.

## Safe local handling

- Keep `.env.local` and production environment files outside Git.
- Use a persistent private volume for `INCIDENT_ARTIFACTS_DIR` in production;
  never commit `artifacts/incidents/`.
- Use only the synthetic fixtures under `artifacts/examples/` in demos and
  issue reports.
- Treat public status as rider information, not a guarantee of elevator
  availability or an official SFMTA communication.
