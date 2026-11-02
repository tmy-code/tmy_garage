# TMY Garage

A personal garage logbook for an owner who services their own cars and motorcycles: what maintenance is due, what parts and consumables each vehicle takes, and the vehicle and insurance facts needed to shop for better insurance quotes.

## Language

**Garage**:
One person's own, isolated collection of Vehicles, Insurance Policies, Drivers and their history. Each user of the app has exactly one Garage.
_Avoid_: Account, workspace, fleet

**Vehicle**:
A car or motorcycle belonging to a Garage. It is either owned or sold; a sold Vehicle (with sale date, Odometer Reading and price) keeps its full history but no longer has anything due. "Owned" means the user keeps and maintains it, even if it is registered or insured in someone else's name (e.g. a family member).
_Avoid_: Car (when meaning any vehicle), bike, asset, archived

### In the French interface

The app speaks English and French. French screens use: Vehicle → véhicule, Maintenance Task → tâche d'entretien, Service → entretien, Odometer Reading → relevé kilométrique, Due Date → échéance, Interval → intervalle, Vehicle Spec → caractéristique, Torque Spec → couple de serrage, Required Tool → outil, Workshop Notes → notes d’atelier, Build → motorisation, Parts Catalogue → liste des pièces, Standard Part → pièce standard, Part Spec → spécification de pièce, OEM Reference → référence constructeur, Required Part → pièce nécessaire, Part Used → pièce utilisée, Fitment Position → emplacement, Shopping List → liste de courses, Technical Inspection → contrôle technique, Inspection Defect → défaillance, Modification → modification, Document → document, Insurer → assureur, Insurance Policy → contrat, Policy Term → période, Cover → garantie, Driver → conducteur, Claim → sinistre, Quote → devis, Quote Pack → dossier devis, Reminder → rappel.

## Maintenance

**Maintenance Task**:
A recurring job defined for one Vehicle (e.g. "engine oil and filter change"), with an Interval saying how often it must be done. A Task may say which Standard Part it replaces; while that part is not on the Vehicle (set aside after a Build change, or marked by the user), the Task is paused: it has no Due Date, sends no Reminder and adds nothing to the Shopping List. A Vehicle's Tasks are listed by category: a Task replacing a Standard Part takes the part's category, any other the one the owner picks ("other" until then); paused Tasks are listed apart.
_Avoid_: Job, service item, schedule entry

**Interval**:
How often a Maintenance Task recurs: a distance, a duration, or both, in which case it is due at whichever is reached first. Where the user's own interval and the Official Interval differ, the stricter one applies.
_Avoid_: Frequency, period

**Service Schedule**:
The manufacturer's list of maintenance jobs and intervals for one Vehicle's exact version, taken from its owner's manual or service booklet; the source of that Vehicle's Maintenance Tasks.
_Avoid_: Maintenance plan, manufacturer schedule, plan d'entretien

**Official Interval**:
The Interval the Service Schedule gives for a Maintenance Task, kept alongside the Task so the user can see how their own Interval differs from it.
_Avoid_: Recommended interval, OEM interval

**Service**:
One occasion on which the user performed one or more Maintenance Tasks on a Vehicle, at a given date and odometer reading. The odometer reading is required only when one of those Tasks has a distance Interval; a Service of time-based Tasks alone (e.g. coolant every 3 years) may leave it out.
_Avoid_: Maintenance (as a noun for an occasion), intervention, visit

**Odometer Reading**:
The distance shown on a Vehicle's odometer on a given date, logged by the user at any time; a Service also records one, unless its Tasks are all time-based and the user left it out.
_Avoid_: Mileage entry, km log

**Due Date**:
The date by which a Maintenance Task must next be done: the earlier of its time-based due date and the date the Vehicle is projected to reach its distance-based due point, given recent Odometer Readings.
_Avoid_: Deadline, next service

## Workshop Data

**Vehicle Spec**:
A piece of technical reference data about a Vehicle, taken from its manuals (e.g. a Torque Spec, tyre pressure, spark plug gap, chain slack). Maintenance Tasks reference the Vehicle Specs they involve.
_Avoid_: Technical data, specification sheet

**Torque Spec**:
A Vehicle Spec giving the tightening torque for one fastener (e.g. "rear caliper bolts, 30 Nm, blue thread-locker").
_Avoid_: Torque value, tightening spec

