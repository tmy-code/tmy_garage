# The Notion copy

`npm run notion-sync` copies part of the garage into Notion, so the owner can look for good prices there (see [ADR 0005](adr/0005-one-way-copy-to-notion-for-deal-hunting.md)). It only reads the app: nothing done in Notion comes back.

## What it copies

Three databases, in French, under the page set by `NOTION_PARENT_PAGE_ID`:

| Database | One page per | Columns from the app | The owner's columns |
| --- | --- | --- | --- |
| Véhicules | owned Vehicle | name, kind, make, model, year, Build, latest odometer and its date, km per day, day of the copy | JDex |
| Caractéristiques | Spec Line in the Fluids or Parts group | label, value, OEM reference, group, category, Vehicle | |
| Articles | Vehicle Part | name, part number, To buy / Bought, unit, usual quantity, last price paid per unit, the Task it is for with its Due Date and Status, Vehicle, Spec Line | Lien affaire, Prix affaire, Boutique, Vérifié le (the Deal) |

Never copied: VINs, sale details, Services, Purchases (other than the last price per unit), notes, receipts and other Documents, torque and other Spec Lines, sold Vehicles.

## How it behaves

- Each page carries the app's id (`ID app`), so running again updates pages instead of doubling them, and only pages that changed are written.
- The script writes the app's columns and never touches the owner's. A column edited by hand in Notion is put back on the next run.
- A record gone from the copy (deleted in the app, or its Vehicle sold) keeps its page, with **Supprimé de l’app** ticked.
- A missing database or column is created; an existing one is never changed, so views, colours and column order set in Notion stay.
- Due Dates and the odometer are as of the day of the copy (`Copié le`).

## Setting it up

1. In Notion, open **Settings › Connections › Develop or manage integrations** and create an internal integration with read and write content access. Copy its token.
2. Open the parent page in Notion, then **⋯ › Connections** and add the integration. It can then reach that page only.
3. In `.env` (never committed), set `GARAGE_URL` (the server as reached from this computer), `NOTION_TOKEN` and `NOTION_PARENT_PAGE_ID` (the 32 characters at the end of the page's link). See `.env.example`.
4. Run `npm run notion-sync`. `--dry-run` shows what would be copied without touching Notion; `--snapshot <file>` reads a saved snapshot instead of the server.
