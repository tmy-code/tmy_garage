import type { Cooling, Distribution, Drivetrain, FinalDrive, FuelType, PartUnit, Transmission, VehicleKind } from './schemas.ts';

/**
 * What a Vehicle is built with, as the parts catalogue needs it (its Build). Null is not filled in yet, which only
 * happens on Vehicles added before these details were required, or for a detail that does not apply to its kind.
 */
export interface VehicleSpecs {
  fuel: FuelType | null;
  transmission: Transmission | null;
  /** Cars only. */
  drivetrain: Drivetrain | null;
  /** Cars only: the timing drive, 'none' on an electric car. */
  distribution: Distribution | null;
  /** Motorcycles only. */
  cooling: Cooling | null;
  finalDrive: FinalDrive | null;
  cylinders: number | null;
  /** Motorcycles with a manual gearbox only. */
  hasHydraulicClutch: boolean;
  /** Cars only, from here on. */
  hasTurbo: boolean;
  hasDirectInjection: boolean;
  hasStartStop: boolean;
  hasAdblue: boolean;
  hasAc: boolean;
  hasAirSuspension: boolean;
}

export const SPEC_FLAGS = [
  'hasTurbo',
  'hasDirectInjection',
  'hasStartStop',
  'hasAdblue',
  'hasAc',
  'hasAirSuspension',
  'hasHydraulicClutch',
] as const satisfies readonly (keyof VehicleSpecs)[];
export type SpecFlag = (typeof SPEC_FLAGS)[number];

/** A Vehicle as far as the catalogue is concerned. */
export type Build = VehicleSpecs & { kind: VehicleKind };

// --- What a Build can be ---

export function fuelsOf(kind: VehicleKind): readonly FuelType[] {
  // Flex-fuel (E85) is a petrol engine that also runs on ethanol: for its parts and options it is petrol.
  return kind === 'motorcycle' ? ['petrol', 'electric'] : ['petrol', 'flexfuel', 'diesel', 'hybrid', 'phev', 'electric'];
}

export function transmissionsOf(kind: VehicleKind, fuel: FuelType | null): readonly Transmission[] {
  if (fuel === 'electric') return ['single_speed'];
  if (fuel === 'hybrid' || fuel === 'phev') return ['automatic', 'dct', 'e_cvt'];
  return kind === 'motorcycle' ? ['manual', 'automatic', 'dct', 'cvt'] : ['manual', 'automatic', 'dct', 'cvt', 'e_cvt'];
}

export function distributionsOf(fuel: FuelType | null): readonly Distribution[] {
  return fuel === 'electric' ? ['none'] : ['belt', 'chain'];
}

export const DRIVETRAINS = ['fwd', 'rwd', 'awd'] as const satisfies readonly Drivetrain[];
export const COOLINGS = ['liquid', 'air'] as const satisfies readonly Cooling[];
export const FINAL_DRIVES = ['chain', 'belt', 'shaft', 'gear', 'none'] as const satisfies readonly FinalDrive[];

/** The options a Vehicle of this kind, fuel and gearbox can have. */
export function flagsOf(kind: VehicleKind, fuel: FuelType | null, transmission: Transmission | null): readonly SpecFlag[] {
  if (kind === 'motorcycle') return transmission === 'manual' ? ['hasHydraulicClutch'] : [];
  const flags: SpecFlag[] = [];
  if (fuel !== 'electric') flags.push('hasTurbo');
  if (fuel === 'petrol' || fuel === 'flexfuel' || fuel === 'hybrid' || fuel === 'phev') flags.push('hasDirectInjection');
  if (fuel !== 'electric') flags.push('hasStartStop');
  if (fuel === 'diesel') flags.push('hasAdblue');
  flags.push('hasAc', 'hasAirSuspension');
  return flags;
}

/**
 * The details with what cannot apply cleared: those of the other kind, options this fuel and gearbox cannot have,
 * and what an electric Vehicle always is (single-speed, no timing drive).
 */