**Required Tool**:
A tool a Maintenance Task needs, with its size where relevant (e.g. "5 mm hex", "torque wrench 5–60 Nm"); together they form the Task's pre-job checklist.
_Avoid_: Tool list, equipment

**Workshop Notes**:
Free-text steps, warnings, photos and links for carrying out a Maintenance Task.
_Avoid_: Procedure, instructions, how-to

## Inspections

**Technical Inspection**:
The regulatory roadworthiness check of a Vehicle by an approved centre (contrôle technique), with date, Odometer Reading, result and Inspection Defects. Not a Service: the user does not perform it, and its rhythm is set by regulation from first registration, not by an Interval. The next one is due by the date printed on the last report; without one it is estimated from the regulatory rhythm.
_Avoid_: CT, MOT, contrôle

**Inspection Defect**:
A fault recorded by a Technical Inspection. A defect requiring a re-inspection (contre-visite) must be fixed by a deadline; one fixed by the user is closed by a Service.
_Avoid_: Défaillance, failure, issue

## Parts

**Part**:
Anything fitted to or consumed by a Vehicle during maintenance, measured in pieces or by volume (filters, pads, plugs, oil, coolant, chain lube).
_Avoid_: Consumable, supply, spare (as separate categories)

**Build**:
What a Vehicle is built with, as far as its parts go: fuel (petrol, flex-fuel E85 for a car, diesel, hybrid, plug-in hybrid, electric; flex-fuel takes the same parts and options as petrol) and gearbox (manual, automatic, dual-clutch, CVT, e-CVT, single-speed); for a car its driven wheels, timing drive and options (turbo, direct injection, start-stop, AdBlue, A/C, air suspension); for a motorcycle its final drive, cooling, number of cylinders and whether its clutch is hydraulic. Every new Vehicle must give its whole Build, and impossible combinations are refused (e.g. a hybrid with a manual gearbox); an electric Vehicle is always single-speed with no timing drive. It decides which Standard Parts the Vehicle has. A Vehicle added before the Build was required may have parts of it missing, which then match nothing.
_Avoid_: Specification, configuration, trim

**Parts Catalogue**:
The list of Standard Parts and the conditions on the Build under which a Vehicle has each: a built-in list, plus what the owner changes in Settings. For a built-in part the owner can change its conditions and default details or take it off the list, and can go back to the built-in version; the owner can also add parts of their own, with a name, category, type and Interval. A change applies to every Vehicle right away, under the same rules as a Build change. Default details fill a Part Spec only where nothing else was written, and do not count as the owner having filled it in.
_Avoid_: Part types, template, master list

**Standard Part**:
A part to replace that a Vehicle of one kind might have, from the Parts Catalogue (e.g. engine oil, oil filter, chain, sprockets for a motorcycle; cabin filter, timing belt kit, automatic gearbox fluid for a car), with the conditions on the Build under which it is there and a generic default Interval. Checks and services (wheel alignment, valve clearance, chain lubrication) are not Standard Parts. A Vehicle lists the Standard Parts that fit its Build (a petrol automatic car with a timing chain gets no timing belt kit, fuel filter or clutch kit); what varies between Vehicles is only their Part Spec. An owned Vehicle has a Maintenance Task replacing each Standard Part that fits its Build, added when the Vehicle is added or when a Build change makes the part fit, at the default Interval for that Build (shorter for engine oil with a turbo) and needing the part as a Required Part whose quantity is left to fill in (the oil filter goes with the engine oil). The Interval follows the Build until the owner sets their own; setting it back to the default makes it follow again. A part's only Task cannot be deleted or unlinked: the owner switches it off by marking the part as not on the Vehicle. Tasks the owner made before, named like one of these, became it. When the Build changes, Standard Parts that no longer fit are set aside as not on the Vehicle, unless the user has filled in their Part Spec, given a quantity for it in a Task, or used them, in which case they are kept and flagged. A Standard Part can also be marked by the user as not on a Vehicle. A Part outside this list is named by the user.
_Avoid_: Part type, category, catalogue entry

**Part Spec**:
The technical description of what a Vehicle takes for one Part, without quantity: characteristics such as viscosity, API/JASO grade or dimensions, the OEM Reference, and/or acceptable part numbers of equivalents (e.g. "engine oil 10W-40, JASO MA2").
_Avoid_: Requirement, recommended part

