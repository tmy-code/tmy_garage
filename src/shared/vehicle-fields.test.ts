import { describe, expect, it } from 'vitest';
import { vehicleInput } from './schemas.ts';
import {
  EDITABLE_VEHICLE_FIELDS,
  VEHICLE_FIELDS,
  normalizeVehicle,
  parseJsonList,
  vehicleFromRow,
  vehicleWrite,
  type EditableVehicle,
  type Vehicle,
} from './vehicle-fields.ts';
import { FULL_ROW as row, GOLDEN } from './vehicle-fields-golden.ts';

describe('vehicleFromRow', () => {
  it('reads every field, in the wire order, and matches the output captured before the table existed', () => {
    expect(JSON.stringify(vehicleFromRow({ ...row, archive_folder: 'Exemple/Test car' }))).toBe(GOLDEN);
    expect(Object.keys(vehicleFromRow(row))).toEqual(Object.keys(VEHICLE_FIELDS));
  });

  it('turns 0 and 1 into booleans', () => {
    const v = vehicleFromRow(row);
    expect(v).toMatchObject({ hasHydraulicClutch: false, hasTurbo: true, hasStartStop: true, onGaragePage: true });
    expect(vehicleFromRow({ ...row, on_garage_page: 0 }).onGaragePage).toBe(false);
  });

  it('reads the equipment list as JSON, and as an empty list when invalid or NULL', () => {
    expect(vehicleFromRow(row).equipment).toEqual(['Transmission chaîne', 'Turbo']);
    expect(vehicleFromRow({ ...row, equipment: 'not json' }).equipment).toEqual([]);
    expect(vehicleFromRow({ ...row, equipment: null }).equipment).toEqual([]);
    expect(parseJsonList('[1,"a",null]')).toEqual(['a']);
    expect(parseJsonList('{"a":1}')).toEqual([]);
  });

  it('keeps nulls, and gives a missing archive folder as null', () => {
    const v = vehicleFromRow({ ...row, vin: null, notion_page_id: null });
    expect(v.vin).toBeNull();
    expect(v.notionPageId).toBeNull();
    expect(v.archiveFolder).toBeNull();
    expect(JSON.stringify(v)).toContain('"archiveFolder":null');
  });
});

describe('normalizeVehicle', () => {
  it('fills in every default for a Vehicle with only its id', () => {
    expect(normalizeVehicle({ id: 'v' })).toMatchObject({
      id: 'v',
      make: null,
      model: null,
      year: null,
      ownership: 'owned',
      onGaragePage: true,
      vin: null,
      firstRegistrationDate: null,
      purchaseDate: null,
      fuel: null,
      transmission: null,
      drivetrain: null,
      distribution: null,
      cooling: null,
      finalDrive: null,
      cylinders: null,
      hasHydraulicClutch: false,
      hasTurbo: false,
      hasDirectInjection: false,
      hasStartStop: false,
      hasAdblue: false,
      hasAc: false,
      hasAirSuspension: false,
      soldDate: null,
      soldOdometer: null,
      soldPrice: null,
      equipment: [],
      notionPageId: null,
      archiveFolder: null,
    });
  });

  it('reads the old status as the ownership, and a sold Vehicle is off the garage page', () => {
    const v = normalizeVehicle({ id: 'v', status: 'sold' });
    expect(v).toMatchObject({ ownership: 'sold', onGaragePage: false });
    expect(v).not.toHaveProperty('status');
    expect(normalizeVehicle({ id: 'v', status: 'owned' })).toMatchObject({ ownership: 'owned', onGaragePage: true });
  });

  it('keeps an explicit onGaragePage and ownership, and leaves no status key', () => {
    const v = normalizeVehicle({ id: 'v', ownership: 'sold', onGaragePage: true, status: 'owned' });
    expect(v).toMatchObject({ ownership: 'sold', onGaragePage: true });
    expect(v).not.toHaveProperty('status');
  });

  it('keeps keys it does not know', () => {
    const v = normalizeVehicle({ id: 'v', extra: 'kept' } as never);
    expect(v).toHaveProperty('extra', 'kept');
  });

  it('changes nothing in what vehicleFromRow gives', () => {
    const v = vehicleFromRow(row);
    expect(normalizeVehicle(v)).toEqual(v);
  });
});

const form = vehicleInput.parse({
  kind: 'car',
  name: 'Test car',
  make: 'Exemple',
  model: 'Test',
  vin: 'VF1TESTVIN0000001',
  firstRegistrationDate: '2015-03-02',
  fuel: 'diesel',
  transmission: 'manual',
  drivetrain: 'fwd',
  distribution: 'belt',
  cylinders: 4,
  hasTurbo: true,
  hasAc: true,
});

describe('vehicleWrite', () => {
  it('lists the columns of the editable fields in the table order', () => {
    const w = vehicleWrite(form);
    expect(w.columns).toEqual(EDITABLE_VEHICLE_FIELDS.map((k) => VEHICLE_FIELDS[k].column));
    expect(w.columns).toHaveLength(22);
    expect(w.values).toHaveLength(22);
    expect(w.assignments).toHaveLength(22);
  });

  it('writes flags as 1 and 0, and the other values as they are', () => {
    const w = vehicleWrite(form);
    const at = (key: keyof EditableVehicle) => w.values[EDITABLE_VEHICLE_FIELDS.indexOf(key)];
    expect(at('hasTurbo')).toBe(1);
    expect(at('hasAc')).toBe(1);
    expect(at('hasAdblue')).toBe(0);
    expect(at('name')).toBe('Test car');
    expect(at('year')).toBe(2015);
    expect(at('cooling')).toBeNull();
  });

  it('keeps the stored year when the new one is null', () => {
    const w = vehicleWrite(form);
    expect(w.assignments[EDITABLE_VEHICLE_FIELDS.indexOf('year')]).toBe('year = COALESCE(?, year)');
    expect(w.assignments.filter((a) => a.includes('COALESCE'))).toHaveLength(1);
    expect(w.assignments[EDITABLE_VEHICLE_FIELDS.indexOf('name')]).toBe('name = ?');
  });

  it('writes exactly the keys the Vehicle form gives', () => {
    expect([...EDITABLE_VEHICLE_FIELDS].sort()).toEqual(Object.keys(form).sort());
  });
});

describe('the Vehicle type', () => {
  it('accepts a Vehicle without the optional Notion page and archive folder', () => {
    const v = {
      id: 'v',
      name: 'Bike',
      make: null,
      model: null,
      year: null,
      vin: null,
      firstRegistrationDate: null,
      purchaseDate: null,
      kind: 'motorcycle',
      fuel: 'petrol',
      transmission: 'manual',
      drivetrain: null,
      distribution: null,
      cooling: 'liquid',
      finalDrive: 'chain',
      cylinders: 2,
      hasHydraulicClutch: false,
      hasTurbo: false,
      hasDirectInjection: false,
      hasStartStop: false,
      hasAdblue: false,
      hasAc: false,
      hasAirSuspension: false,
      ownership: 'owned',
      onGaragePage: true,
      soldDate: null,
      soldOdometer: null,
      soldPrice: null,
      equipment: [],
    } satisfies Vehicle;
    expect(Object.keys(v)).toHaveLength(Object.keys(VEHICLE_FIELDS).length - 2);
  });
});