export function cleanSpecs<T extends Build>(build: T): T {
  const car = build.kind === 'car';
  const electric = build.fuel === 'electric';
  const flags = flagsOf(build.kind, build.fuel, electric ? 'single_speed' : build.transmission);
  return {
    ...build,
    transmission: electric ? 'single_speed' : build.transmission,
    drivetrain: car ? build.drivetrain : null,
    distribution: car ? (electric ? 'none' : build.distribution) : null,
    cooling: car ? null : build.cooling,
    finalDrive: car ? null : build.finalDrive,
    cylinders: car ? null : build.cylinders,
    ...Object.fromEntries(SPEC_FLAGS.map((flag) => [flag, flags.includes(flag) && build[flag]])),
  };
}

/** What is missing or impossible in a Build, as the field it concerns; null when it is complete and coherent. */
export function specsProblem(build: Build): { field: keyof VehicleSpecs; issue: 'required' | 'invalid' } | null {
  const required: (keyof VehicleSpecs)[] =
    build.kind === 'car' ? ['fuel', 'transmission', 'drivetrain', 'distribution'] : ['fuel', 'transmission', 'cooling', 'finalDrive', 'cylinders'];
  for (const field of required) if (build[field] === null) return { field, issue: 'required' };
  if (!fuelsOf(build.kind).includes(build.fuel!)) return { field: 'fuel', issue: 'invalid' };
  if (!transmissionsOf(build.kind, build.fuel).includes(build.transmission!)) return { field: 'transmission', issue: 'invalid' };
  if (build.kind === 'car' && !distributionsOf(build.fuel).includes(build.distribution!)) return { field: 'distribution', issue: 'invalid' };
  const flags = flagsOf(build.kind, build.fuel, build.transmission);
  const impossible = SPEC_FLAGS.find((flag) => build[flag] && !flags.includes(flag));
  return impossible ? { field: impossible, issue: 'invalid' } : null;
}

// --- The parts catalogue ---

/** Groups for listing Part Specs and Maintenance Tasks, in screen order. Parts that are not Standard Parts go under 'other'. */
export const PART_CATEGORIES = [
  'engine',
  'ignition',
  'fuel_exhaust',
  'cooling',
  'transmission',
  'drivetrain',
  'brakes',
  'tires_suspension',
  'electrical',
  'hvac',
  'body',
  'other',
] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

type SpecKey = keyof VehicleSpecs | 'combustion';

/**
 * A condition on one detail of the Build: equal, different, one of, or at least. 'combustion' is whether it has a
 * combustion engine (any fuel but electric). A detail that is not filled in never matches.
 */
type Rule = readonly [SpecKey, '=' | '!=', string | number | boolean] | readonly [SpecKey, 'in', readonly string[]] | readonly [SpecKey, '>=', number];

interface PartTemplate {
  code: string;
  kind: VehicleKind;
  en: string;
  fr: string;
  unit: PartUnit;
  category: Exclude<PartCategory, 'other'>;
  /** The generic default interval, given to the Maintenance Task a new Vehicle gets for this part. */
  intervalKm: number | null;
  intervalMonths: number | null;
  /** All must match for the part to be on the Vehicle; none means every Vehicle of its kind has it. */
  when?: readonly Rule[];
  /** A shorter distance interval when the engine has a turbo. */
  turboIntervalKm?: number;
  /** The Maintenance Task's name when it differs from the part's, e.g. oil and filter changed together. */
  task?: { en: string; fr: string };
  /** The part whose Maintenance Task also replaces this one (the oil filter goes with the oil), instead of its own. */
  goesWith?: string;
}

const COMBUSTION: Rule = ['combustion', '=', true];
const SPARK_IGNITION: Rule = ['fuel', 'in', ['petrol', 'flexfuel', 'hybrid', 'phev']];

