---
status: superseded by 0007 and 0008 (the Articles copy was removed)
---

# A one-way copy to Notion for deal hunting

The owner looks for good prices online for the parts and fluids they need, and wants to do it in Notion, beside their other notes and with Notion's AI. We copy a small part of the garage into Notion, under a page the owner chooses in their own filing system, with a script run on demand. The app stays the only place where garage data is entered. This amends ADR 0002, which kept all data off third-party clouds: only data that helps with buying leaves the NAS.

## Decisions

- **What is copied.** Vehicles that are owned (name, kind, make, model, year, Build, current odometer, daily distance). All their Vehicle Parts, To buy or Bought, with the last price paid per unit and the Due Date of the Task each one is bought for. Their Spec Lines in the Fluids and Parts groups.
- **What never leaves the NAS.** VINs, sale details, Services and their costs, Purchases other than the last price per unit, receipts and every other Document, torque and other Spec Lines, and sold Vehicles.
- **One way.** The script reads `/api/snapshot` and works out Due Dates with the app's own code. It never writes back. Deals, and the owner's filing reference for each Vehicle, live in columns that exist only in Notion, which the script never overwrites. A part bought is recorded as a Purchase in the app, as before.
- **Nothing found in Notion is lost by the script.** A part deleted in the app, or whose Vehicle is sold, keeps its Notion page, marked as deleted from the app and hidden from the views.
- **On demand.** The owner runs the script before a deal-hunting session. Running it again updates pages instead of doubling them, so it can later run nightly from the NAS without changing the design. Each copy records the day it was made, since Due Dates go stale.
- **In French**, with the words of the app's French interface.

## Considered Options

- **Two-way sync** (edit parts in Notion): rejected. It would need conflict handling on top of the offline send queue (ADR 0001) for one owner who enters data in the app anyway.
- **Copying everything**: rejected. VINs and receipts identify the owner, and the history and costs do not help with finding a deal.
- **A button in the app on the NAS**: deferred. A script on the owner's PC is less to build, and it can move into the container later.

## Consequences

- The Notion token, the id of the parent page and the server's address are set in `.env` and never committed. The integration is shared with that page only, so it cannot read the rest of the workspace. The code is generic, so it can live in this public repository.
- Notion holds a copy that may be out of date. Due Dates there are as of the day of the last copy.
