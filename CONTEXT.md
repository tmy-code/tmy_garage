# TMY Garage

A personal garage logbook for an owner who services their own cars and motorcycles. It rests on five parts: each Vehicle's Profile, its Maintenance Plan, the Service History Log, the Mileage Log, and the Status worked out from the other four.

## Language

**Garage**:
One person's own, isolated collection of Vehicles and their history. Each user of the app has exactly one Garage.
_Avoid_: Account, workspace, fleet

**Vehicle Profile**:
What identifies a Vehicle (car or motorcycle, brand, model, year, VIN, fuel and what it is built with) and its factory specs. A Vehicle is either owned or sold; a sold Vehicle keeps its full history but has nothing due.
_Avoid_: Car (when meaning any vehicle), bike, asset

**Build**:
What a Vehicle is made of (fuel, gearbox, timing drive, final drive, cooling, options). It picks which Plan Templates seed a new Vehicle's plan.
_Avoid_: Traits, motorisation (in English)

**Spec Line**:
One labelled value of a Vehicle's factory specs, in a group: Fluids ("Engine oil: 10W-40, 3.2 L"), Parts ("Front tyre: 120/70 ZR17, 2.5 bar"), Torque ("Drain plug: 30 Nm") or Other. A label appears once per Vehicle.
_Avoid_: Part Spec, Vehicle Spec, Torque Spec

### In the French interface

Vehicle → véhicule, Maintenance Task → tâche d'entretien, Service → entretien, Odometer Reading → relevé kilométrique, Fill-up → plein, Top-up → appoint, Full tank → plein complet, Consumption → consommation, Due Date → échéance, Interval → intervalle, Spec Line → caractéristique (fiche technique), Vehicle Part → article (une pièce ou un fluide), Achat → achat, Build → motorisation, Plan Template → modèle de tâche, Document → document, Performed by → réalisé par, Total cost → coût total.

## Maintenance Plan

**Maintenance Task**:
A recurring job defined for one Vehicle, named for what is to be done ("Change engine oil and filter", "Lubricate the chain"), with an Action, an Interval, a Category and Notes. A Vehicle's Tasks are its own: it can edit, add, remove or switch off any of them. A switched-off Task is paused: no Due Date.
_Avoid_: Job, service item, schedule entry

**Action**:
What a Task does to its part: Replace, Inspect, Clean or Adjust.

**Category**:
The group a Task or Plan Template is listed under: Engine, Transmission, Braking system, Chassis, Electrical, Cooling & Climate, and Other for what fits none. Any Task can be placed in any Category.
_Avoid_: Type, group, section

**Interval**:
How often a Task recurs: a distance only, a time only, or both, in which case it is due at whichever comes first.
_Avoid_: Frequency, period

**Task Notes**:
Free text on a Task: instructions, torque values, fluid reminders, standard part codes, links.
_Avoid_: Workshop notes, procedure

**Plan Template**:
A built-in or owner-made task (name, Action, Category, Interval, and the Build details it applies to) edited in Settings. A new Vehicle gets the Templates that fit its Build as its starting plan; changing a Template never changes a Vehicle that exists. "Add missing tasks from templates" gives an existing Vehicle the ones it lacks.
_Avoid_: Catalogue, Standard Part, schedule

## History

**Service**:
One occasion on which one or more Tasks were done on a Vehicle, on a date and at an odometer reading (optional when all its Tasks are time-based). It records who did it (Performed by: DIY, Independent garage or Dealership), the Total cost of parts and labour in one amount, the components used, notes, and a receipt. Logging a Service restarts the count of each Task it did.
_Avoid_: Maintenance (as a noun for an occasion), intervention, visit

**Repair**:
A Service outside the plan: a title and a Category instead of Tasks (a Task can still be ticked if one was done too). It never changes a Status.
_Avoid_: Fix, breakdown

**Component Used**:
A line of a Service naming what went in, with brand and variant ("Motul 7100 10W-40"), a part number, a quantity in pieces or litres and the price paid per unit. It is a copy: the Service keeps it as logged, even if the Vehicle Part it was picked from changes. On screen it is an **item** too (articles utilisés), the same word as the Vehicle Part it is usually picked from.
_Avoid_: Part Used, Part Spec, Element

**Vehicle Part**:
A part or fluid bought for one Vehicle ("Motul 7100 10W-40", "Mann HU 7008 z"), with its part number, unit, usual quantity and price per unit, and optionally the Task it is bought for and the Spec Line it is for. The owner picks from the Vehicle's parts when logging a Service. Not the same as a Spec Line, which is the factory figure: the item only points at it, so the figure is shown next to what was bought.
On screen the app calls it an **item** (article in French), so the word covers fluids as well as parts; "Vehicle Part" stays the term in the code and in these docs.
_Avoid_: Catalogue (that word is for the Plan Templates), stock, inventory, wishlist, shopping list

