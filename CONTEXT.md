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

Vehicle → véhicule, Maintenance Task → tâche d'entretien, Service → entretien, Odometer Reading → relevé kilométrique, Due Date → échéance, Interval → intervalle, Spec Line → caractéristique (fiche technique), Build → motorisation, Plan Template → modèle de tâche, Document → document, Reminder → rappel, Performed by → réalisé par, Total cost → coût total.

## Maintenance Plan

**Maintenance Task**:
A recurring job defined for one Vehicle, named for what is to be done ("Change engine oil and filter", "Lubricate the chain"), with an Action, an Interval, a Category and Notes. A Vehicle's Tasks are its own: it can edit, add, remove or switch off any of them. A switched-off Task is paused: no Due Date, no Reminder.
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

**Component Used**:
A line of a Service naming what went in, with brand and variant ("Motul 7100 10W-40"), a part number, and a quantity in pieces or litres.
_Avoid_: Part Used, Part Spec

**Receipt**:
The photo or PDF of the invoice attached to a Service.
_Avoid_: Invoice (as a record), paper

**Odometer Reading**:
The distance on a Vehicle's odometer on a date, logged at any time. A Service records one too. Together they form the Mileage Log.
_Avoid_: Mileage entry, km log

**Mileage Log**:
A Vehicle's dated odometer values (readings and Services). It gives the current mileage and the average distance per day, which turns a distance Interval into a forecast date.

## Status

**Due Date**:
When a Task must next be done: the earlier of its time-based date and the date the Vehicle is projected to reach its distance-based point, given the Mileage Log.
_Avoid_: Deadline, next service

**Status**:
Worked out from the plan, the history and the mileage, never stored: Overdue when the Interval is used up, Due soon when 10% of the Interval (by distance or by time) or less is left, On track otherwise. A Task never done has no record yet; a switched-off one is Paused.

**Reminder**:
A notification to a subscribed device when a Task becomes Due soon or Overdue.
_Avoid_: Alert

## Other

**Document**:
A stored file (PDF or photo) attached to a Service as its Receipt.