/**
 * The Standard Parts a car or motorcycle might have and when it has them, from the vehicle parts database: its
 * parts to replace (its checks and services are not parts). Engine oil and its filter are kept apart, since each
 * is bought by its own unit. Codes are stored, so never rename one.
 */
export const PART_TEMPLATES = [
  // --- Cars ---
  { code: 'tires', kind: 'car', en: 'Tyres', fr: 'Pneus', unit: 'piece', category: 'tires_suspension', intervalKm: 40_000, intervalMonths: 72 },
  { code: 'shock_absorbers', kind: 'car', en: 'Shock absorbers', fr: 'Amortisseurs', unit: 'piece', category: 'tires_suspension', intervalKm: 100_000, intervalMonths: null },
  { code: 'brake_pads_front', kind: 'car', en: 'Front brake pads', fr: 'Plaquettes avant', unit: 'piece', category: 'brakes', intervalKm: 40_000, intervalMonths: null },
  { code: 'brake_pads_rear', kind: 'car', en: 'Rear brake pads', fr: 'Plaquettes arrière', unit: 'piece', category: 'brakes', intervalKm: 60_000, intervalMonths: null },
  { code: 'brake_discs_front', kind: 'car', en: 'Front brake discs', fr: 'Disques avant', unit: 'piece', category: 'brakes', intervalKm: 80_000, intervalMonths: null },
  { code: 'brake_discs_rear', kind: 'car', en: 'Rear brake discs', fr: 'Disques arrière', unit: 'piece', category: 'brakes', intervalKm: 100_000, intervalMonths: null },
  { code: 'brake_fluid', kind: 'car', en: 'Brake fluid', fr: 'Liquide de frein', unit: 'litre', category: 'brakes', intervalKm: null, intervalMonths: 24 },
  { code: 'wipers', kind: 'car', en: 'Wiper blades', fr: 'Balais d’essuie-glace', unit: 'piece', category: 'body', intervalKm: null, intervalMonths: 12 },
  { code: 'cabin_filter', kind: 'car', en: 'Cabin filter', fr: 'Filtre d’habitacle', unit: 'piece', category: 'hvac', intervalKm: 15_000, intervalMonths: 12 },
  { code: 'battery_12v', kind: 'car', en: '12 V battery', fr: 'Batterie 12 V', unit: 'piece', category: 'electrical', intervalKm: null, intervalMonths: 60, when: [['hasStartStop', '=', false]] },
  { code: 'battery_12v_agm', kind: 'car', en: '12 V battery (AGM/EFB, start-stop)', fr: 'Batterie 12 V (AGM/EFB, start-stop)', unit: 'piece', category: 'electrical', intervalKm: null, intervalMonths: 48, when: [['hasStartStop', '=', true]] },
  { code: 'engine_oil', kind: 'car', en: 'Engine oil', fr: 'Huile moteur', unit: 'litre', category: 'engine', intervalKm: 15_000, intervalMonths: 12, turboIntervalKm: 10_000, when: [COMBUSTION], task: { en: 'Engine oil and filter', fr: 'Huile moteur et filtre' } },
  { code: 'oil_filter', kind: 'car', en: 'Oil filter', fr: 'Filtre à huile', unit: 'piece', category: 'engine', intervalKm: 15_000, intervalMonths: 12, when: [COMBUSTION], goesWith: 'engine_oil' },
  { code: 'air_filter', kind: 'car', en: 'Air filter', fr: 'Filtre à air', unit: 'piece', category: 'engine', intervalKm: 30_000, intervalMonths: 24, when: [COMBUSTION] },
  { code: 'drive_belt', kind: 'car', en: 'Accessory belt and tensioner', fr: 'Courroie d’accessoires et galet', unit: 'piece', category: 'engine', intervalKm: 100_000, intervalMonths: 72, when: [COMBUSTION] },
  { code: 'coolant', kind: 'car', en: 'Coolant', fr: 'Liquide de refroidissement', unit: 'litre', category: 'cooling', intervalKm: 60_000, intervalMonths: 60, when: [COMBUSTION] },
  { code: 'timing_belt_kit', kind: 'car', en: 'Timing belt kit and water pump', fr: 'Kit de distribution et pompe à eau', unit: 'piece', category: 'engine', intervalKm: 120_000, intervalMonths: 120, when: [['distribution', '=', 'belt']] },
  { code: 'spark_plugs', kind: 'car', en: 'Spark plugs', fr: 'Bougies', unit: 'piece', category: 'ignition', intervalKm: 60_000, intervalMonths: 72, when: [SPARK_IGNITION] },
  { code: 'fuel_filter', kind: 'car', en: 'Fuel filter', fr: 'Filtre à gazole', unit: 'piece', category: 'fuel_exhaust', intervalKm: 30_000, intervalMonths: 24, when: [['fuel', '=', 'diesel']] },
  { code: 'clutch_kit', kind: 'car', en: 'Clutch kit', fr: 'Kit d’embrayage', unit: 'piece', category: 'transmission', intervalKm: 150_000, intervalMonths: null, when: [['transmission', '=', 'manual']] },
  { code: 'clutch_fluid', kind: 'car', en: 'Clutch fluid', fr: 'Liquide d’embrayage', unit: 'litre', category: 'transmission', intervalKm: null, intervalMonths: 24, when: [['transmission', '=', 'manual']] },
  { code: 'atf', kind: 'car', en: 'Automatic gearbox fluid and filter', fr: 'Huile de boîte automatique et filtre', unit: 'litre', category: 'transmission', intervalKm: 60_000, intervalMonths: 60, when: [['transmission', '=', 'automatic']] },
  { code: 'dct_oil', kind: 'car', en: 'Dual-clutch gearbox oil and filter', fr: 'Huile de boîte à double embrayage et filtre', unit: 'litre', category: 'transmission', intervalKm: 60_000, intervalMonths: 60, when: [['transmission', '=', 'dct']] },
  { code: 'cvt_fluid', kind: 'car', en: 'CVT fluid', fr: 'Huile de boîte CVT', unit: 'litre', category: 'transmission', intervalKm: 60_000, intervalMonths: 60, when: [['transmission', '=', 'cvt']] },
  { code: 'ecvt_fluid', kind: 'car', en: 'e-CVT transaxle fluid', fr: 'Huile de transmission e-CVT', unit: 'litre', category: 'transmission', intervalKm: 100_000, intervalMonths: 120, when: [['transmission', '=', 'e_cvt']] },
  { code: 'diff_oil_rear', kind: 'car', en: 'Rear differential oil', fr: 'Huile de pont arrière', unit: 'litre', category: 'drivetrain', intervalKm: 100_000, intervalMonths: 120, when: [['drivetrain', 'in', ['rwd', 'awd']]] },
  { code: 'diff_oil_front', kind: 'car', en: 'Front differential oil', fr: 'Huile de différentiel avant', unit: 'litre', category: 'drivetrain', intervalKm: 100_000, intervalMonths: 120, when: [['drivetrain', '=', 'awd']] },
  { code: 'transfer_case_oil', kind: 'car', en: 'Transfer case oil', fr: 'Huile de boîte de transfert', unit: 'litre', category: 'drivetrain', intervalKm: 100_000, intervalMonths: 120, when: [['drivetrain', '=', 'awd']] },
  { code: 'inverter_coolant', kind: 'car', en: 'Inverter coolant', fr: 'Liquide de refroidissement de l’onduleur', unit: 'litre', category: 'cooling', intervalKm: 150_000, intervalMonths: 120, when: [['fuel', 'in', ['hybrid', 'phev']]] },
  { code: 'ev_battery_coolant', kind: 'car', en: 'Battery coolant', fr: 'Liquide de refroidissement de la batterie', unit: 'litre', category: 'cooling', intervalKm: 150_000, intervalMonths: 120, when: [['fuel', '=', 'electric']] },
  { code: 'ev_reduction_gear_oil', kind: 'car', en: 'Reduction gear oil', fr: 'Huile de réducteur', unit: 'litre', category: 'transmission', intervalKm: 150_000, intervalMonths: 120, when: [['fuel', '=', 'electric']] },
  { code: 'ev_reduction_gear_oil_rear', kind: 'car', en: 'Rear reduction gear oil (dual motor)', fr: 'Huile de réducteur arrière (double moteur)', unit: 'litre', category: 'transmission', intervalKm: 150_000, intervalMonths: 120, when: [['fuel', '=', 'electric'], ['drivetrain', '=', 'awd']] },
  { code: 'ac_dryer', kind: 'car', en: 'A/C dryer', fr: 'Filtre déshydrateur de climatisation', unit: 'piece', category: 'hvac', intervalKm: null, intervalMonths: 72, when: [['hasAc', '=', true]] },

  // --- Motorcycles ---
  { code: 'moto_tire_front', kind: 'motorcycle', en: 'Front tyre', fr: 'Pneu avant', unit: 'piece', category: 'tires_suspension', intervalKm: 15_000, intervalMonths: 60 },
  { code: 'moto_tire_rear', kind: 'motorcycle', en: 'Rear tyre', fr: 'Pneu arrière', unit: 'piece', category: 'tires_suspension', intervalKm: 10_000, intervalMonths: 60 },
  { code: 'moto_brake_pads_front', kind: 'motorcycle', en: 'Front brake pads', fr: 'Plaquettes avant', unit: 'piece', category: 'brakes', intervalKm: 20_000, intervalMonths: null },
  { code: 'moto_brake_pads_rear', kind: 'motorcycle', en: 'Rear brake pads', fr: 'Plaquettes arrière', unit: 'piece', category: 'brakes', intervalKm: 25_000, intervalMonths: null },
  { code: 'moto_brake_discs_front', kind: 'motorcycle', en: 'Front brake discs', fr: 'Disques avant', unit: 'piece', category: 'brakes', intervalKm: 50_000, intervalMonths: null },
  { code: 'moto_brake_discs_rear', kind: 'motorcycle', en: 'Rear brake disc', fr: 'Disque arrière', unit: 'piece', category: 'brakes', intervalKm: 60_000, intervalMonths: null },
  { code: 'moto_brake_fluid', kind: 'motorcycle', en: 'Brake fluid', fr: 'Liquide de frein', unit: 'litre', category: 'brakes', intervalKm: null, intervalMonths: 24 },
  { code: 'moto_brake_hoses', kind: 'motorcycle', en: 'Brake hoses', fr: 'Durites de frein', unit: 'piece', category: 'brakes', intervalKm: null, intervalMonths: 60 },
  { code: 'moto_fork_oil_seals', kind: 'motorcycle', en: 'Fork oil and seals', fr: 'Huile et joints de fourche', unit: 'litre', category: 'tires_suspension', intervalKm: 30_000, intervalMonths: 36 },
  { code: 'moto_battery', kind: 'motorcycle', en: 'Battery', fr: 'Batterie', unit: 'piece', category: 'electrical', intervalKm: null, intervalMonths: 48 },
  { code: 'moto_engine_oil', kind: 'motorcycle', en: 'Engine oil', fr: 'Huile moteur', unit: 'litre', category: 'engine', intervalKm: 8_000, intervalMonths: 12, when: [COMBUSTION], task: { en: 'Engine oil and filter', fr: 'Huile moteur et filtre' } },
  { code: 'moto_oil_filter', kind: 'motorcycle', en: 'Oil filter', fr: 'Filtre à huile', unit: 'piece', category: 'engine', intervalKm: 8_000, intervalMonths: 12, when: [COMBUSTION], goesWith: 'moto_engine_oil' },
  { code: 'moto_air_filter', kind: 'motorcycle', en: 'Air filter', fr: 'Filtre à air', unit: 'piece', category: 'engine', intervalKm: 15_000, intervalMonths: 24, when: [COMBUSTION] },
  { code: 'moto_spark_plugs', kind: 'motorcycle', en: 'Spark plugs', fr: 'Bougies', unit: 'piece', category: 'ignition', intervalKm: 20_000, intervalMonths: 48, when: [COMBUSTION] },
  { code: 'moto_coolant', kind: 'motorcycle', en: 'Coolant', fr: 'Liquide de refroidissement', unit: 'litre', category: 'cooling', intervalKm: null, intervalMonths: 36, when: [COMBUSTION, ['cooling', '=', 'liquid']] },
  { code: 'moto_clutch_plates', kind: 'motorcycle', en: 'Clutch plates', fr: 'Disques d’embrayage', unit: 'piece', category: 'transmission', intervalKm: 30_000, intervalMonths: null, when: [['transmission', '=', 'manual']] },
  { code: 'moto_clutch_fluid', kind: 'motorcycle', en: 'Hydraulic clutch fluid', fr: 'Liquide d’embrayage hydraulique', unit: 'litre', category: 'transmission', intervalKm: null, intervalMonths: 24, when: [['transmission', '=', 'manual'], ['hasHydraulicClutch', '=', true]] },
  { code: 'moto_dct_oil', kind: 'motorcycle', en: 'DCT oil and filter', fr: 'Huile de boîte DCT et filtre', unit: 'litre', category: 'transmission', intervalKm: 24_000, intervalMonths: 24, when: [['transmission', '=', 'dct']] },
  { code: 'moto_cvt_belt', kind: 'motorcycle', en: 'CVT drive belt', fr: 'Courroie de variateur', unit: 'piece', category: 'transmission', intervalKm: 20_000, intervalMonths: null, when: [['transmission', '=', 'cvt']] },
  { code: 'moto_cvt_rollers', kind: 'motorcycle', en: 'Variator rollers', fr: 'Galets de variateur', unit: 'piece', category: 'transmission', intervalKm: 20_000, intervalMonths: null, when: [['transmission', '=', 'cvt']] },
  { code: 'moto_chain', kind: 'motorcycle', en: 'Chain', fr: 'Chaîne', unit: 'piece', category: 'drivetrain', intervalKm: 25_000, intervalMonths: null, when: [['finalDrive', '=', 'chain']] },
  { code: 'moto_sprockets', kind: 'motorcycle', en: 'Front and rear sprockets', fr: 'Pignon et couronne', unit: 'piece', category: 'drivetrain', intervalKm: 25_000, intervalMonths: null, when: [['finalDrive', '=', 'chain']] },
  { code: 'moto_drive_belt', kind: 'motorcycle', en: 'Final drive belt', fr: 'Courroie de transmission finale', unit: 'piece', category: 'drivetrain', intervalKm: 60_000, intervalMonths: null, when: [['finalDrive', '=', 'belt']] },
  { code: 'moto_shaft_oil', kind: 'motorcycle', en: 'Final drive (shaft) oil', fr: 'Huile de cardan', unit: 'litre', category: 'drivetrain', intervalKm: 30_000, intervalMonths: 36, when: [['finalDrive', '=', 'shaft']] },
  { code: 'moto_gear_oil', kind: 'motorcycle', en: 'Final drive gear oil (scooter)', fr: 'Huile de transmission finale (scooter)', unit: 'litre', category: 'drivetrain', intervalKm: 20_000, intervalMonths: 24, when: [['finalDrive', '=', 'gear']] },
  { code: 'moto_ev_coolant', kind: 'motorcycle', en: 'Motor and battery coolant', fr: 'Liquide de refroidissement moteur et batterie', unit: 'litre', category: 'cooling', intervalKm: null, intervalMonths: 48, when: [['fuel', '=', 'electric'], ['cooling', '=', 'liquid']] },
] as const satisfies readonly PartTemplate[];

