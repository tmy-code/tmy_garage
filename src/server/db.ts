import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { convertToFiveParts } from './five-parts.ts';

export const DEFAULT_GARAGE_ID = 'default';

// Append-only: never edit a migration that has shipped, add a new one.
/** SQL, or a function for a step that needs code (the rework onto the five parts). */
const MIGRATIONS: (string | ((db: DatabaseSync) => void))[] = [
  `
  CREATE TABLE garages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  INSERT INTO garages (id, name) VALUES ('${DEFAULT_GARAGE_ID}', 'My garage');

  CREATE TABLE vehicles (
    id TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    kind TEXT NOT NULL CHECK (kind IN ('car', 'motorcycle')),
    name TEXT NOT NULL,
    make TEXT,
    model TEXT,
    year INTEGER,
    registration TEXT,
    status TEXT NOT NULL DEFAULT 'owned' CHECK (status IN ('owned', 'sold')),
    sold_date TEXT,
    sold_odometer INTEGER,
    sold_price REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE maintenance_tasks (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    name TEXT NOT NULL,
    interval_km INTEGER,
    interval_months INTEGER,
    baseline_date TEXT,
    baseline_odometer INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (interval_km IS NOT NULL OR interval_months IS NOT NULL)
  );

  CREATE TABLE services (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    date TEXT NOT NULL,
    odometer INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE service_tasks (
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES maintenance_tasks(id),
    PRIMARY KEY (service_id, task_id)
  );

  CREATE TABLE odometer_readings (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    date TEXT NOT NULL,
    odometer INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  ALTER TABLE maintenance_tasks ADD COLUMN official_interval_km INTEGER;
  ALTER TABLE maintenance_tasks ADD COLUMN official_interval_months INTEGER;
  `,
  `
  ALTER TABLE maintenance_tasks ADD COLUMN workshop_notes TEXT;

  CREATE TABLE vehicle_specs (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    kind TEXT NOT NULL CHECK (kind IN ('torque', 'other')),
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE part_specs (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    name TEXT NOT NULL,
    characteristics TEXT,
    part_numbers TEXT,
    unit TEXT NOT NULL CHECK (unit IN ('piece', 'litre')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE fitment_positions (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE required_parts (
    task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
    part_spec_id TEXT NOT NULL REFERENCES part_specs(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,
    sort INTEGER NOT NULL,
    PRIMARY KEY (task_id, part_spec_id)
  );

  CREATE TABLE required_tools (
    task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (task_id, sort)
  );

  CREATE TABLE task_specs (
    task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
    spec_id TEXT NOT NULL REFERENCES vehicle_specs(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, spec_id)
  );

  CREATE TABLE parts_used (
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL,
    part_spec_id TEXT REFERENCES part_specs(id) ON DELETE SET NULL,
    position_id TEXT REFERENCES fitment_positions(id),
    description TEXT NOT NULL,
    part_number TEXT,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('piece', 'litre')),
    price REAL,
    supplier TEXT,
    PRIMARY KEY (service_id, sort)
  );
  `,
  `
  ALTER TABLE part_specs ADD COLUMN standard_part TEXT;
  ALTER TABLE part_specs ADD COLUMN not_fitted INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX part_specs_standard ON part_specs (vehicle_id, standard_part) WHERE standard_part IS NOT NULL;
  `,
  `
  ALTER TABLE vehicles ADD COLUMN first_registration TEXT;

  CREATE TABLE technical_inspections (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    date TEXT NOT NULL,
    odometer INTEGER NOT NULL,
    centre TEXT,
    result TEXT NOT NULL CHECK (result IN ('passed', 'majorDefects', 'criticalDefects')),
    next_due_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE inspection_defects (
    inspection_id TEXT NOT NULL REFERENCES technical_inspections(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('minor', 'major', 'critical')),
    fixed_service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
    PRIMARY KEY (inspection_id, sort)
  );

  CREATE TABLE modifications (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    name TEXT NOT NULL,
    fitted_date TEXT NOT NULL,
    fitted_odometer INTEGER,
    removed_date TEXT,
    position_id TEXT REFERENCES fitment_positions(id),
    declared_to_insurer INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('vehicle', 'service', 'modification', 'inspection')),
    owner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT,
    issue_date TEXT,
    expiry_date TEXT,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX documents_owner ON documents (owner_kind, owner_id);
  `,
  `
  ALTER TABLE vehicles ADD COLUMN vin TEXT;
  ALTER TABLE vehicles ADD COLUMN version TEXT;
  ALTER TABLE vehicles ADD COLUMN fiscal_power INTEGER;
  ALTER TABLE vehicles ADD COLUMN national_type TEXT;
  ALTER TABLE vehicles ADD COLUMN purchase_date TEXT;
  ALTER TABLE vehicles ADD COLUMN overnight_parking TEXT;

  CREATE TABLE drivers (
    id TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    name TEXT NOT NULL,
    birth_date TEXT,
    car_licence_date TEXT,
    motorcycle_licence_date TEXT,
    motorcycle_licence TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE insurance_policies (
    id TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    insurer TEXT NOT NULL,
    policy_number TEXT,
    start_date TEXT NOT NULL,
    cancelled_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE policy_drivers (
    policy_id TEXT NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
    driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    PRIMARY KEY (policy_id, driver_id)
  );

  CREATE TABLE policy_terms (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (end_date > start_date)
  );

  CREATE TABLE covers (
    id TEXT PRIMARY KEY,
    term_id TEXT NOT NULL REFERENCES policy_terms(id) ON DELETE CASCADE,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    level TEXT NOT NULL CHECK (level IN ('thirdParty', 'thirdPartyExtended', 'comprehensive')),
    guarantees TEXT,
    excess REAL,
    premium REAL,
    crm REAL,
    notes TEXT,
    UNIQUE (term_id, vehicle_id)
  );

  CREATE TABLE claims (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    responsibility TEXT NOT NULL CHECK (responsibility IN ('notAtFault', 'partlyAtFault', 'atFault')),
    amount REAL,
    description TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE quotes (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    insurer TEXT NOT NULL,
    date TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('thirdParty', 'thirdPartyExtended', 'comprehensive')),
    guarantees TEXT,
    excess REAL,
    premium REAL NOT NULL,
    valid_until TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A Policy's Documents belong to no single Vehicle, so Documents now belong to the Garage directly.
  CREATE TABLE documents_new (
    id TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    vehicle_id TEXT REFERENCES vehicles(id),
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('vehicle', 'service', 'modification', 'inspection', 'policy', 'cover', 'claim')),
    owner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT,
    issue_date TEXT,
    expiry_date TEXT,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO documents_new
    SELECT d.id, v.garage_id, d.vehicle_id, d.owner_kind, d.owner_id, d.type, d.title, d.issue_date, d.expiry_date,
           d.file_name, d.content_type, d.size, d.created_at
    FROM documents d JOIN vehicles v ON v.id = d.vehicle_id;
  DROP TABLE documents;
  ALTER TABLE documents_new RENAME TO documents;
  CREATE INDEX documents_owner ON documents (owner_kind, owner_id);
  `,
  `
  -- A device (phone, browser) that asked to receive Reminders, as handed over by its browser's push service.
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    lang TEXT NOT NULL CHECK (lang IN ('en', 'fr')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Which Reminders were already sent, so each one goes out once per status (and overdue ones weekly).
  CREATE TABLE reminders_sent (
    garage_id TEXT NOT NULL REFERENCES garages(id),
    key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('dueSoon', 'overdue')),
    sent_on TEXT NOT NULL,
    PRIMARY KEY (garage_id, key, status)
  );

  CREATE TABLE reminder_runs (
    garage_id TEXT PRIMARY KEY REFERENCES garages(id),
    last_date TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE maintenance_tasks ADD COLUMN name_fr TEXT;
  ALTER TABLE part_specs ADD COLUMN name_fr TEXT;
  ALTER TABLE part_specs ADD COLUMN oem_reference TEXT;
  `,
  `
  -- What a Vehicle is built with decides which Standard Parts it has; null is unknown or not applicable.
  ALTER TABLE vehicles ADD COLUMN fuel TEXT CHECK (fuel IN ('petrol', 'diesel', 'hybrid', 'electric'));
  ALTER TABLE vehicles ADD COLUMN gearbox TEXT CHECK (gearbox IN ('manual', 'automatic'));
  ALTER TABLE vehicles ADD COLUMN timing TEXT CHECK (timing IN ('belt', 'chain'));
  ALTER TABLE vehicles ADD COLUMN final_drive TEXT CHECK (final_drive IN ('chain', 'belt', 'shaft'));
  ALTER TABLE vehicles ADD COLUMN cooling TEXT CHECK (cooling IN ('liquid', 'air'));
  `,
  `
  -- A Fitment Position is now one of the Vehicle's fitted Standard Parts; older free-named ones keep a null here.
  ALTER TABLE fitment_positions ADD COLUMN standard_part TEXT;
  CREATE UNIQUE INDEX fitment_positions_standard ON fitment_positions (vehicle_id, standard_part) WHERE standard_part IS NOT NULL;
  `,
  `
  -- Whether the Vehicle has a card on the garage page, whatever its sale status. Until now that was the owned ones.
  ALTER TABLE vehicles ADD COLUMN on_garage_page INTEGER NOT NULL DEFAULT 1;
  UPDATE vehicles SET on_garage_page = 0 WHERE status = 'sold';
  `,
  `
  -- The Build as the vehicle parts database describes it. The gearbox becomes the transmission and the timing drive
  -- the distribution; fuel and final drive take more values, so those columns are recreated with a wider check.
  ALTER TABLE vehicles ADD COLUMN transmission TEXT CHECK (transmission IN ('manual', 'automatic', 'dct', 'cvt', 'e_cvt', 'single_speed'));
  UPDATE vehicles SET transmission = CASE WHEN fuel = 'electric' THEN 'single_speed' ELSE gearbox END;
  ALTER TABLE vehicles DROP COLUMN gearbox;
  ALTER TABLE vehicles ADD COLUMN distribution TEXT CHECK (distribution IN ('belt', 'chain', 'none'));
  UPDATE vehicles SET distribution = CASE WHEN kind <> 'car' THEN NULL WHEN fuel = 'electric' THEN 'none' ELSE timing END;
  ALTER TABLE vehicles DROP COLUMN timing;
  ALTER TABLE vehicles ADD COLUMN fuel_new TEXT CHECK (fuel_new IN ('petrol', 'diesel', 'hybrid', 'phev', 'electric'));
  UPDATE vehicles SET fuel_new = fuel;
  ALTER TABLE vehicles DROP COLUMN fuel;
  ALTER TABLE vehicles RENAME COLUMN fuel_new TO fuel;
  ALTER TABLE vehicles ADD COLUMN final_drive_new TEXT CHECK (final_drive_new IN ('chain', 'belt', 'shaft', 'gear', 'none'));
  UPDATE vehicles SET final_drive_new = final_drive;
  ALTER TABLE vehicles DROP COLUMN final_drive;
  ALTER TABLE vehicles RENAME COLUMN final_drive_new TO final_drive;
  ALTER TABLE vehicles ADD COLUMN drivetrain TEXT CHECK (drivetrain IN ('fwd', 'rwd', 'awd'));
  ALTER TABLE vehicles ADD COLUMN cylinders INTEGER CHECK (cylinders >= 1);
  ALTER TABLE vehicles ADD COLUMN has_hydraulic_clutch INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vehicles ADD COLUMN has_turbo INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vehicles ADD COLUMN has_direct_injection INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vehicles ADD COLUMN has_start_stop INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vehicles ADD COLUMN has_adblue INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vehicles ADD COLUMN has_ac INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vehicles ADD COLUMN has_air_suspension INTEGER NOT NULL DEFAULT 0;

  -- Standard Parts move to the parts catalogue's codes. The server does it, since it knows the catalogue, for the
  -- Vehicles listed here, then empties the list.
  CREATE TABLE part_catalogue_moves (vehicle_id TEXT PRIMARY KEY REFERENCES vehicles(id));
  INSERT INTO part_catalogue_moves SELECT id FROM vehicles;
  `,
  `
  -- The Standard Part a Maintenance Task replaces, if any: the Task pauses while that part is not on the Vehicle.
  ALTER TABLE maintenance_tasks ADD COLUMN standard_part TEXT;

  -- A Required Part's quantity may be left to fill in (a new Vehicle's tasks list their parts, not how much).
  CREATE TABLE required_parts_new (
    task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
    part_spec_id TEXT NOT NULL REFERENCES part_specs(id) ON DELETE CASCADE,
    quantity REAL CHECK (quantity > 0),
    sort INTEGER NOT NULL,
    PRIMARY KEY (task_id, part_spec_id)
  );
  INSERT INTO required_parts_new SELECT task_id, part_spec_id, quantity, sort FROM required_parts;
  DROP TABLE required_parts;
  ALTER TABLE required_parts_new RENAME TO required_parts;
  `,
  `
  -- Whether the owner set a schedule Task's Interval; until then it follows the Build (e.g. shorter with a turbo).
  ALTER TABLE maintenance_tasks ADD COLUMN custom_interval INTEGER NOT NULL DEFAULT 0;

  -- Vehicles whose Tasks join the maintenance schedule. The server does it, since it knows the catalogue: a Task
  -- named like a schedule Task becomes it, then missing ones are added. Sold Vehicles wait until sold no more.
  CREATE TABLE schedule_moves (vehicle_id TEXT PRIMARY KEY REFERENCES vehicles(id));
  INSERT INTO schedule_moves SELECT id FROM vehicles;
  `,
  `
  -- The category the owner picked for a Task replacing no Standard Part; one replacing a part takes the part's.
  ALTER TABLE maintenance_tasks ADD COLUMN category TEXT CHECK (category IN ('engine', 'ignition', 'fuel_exhaust', 'cooling',
    'transmission', 'drivetrain', 'brakes', 'tires_suspension', 'electrical', 'hvac', 'body', 'other'));
  `,
  `
  -- Flex-fuel (E85) joins the fuels, so the column is recreated with a wider check.
  ALTER TABLE vehicles ADD COLUMN fuel_new TEXT CHECK (fuel_new IN ('petrol', 'flexfuel', 'diesel', 'hybrid', 'phev', 'electric'));
  UPDATE vehicles SET fuel_new = fuel;
  ALTER TABLE vehicles DROP COLUMN fuel;
  ALTER TABLE vehicles RENAME COLUMN fuel_new TO fuel;
  `,
  `
  -- A Service doing only time-based Tasks (e.g. coolant every 3 years) may leave the odometer out. The column is
  -- recreated without NOT NULL; the table itself stays, since Services' tasks, parts and closed defects refer to it.
  ALTER TABLE services ADD COLUMN odometer_new INTEGER;
  UPDATE services SET odometer_new = odometer;
  ALTER TABLE services DROP COLUMN odometer;
  ALTER TABLE services RENAME COLUMN odometer_new TO odometer;
  `,
  `
  -- What the owner changed in the parts catalogue: for a built-in part (kind is null) its conditions, default details
  -- or removal; otherwise a whole part of their own.
  CREATE TABLE catalogue_parts (
    garage_id TEXT NOT NULL REFERENCES garages(id),
    code TEXT NOT NULL,
    kind TEXT CHECK (kind IN ('car', 'motorcycle')),
    name TEXT,
    name_fr TEXT,
    unit TEXT CHECK (unit IN ('piece', 'litre')),
    category TEXT,
    interval_km INTEGER,
    interval_months INTEGER,
    conditions TEXT,
    characteristics TEXT,
    removed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (garage_id, code)
  );
  `,
  `
  -- Interval rules on the parts catalogue (e.g. a shorter distance with a turbo): for a built-in part the owner's rules
  -- and, when interval_set is 1, their default Interval; a catalogue entry with no unit is a check or service with a
  -- Task but no part. A Task can also be switched off on one Vehicle, which pauses it.
  ALTER TABLE catalogue_parts ADD COLUMN interval_rules TEXT;
  ALTER TABLE catalogue_parts ADD COLUMN interval_set INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE maintenance_tasks ADD COLUMN switched_off INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Interval rules by build were dropped again: an Interval is customised on the Vehicle instead.
  ALTER TABLE catalogue_parts DROP COLUMN interval_rules;
  `,
  `
  -- Six categories (engine, transmission, braking system, chassis, electrical, cooling and climate) plus 'other'
  -- replace the twelve: ignition, fuel and exhaust join the engine, the drivetrain the transmission, tyres, suspension
  -- and body the chassis, heating and A/C the cooling. A Task's category may now be set on any Task, so the column is
  -- recreated with the new check.
  ALTER TABLE maintenance_tasks ADD COLUMN category_new TEXT CHECK (category_new IN
    ('engine', 'transmission', 'brakes', 'chassis', 'electrical', 'cooling_climate', 'other'));
  UPDATE maintenance_tasks SET category_new = CASE category WHEN 'engine' THEN 'engine' WHEN 'ignition' THEN 'engine' WHEN 'fuel_exhaust' THEN 'engine' WHEN 'transmission' THEN 'transmission' WHEN 'drivetrain' THEN 'transmission' WHEN 'brakes' THEN 'brakes' WHEN 'tires_suspension' THEN 'chassis' WHEN 'body' THEN 'chassis' WHEN 'electrical' THEN 'electrical' WHEN 'cooling' THEN 'cooling_climate' WHEN 'hvac' THEN 'cooling_climate' WHEN 'other' THEN 'other' END;
  ALTER TABLE maintenance_tasks DROP COLUMN category;
  ALTER TABLE maintenance_tasks RENAME COLUMN category_new TO category;
  UPDATE catalogue_parts SET category = CASE category WHEN 'engine' THEN 'engine' WHEN 'ignition' THEN 'engine' WHEN 'fuel_exhaust' THEN 'engine' WHEN 'transmission' THEN 'transmission' WHEN 'drivetrain' THEN 'transmission' WHEN 'brakes' THEN 'brakes' WHEN 'tires_suspension' THEN 'chassis' WHEN 'body' THEN 'chassis' WHEN 'electrical' THEN 'electrical' WHEN 'cooling' THEN 'cooling_climate' WHEN 'hvac' THEN 'cooling_climate' WHEN 'other' THEN 'other' END WHERE category IS NOT NULL;
  `,
  `
  -- Fitment Positions are gone: a Part Used keeps its description and its Part Spec, and the screen listing what is
  -- fitted where is dropped. A Modification at an older free-named position keeps that name in its notes. The two
  -- tables that pointed at positions are recreated without the column.
  UPDATE modifications
    SET notes = trim(coalesce(notes || char(10), '') || 'Position: ' || (SELECT name FROM fitment_positions WHERE fitment_positions.id = modifications.position_id))
    WHERE position_id IN (SELECT id FROM fitment_positions WHERE standard_part IS NULL);

  CREATE TABLE parts_used_new (
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL,
    part_spec_id TEXT REFERENCES part_specs(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    part_number TEXT,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('piece', 'litre')),
    price REAL,
    supplier TEXT,
    PRIMARY KEY (service_id, sort)
  );
  INSERT INTO parts_used_new SELECT service_id, sort, part_spec_id, description, part_number, quantity, unit, price, supplier FROM parts_used;
  DROP TABLE parts_used;
  ALTER TABLE parts_used_new RENAME TO parts_used;

  CREATE TABLE modifications_new (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    name TEXT NOT NULL,
    fitted_date TEXT NOT NULL,
    fitted_odometer INTEGER,
    removed_date TEXT,
    declared_to_insurer INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO modifications_new
    SELECT id, vehicle_id, name, fitted_date, fitted_odometer, removed_date, declared_to_insurer, notes, created_at FROM modifications;
  DROP TABLE modifications;
  ALTER TABLE modifications_new RENAME TO modifications;

  DROP TABLE fitment_positions;
`,
`
  -- The rework: insurance, inspections, modifications, quotes and drivers leave the app. Their tables go (a backup is
  -- written first); Documents attached to them stay stored but are no longer shown. A Vehicle keeps the facts of its
  -- Profile only.
  DROP TABLE inspection_defects;
  DROP TABLE technical_inspections;
  DROP TABLE modifications;
  DROP TABLE claims;
  DROP TABLE covers;
  DROP TABLE policy_terms;
  DROP TABLE policy_drivers;
  DROP TABLE insurance_policies;
  DROP TABLE drivers;
  DROP TABLE quotes;
  ALTER TABLE vehicles DROP COLUMN registration;
  ALTER TABLE vehicles DROP COLUMN first_registration;
  ALTER TABLE vehicles DROP COLUMN version;
  ALTER TABLE vehicles DROP COLUMN fiscal_power;
  ALTER TABLE vehicles DROP COLUMN national_type;
  ALTER TABLE vehicles DROP COLUMN purchase_date;
  ALTER TABLE vehicles DROP COLUMN overnight_parking;
`,
`
  -- Each Task says what is done to the part (replace, inspect, clean or adjust); the action is guessed from the name of
  -- the Tasks already there. A Service says who did the work and what it all cost: the cost starts as the sum of the
  -- prices of its Parts Used. The Official Interval is folded into the Interval (the stricter of the two applied, so
  -- nothing is due earlier or later than before) and goes.
  ALTER TABLE maintenance_tasks ADD COLUMN action TEXT NOT NULL DEFAULT 'replace' CHECK (action IN ('replace', 'inspect', 'clean', 'adjust'));
  UPDATE maintenance_tasks SET action = 'inspect'
    WHERE lower(name || ' ' || coalesce(name_fr, '')) LIKE '%check%' OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%inspect%'
      OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%vérif%' OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%contrôl%'
      OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%controle%';
  UPDATE maintenance_tasks SET action = 'clean'
    WHERE lower(name || ' ' || coalesce(name_fr, '')) LIKE '%clean%' OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%nettoy%';
  UPDATE maintenance_tasks SET action = 'adjust'
    WHERE lower(name || ' ' || coalesce(name_fr, '')) LIKE '%adjust%' OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%lubric%'
      OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%tension%' OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%règl%'
      OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%regl%' OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%grais%'
      OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%alignment%' OR lower(name || ' ' || coalesce(name_fr, '')) LIKE '%géométrie%';
  UPDATE maintenance_tasks SET
    interval_km = CASE WHEN official_interval_km IS NULL THEN interval_km WHEN interval_km IS NULL THEN official_interval_km
                       ELSE min(interval_km, official_interval_km) END,
    interval_months = CASE WHEN official_interval_months IS NULL THEN interval_months WHEN interval_months IS NULL THEN official_interval_months
                           ELSE min(interval_months, official_interval_months) END;
  ALTER TABLE maintenance_tasks DROP COLUMN official_interval_km;
  ALTER TABLE maintenance_tasks DROP COLUMN official_interval_months;

  ALTER TABLE services ADD COLUMN performed_by TEXT NOT NULL DEFAULT 'diy' CHECK (performed_by IN ('diy', 'garage', 'dealership'));
  ALTER TABLE services ADD COLUMN total_cost REAL;
  UPDATE services SET total_cost = (SELECT sum(price) FROM parts_used WHERE parts_used.service_id = services.id AND price IS NOT NULL);
`,
  convertToFiveParts,
  `
  -- Spec lines are listed by category, like Tasks. The category is guessed from the label of the lines already there.
  ALTER TABLE spec_lines ADD COLUMN category TEXT CHECK (category IN ('engine', 'transmission', 'brakes', 'chassis', 'electrical', 'cooling_climate', 'other'));
  UPDATE spec_lines SET category = 'brakes' WHERE spec_group <> 'torque' AND (lower(label) LIKE '%brake%' OR lower(label) LIKE '%frein%' OR lower(label) LIKE '%pad%' OR lower(label) LIKE '%plaquette%' OR lower(label) LIKE '%disc%' OR lower(label) LIKE '%disque%');
  UPDATE spec_lines SET category = 'cooling_climate' WHERE category IS NULL AND spec_group <> 'torque' AND (lower(label) LIKE '%coolant%' OR lower(label) LIKE '%refroidissement%' OR lower(label) LIKE '%antifreeze%' OR lower(label) LIKE '%a/c%' OR lower(label) LIKE '%climatisation%');
  UPDATE spec_lines SET category = 'transmission' WHERE category IS NULL AND spec_group <> 'torque' AND (lower(label) LIKE '%chain%' OR lower(label) LIKE '%chaîne%' OR lower(label) LIKE '%sprocket%' OR lower(label) LIKE '%clutch%' OR lower(label) LIKE '%embrayage%' OR lower(label) LIKE '%gear%' OR lower(label) LIKE '%boîte%' OR lower(label) LIKE '%differential%' OR lower(label) LIKE '%cardan%');
  UPDATE spec_lines SET category = 'chassis' WHERE category IS NULL AND spec_group <> 'torque' AND (lower(label) LIKE '%tyre%' OR lower(label) LIKE '%tire%' OR lower(label) LIKE '%pneu%' OR lower(label) LIKE '%fork%' OR lower(label) LIKE '%fourche%' OR lower(label) LIKE '%shock%' OR lower(label) LIKE '%suspension%' OR lower(label) LIKE '%wiper%');
  UPDATE spec_lines SET category = 'electrical' WHERE category IS NULL AND spec_group <> 'torque' AND (lower(label) LIKE '%batter%' OR lower(label) LIKE '%fuse%' OR lower(label) LIKE '%fusible%' OR lower(label) LIKE '%bulb%' OR lower(label) LIKE '%ampoule%');
  UPDATE spec_lines SET category = 'engine' WHERE category IS NULL AND spec_group <> 'torque' AND (lower(label) LIKE '%oil%' OR lower(label) LIKE '%huile%' OR lower(label) LIKE '%spark%' OR lower(label) LIKE '%bougie%' OR lower(label) LIKE '%filter%' OR lower(label) LIKE '%filtre%' OR lower(label) LIKE '%fuel%' OR lower(label) LIKE '%timing%' OR lower(label) LIKE '%distribution%' OR lower(label) LIKE '%valve%' OR lower(label) LIKE '%soupape%');
`,
  `
  -- A Service is either maintenance (it did Tasks of the plan) or a repair outside the plan: a title and a category
  -- instead of Tasks, though it may also have done some.
  ALTER TABLE services ADD COLUMN kind TEXT NOT NULL DEFAULT 'maintenance' CHECK (kind IN ('maintenance', 'repair'));
  ALTER TABLE services ADD COLUMN title TEXT;
  ALTER TABLE services ADD COLUMN category TEXT CHECK (category IN ('engine', 'transmission', 'brakes', 'chassis', 'electrical', 'cooling_climate', 'other'));
`,
  `
  -- The Plan Template a Task came from, so adding templates again never doubles a Task, whatever it was renamed to.
  -- Tasks that exist already are tagged the next time templates are added, by their name.
  ALTER TABLE maintenance_tasks ADD COLUMN template_code TEXT;
  CREATE UNIQUE INDEX maintenance_tasks_template ON maintenance_tasks (vehicle_id, template_code) WHERE template_code IS NOT NULL;
`,
  // The car tyres template became a front and a rear one, since a pair is often changed alone: what the owner changed
  // on the old one now applies to both. Tasks already on Vehicles stay as they are.
  (db) => splitCatalogueEntry(db, 'tires', ['tires_front', 'tires_rear']),
  // Likewise the fork oil and seals: the seals are never done without the oil, but the oil can be done alone.
  (db) => splitCatalogueEntry(db, 'moto_fork_oil_seals', ['moto_fork_oil', 'moto_fork_seals']),
  // And the car shock absorbers, front and rear.
  (db) => splitCatalogueEntry(db, 'shock_absorbers', ['shock_absorbers_front', 'shock_absorbers_rear']),
  `
  -- The standard spec line a line came from, so adding the usual lines again never doubles one, whatever it was renamed to.
  ALTER TABLE spec_lines ADD COLUMN template_code TEXT;
  CREATE UNIQUE INDEX spec_lines_template ON spec_lines (vehicle_id, template_code) WHERE template_code IS NOT NULL;
`,
  `
  -- The parts and fluids bought for a Vehicle, picked when logging a Service. A Service keeps its own copy of what it used,
  -- with a loose link back (part_id) and the price paid.
  CREATE TABLE vehicle_parts (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    name TEXT NOT NULL,
    part_number TEXT,
    unit TEXT NOT NULL CHECK (unit IN ('piece', 'litre')),
    quantity REAL NOT NULL DEFAULT 1,
    price REAL,
    task_id TEXT REFERENCES maintenance_tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX vehicle_parts_vehicle ON vehicle_parts (vehicle_id);
  ALTER TABLE service_items ADD COLUMN part_id TEXT REFERENCES vehicle_parts(id) ON DELETE SET NULL;
  ALTER TABLE service_items ADD COLUMN price REAL;
`,
  `
  -- When the Vehicle first went on the road (its first registration) and when the owner bought it. Both optional.
  ALTER TABLE vehicles ADD COLUMN first_registration_date TEXT;
  ALTER TABLE vehicles ADD COLUMN purchase_date TEXT;
`,
  `
  -- The manufacturer's (OEM) reference of a spec line, kept apart from its value.
  ALTER TABLE spec_lines ADD COLUMN oem TEXT;
`,
  `
  -- A part is either to buy (wanted or planned, or to be bought again) or bought. The parts that exist already were
  -- bought, so they start as 0. Notes hold the shop, a link, a comparison.
  ALTER TABLE vehicle_parts ADD COLUMN to_buy INTEGER NOT NULL DEFAULT 0 CHECK (to_buy IN (0, 1));
  ALTER TABLE vehicle_parts ADD COLUMN notes TEXT;

  -- The purchase log of a part: what the owner paid, kept so spending can be analysed outside the app. total_paid is
  -- for the goods only, as on the receipt; delivery fees are apart. vehicle_id is the part's, kept for scoping and export.
  CREATE TABLE purchases (
    id TEXT PRIMARY KEY,
    part_id TEXT NOT NULL REFERENCES vehicle_parts(id) ON DELETE CASCADE,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    date TEXT NOT NULL,
    quantity REAL NOT NULL,
    total_paid REAL NOT NULL,
    shop TEXT,
    delivery_fees REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX purchases_part ON purchases (part_id);
  CREATE INDEX purchases_vehicle ON purchases (vehicle_id);

  -- A purchase's receipt is a Document, so documents may now belong to a purchase.
  CREATE TABLE documents_new (
    id TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    vehicle_id TEXT REFERENCES vehicles(id),
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('vehicle', 'service', 'modification', 'inspection', 'policy', 'cover', 'claim', 'purchase')),
    owner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT,
    issue_date TEXT,
    expiry_date TEXT,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO documents_new SELECT id, garage_id, vehicle_id, owner_kind, owner_id, type, title, issue_date, expiry_date,
                                   file_name, content_type, size, created_at FROM documents;
  DROP TABLE documents;
  ALTER TABLE documents_new RENAME TO documents;
  CREATE INDEX documents_owner ON documents (owner_kind, owner_id);
`,
  `
  -- The Spec Line an item is for (the factory figure it should match). Loose: emptied if the Spec Line is deleted.
  ALTER TABLE vehicle_parts ADD COLUMN spec_line_id TEXT REFERENCES spec_lines(id) ON DELETE SET NULL;
`,
];

