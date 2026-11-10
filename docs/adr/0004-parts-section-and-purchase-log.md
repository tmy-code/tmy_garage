---
status: accepted, mostly superseded by ADR 0008 (the to-buy state and the purchase log were removed; the Parts list remains)
---

# A garage-wide Parts section with a purchase log

The parts list (ADR 0003) held only parts already bought, per Vehicle. The owner also wants to note parts they plan to buy, see every Vehicle's parts in one place, and record what each purchase cost so spending can be analysed outside the app. We added a **Parts section** over the existing per-Vehicle lists, a **To buy / Bought** state on each Vehicle Part, and a **Purchase** log under each part.

## Decisions

- **One section, parts still per Vehicle.** The Parts section lists every Vehicle's parts, filtered by Vehicle and state. It replaces the per-Vehicle Workshop page, which now links to it filtered to that Vehicle. ADR 0003's rule that a part belongs to exactly one Vehicle stands, so there is still no shared price or quantity to argue about.
- **Two states, with a stored marker.** A part is To buy or Bought. Parts that existed before this change are Bought with an empty log, so the state cannot be derived from "has a Purchase": a stored to-buy marker is set for a wished part and for "buy again", and cleared by recording a Purchase. We refused to invent Purchases (made-up dates and totals) for old parts, because the log exists to be analysed.
- **A Purchase records what the receipt says.** Date, quantity in the part's unit, and **Total paid** for the goods, with optional shop, delivery fees, receipt and notes. The price per unit is worked out, never typed, and delivery fees are never part of Total paid. A price per unit forced the owner to divide a 5 L jug by hand and lost cents.
- **The app records, it does not report.** No totals, charts or spending figures. A Service's Total cost keeps its meaning, so there is no double counting between a Purchase and a Service. A Download CSV button gives the owner the log for analysis in a spreadsheet.
- **An item may point at its Spec Line.** This reverses ADR 0003's "not linked to Spec Lines": without it the app could not say that "Motul 7100 10W-40" is the oil for "Engine oil: 10W-40, 3.2 L", nor show the factory figure beside what was bought. The link is optional, to one Spec Line of the same Vehicle, and loose (emptied if the Spec Line is deleted). The spec is only shown next to the item and in the Service form picker: nothing is copied, defaulted or checked, so the free-text spec labels cannot break anything. The link to a Task stays, since it answers a different question (which job the item is bought for).
- **The part's price stays manual.** It does not follow the latest Purchase. This keeps ADR 0003's rule: two figures can differ, and that is accepted.
- **Service form.** It offers all of a Vehicle's parts, Bought first. Picking a To buy part clears its marker when the Service is saved, which works offline because the server does it on arrival. No Purchase is invented, so the part shows "no purchase recorded" until one is added.
- **Online only to change, readable offline.** Managing parts and Purchases needs a connection, like the Specs page (ADR 0001 is unchanged). The parts and their Purchases do travel in the offline snapshot, so the Parts section can be read, and the Service form can pick from it, with no signal.

## Consequences

- A migration adds the Purchases table, the to-buy marker and a Notes column on parts. Existing parts get no marker, so they stay Bought.
- "Wishlist" and "shopping list" stay out of the vocabulary (the old Shopping List was removed in the five-parts rework): the word is Vehicle Part, in the To buy state.
- An idea still being compared has no state of its own; it goes in Notes.