export type StandardPartKey = (typeof PART_TEMPLATES)[number]['code'];

const BY_CODE = new Map<string, PartTemplate>(PART_TEMPLATES.map((t) => [t.code, t]));

export function isStandardPartKey(key: string): key is StandardPartKey {
  return BY_CODE.has(key);
}

export function templatesOf(kind: VehicleKind): (PartTemplate & { code: StandardPartKey })[] {
  return PART_TEMPLATES.filter((t) => t.kind === kind) as (PartTemplate & { code: StandardPartKey })[];
}

/** A Standard Part's name in the interface language. */
export function standardPartName(key: StandardPartKey, lang: 'en' | 'fr'): string {
  return BY_CODE.get(key)![lang];
}

function matches(build: Build, [key, op, value]: Rule): boolean {
  const actual = key === 'combustion' ? build.fuel !== 'electric' : build[key];
  if (actual === null) return false;
  switch (op) {
    case '=':
      return actual === value;
    case '!=':
      return actual !== value;
    case 'in':
      return (value as readonly unknown[]).includes(actual);
    case '>=':
      return typeof actual === 'number' && actual >= value;
  }
}

/** Whether a Standard Part is on a Vehicle with this Build. */
export function partFits(build: Build, key: StandardPartKey): boolean {
  const template = BY_CODE.get(key);
  if (!template || template.kind !== build.kind) return false;
  return (template.when ?? []).every((rule) => matches(build, rule));
}

