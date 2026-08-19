# Synthetic judge examples

Every JSON file in this directory is intentionally synthetic and carries both
`"example": true` and `"sanitized": true`. These files are documentation and
demo evidence only; the application never treats them as a live snapshot.

- `layout-drift/detection.json` shows a rejected structural change. Publication
  is frozen and no service event or route recalculation is emitted.
- `healthy-collection/accepted-summary.json` shows the shape of a trusted,
  no-change collection summary without source rows or private identities.
- `healing/preview-review.json` shows a deterministic preview followed by an
  advisory Fireworks result and an explicit human gate.

Do not copy raw Bright Data responses, API headers, account identifiers, or
private incident artifacts into this directory. The release check validates the
markers and JSON syntax.
