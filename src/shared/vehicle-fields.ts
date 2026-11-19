// Type-only imports on purpose: this module must never pull in node:sqlite or zod at runtime (no import cycle
// with schemas.ts or catalogue.ts, and it is bundled into the phone app).
import type { Build } from './catalogue.ts';
import type { IsoDate } from './dates.ts';
import type { Cooling, Distribution, Drivetrain, FinalDrive, FuelType, Transmission, VehicleKind } from './schemas.ts';

export type Ownership = 'owned' | 'sold';
export type SqlValue = string | number | null;

/** One field of a Vehicle: its column, how it is read from a row and written to one, and what an older copy lacks. */
export interface Field<T, E extends boolean = false, O extends boolean = false> {
  readonly column: string;
  /** Written by the Vehicle form (vehicleInput). */
  readonly editable: E;
  /** The key is `?:` in the Vehicle type. */
  readonly optional: O;
  /** The UPDATE keeps the stored value when the new one is null: `col = COALESCE(?, col)`. */
  readonly keepIfNull: boolean;
  /** normalizeVehicle fills `fallback` in when an older copy lacks the field. */
  readonly hasDefault: boolean;
  readonly fallback: T | undefined;
  fromDb(v: unknown): T;
  toDb(v: T): SqlValue;
}

function field<T>(column: string, fromDb: (v: unknown) => T, toDb: (v: T) => SqlValue, hasDefault: boolean, fallback?: T): Field<T> {
  return { column, editable: false, optional: false, keepIfNull: false, hasDefault, fallback, fromDb, toDb };
}

const raw = (v: unknown) => v as SqlValue;

/** Text with no default (the Vehicle always has it). */
const text = (column: string): Field<string> => field<string>(column, (v) => v as string, raw, false);
/** Text that may be missing; null when an older copy lacks it. `coalesce` turns a missing column into null when reading. */
const nullableText = (column: string, coalesce = false): Field<string | null> =>
  field<string | null>(column, coalesce ? (v) => (v as string | null | undefined) ?? null : (v) => v as string | null, raw, true, null);
const int = (column: string): Field<number | null> => field<number | null>(column, (v) => v as number | null, raw, true, null);
const real = int;
const isoDate = (column: string): Field<IsoDate | null> => field<IsoDate | null>(column, (v) => v as IsoDate | null, raw, true, null);
/** Stored as 0 or 1. */
const bool = (column: string, fallback = false): Field<boolean> => field<boolean>(column, (v) => v === 1, (v) => (v ? 1 : 0), true, fallback);
/** A JSON list of text kept in one column. */
const jsonList = (column: string): Field<string[]> => field<string[]>(column, parseJsonList, (v) => JSON.stringify(v), true, []);
/** An enum: the type is checked at compile time only, the value passes through as stored. */
const oneOf = <T extends string | null>(column: string, ...fallback: [] | [T]): Field<T> =>
  field<T>(column, (v) => v as T, raw, fallback.length > 0, fallback[0]);

const editable = <T, O extends boolean>(f: Field<T, boolean, O>, options?: { keepIfNull?: true }): Field<T, true, O> => ({
  ...f,
  editable: true,
  keepIfNull: options?.keepIfNull === true,
});
const optional = <T, E extends boolean>(f: Field<T, E, boolean>): Field<T, E, true> => ({ ...f, optional: true });

/**
 * Every field of a Vehicle, in the order the keys go over the wire. The Vehicle type, the row reader, the offline
 * copy's defaults and the form's INSERT/UPDATE all come from this table.
 */
