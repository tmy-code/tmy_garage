---
status: accepted
---

# A two-way sync with Notion: Notion owns the referentials, the app owns the logs

The owner maintains the reference data of the garage in Notion: the task catalogue, which task applies to which vehicle (from its equipment), vehicle specs, tools, consumable types and products. The app keeps that data offline and read-only, and keeps what happens in the garage: Services, Odometer Readings, Fill-ups, reminders. This supersedes ADR 0005's "one way, the app never reads Notion": the Articles deal-hunting copy it describes remains, the rest is replaced. The conflict rule is **Notion wins definitions, the app wins logs**.

## Decisions

- **Ownership per field.**
  - Notion owns: the catalogue (task name, action, default intervals, applicability, required consumable types, components, tools, instructions), component types, consumable types, products, tools, the per-vehicle consumables and specs, the vehicle's equipment tags, and, for a task linked to the catalogue, its name, action, intervals and notes (a Plan's per-vehicle override, else the catalogue default).
  - The app owns: Services, Odometer Readings, Fill-ups, Documents, Purchases, the Vehicles' own details, the baseline of a task, its category, whether it is switched off, and every task the owner made in the app that is not linked.
  - Both sides touch a task only in their own fields. The server answers `409 {code: 'notion_owned'}` when the app tries to edit what Notion owns, or to delete a linked task.
- **Server side, token only on the server.** The NAS server pulls from and pushes to Notion (`src/server/notion-sync.ts`, timer every 30 minutes plus a "Sync now" button calling `POST /api/notion/sync`). The Notion token and the parent page id are environment variables of the server; they are never sent to the phone, logged or returned by an endpoint. The phone only reads the result from the snapshot. The `npm run notion-sync` script stays as a thin command line over the same engine.
- **Pull first, then push.** The pull fetches the eight hand-made databases and the Véhicules equipment, then applies them in one transaction (any error leaves the data untouched). The push then copies Véhicules and Articles as before. A dry run (`?dryRun=1`) fetches and parses without applying.
- **Hand-made databases are never altered.** The app matches them by title under the parent page. It never creates, renames, retypes or deletes their columns or databases, and never writes their title column. The "Équipements" column of the app-managed Véhicules database is the owner's: the push never writes it.
- **Applicability.** A catalogue task applies to a vehicle when every tag of "Applicable si" is among the vehicle's equipment (empty applies to all). The vehicle's equipment is authoritative; a warning is raised when it is empty. For each owned vehicle and each applicable catalogue task without a Plan page, the server derives the app task (`plan_auto = 1`); an explicit Plan page is honoured (`plan_auto = 0`). An unlinked app task with the same normalised name is adopted instead of duplicated, and Notion's intervals replace the app's only when non-empty.
- **Soft removal with guards.** A row gone from Notion is marked `notion_removed` and hidden, never deleted. A removal pass is skipped (with a warning) when the pull of a database is incomplete, when it returned nothing while linked rows exist, or when more than the larger of 3 and half of the linked rows would go. A Plan page that vanishes, or a task no longer applicable, unlinks and pauses the task; the task and its history are kept, and the pause is counted in the Notion card of Settings.
- **The push is guarded too.** It does not mark pages "Supprimé de l’app" (and warns) when the snapshot is empty for that database or has no vehicles, or when more than the larger of 3 and half of the linked pages would be marked at once.
- **Caractéristiques superseded.** The app-pushed Caractéristiques database is frozen: it is no longer written and the "Caractéristique" relation in Articles is no longer filled. Nothing is deleted in Notion. The app's own spec lines stay in the app, shown after the Notion specs.
- **Built-in templates.** Once the catalogue has rows, the built-in templates (`catalogue.ts`) stop seeding tasks for new vehicles and "Add missing tasks from templates" does nothing.
- **Plain text.** Instructions arrive as plain text. A product's price is a default.

## Privacy delta

ADR 0005's list of what never leaves the NAS stays, with these changes. The journal databases planned for later (Séances, Interventions, Consommables utilisés) will carry date, odometer, task and per-line quantity and price of parts used. They will never carry notes, receipts, VINs, shop names, repair titles or the Service total. Nothing of the journal is sent in this first step: only reference data comes in, and the existing Véhicules and Articles copy goes out.

## Offline

ADR 0001's send queue is unchanged. The reference data travels in the snapshot and is read-only on the phone, so it needs no queue; logging a Service offline works as before. `Sync now` needs the network and is disabled offline.

## Considered Options

- **Merging Notion specs into `spec_lines`**: rejected. Notion would overwrite what the owner typed in the app. A separate Notion-owned `vehicle_specs` table keeps both.
- **Notion write access from the phone**: rejected. It would put the token on the phone.
- **Deleting rows gone from Notion**: rejected. A mistaken edit in Notion must never remove data from the garage.

## Consequences

- A task's name, action, intervals and notes can only be changed in Notion once linked.
- The schema grows by the reference tables listed in `docs/data-model.md`.
- Notion rate limits (about three requests a second) make a full sync take a while; it runs in the background.
