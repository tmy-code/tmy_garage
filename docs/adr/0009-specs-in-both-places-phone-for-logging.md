---
status: accepted (2026-11-14)
---

# Specs are editable in the app and in Notion; the phone only logs

The owner uses the phone in the garage to record Services, Odometer Readings and Fill-ups, and sits at a desktop to maintain the reference data. Specs were split in two lists that never met: the app's own Spec Lines and the Notion-owned Component Specs and Vehicle Consumables (ADR 0007 rejected merging them, because Notion would overwrite what the owner typed). The owner now wants every spec editable in Notion as well as in the app.

## Decisions

- **Phone vs desktop.** The Android app writes only Services, Odometer Readings and Fill-ups; everything else is read-only on it. The desktop (browser, plus Notion) edits everything, including those three. The split follows the platform (`isAndroidApp`), not the screen width, and is enforced in the UI only: the server still accepts writes from any client.
- **Two kinds of spec, no Spec Lines.** An **Item Spec** (what a Vehicle takes of a fluid or part) replaces the Vehicle Consumable and the Fluids and Parts Spec Lines. A **Component Spec** (a figure for a component) absorbs the Torque and Other Spec Lines. Spec Lines stop existing.
- **Notion is the master copy.** A desktop edit is written to Notion first and shown once Notion accepts it; the desktop cannot edit specs offline. No conflict rule is needed. This reverses ADR 0007's "the app never writes the owner's hand-made databases" for these two databases only.
- **Migration.** A one-off script, dry run first, creates the Notion pages for the existing Spec Lines and re-points each Vehicle Item's spec link. It runs against the NAS snapshot, never a database copy. The frozen *Caractéristiques* database is archived by the owner, not deleted.
- **Notion names.** *Consommables par véhicule* becomes *Spécifications d'articles* and *Spécifications* becomes *Spécifications de composants*. The app finds databases by title, so it accepts both the old and the new title during the changeover; the Notion rename is the last step, done after the release and with the owner's go-ahead.
- **Receipts are desktop-only.** A Service's Receipts (Documents) are added and removed on the desktop; the phone shows them read-only. They stay in the app and never go to Notion.
- **Vehicle Part becomes Vehicle Item** (the word the screens already use). The code rename is a separate task.

## Consequences

- Rejected: keeping both lists and syncing each two-way (two places for one figure, no rule for which wins); last-write-wins (needs timestamps and offline merging for little gain with one editor).
- Phones only read specs, so the offline snapshot is unchanged and no `API_VERSION` bump is needed for the phone/desktop split. Moving the spec link from a Spec Line to an Item Spec changes `/api`: `API_VERSION` is 3.
- The SQL table keeps the name `vehicle_consumables` for the Item Specs (the API and the snapshot say Item Specs, `itemSpecs`), so a rollback to the previous image still works on the additive schema.
- The spec endpoints live under `/api/notion/` (they wait for Notion, up to 120 s on the client, and pass a 502 or 503 through as an answer, not as "offline").
- The Spec Lines not moved to Notion (a sold Vehicle has no Notion page, an empty line has nothing to move) stay visible, read-only, under "Old specs"; nothing is deleted.
