# The Notion sync

The server keeps Notion and the app in step ([ADR 0007](adr/0007-two-way-notion-sync.md)). **Notion wins definitions, the app wins logs**: the owner maintains the referentials in Notion (task catalogue, which task applies to which vehicle, specs, tools, consumable types, products); the app stores them offline, read-only, and keeps the logging and the reminders. The two exceptions are the **Item Specs** and **Component Specs**, which can also be edited in the app on the desktop: the edit is written to Notion first ([ADR 0009](adr/0009-specs-in-both-places-phone-for-logging.md)). It also still copies vehicles to Notion for deal hunting ([ADR 0005](adr/0005-one-way-copy-to-notion-for-deal-hunting.md)); the Articles copy was removed ([ADR 0008](adr/0008-shopping-list-and-purchase-log-move-to-notion.md)): the owner's *Achats* database is read instead, to tell what was bought. Every database, column and link is described in [notion-databases.md](notion-databases.md).

Each run does, in order: **fetch** the owner's databases, **apply** them to the app in one transaction (an error changes nothing), then **push** the copy. It runs on the NAS server about a minute after start, every 30 minutes, and from *Settings* → *Notion* → *Sync now*. Only the server holds the Notion token.

## Who owns what

| Data | Owner | Notes |
| --- | --- | --- |
| Task catalogue, component types, consumable types, products, tools | Notion | Hand-made databases, read-only in the app. |
| Per-vehicle Item Specs and Component Specs | Notion, edited from the desktop app too | The app writes to Notion first, under the sync's lock, and saves the local row only from the page Notion returns. No offline edit. The old Spec Lines are frozen and read-only until moved (see below). |
| Phone and desktop | The app | The phone logs Services, Odometer Readings and Fill-ups only; everything else is read-only on it. The desktop edits everything. The split is in the screens: the server accepts writes from any client. |
| Receipts (Documents of a Service) | The app, desktop only | Added and removed on the desktop; never pushed to Notion. |
| A vehicle's equipment tags | Notion | Column *Équipements* of *Véhicules*. The push never writes it. |
| Name, action, intervals and notes of a task that follows the catalogue | Notion | The Plan's interval overrides the catalogue default. The app answers 409 `notion_owned` if asked to change them or delete the task. |
| Switched off, baseline (last done before tracking) and category of a task | The app | |
| Tasks the owner made in the app and that match no catalogue task | The app | Left alone. |
| Services, odometer readings, fill-ups, documents | The app | Never pulled from Notion. |
| *Achats* (what was bought, for which Item Spec of a vehicle) | Notion | Hand-made, read-only. Only date, article, product, quantity, price and shop are kept: never the invoice files or the notes. |
| *Véhicules* database (columns the app writes) | The app | Pushed; the owner's columns (JDex, Deals, *Équipements*) are never written. |
| *Articles* | Nobody | No longer written since 2026-11-10 ([ADR 0008](adr/0008-shopping-list-and-purchase-log-move-to-notion.md)). The app never reads, writes or ticks it, and does not mind if it is there or not. Leave it, or archive it in Notion. |
| *Caractéristiques* | Nobody | Frozen: no longer written, nothing deleted; the owner archives it after the move of the Spec Lines. |

## The databases the owner makes by hand

Found by title under the page set by `NOTION_PARENT_PAGE_ID`. The app never creates, renames, retypes or deletes their columns or databases. It writes pages only in *Plans d'entretien* and in the two spec databases (below). A missing optional column is tolerated; a missing required one (or a missing database) makes that database "incomplete": the warning is shown in Settings and nothing is removed because of it.