**Achat**:
A line of the owner's Notion Achats database: a date, an article (a vehicle's consumable line), optionally a product, quantity, price and shop. The app only reads it. A required consumable is Bought when an Achat of its line is dated after the Task was last done, otherwise To buy.
_Avoid_: Purchase (the removed app log), order, expense

**Deal**:
An offer the owner found online for a Vehicle Part while looking for a good price: a link, a price, a shop and the day it was checked. It is not an Achat: buying it is recorded in the owner's Notion Achats database.
_Avoid_: Offer, quote, bargain

**Parts section**:
The garage-wide place in the app that lists the Vehicle Parts of every Vehicle together, filterable by Vehicle. Each part still belongs to exactly one Vehicle.

**Receipt**:
The photo or PDF of the invoice attached to a Service.
_Avoid_: Invoice (as a record), paper

**Fill-up**:
One visit to the pump: the date, the litres, the total paid and, if noted, the odometer. It is either a full tank or a top-up. The price per litre is worked out from the total paid and the litres, never typed.
_Avoid_: Refuel, fuel entry

**Top-up**:
A Fill-up that does not fill the tank. It gives no consumption of its own: its litres count towards the next full tank.

**Full tank**:
A Fill-up that fills the tank. Two full tanks with a known odometer give the Consumption of the stretch between them.

**Consumption**:
Litres used per 100 km over a stretch between two full tanks, and its average over all stretches (all litres over all kilometres). Always worked out, never stored.
_Avoid_: Mileage (that word is for distance), efficiency

**Odometer Reading**:
The distance on a Vehicle's odometer on a date, logged at any time. A Service or a Fill-up may record one too. Together they form the Mileage Log.
_Avoid_: Mileage entry, km log

**Mileage Log**:
A Vehicle's dated odometer values (readings, Services and Fill-ups). It gives the current mileage and the average distance per day, which turns a distance Interval into a forecast date.

## Status

**Due Date**:
When a Task must next be done: the earlier of its time-based date and the date the Vehicle is projected to reach its distance-based point, given the Mileage Log.
_Avoid_: Deadline, next service

**Status**:
Worked out from the plan, the history and the mileage, never stored: Overdue when the Interval is used up, Due soon when 10% of the Interval (by distance or by time) or less is left, On track otherwise. A Task never done has no record yet; a switched-off one is Paused.

**Todoist task**:
The task the app creates in the owner's Todoist when a Maintenance Task becomes Due soon or Overdue, dated with its Due Date. The app moves the date when the estimate changes and completes it once the job is logged.
_Avoid_: Reminder, alert

## Notion reference data

The owner keeps the referentials in Notion; the app copies them and keeps them read-only ([ADR 0007](docs/adr/0007-two-way-notion-sync.md)). French is the words used in Notion.

**Catalogue Task** (_Tâche d'entretien_):
A task of the Notion catalogue: what to do, whether it is an inspection or a replacement, the Equipment a Vehicle needs for it to apply, its default Intervals, and what it needs (Consumable Types, Component Types, Tools, instructions). A Maintenance Task that follows one is owned by Notion for its name, Action, Intervals and notes.
_Avoid_: Template (that is the built-in Plan Template)

**Component Type** (_Type de composant_):
A kind of component a task works on (a drain plug, a caliper bolt), to which a Vehicle's torque specs are attached.

**Consumable Type** (_Type de consommable_):
A kind of fluid or part that gets used up (engine oil, oil filter, brake pads). Each has a Family (fluid or part). What a Vehicle takes of one is its Vehicle Consumable.

**Product** (_Produit_):
A brand-name item of a Consumable Type, with a reference, supplier and a default price (not an Achat).
_Avoid_: Part (that is a Vehicle Part, the app's own list)

**Tool** (_Outil_):
Something used for a job, with a size or capacity and whether the owner has it.

**Equipment** (_Équipements_):
The tags the owner puts on a Vehicle in Notion (e.g. "Transmission chaîne", "ABS"). A Catalogue Task applies to a Vehicle when every tag of its "Applicable si" is among the Vehicle's Equipment; a task with no tag applies to every Vehicle.

**Required consumable** (_Consommable requis_):
A Consumable Type that a ticked replacement Task needs, shown on the Service screen with this Vehicle's own sheet (specification, OEM reference, capacity, quantity) and a picker for the Product used. Picking one fills in the line, which stays editable and keeps the type and the product. An inspection shows none.

**Session** (_Séance_):
A Service as it appears in the Notion journal: its date, odometer, who did the work and whether it was maintenance or a repair. Nothing else of the Service leaves the NAS.

**Intervention**:
One Task done during a Session, with its Action (check or replacement) and, when it has them, its catalogue task and its Plan.

**Plan** (_Plan d'entretien_):
The Notion page that ties one Vehicle to one Catalogue Task, with optional Intervals of its own and the last time the task was done ("Dernier fait"). The sync creates it for a derived Task and keeps "Dernier fait" up to date.

## Other

**Document**:
A stored file (PDF or photo) attached to a Service as its Receipt.