export const VEHICLE_FIELDS = {
  id: text('id'),
  name: editable(text('name')),
  make: editable(nullableText('make')),
  model: editable(nullableText('model')),
  year: editable(int('year'), { keepIfNull: true }),
  /** Vehicle identification number. */
  vin: editable(nullableText('vin')),
  /** When it first went on the road (first registration). */
  firstRegistrationDate: editable(isoDate('first_registration_date')),
  /** When the owner bought it. */
  purchaseDate: editable(isoDate('purchase_date')),
  /** A car or motorcycle. */
  kind: editable(oneOf<VehicleKind>('kind')),
  // What it is built with (its Build): see VehicleSpecs in catalogue.ts.
  fuel: editable(oneOf<FuelType | null>('fuel', null)),
  transmission: editable(oneOf<Transmission | null>('transmission', null)),
  /** Cars only. */
  drivetrain: editable(oneOf<Drivetrain | null>('drivetrain', null)),
  /** Cars only: the timing drive, 'none' on an electric car. */
  distribution: editable(oneOf<Distribution | null>('distribution', null)),
  /** Motorcycles only. */
  cooling: editable(oneOf<Cooling | null>('cooling', null)),
  finalDrive: editable(oneOf<FinalDrive | null>('final_drive', null)),
  cylinders: editable(int('cylinders')),
  /** Motorcycles with a manual gearbox only. */
  hasHydraulicClutch: editable(bool('has_hydraulic_clutch')),
  /** Cars only, from here on. */
  hasTurbo: editable(bool('has_turbo')),
  hasDirectInjection: editable(bool('has_direct_injection')),
  hasStartStop: editable(bool('has_start_stop')),
  hasAdblue: editable(bool('has_adblue')),
  hasAc: editable(bool('has_ac')),
  hasAirSuspension: editable(bool('has_air_suspension')),
  ownership: oneOf<Ownership>('ownership', 'owned'),
  /** Whether it has a card on the garage page, whatever its ownership; selling it hides it, and the user can change either. */
  onGaragePage: bool('on_garage_page', true),
  soldDate: isoDate('sold_date'),
  soldOdometer: int('sold_odometer'),
  soldPrice: real('sold_price'),
  /** The equipment tags the owner keeps in Notion (e.g. "Transmission chaîne"); they decide which catalogue tasks apply. Read-only here. */
  equipment: jsonList('equipment'),
  /** The Vehicle's page in the Notion Véhicules database, once the sync has seen it. */
  notionPageId: optional(nullableText('notion_page_id')),
  /** Where this Vehicle's Receipts are filed in the owner's Proton Drive, relative to the Proton root (ADR 0010). */
  archiveFolder: optional(nullableText('archive_folder', true)),
} satisfies Record<string, Field<any, boolean, boolean>>;

type Fields = typeof VEHICLE_FIELDS;
type ValueOf<F> = F extends Field<infer T, any, any> ? T : never;
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** A car or motorcycle; what it is built with (its Build) is described by VehicleSpecs in catalogue.ts. */
export type Vehicle = Simplify<
  { [K in keyof Fields as Fields[K] extends Field<any, any, true> ? never : K]: ValueOf<Fields[K]> } & {
    [K in keyof Fields as Fields[K] extends Field<any, any, true> ? K : never]?: ValueOf<Fields[K]>;
  }
>;

export type EditableVehicleKey = { [K in keyof Fields]: Fields[K] extends Field<any, true, any> ? K : never }[keyof Fields];
/** What the Vehicle form writes. */
export type EditableVehicle = Pick<Vehicle, EditableVehicleKey>;

const FIELD_KEYS = Object.keys(VEHICLE_FIELDS) as (keyof Fields)[];
type AnyField = Field<any, boolean, boolean>;
const fieldOf = (key: keyof Fields): AnyField => VEHICLE_FIELDS[key];

export const EDITABLE_VEHICLE_FIELDS: readonly EditableVehicleKey[] = FIELD_KEYS.filter((k): k is EditableVehicleKey => fieldOf(k).editable);

/** A Vehicle as an older offline copy or an older server held it: fields may be missing, and `status` was the `ownership`. */
export type LegacyVehicle = Partial<Vehicle> & { id: string; status?: unknown };

/** A JSON list of text kept in one column. */
export function parseJsonList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const list: unknown = JSON.parse(value);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** A Vehicle from its row in the database, every key present, in the table's order. */
export function vehicleFromRow(row: Record<string, unknown>): Vehicle {
  const out: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    const f = fieldOf(key);
    out[key] = f.fromDb(row[f.column]);
  }
  return out as Vehicle;
}

/** Fills in what an older offline copy lacks, and turns the old `status` into `ownership`. Other keys are kept. */
export function normalizeVehicle(input: LegacyVehicle): Vehicle {
  const { status, ...rest } = input;
  const have = rest as Record<string, unknown>;
  const out: Record<string, unknown> = { ...have };
  for (const key of FIELD_KEYS) {
    const f = fieldOf(key);
    if (f.hasDefault) out[key] = have[key] ?? f.fallback;
  }
  const ownership = rest.ownership ?? (status as Ownership | undefined) ?? 'owned';
  out.ownership = ownership;
  out.onGaragePage = rest.onGaragePage ?? ownership === 'owned';
  return out as Vehicle;
}

/** The columns, values and `col = ?` assignments for writing the Vehicle form's fields, in the table's order. */
export function vehicleWrite(input: EditableVehicle): { columns: string[]; values: SqlValue[]; assignments: string[] } {
  const columns: string[] = [];
  const values: SqlValue[] = [];
  const assignments: string[] = [];
  for (const key of EDITABLE_VEHICLE_FIELDS) {
    const f = fieldOf(key);
    columns.push(f.column);
    values.push(f.toDb(input[key]));
    assignments.push(f.keepIfNull ? `${f.column} = COALESCE(?, ${f.column})` : `${f.column} = ?`);
  }
  return { columns, values, assignments };
}

// Compile-time check: the Build the catalogue reads is exactly the matching part of a Vehicle.
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const BUILD_MATCHES_VEHICLE: MutuallyAssignable<Pick<Vehicle, keyof Build>, Build> = true;