| Database | Columns (required first) |
| --- | --- |
| Tâches d'entretien | Tâche (title), Action (select: Contrôle / Remplacement / Nettoyage / Réglage), Applicable si (multi-select), Intervalle par défaut (km), Intervalle par défaut (mois) · Types de consommables requis, Composants, Outils (relations), Instructions, Catégorie (select: Moteur / Transmission / Freinage / Châssis / Électricité / Refroidissement et climatisation / Autre; also Freins, Roues, Électrique) |
| Types de composants | Nom · Catégorie, Notes |
| Types de consommables | Nom · Catégorie, Famille (Fluide / Pièce), Notes |
| Produits | Nom · Type de consommable (relation), Marque, Référence, Fournisseur, Prix, Notes |
| Achats | Achat (title), Date, Article (relation to *Spécifications d'articles*) · Produit (relation), Quantité, Prix payé, Boutique. A *Facture* (files) or *Notes* column is never read. |
| Outils | Nom · Type, Taille / capacité, Possédé (checkbox), Prix, Notes |
| Plans d'entretien | Plan (title), Véhicule, Tâche · Intervalle (km), Intervalle (mois) (per-vehicle overrides), Dernier fait (km), Dernier fait (date), Notes |
| Spécifications d'articles (formerly *Consommables par véhicule*) | Désignation (title), Véhicule, Type · Spécification, Réf. OEM, Capacité, Quantité (number or text), Produits compatibles, Produit retenu, Statut (Confirmé / À confirmer) |
| Spécifications de composants (formerly *Spécifications*) | Élément (title), Véhicule, Valeur (number or text) · Composant, Catégorie, Unité, Source, Statut |

Both titles of a renamed database are accepted. If both exist under the parent page, that database is neither read nor written and a warning says to archive or rename one.

In *Véhicules* (the app's database) the owner adds the multi-select **Équipements**. A page that points at several vehicles gives one row per vehicle. Words the app does not know (an Action other than Contrôle, Remplacement, Nettoyage or Réglage…) are read as empty, with a warning.

## How the plan is built

- For every owned vehicle and every catalogue task that applies to it (every tag of *Applicable si* is among its equipment; no tag applies to all) with no Plan page, the server creates the app task. An explicit Plan page is honoured, with its own intervals and notes.
- An app task with the same name (case, accents and spacing aside) is linked instead of duplicated. Notion's interval replaces the app's only when Notion has a value; an empty one never blanks.
- A catalogue task with no interval at all is not added (a warning says so). A linked task whose interval was emptied keeps its old one.
- A Plan page that vanishes, or a task that stops applying (equipment changed, catalogue row removed), is unlinked and paused. It is never deleted and its history stays. Settings shows how many were paused.
- A vehicle with no equipment in Notion gets a warning: only the tasks with no condition apply.
- Once the catalogue has rows, the built-in templates stop seeding new vehicles.

## Removal

A row gone from Notion is hidden in the app (never deleted) and shown again if it returns. Nothing is hidden when the database could not be read completely, when Notion returned no rows while rows are linked, or when more than the larger of 3 and half of the linked rows would go; a warning says so.

The push has the same kind of guard: it never ticks **Supprimé de l’app** on any page of a database (and says so in the warnings) when the app has no rows for it while Notion has linked pages, when the app has no vehicles at all, or when more than the larger of 3 and half of the linked pages would be ticked at once. A page already ticked whose record is back is unticked as usual.

## Setting it up

1. In Notion, open **Settings › Connections › Develop or manage integrations** and create an internal integration with read and write content access. Copy its token.
2. Open the parent page, then **⋯ › Connections** and add the integration. It can then reach that page only.
3. On the server, set `NOTION_TOKEN` and `NOTION_PARENT_PAGE_ID` (the 32 characters at the end of the page's link) from a file that exists only there ([deploy.md](deploy.md)).
4. Check what the pull reads before trusting it: `npm run notion-sync -- --pull-dry-run` (with the two variables in a local `.env`) fetches and parses the databases and prints the rows, the warnings and every vocabulary found, writing nothing and touching no database. The server's `POST /api/notion/sync?dryRun=1` does the same without applying.
5. Open *Settings* → *Notion* and tap **Sync now**.

## The command line

`npm run notion-sync` is a thin command over the same engine and only pushes the copy by hand. Options: `--dry-run` (show what would be pushed, no Notion access), `--snapshot <file>` (read a saved snapshot instead of the server), `--pull-dry-run` (described above). It needs `GARAGE_URL`, `NOTION_TOKEN` and `NOTION_PARENT_PAGE_ID` in `.env` (never committed).

## What leaves the NAS

Pushed to Notion: owned vehicles (name, kind, make, model, year, Build, odometer, daily distance), plus the journal below. The items (Articles) are no longer pushed. Never: VINs, sale details, the cost of a Service, receipts and other documents, notes, shops, repair titles, odometer-only readings, fill-ups, sold vehicles.

## Writing to the owner's databases

The writes into the owner's databases are in *Plans d'entretien*, and in the two spec databases (ADR 0009, which supersedes ADR 0007 for these two). Nothing else, and never a column.

### Writing back to the Plans database

- A **plan page** is created for each task that follows the catalogue and has none, with only **Plan** (the title), **Véhicule** and **Tâche**. Never twice, never when a page for that vehicle and task exists already, never for a paused task, and never again for a page the owner archived (the pull pauses that task).
- **Dernier fait (km)** and **Dernier fait (date)** are written from the last Service (a baseline counts), only where the value differs. If either column is missing or has another type, or the page covers several vehicles, a warning says so and nothing is written.

### Spec pages (Item Specs and Component Specs)

Written on a desktop edit in the app, and by the one-off move below:

- **Notion first.** The server holds the sync's lock, writes the page, reads the answer, and only then saves the local row from it. If Notion refuses, nothing changes here. A sync running at the time makes the edit answer 409 `notion_busy`; the timer's own sync is then skipped quietly.
- **Diff only.** An edit sends only the columns that differ from the page as it is in Notion. Nothing changed, nothing sent. Existing select options are matched (*Statut*, *Catégorie*, *Unité*) before a new one is written.
- **Never *Produits compatibles*.** The app writes the name, the vehicle (at creation), the type, the specification, the OEM reference, the capacity, the quantity, the chosen product and the status of an Item Spec; the label, vehicle (at creation), component type, category, value, unit, source and status of a Component Spec.
- **Value rules.** If *Valeur* is a number column, the app asks for a number (the unit goes in *Unité*); a missing optional column that the edit needs makes it answer `notion_incomplete` without writing.
- **Delete.** A page that covers several vehicles only loses this vehicle (*Véhicule*); otherwise the page goes to Notion's trash, where it can be restored.
- **Shared pages.** A page that points at several vehicles is changed for all of them; the screen says so.
- **Locked against the sync.** One lock covers the sync, a spec edit and the move below, so they never overlap.

## Moving the Spec Lines (one-off)

The old **Spec Lines** of the app (fluids and parts, torque and other) move into the two spec databases ([ADR 0009](adr/0009-specs-in-both-places-phone-for-logging.md)): fluids and parts become *Spécifications d'articles* pages, torque and other become *Spécifications de composants* pages. It runs on the NAS server, through an endpoint, with a dry run first. The Notion token stays on the server: from the PC you only need `GARAGE_URL` (the address of the garage server, never committed).

1. Merge the release and let the NAS update. From then on, **every desktop spec edit writes to the real Notion**, by design.
2. Dry run, which reads Notion and writes nothing, here or in Notion: `curl -X POST "$GARAGE_URL/api/notion/spec-migration?dryRun=1"`. Read the report with the owner: each line's target (`item_spec` or `component_spec`), its action (`create`, `link` to a page that is already there, or `skip` with a reason: no Notion page for a sold vehicle, or nothing to move), the preview of what would be written, and how many Vehicle Items would be re-pointed or left without an Item Spec. A column the databases lack shows as a warning.
3. **Only with the owner's go-ahead** (it writes to the real Notion), the real run, which needs the explicit `dryRun=0` (without it, or with any other value, the call is a dry run): `curl -X POST "$GARAGE_URL/api/notion/spec-migration?dryRun=0"`. Never run it against a local copy of the database with the token. Every page it creates has the Statut *À confirmer*, so the owner reviews the values. Each line is recorded in `spec_line_moves`, so running it again moves nothing twice, and a run that stopped half way is finished by the next one (it also re-points the Vehicle Items of lines moved before). If a database or a column the plan needs is missing, it stops before writing anything.
4. *Settings* → *Notion* → *Sync now*, then check the Specs pages: the lines that could not move stay listed read-only under "Old specs".
5. The owner archives *Caractéristiques* in Notion (nothing is deleted).
6. Last, with the owner's go-ahead: rename *Consommables par véhicule* to *Spécifications d'articles* and *Spécifications* to *Spécifications de composants*. The app finds a database under either title; if both a new and an old title exist for one database it reads and writes neither and warns. Then *Sync now* and check there is no warning.

## The journal

Three databases the app creates under the parent page (found by title; missing columns are added, existing ones never changed): **Séances** (one per Service: Séance, Véhicule, Date, Km, Réalisé par, Type Entretien / Réparation), **Interventions** (one per task done: Intervention, Séance, Tâche, Plan, Action Contrôle / Remplacement / Nettoyage / Réglage) and **Consommables utilisés** (one per part line: Ligne, Intervention, Type de consommable, Produit utilisé, Désignation, Quantité, Prix unitaire). All carry **ID app** and **Supprimé de l’app**. A line goes with the intervention whose task needs its consumable type, else with the Service's first task. A line typed by hand has no Produit utilisé and keeps its Désignation. A relation that points at one of your databases is only created when that database exists, and stays empty for a row whose page is not known. A removed row is ticked, never deleted, with the same guard as above.