/** Replaces what the owner changed on a template that was split by the same change on each of the new ones. */
function splitCatalogueEntry(db: DatabaseSync, from: string, into: string[]): void {
  const columns = (db.prepare('PRAGMA table_info(catalogue_parts)').all() as { name: string }[]).map((c) => c.name).filter((n) => n !== 'code');
  const list = columns.join(', ');
  for (const code of into) {
    db.prepare(`INSERT INTO catalogue_parts (code, ${list}) SELECT ?, ${list} FROM catalogue_parts WHERE code = ?`).run(code, from);
  }
  db.prepare('DELETE FROM catalogue_parts WHERE code = ?').run(from);
}

function schemaVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

/**
 * Opens the garage database and brings its schema up to date.
 * Before migrating an existing database, a copy is written to `backupDir` so an update can never lose history.
 * `targetVersion` stops short of the latest schema, so tests can recreate a database an older release left behind.
 */
export function openDatabase(path: string, backupDir?: string, targetVersion = MIGRATIONS.length): DatabaseSync {
  const isNew = path === ':memory:' || !existsSync(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');

  const current = schemaVersion(db);
  if (current < targetVersion && !isNew && backupDir) {
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(backupDir, `garage-v${current}-${stamp}.sqlite`);
    db.prepare('VACUUM INTO ?').run(target);
  }

  for (let version = current; version < targetVersion; version++) {
    db.exec('BEGIN');
    try {
      const step = MIGRATIONS[version]!;
      if (typeof step === 'string') db.exec(step);
      else step(db);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
}
