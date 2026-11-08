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

Vehicle → véhicule, Maintenance Task → tâche d'entretien, Service → entretien, Odometer Reading → relevé kilométrique, Fill-up → plein, Top-up → appoint, Full tank → plein complet, Consumption → consommation, Due Date → échéance, Interval → intervalle, Spec Line → caractéristique (fiche technique), Vehicle Part → article (une pièce ou un fluide), To buy / Bought → à acheter / achetée, Purchase → achat, Total paid → total payé, Build → motorisation, Plan Template → modèle de tâche, Document → document, Performed by → réalisé par, Total cost → coût total.

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
A part or fluid bought, or to be bought, for one Vehicle ("Motul 7100 10W-40", "Mann HU 7008 z"), with its part number, unit, usual quantity and price per unit, and optionally the Task it is bought for and the Spec Line it is for. It is either To buy or Bought. The owner picks from the Vehicle's parts when logging a Service. Not the same as a Spec Line, which is the factory figure: the item only points at it, so the figure is shown next to what was bought.
On screen the app calls it an **item** (article in French), so the word covers fluids as well as parts; "Vehicle Part" stays the term in the code and in these docs.
_Avoid_: Catalogue (that word is for the Plan Templates), stock, inventory, wishlist, shopping list

**To buy / Bought**:
The two states of a Vehicle Part. To buy covers anything the owner wants or plans to buy, including a part bought before that must be bought again; Bought means the owner has it. Recording a Purchase makes a part Bought; "buy again" makes it To buy. A part that existed before Purchases were introduced is Bought with an empty purchase log. Nothing finer: an idea still being compared goes in the part's Notes.

**Purchase**:
One occasion on which the owner bought a Vehicle Part: a date, a quantity (in the part's unit) and the Total paid for the goods as on the receipt, with further details (shop, delivery fees, receipt, notes) kept so the owner can analyse spending outside the app. The price per unit is worked out from Total paid and quantity, never typed. Delivery fees are a separate amount and never part of Total paid. A part can have many; together they are its purchase log. The app only records Purchases; it does not total or report them, and a Service's Total cost is unaffected.
_Avoid_: Order, expense, price per unit (as a typed field)

**Deal**:
An offer the owner found online for a Vehicle Part while looking for a good price: a link, a price, a shop and the day it was checked. It is not a Purchase: buying it is still recorded as a Purchase.
_Avoid_: Offer, quote, bargain

**Parts section**:
The garage-wide place in the app that lists the Vehicle Parts of every Vehicle together, filterable by Vehicle and by To buy / Bought. Each part still belongs to exactly one Vehicle.

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

## Other

**Document**:
A stored file (PDF or photo) attached to a Service as its Receipt.