**OEM Reference**:
The vehicle manufacturer's own part number for a Part on one Vehicle (e.g. a Honda or Renault reference), kept apart from the equivalent part numbers that also fit.
_Avoid_: Genuine part number, original reference

**Required Part**:
A Part Spec and the quantity of it a Maintenance Task needs (e.g. "engine oil 10W-40 JASO MA2, 3.2 L"). The quantity may be left to fill in; the Shopping List then says to check it.
_Avoid_: Part list, bill of materials

**Part Used**:
The actual Part fitted or consumed during a Service: brand, part number and quantity, optionally price and supplier.
_Avoid_: Purchase, consumption

**Modification**:
A change that takes a Vehicle away from its factory configuration (e.g. aftermarket exhaust, ECU remap, heated grips), with the date fitted, optional date removed, the Parts involved, and whether it has been declared to the insurer. Like-for-like or in-spec replacements are maintenance, not Modifications.
_Avoid_: Mod, upgrade, customisation

**Fitment Position**:
A location on a Vehicle that holds one Part at a time (e.g. front tyre, rear tyre, battery, chain kit). Each Standard Part that fits the Vehicle's Build and is fitted rather than topped up (not oils, fluids or gas) is a Fitment Position; the user never adds one by hand, so a motorcycle with a chain drive has a chain kit position and one with a belt drive has a drive belt position instead. Older positions the user named before this are kept. What is currently fitted there is the most recent Part Used or Modification at that position; a Part Used for a Standard Part's Part Spec goes at that Standard Part's position.
_Avoid_: Slot, component, location

**Shopping List**:
The Required Parts of the Maintenance Tasks coming due, added up per Part Spec, with what was used last time. The user checks the shelf themselves: no stock of spares is tracked.
_Avoid_: Stock, inventory, order

**Reminder**:
A notification sent to the user's subscribed devices when a Maintenance Task, Technical Inspection, Document expiry or Policy Term renewal becomes due soon, and again when it becomes overdue (then weekly until dealt with).
_Avoid_: Alert, notification (for the concept), rappel

## Documents

**Document**:
A stored file (PDF or photo) of a given type, with optional issue and expiry dates, attached to exactly one Vehicle, Insurance Policy, Cover, Claim, Service, Modification or Technical Inspection (e.g. carte grise, mémo véhicule assuré, invoice, owner's manual).
_Avoid_: File, attachment, paper

## Insurance

**Insurer**:
A company that sells vehicle insurance, either the user's current one or a competitor.
_Avoid_: Assureur, company, provider

**Insurance Policy**:
A contract with one Insurer covering one or more Vehicles, running from a start date until cancelled (contrat d'assurance).
_Avoid_: Contract, insurance (as a countable noun)

**Policy Term**:
One period of an Insurance Policy, usually a year, ending at its renewal date (échéance), during which its Covers and premiums are fixed.
_Avoid_: Year, period, renewal

**Cover**:
What an Insurance Policy provides for one Vehicle during one Policy Term: cover level (au tiers, tiers étendu, tous risques), optional guarantees, excess (franchise), premium, and that Vehicle's bonus-malus coefficient (CRM).
_Avoid_: Coverage, formule, guarantee (for the whole package)

**Driver**:
A person declared on an Insurance Policy as allowed to drive its Vehicles, with licence dates and claims history. Currently only the user.
_Avoid_: Conducteur, insured, policyholder

**Claim**:
An incident declared to an Insurer under an Insurance Policy (sinistre), with date, Vehicle, Driver, responsibility (at fault, partly or not) and amount.
_Avoid_: Sinistre, accident, incident

**Relevé d'information**:
The claims-history statement an Insurer issues for an Insurance Policy, covering the last five years: Vehicles, Drivers, CRM and Claims. Required by every competing Insurer for a quote.
_Avoid_: Claims statement, RI

**Quote**:
A price offered by an Insurer for a given Vehicle at a given date, described with the same terms as a Cover (cover level, guarantees, excess) so it can be compared against the current Cover's premium.
_Avoid_: Devis, offer, estimate

**Quote Pack**:
Everything a competing Insurer or comparison site asks about one Vehicle and its Drivers, gathered in one place: registration facts, overnight parking, annual distance derived from Odometer Readings, current Cover, CRM, Claims over five years, Modifications and licence dates.
_Avoid_: Quote request, insurance profile