/** Position of a Standard Part in the catalogue, so screens keep its order; other Parts come after. */
export function catalogueOrder(key: StandardPartKey | null): number {
  const index = key === null ? -1 : PART_TEMPLATES.findIndex((t) => t.code === key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Whether a Standard Part is fitted at a position, rather than a fluid that is topped up or drained. */
export function isFitted(key: StandardPartKey): boolean {
  return BY_CODE.get(key)?.unit === 'piece';
}

export function partCategory(key: StandardPartKey | null): PartCategory {
  return key === null ? 'other' : (BY_CODE.get(key)?.category ?? 'other');
}

/** A Maintenance Task a new Vehicle starts with, one per Standard Part it has (an oil filter goes with the oil). */
export interface StarterTask {
  name: string;
  nameFr: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  /** The part the Task replaces. */
  standardPart: StandardPartKey;
  /** Its Required Parts: the part itself, then those that go with it. */
  parts: StandardPartKey[];
}

/** The catalogue's Interval for the Task replacing a Standard Part on a Vehicle with this Build (shorter with a turbo). */
export function defaultInterval(build: Build, key: StandardPartKey): { intervalKm: number | null; intervalMonths: number | null } | null {
  const t = BY_CODE.get(key);
  if (!t || t.kind !== build.kind || t.goesWith !== undefined) return null;
  return { intervalKm: build.hasTurbo && t.turboIntervalKm ? t.turboIntervalKm : t.intervalKm, intervalMonths: t.intervalMonths };
}

/** The Vehicle's maintenance schedule: a Task per Standard Part that fits its Build (the oil filter goes with the oil). */
export function starterTasks(build: Build): StarterTask[] {
  const fitting = templatesOf(build.kind).filter((t) => partFits(build, t.code));
  return fitting
    .filter((t) => t.goesWith === undefined)
    .map((t) => ({
      name: t.task ? t.task.en : t.en,
      nameFr: t.task ? t.task.fr : t.fr,
      ...defaultInterval(build, t.code)!,
      standardPart: t.code,
      parts: [t.code, ...fitting.filter((other) => other.goesWith === t.code).map((other) => other.code)],
    }));
}
