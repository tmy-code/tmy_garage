---
status: accepted, extended by ADR 0004 (parts can also be To buy, and have a purchase log)
---

# A parts list per Vehicle, picked when logging a Service

The components of a Service were free text typed each time. We added a **parts list** per Vehicle (`vehicle_parts`): what the owner actually buys, with part number, unit, usual quantity, price per unit and the Task it is usually bought for. Logging a Service picks from it, and a part typed by hand is kept in it by default.

## Decisions

- **Per Vehicle, not shared.** Two Vehicles with the same oil each list it. This keeps every list small and removes any question of whose price or quantity is right. Copying between Vehicles can come later if it is missed.
- **A Service keeps its own copy.** A component stores its description, part number, quantity, unit and price as logged, with only a loose `part_id` back to the list (emptied if the part is deleted). History therefore never changes when the list does, and the same rule already holds for Tasks and Services.
- **Not linked to Spec Lines.** Spec Lines are the factory reference ("10W-40, 3.2 L"); the parts list is what was bought. They answer different questions and are edited at different times. *(Reversed in part by ADR 0004: an item can now optionally point at the Spec Line it is for. The two lists stay separate and nothing is copied between them.)*
- **Offline.** Logging a Service must keep working offline (ADR 0001). The list travels in the snapshot, and a part to keep is created by the server when the Service arrives, under an id the phone made, so a replayed Service never doubles it. Editing the list itself needs a connection, like the Specs page.
- **Price stays manual.** A Service records the price paid, but never rewrites the list price: replaying an old queued Service could otherwise set it back.

## Consequences

- A new table and two columns on `service_items` (`part_id`, `price`), added by a migration; older phones keep working because the new fields are optional in a Service.
- The word "catalogue" stays reserved for the Plan Templates; this list is the "parts list" (Vehicle Part) everywhere.
