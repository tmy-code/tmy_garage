# The Notion sync

The server keeps Notion and the app in step ([ADR 0007](adr/0007-two-way-notion-sync.md)). **Notion wins definitions, the app wins logs**: the owner maintains the referentials in Notion (task catalogue, which task applies to which vehicle, specs, tools, consumable types, products); the app stores them offline, read-only, and keeps the logging and the reminders. It also still copies vehicles and items to Notion for deal hunting ([ADR 0005](adr/0005-one-way-copy-to-notion-for-deal-hunting.md)). Every database, column and link is described in [notion-databases.md](notion-databases.md).

Each run does, in order: **fetch** the owner's databases, **apply** them to the app in one transaction (an error changes nothing), then **push** the copy. It runs on the NAS server about a minute after start, every 30 minutes, and from *Settings* → *Notion* → *Sync now*. Only the server holds the Notion token.

## Who owns what

| Data | Owner | Notes |
| --- | --- | --- |
| Task catalogue, component types, consumable types, products, tools | Notion | Hand-made databases, read-only in the app. |
| Per-vehicle consumables and specs | Notion | Separate from the app's own spec lines, which stay and are shown after the Notion specs. |
| A vehicle's equipment tags | Notion | Column *Équipements* of *Véhicules*. The push never writes it. |
| Name, action, intervals and notes of a task that follows the catalogue | Notion | The Plan's interval overrides the catalogue default. The app answers 409 `notion_owned` if asked to change them or delete the task. |
| Switched off, baseline (last done before tracking) and category of a task | The app | |
| Tasks the owner made in the app and that match no catalogue task | The app | Left alone. |
| Services, odometer readings, fill-ups, documents, purchases | The app | Never pulled from Notion. |
| *Véhicules* and *Articles* databases (columns the app writes) | The app | Pushed; the owner's columns (JDex, Deals, *Équipements*) are never written. |
| *Caractéristiques* | Nobody | Frozen: no longer written, nothing deleted. |

## The databases the owner makes by hand

Found by title under the page set by `NOTION_PARENT_PAGE_ID`. The app never creates, renames, retypes or deletes their columns or databases, and never writes their title column. A missing optional column is tolerated; a missing required one (or a missing database) makes that database "incomplete": the warning is shown in Settings and nothing is removed because of it.

| Database | Columns (required first) |
| --- | --- |
| Tâches d'entretien | Tâche (title), Action (select: Contrôle / Remplacement), Applicable si (multi-select), Intervalle par défaut (km), Intervalle par défaut (mois) · Types de consommables requis, Composants, Outils (relations), Instructions, Catégorie (select: Moteur / Transmission / Freinage / Châssis / Électricité / Refroidissement et climatisation / Autre; also Freins, Roues, Électrique) |
| Types de composants | Nom · Catégorie, Notes |
| Types de consommables | Nom · Catégorie, Famille (Fluide / Pièce), Notes |
| Produits | Nom · Type de consommable (relation), Marque, Référence, Fournisseur, Prix, Notes |
| Outils | Nom · Type, Taille / capacité, Possédé (checkbox), Prix, Notes |
| Plans d'entretien | Plan (title), Véhicule, Tâche · Intervalle (km), Intervalle (mois) (per-vehicle overrides), Dernier fait (km), Dernier fait (date), Notes |
| Consommables par véhicule | Désignation (title), Véhicule, Type · Spécification, Réf. OEM, Capacité, Quantité (number or text), Produits compatibles, Produit retenu, Statut (Confirmé / À confirmer) |
| Spécifications | Élément (title), Véhicule, Valeur (number or text) · Composant, Catégorie, Unité, Source, Statut |

In *Véhicules* (the app's database) the owner adds the multi-select **Équipements**. A page that points at several vehicles gives one row per vehicle. Words the app does not know (an Action other than Contrôle or Remplacement…) are read as empty, with a warning.

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

Pushed to Notion: owned vehicles (name, kind, make, model, year, Build, odometer, daily distance) and all their items (name, reference, to buy / bought, unit, usual quantity, last price per unit, the task and its due date and status), plus the journal below. Never: VINs, sale details, the cost of a Service, receipts and other documents, notes, shops, repair titles, odometer-only readings, purchases, fill-ups, sold vehicles.

## Writing back to the Plans database

The only writes into the owner's databases are in *Plans d'entretien*:

- A **plan page** is created for each task that follows the catalogue and has none, with only **Plan** (the title), **Véhicule** and **Tâche**. Never twice, never when a page for that vehicle and task exists already, never for a paused task, and never again for a page the owner archived (the pull pauses that task).
- **Dernier fait (km)** and **Dernier fait (date)** are written from the last Service (a baseline counts), only where the value differs. If either column is missing or has another type, or the page covers several vehicles, a warning says so and nothing is written.

## The journal

Three databases the app creates under the parent page (found by title; missing columns are added, existing ones never changed): **Séances** (one per Service: Séance, Véhicule, Date, Km, Réalisé par, Type Entretien / Réparation), **Interventions** (one per task done: Intervention, Séance, Tâche, Plan, Action Contrôle / Remplacement) and **Consommables utilisés** (one per part line: Ligne, Intervention, Type de consommable, Produit utilisé, Désignation, Quantité, Prix unitaire). All carry **ID app** and **Supprimé de l’app**. A line goes with the intervention whose task needs its consumable type, else with the Service's first task. A line typed by hand has no Produit utilisé and keeps its Désignation. A relation that points at one of your databases is only created when that database exists, and stays empty for a row whose page is not known. A removed row is ticked, never deleted, with the same guard as above.
