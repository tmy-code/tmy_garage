---
status: accepted
---

# Offline Service logging via a send queue, not full local-first sync

The user works on their vehicles in a basement car park with no cell reception, so the phone app must work offline — but only for what happens there: reading Maintenance Tasks, Part Specs, Vehicle Specs, workshop data and what is fitted, and logging Services, Parts Used, Odometer Readings and photos. We cache that data on the phone and put offline writes in a send queue that is replayed to the server when the connection returns, with "last write wins" for the rare conflict. This is safe because each Garage has a single editor, so concurrent edits to the same record practically never happen.

## Considered Options

- **Online-only** — rejected: useless where the work actually happens.
- **Full local-first sync with conflict merging (as Actual Budget does)** — rejected: a large engineering investment that a single-editor Garage does not need.

## Consequences

- Insurance, Quotes, Documents other than Service photos, and Task setup are online-only, desk-based screens. Extending offline to them means extending the queue, not rewriting it.
- If a Garage ever gets several editors (e.g. a shared family Garage), "last write wins" must be revisited.
