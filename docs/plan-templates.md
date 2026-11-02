# Standard plan templates

The built-in maintenance tasks a vehicle can start with, by kind of vehicle. They are defined in [`src/shared/catalogue.ts`](../src/shared/catalogue.ts), which is the source of truth: this page is a readable copy of it. See [data-model.md](data-model.md#plan-templates) for how templates become tasks.

- A **new vehicle** gets the templates whose "Applies to" matches its build (fuel, gearbox, drivetrain and so on). After that its plan is its own.
- **Intervals** are the defaults. Whichever of distance or time comes first applies. They can be changed in Settings, and only affect vehicles added afterwards.
- A template marked "uses a part" or "uses a fluid" also gives the task a part or fluid to buy, to be filled in on the vehicle.
- A template with **no task of its own** is done with another one (the oil filter with the engine oil).
- A template that is **always done together with** another also logs that one when a service is saved (the fork seals also log the fork oil), though the other can be done alone.
- Tasks are named in English and French: the French names are in the catalogue.
- Values under "Applies to" are the build details of the vehicle form. Fuel: petrol, flexfuel, diesel, hybrid, phev (plug-in hybrid), electric. Gearbox: manual, automatic, dct (dual-clutch), cvt, e_cvt (hybrid).

## Cars

### Engine

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Change engine oil and filter | 15 000 km / 1 y | fuel: petrol, flexfuel, diesel, hybrid, phev | 10 000 km with a turbo; uses a fluid |
| (Oil filter) | 15 000 km / 1 y | fuel: petrol, flexfuel, diesel, hybrid, phev | no task of its own: done with the engine oil; uses a part |
| Replace air filter | 30 000 km / 2 y | fuel: petrol, flexfuel, diesel, hybrid, phev | uses a part |
| Replace accessory belt and tensioner | 100 000 km / 6 y | fuel: petrol, flexfuel, diesel, hybrid, phev | uses a part |
| Replace timing belt kit and water pump | 120 000 km / 10 y | distribution: belt | uses a part |
| Replace spark plugs | 60 000 km / 6 y | fuel: petrol, flexfuel, hybrid, phev | uses a part |
| Replace fuel filter | 30 000 km / 2 y | fuel: diesel | uses a part |

### Transmission

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Replace clutch kit | 150 000 km | gearbox: manual | uses a part |
| Change clutch fluid | 2 y | gearbox: manual | uses a fluid |
| Change automatic gearbox fluid and filter | 60 000 km / 5 y | gearbox: automatic | uses a fluid |
| Change dual-clutch gearbox oil and filter | 60 000 km / 5 y | gearbox: dct | uses a fluid |
| Change CVT fluid | 60 000 km / 5 y | gearbox: cvt | uses a fluid |
| Change e-CVT transaxle fluid | 100 000 km / 10 y | gearbox: e_cvt | uses a fluid |
| Change rear differential oil | 100 000 km / 10 y | drivetrain: rwd, awd | uses a fluid |
| Change front differential oil | 100 000 km / 10 y | drivetrain: awd | uses a fluid |
| Change transfer case oil | 100 000 km / 10 y | drivetrain: awd | uses a fluid |
| Change reduction gear oil | 150 000 km / 10 y | fuel: electric | uses a fluid |
| Change rear reduction gear oil (dual motor) | 150 000 km / 10 y | fuel: electric; drivetrain: awd | uses a fluid |

### Brakes

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Replace front brake pads | 40 000 km | Every vehicle | uses a part |
| Replace rear brake pads | 60 000 km | Every vehicle | uses a part |
| Replace front brake discs | 80 000 km | Every vehicle | uses a part |
| Replace rear brake discs | 100 000 km | Every vehicle | uses a part |
| Change brake fluid | 2 y | Every vehicle | uses a fluid |

### Chassis

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Replace front tyres | 40 000 km / 6 y | Every vehicle | uses a part |
| Replace rear tyres | 40 000 km / 6 y | Every vehicle | uses a part |
| Replace front shock absorbers | 100 000 km | Every vehicle | uses a part |
| Replace rear shock absorbers | 100 000 km | Every vehicle | uses a part |
| Replace wiper blades | 1 y | Every vehicle | uses a part |

### Electrical

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Replace 12 V battery | 5 y | no start-stop | uses a part |
| Replace 12 V battery (AGM/EFB, start-stop) | 4 y | has start-stop | uses a part |

### Cooling & climate

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Replace cabin filter | 15 000 km / 1 y | Every vehicle | uses a part |
| Change coolant | 60 000 km / 5 y | fuel: petrol, flexfuel, diesel, hybrid, phev | uses a fluid |
| Change inverter coolant | 150 000 km / 10 y | fuel: hybrid, phev | uses a fluid |
| Change battery coolant | 150 000 km / 10 y | fuel: electric | uses a fluid |
| Replace A/C dryer | 6 y | has air conditioning | uses a part |

## Motorcycles

### Engine

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Change engine oil and filter | 8 000 km / 1 y | fuel: petrol | uses a fluid |
| (Oil filter) | 8 000 km / 1 y | fuel: petrol | no task of its own: done with the engine oil; uses a part |
| Replace air filter | 15 000 km / 2 y | fuel: petrol | uses a part |
| Replace spark plugs | 20 000 km / 4 y | fuel: petrol | uses a part |

### Transmission

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Replace clutch plates | 30 000 km | gearbox: manual | uses a part |
| Change hydraulic clutch fluid | 2 y | gearbox: manual; has hydraulic clutch | uses a fluid |
| Change DCT oil and filter | 24 000 km / 2 y | gearbox: dct | uses a fluid |
| Replace CVT drive belt | 20 000 km | gearbox: cvt | uses a part |
| Replace variator rollers | 20 000 km | gearbox: cvt | uses a part |
| Replace chain | 25 000 km | final drive: chain | uses a part |
| Replace front and rear sprockets | 25 000 km | final drive: chain | uses a part |
| Replace final drive belt | 60 000 km | final drive: belt | uses a part |
| Change final drive (shaft) oil | 30 000 km / 3 y | final drive: shaft | uses a fluid |
| Change final drive gear oil (scooter) | 20 000 km / 2 y | final drive: gear | uses a fluid |

### Brakes

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Replace front brake pads | 20 000 km | Every vehicle | uses a part |
| Replace rear brake pads | 25 000 km | Every vehicle | uses a part |
| Replace front brake discs | 50 000 km | Every vehicle | uses a part |
| Replace rear brake disc | 60 000 km | Every vehicle | uses a part |
| Change brake fluid | 2 y | Every vehicle | uses a fluid |
| Replace brake hoses | 5 y | Every vehicle | uses a part |

### Chassis

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Replace front tyre | 15 000 km / 5 y | Every vehicle | uses a part |
| Replace rear tyre | 10 000 km / 5 y | Every vehicle | uses a part |
| Change fork oil | 30 000 km / 3 y | Every vehicle | uses a fluid |
| Replace fork seals | 60 000 km / 6 y | Every vehicle | always done together with "Change fork oil"; uses a part |

### Electrical

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Replace battery | 4 y | Every vehicle | uses a part |

### Cooling & climate

| Task | Interval | Applies to | Notes |
| --- | --- | --- | --- |
| Change coolant | 3 y | fuel: petrol; cooling: liquid | uses a fluid |
| Change motor and battery coolant | 4 y | fuel: electric; cooling: liquid | uses a fluid |

