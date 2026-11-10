---
status: accepted (2026-11-10)
---

# The shopping list and the purchase log move to Notion; the app reads the owner's Achats

The owner now keeps what to buy and what was bought in Notion, in their own *Achats* database, linked to the vehicle's consumable lines. Keeping the same thing in the app as well (the To buy / Bought state, the Purchase log, receipts, the CSV, the Articles copy) meant typing it twice. So the app stops being the place where purchases are entered, and instead reads Notion to say whether what a Task needs was bought since it was last done.

## Decisions

- **Removed from the app:** the To buy / Bought state of a Vehicle Part, the **Articles** push to Notion, the app's own **Purchase** log (screens and routes), the receipts of purchases and the CSV export. Using a part in a Service no longer changes anything on the part.
- **Kept:** the Parts list per Vehicle and the Parts section (list, add, edit, delete), and the Service form's picker (the parts for the ticked Tasks first, then the others). Todoist reminders are unaffected.
- **Nothing is dropped, so a rollback works.** The column `vehicle_parts.to_buy`, the `purchases` table, the `documents` check that still allows `purchase`, and the stored receipt files stay as they are. The only migration added is the new `ref_purchases` table. Deleting a part still removes its legacy purchase rows through the foreign key cascade; their receipt rows and files stay as unreachable orphans. The column may be dropped later (`ALTER TABLE vehicle_parts DROP COLUMN to_buy`).
- **`toBuy` is accepted and ignored.** The part schema stays a plain `z.object`, which strips unknown keys, so an old app that still sends `toBuy` is not rejected (never add `.strict()`). The server no longer reads or writes it.
- **Achats is read-only.** It is one of the owner's hand-made databases (ADR 0007): never created, renamed or written. Required columns: Achat (title), Date, Article (relation to *Consommables par véhicule*); optional: Produit, Quantité, Prix payé, Boutique. For privacy only the date, article, product, quantity, price and shop are kept; *Facture* (files) and *Notes* are never read or stored, and are not even in the app's description of the database.
- **The bought rule.** A required consumable is Bought when an Achat of one of the Vehicle's lines of that type is dated **strictly after** the date the Task was last done (the last Service, or its baseline); a Task never done counts any Achat; otherwise it is To buy. For several Tasks asking for the same type (the Service form), the strictest date applies: the latest last-done date. A type the Vehicle has no line for is **untracked**: nothing is shown, since nothing can be linked. It is worked out on the phone from the snapshot (`src/shared/purchases.ts`), never stored.
- **Names.** The table is `ref_purchases`, the type `NotionPurchase` and the snapshot field `notionPurchases`. The word `purchases` is not reused, so the legacy table, the removed Purchase log and the new Notion rows never get mixed up in code or in reading.
- **Matching** an Achat to a line is by the Notion page id (`article_notion_id` against `vehicle_consumables.notion_id`), at read time, so the order the databases are pulled in does not matter.

## Consequences

- **No `API_VERSION` bump.** An old app sending `toBuy` is ignored; a snapshot without `purchases` is read with the old app's `?? []`; an unknown `notionPurchases` is ignored. A bump would freeze old phones' send queues (ADR 0003 and ADR 0001's rule), and purchase writes were never in the send queue anyway. The symptoms on an old phone: its purchase screens answer 404 and it shows no Bought / To buy chips, until it is updated.
- The Notion *Articles* database is left in place for the owner to archive; the app never reads, writes or ticks it, and does not warn whether it exists.
- Chips (Bought on a date / To buy) appear under a Task that is Due soon or Overdue on the vehicle page and the dashboard, and in each consumable block of the Service form (with the shop).
