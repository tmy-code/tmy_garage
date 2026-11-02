import type { Cooling, Distribution, Drivetrain, FinalDrive, FuelType, PartUnit, TaskAction, Transmission, VehicleKind } from './schemas.ts';

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

/** Groups for listing Part Specs and Maintenance Tasks, in screen order. What the owner has not placed in one goes under 'other'. */
export const PART_CATEGORIES = ['engine', 'transmission', 'brakes', 'chassis', 'electrical', 'cooling_climate', 'other'] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

type SpecKey = keyof VehicleSpecs | 'combustion';

/**
 * A condition of a built-in part on one detail of the Build: equal or one of. 'combustion' is whether it has a
 * combustion engine (any fuel but electric).
 */
type Rule = readonly [SpecKey, '=', string | boolean] | readonly [SpecKey, 'in', readonly string[]];

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
  /** The Maintenance Task's name: what is to be done (e.g. "Replace front brake pads"), not the part's name. */
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
  { code: 'tires_front', kind: 'car', en: 'Front tyres', fr: 'Pneus avant', unit: 'piece', category: 'chassis', intervalKm: 40_000, intervalMonths: 72, task: { en: 'Replace front tyres', fr: 'Remplacer les pneus avant' } },
  { code: 'tires_rear', kind: 'car', en: 'Rear tyres', fr: 'Pneus arrière', unit: 'piece', category: 'chassis', intervalKm: 40_000, intervalMonths: 72, task: { en: 'Replace rear tyres', fr: 'Remplacer les pneus arrière' } },
  { code: 'shock_absorbers', kind: 'car', en: 'Shock absorbers', fr: 'Amortisseurs', unit: 'piece', category: 'chassis', intervalKm: 100_000, intervalMonths: null, task: { en: 'Replace shock absorbers', fr: 'Remplacer les amortisseurs' } },
  { code: 'brake_pads_front', kind: 'car', en: 'Front brake pads', fr: 'Plaquettes avant', unit: 'piece', category: 'brakes', intervalKm: 40_000, intervalMonths: null, task: { en: 'Replace front brake pads', fr: 'Remplacer les plaquettes avant' } },
  { code: 'brake_pads_rear', kind: 'car', en: 'Rear brake pads', fr: 'Plaquettes arrière', unit: 'piece', category: 'brakes', intervalKm: 60_000, intervalMonths: null, task: { en: 'Replace rear brake pads', fr: 'Remplacer les plaquettes arrière' } },
  { code: 'brake_discs_front', kind: 'car', en: 'Front brake discs', fr: 'Disques avant', unit: 'piece', category: 'brakes', intervalKm: 80_000, intervalMonths: null, task: { en: 'Replace front brake discs', fr: 'Remplacer les disques avant' } },
  { code: 'brake_discs_rear', kind: 'car', en: 'Rear brake discs', fr: 'Disques arrière', unit: 'piece', category: 'brakes', intervalKm: 100_000, intervalMonths: null, task: { en: 'Replace rear brake discs', fr: 'Remplacer les disques arrière' } },
  { code: 'brake_fluid', kind: 'car', en: 'Brake fluid', fr: 'Liquide de frein', unit: 'litre', category: 'brakes', intervalKm: null, intervalMonths: 24, task: { en: 'Change brake fluid', fr: 'Remplacer le liquide de frein' } },
  { code: 'wipers', kind: 'car', en: 'Wiper blades', fr: 'Balais d’essuie-glace', unit: 'piece', category: 'chassis', intervalKm: null, intervalMonths: 12, task: { en: 'Replace wiper blades', fr: 'Remplacer les balais d’essuie-glace' } },
  { code: 'cabin_filter', kind: 'car', en: 'Cabin filter', fr: 'Filtre d’habitacle', unit: 'piece', category: 'cooling_climate', intervalKm: 15_000, intervalMonths: 12, task: { en: 'Replace cabin filter', fr: 'Remplacer le filtre d’habitacle' } },
  { code: 'battery_12v', kind: 'car', en: '12 V battery', fr: 'Batterie 12 V', unit: 'piece', category: 'electrical', intervalKm: null, intervalMonths: 60, when: [['hasStartStop', '=', false]], task: { en: 'Replace 12 V battery', fr: 'Remplacer la batterie 12 V' } },
  { code: 'battery_12v_agm', kind: 'car', en: '12 V battery (AGM/EFB, start-stop)', fr: 'Batterie 12 V (AGM/EFB, start-stop)', unit: 'piece', category: 'electrical', intervalKm: null, intervalMonths: 48, when: [['hasStartStop', '=', true]], task: { en: 'Replace 12 V battery (AGM/EFB, start-stop)', fr: 'Remplacer la batterie 12 V (AGM/EFB, start-stop)' } },
  { code: 'engine_oil', kind: 'car', en: 'Engine oil', fr: 'Huile moteur', unit: 'litre', category: 'engine', intervalKm: 15_000, intervalMonths: 12, turboIntervalKm: 10_000, when: [COMBUSTION], task: { en: 'Change engine oil and filter', fr: 'Vidange huile moteur et filtre' } },
  { code: 'oil_filter', kind: 'car', en: 'Oil filter', fr: 'Filtre à huile', unit: 'piece', category: 'engine', intervalKm: 15_000, intervalMonths: 12, when: [COMBUSTION], goesWith: 'engine_oil' },
  { code: 'air_filter', kind: 'car', en: 'Air filter', fr: 'Filtre à air', unit: 'piece', category: 'engine', intervalKm: 30_000, intervalMonths: 24, when: [COMBUSTION], task: { en: 'Replace air filter', fr: 'Remplacer le filtre à air' } },
  { code: 'drive_belt', kind: 'car', en: 'Accessory belt and tensioner', fr: 'Courroie d’accessoires et galet', unit: 'piece', category: 'engine', intervalKm: 100_000, intervalMonths: 72, when: [COMBUSTION], task: { en: 'Replace accessory belt and tensioner', fr: 'Remplacer la courroie d’accessoires et le galet' } },
  { code: 'coolant', kind: 'car', en: 'Coolant', fr: 'Liquide de refroidissement', unit: 'litre', category: 'cooling_climate', intervalKm: 60_000, intervalMonths: 60, when: [COMBUSTION], task: { en: 'Change coolant', fr: 'Remplacer le liquide de refroidissement' } },
  { code: 'timing_belt_kit', kind: 'car', en: 'Timing belt kit and water pump', fr: 'Kit de distribution et pompe à eau', unit: 'piece', category: 'engine', intervalKm: 120_000, intervalMonths: 120, when: [['distribution', '=', 'belt']], task: { en: 'Replace timing belt kit and water pump', fr: 'Remplacer le kit de distribution et la pompe à eau' } },
  { code: 'spark_plugs', kind: 'car', en: 'Spark plugs', fr: 'Bougies', unit: 'piece', category: 'engine', intervalKm: 60_000, intervalMonths: 72, when: [SPARK_IGNITION], task: { en: 'Replace spark plugs', fr: 'Remplacer les bougies' } },
  { code: 'fuel_filter', kind: 'car', en: 'Fuel filter', fr: 'Filtre à gazole', unit: 'piece', category: 'engine', intervalKm: 30_000, intervalMonths: 24, when: [['fuel', '=', 'diesel']], task: { en: 'Replace fuel filter', fr: 'Remplacer le filtre à gazole' } },
  { code: 'clutch_kit', kind: 'car', en: 'Clutch kit', fr: 'Kit d’embrayage', unit: 'piece', category: 'transmission', intervalKm: 150_000, intervalMonths: null, when: [['transmission', '=', 'manual']], task: { en: 'Replace clutch kit', fr: 'Remplacer le kit d’embrayage' } },
  { code: 'clutch_fluid', kind: 'car', en: 'Clutch fluid', fr: 'Liquide d’embrayage', unit: 'litre', category: 'transmission', intervalKm: null, intervalMonths: 24, when: [['transmission', '=', 'manual']], task: { en: 'Change clutch fluid', fr: 'Remplacer le liquide d’embrayage' } },
  { code: 'atf', kind: 'car', en: 'Automatic gearbox fluid and filter', fr: 'Huile de boîte automatique et filtre', unit: 'litre', category: 'transmission', intervalKm: 60_000, intervalMonths: 60, when: [['transmission', '=', 'automatic']], task: { en: 'Change automatic gearbox fluid and filter', fr: 'Vidanger la boîte automatique et remplacer le filtre' } },
  { code: 'dct_oil', kind: 'car', en: 'Dual-clutch gearbox oil and filter', fr: 'Huile de boîte à double embrayage et filtre', unit: 'litre', category: 'transmission', intervalKm: 60_000, intervalMonths: 60, when: [['transmission', '=', 'dct']], task: { en: 'Change dual-clutch gearbox oil and filter', fr: 'Vidanger la boîte à double embrayage et remplacer le filtre' } },
  { code: 'cvt_fluid', kind: 'car', en: 'CVT fluid', fr: 'Huile de boîte CVT', unit: 'litre', category: 'transmission', intervalKm: 60_000, intervalMonths: 60, when: [['transmission', '=', 'cvt']], task: { en: 'Change CVT fluid', fr: 'Vidanger la boîte CVT' } },
  { code: 'ecvt_fluid', kind: 'car', en: 'e-CVT transaxle fluid', fr: 'Huile de transmission e-CVT', unit: 'litre', category: 'transmission', intervalKm: 100_000, intervalMonths: 120, when: [['transmission', '=', 'e_cvt']], task: { en: 'Change e-CVT transaxle fluid', fr: 'Vidanger la transmission e-CVT' } },
  { code: 'diff_oil_rear', kind: 'car', en: 'Rear differential oil', fr: 'Huile de pont arrière', unit: 'litre', category: 'transmission', intervalKm: 100_000, intervalMonths: 120, when: [['drivetrain', 'in', ['rwd', 'awd']]], task: { en: 'Change rear differential oil', fr: 'Vidanger le pont arrière' } },
  { code: 'diff_oil_front', kind: 'car', en: 'Front differential oil', fr: 'Huile de différentiel avant', unit: 'litre', category: 'transmission', intervalKm: 100_000, intervalMonths: 120, when: [['drivetrain', '=', 'awd']], task: { en: 'Change front differential oil', fr: 'Vidanger le différentiel avant' } },
  { code: 'transfer_case_oil', kind: 'car', en: 'Transfer case oil', fr: 'Huile de boîte de transfert', unit: 'litre', category: 'transmission', intervalKm: 100_000, intervalMonths: 120, when: [['drivetrain', '=', 'awd']], task: { en: 'Change transfer case oil', fr: 'Vidanger la boîte de transfert' } },
  { code: 'inverter_coolant', kind: 'car', en: 'Inverter coolant', fr: 'Liquide de refroidissement de l’onduleur', unit: 'litre', category: 'cooling_climate', intervalKm: 150_000, intervalMonths: 120, when: [['fuel', 'in', ['hybrid', 'phev']]], task: { en: 'Change inverter coolant', fr: 'Remplacer le liquide de refroidissement de l’onduleur' } },
  { code: 'ev_battery_coolant', kind: 'car', en: 'Battery coolant', fr: 'Liquide de refroidissement de la batterie', unit: 'litre', category: 'cooling_climate', intervalKm: 150_000, intervalMonths: 120, when: [['fuel', '=', 'electric']], task: { en: 'Change battery coolant', fr: 'Remplacer le liquide de refroidissement de la batterie' } },
  { code: 'ev_reduction_gear_oil', kind: 'car', en: 'Reduction gear oil', fr: 'Huile de réducteur', unit: 'litre', category: 'transmission', intervalKm: 150_000, intervalMonths: 120, when: [['fuel', '=', 'electric']], task: { en: 'Change reduction gear oil', fr: 'Vidanger le réducteur' } },
  { code: 'ev_reduction_gear_oil_rear', kind: 'car', en: 'Rear reduction gear oil (dual motor)', fr: 'Huile de réducteur arrière (double moteur)', unit: 'litre', category: 'transmission', intervalKm: 150_000, intervalMonths: 120, when: [['fuel', '=', 'electric'], ['drivetrain', '=', 'awd']], task: { en: 'Change rear reduction gear oil (dual motor)', fr: 'Vidanger le réducteur arrière (double moteur)' } },
  { code: 'ac_dryer', kind: 'car', en: 'A/C dryer', fr: 'Filtre déshydrateur de climatisation', unit: 'piece', category: 'cooling_climate', intervalKm: null, intervalMonths: 72, when: [['hasAc', '=', true]], task: { en: 'Replace A/C dryer', fr: 'Remplacer le filtre déshydrateur de climatisation' } },

  // --- Motorcycles ---
  { code: 'moto_tire_front', kind: 'motorcycle', en: 'Front tyre', fr: 'Pneu avant', unit: 'piece', category: 'chassis', intervalKm: 15_000, intervalMonths: 60, task: { en: 'Replace front tyre', fr: 'Remplacer le pneu avant' } },
  { code: 'moto_tire_rear', kind: 'motorcycle', en: 'Rear tyre', fr: 'Pneu arrière', unit: 'piece', category: 'chassis', intervalKm: 10_000, intervalMonths: 60, task: { en: 'Replace rear tyre', fr: 'Remplacer le pneu arrière' } },
  { code: 'moto_brake_pads_front', kind: 'motorcycle', en: 'Front brake pads', fr: 'Plaquettes avant', unit: 'piece', category: 'brakes', intervalKm: 20_000, intervalMonths: null, task: { en: 'Replace front brake pads', fr: 'Remplacer les plaquettes avant' } },
  { code: 'moto_brake_pads_rear', kind: 'motorcycle', en: 'Rear brake pads', fr: 'Plaquettes arrière', unit: 'piece', category: 'brakes', intervalKm: 25_000, intervalMonths: null, task: { en: 'Replace rear brake pads', fr: 'Remplacer les plaquettes arrière' } },
  { code: 'moto_brake_discs_front', kind: 'motorcycle', en: 'Front brake discs', fr: 'Disques avant', unit: 'piece', category: 'brakes', intervalKm: 50_000, intervalMonths: null, task: { en: 'Replace front brake discs', fr: 'Remplacer les disques avant' } },
  { code: 'moto_brake_discs_rear', kind: 'motorcycle', en: 'Rear brake disc', fr: 'Disque arrière', unit: 'piece', category: 'brakes', intervalKm: 60_000, intervalMonths: null, task: { en: 'Replace rear brake disc', fr: 'Remplacer le disque arrière' } },
  { code: 'moto_brake_fluid', kind: 'motorcycle', en: 'Brake fluid', fr: 'Liquide de frein', unit: 'litre', category: 'brakes', intervalKm: null, intervalMonths: 24, task: { en: 'Change brake fluid', fr: 'Remplacer le liquide de frein' } },
  { code: 'moto_brake_hoses', kind: 'motorcycle', en: 'Brake hoses', fr: 'Durites de frein', unit: 'piece', category: 'brakes', intervalKm: null, intervalMonths: 60, task: { en: 'Replace brake hoses', fr: 'Remplacer les durites de frein' } },
  { code: 'moto_fork_oil_seals', kind: 'motorcycle', en: 'Fork oil and seals', fr: 'Huile et joints de fourche', unit: 'litre', category: 'chassis', intervalKm: 30_000, intervalMonths: 36, task: { en: 'Change fork oil and seals', fr: 'Remplacer l’huile et les joints de fourche' } },
  { code: 'moto_battery', kind: 'motorcycle', en: 'Battery', fr: 'Batterie', unit: 'piece', category: 'electrical', intervalKm: null, intervalMonths: 48, task: { en: 'Replace battery', fr: 'Remplacer la batterie' } },
  { code: 'moto_engine_oil', kind: 'motorcycle', en: 'Engine oil', fr: 'Huile moteur', unit: 'litre', category: 'engine', intervalKm: 8_000, intervalMonths: 12, when: [COMBUSTION], task: { en: 'Change engine oil and filter', fr: 'Vidange huile moteur et filtre' } },
  { code: 'moto_oil_filter', kind: 'motorcycle', en: 'Oil filter', fr: 'Filtre à huile', unit: 'piece', category: 'engine', intervalKm: 8_000, intervalMonths: 12, when: [COMBUSTION], goesWith: 'moto_engine_oil' },
  { code: 'moto_air_filter', kind: 'motorcycle', en: 'Air filter', fr: 'Filtre à air', unit: 'piece', category: 'engine', intervalKm: 15_000, intervalMonths: 24, when: [COMBUSTION], task: { en: 'Replace air filter', fr: 'Remplacer le filtre à air' } },
  { code: 'moto_spark_plugs', kind: 'motorcycle', en: 'Spark plugs', fr: 'Bougies', unit: 'piece', category: 'engine', intervalKm: 20_000, intervalMonths: 48, when: [COMBUSTION], task: { en: 'Replace spark plugs', fr: 'Remplacer les bougies' } },
  { code: 'moto_coolant', kind: 'motorcycle', en: 'Coolant', fr: 'Liquide de refroidissement', unit: 'litre', category: 'cooling_climate', intervalKm: null, intervalMonths: 36, when: [COMBUSTION, ['cooling', '=', 'liquid']], task: { en: 'Change coolant', fr: 'Remplacer le liquide de refroidissement' } },
  { code: 'moto_clutch_plates', kind: 'motorcycle', en: 'Clutch plates', fr: 'Disques d’embrayage', unit: 'piece', category: 'transmission', intervalKm: 30_000, intervalMonths: null, when: [['transmission', '=', 'manual']], task: { en: 'Replace clutch plates', fr: 'Remplacer les disques d’embrayage' } },
  { code: 'moto_clutch_fluid', kind: 'motorcycle', en: 'Hydraulic clutch fluid', fr: 'Liquide d’embrayage hydraulique', unit: 'litre', category: 'transmission', intervalKm: null, intervalMonths: 24, when: [['transmission', '=', 'manual'], ['hasHydraulicClutch', '=', true]], task: { en: 'Change hydraulic clutch fluid', fr: 'Remplacer le liquide d’embrayage hydraulique' } },
  { code: 'moto_dct_oil', kind: 'motorcycle', en: 'DCT oil and filter', fr: 'Huile de boîte DCT et filtre', unit: 'litre', category: 'transmission', intervalKm: 24_000, intervalMonths: 24, when: [['transmission', '=', 'dct']], task: { en: 'Change DCT oil and filter', fr: 'Vidanger la boîte DCT et remplacer le filtre' } },
  { code: 'moto_cvt_belt', kind: 'motorcycle', en: 'CVT drive belt', fr: 'Courroie de variateur', unit: 'piece', category: 'transmission', intervalKm: 20_000, intervalMonths: null, when: [['transmission', '=', 'cvt']], task: { en: 'Replace CVT drive belt', fr: 'Remplacer la courroie de variateur' } },
  { code: 'moto_cvt_rollers', kind: 'motorcycle', en: 'Variator rollers', fr: 'Galets de variateur', unit: 'piece', category: 'transmission', intervalKm: 20_000, intervalMonths: null, when: [['transmission', '=', 'cvt']], task: { en: 'Replace variator rollers', fr: 'Remplacer les galets de variateur' } },
  { code: 'moto_chain', kind: 'motorcycle', en: 'Chain', fr: 'Chaîne', unit: 'piece', category: 'transmission', intervalKm: 25_000, intervalMonths: null, when: [['finalDrive', '=', 'chain']], task: { en: 'Replace chain', fr: 'Remplacer la chaîne' } },
  { code: 'moto_sprockets', kind: 'motorcycle', en: 'Front and rear sprockets', fr: 'Pignon et couronne', unit: 'piece', category: 'transmission', intervalKm: 25_000, intervalMonths: null, when: [['finalDrive', '=', 'chain']], task: { en: 'Replace front and rear sprockets', fr: 'Remplacer le pignon et la couronne' } },
  { code: 'moto_drive_belt', kind: 'motorcycle', en: 'Final drive belt', fr: 'Courroie de transmission finale', unit: 'piece', category: 'transmission', intervalKm: 60_000, intervalMonths: null, when: [['finalDrive', '=', 'belt']], task: { en: 'Replace final drive belt', fr: 'Remplacer la courroie de transmission finale' } },
  { code: 'moto_shaft_oil', kind: 'motorcycle', en: 'Final drive (shaft) oil', fr: 'Huile de cardan', unit: 'litre', category: 'transmission', intervalKm: 30_000, intervalMonths: 36, when: [['finalDrive', '=', 'shaft']], task: { en: 'Change final drive (shaft) oil', fr: 'Vidanger le cardan' } },
  { code: 'moto_gear_oil', kind: 'motorcycle', en: 'Final drive gear oil (scooter)', fr: 'Huile de transmission finale (scooter)', unit: 'litre', category: 'transmission', intervalKm: 20_000, intervalMonths: 24, when: [['finalDrive', '=', 'gear']], task: { en: 'Change final drive gear oil (scooter)', fr: 'Vidanger la transmission finale (scooter)' } },
  { code: 'moto_ev_coolant', kind: 'motorcycle', en: 'Motor and battery coolant', fr: 'Liquide de refroidissement moteur et batterie', unit: 'litre', category: 'cooling_climate', intervalKm: null, intervalMonths: 48, when: [['fuel', '=', 'electric'], ['cooling', '=', 'liquid']], task: { en: 'Change motor and battery coolant', fr: 'Remplacer le liquide de refroidissement moteur et batterie' } },
] as const satisfies readonly PartTemplate[];

/** A Standard Part's code: a built-in one, or `own_…` for one the owner added. Codes are stored, so never rename one. */
export type StandardPartKey = string;

// --- Conditions on the Build ---

/** The details of a Build a part can depend on: one of their values, or an option being there or not. */
export const CONDITION_KEYS = ['fuel', 'transmission', 'drivetrain', 'distribution', 'finalDrive', 'cooling', ...SPEC_FLAGS] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

/**
 * For each detail a part depends on, the values a Vehicle needs for the part to be on it (an option as 'true' or
 * 'false'). A detail left out takes any value; a detail not filled in on the Vehicle never matches.
 */
export type Conditions = Partial<Record<ConditionKey, readonly string[]>>;

/** The details a part of this kind can depend on, with the values each can take, in screen order. */
export function conditionChoices(kind: VehicleKind): { key: ConditionKey; values: readonly string[] }[] {
  const flag = (key: SpecFlag) => ({ key, values: ['true', 'false'] });
  return kind === 'car'
    ? [
        { key: 'fuel', values: fuelsOf('car') },
        { key: 'transmission', values: [...transmissionsOf('car', null), 'single_speed'] },
        { key: 'drivetrain', values: DRIVETRAINS },
        { key: 'distribution', values: ['belt', 'chain', 'none'] },
        ...SPEC_FLAGS.filter((f) => f !== 'hasHydraulicClutch').map(flag),
      ]
    : [
        { key: 'fuel', values: fuelsOf('motorcycle') },
        { key: 'transmission', values: [...transmissionsOf('motorcycle', null), 'single_speed'] },
        { key: 'finalDrive', values: FINAL_DRIVES },
        { key: 'cooling', values: COOLINGS },
        flag('hasHydraulicClutch'),
      ];
}

/** Conditions as they are kept: details of the kind only, known values only, and a detail taking any value left out. */
export function tidyConditions(kind: VehicleKind, conditions: Conditions): Conditions {
  const tidy: Conditions = {};
  for (const { key, values } of conditionChoices(kind)) {
    const wanted = conditions[key];
    if (!wanted) continue;
    const kept = values.filter((v) => wanted.includes(v));
    if (kept.length < values.length) tidy[key] = kept;
  }
  return tidy;
}

/** A built-in part's rules as Conditions, so the owner can change them like any other. */
function conditionsOf(kind: VehicleKind, rules: readonly Rule[]): Conditions {
  const conditions: Partial<Record<ConditionKey, string[]>> = {};
  for (const [key, op, value] of rules) {
    const detail = (key === 'combustion' ? 'fuel' : key) as ConditionKey;
    const allowed =
      key === 'combustion'
        ? fuelsOf(kind).filter((f) => f !== 'electric')
        : op === 'in'
          ? [...(value as readonly string[])]
          : [String(value)];
    const before = conditions[detail];
    conditions[detail] = before ? before.filter((v) => allowed.includes(v)) : allowed;
  }
  return conditions;
}

function matches(build: Build, conditions: Conditions): boolean {
  return Object.entries(conditions).every(([key, values]) => {
    const actual = build[key as ConditionKey];
    // A fuel never filled in (a Vehicle added before it was required) still counts as a combustion engine.
    if (key === 'fuel' && actual === null) {
      return !values!.includes('electric') && fuelsOf(build.kind).every((f) => f === 'electric' || values!.includes(f));
    }
    return actual !== null && values!.includes(String(actual));
  });
}

// --- The catalogue: built-in parts with the owner's changes ---

/** How often a Task recurs: a distance, a duration, or both. */
export interface Interval {
  intervalKm: number | null;
  intervalMonths: number | null;
}

/** A part the owner added to the catalogue: a part to replace, or (no unit) a check or service replacing no part. */
export interface OwnPart extends Interval {
  kind: VehicleKind;
  name: string;
  nameFr: string | null;
  unit: PartUnit | null;
  category: PartCategory;
  action: TaskAction;
}

/** What the owner changed in the catalogue for one part: a built-in one's conditions, details or removal, or a part of their own. */
export interface CatalogueEntry {
  code: StandardPartKey;
  /** The owner's own part; null for a change to a built-in one. */
  own: OwnPart | null;
  /** Null keeps a built-in part's own conditions. */
  conditions: Conditions | null;
  /** Default details (e.g. "10W-40, JASO MA2") a matching Vehicle's Part Spec starts with. */
  characteristics: string | null;
  /** A built-in part taken off the list. */
  removed: boolean;
  /** The owner's own name, category or action for a built-in part; empty keeps the built-in one. */
  overrides: { name: string | null; nameFr: string | null; category: PartCategory | null; action: TaskAction | null } | null;
  /** The owner's own default Interval for a built-in part; null keeps the built-in one. */
  interval: Interval | null;
}

/** A part of the catalogue as it stands, built-in or the owner's own. */
export interface CataloguePart {
  code: StandardPartKey;
  kind: VehicleKind;
  en: string;
  fr: string;
  /** Null for a task that uses nothing to buy: it has a Task but no Part Spec. */
  unit: PartUnit | null;
  category: PartCategory;
  action: TaskAction;
  intervalKm: number | null;
  intervalMonths: number | null;
  /** A shorter distance interval when the engine has a turbo. */
  turboIntervalKm?: number;
  task?: { en: string; fr: string };
  goesWith?: string;
  conditions: Conditions;
  characteristics: string | null;
  builtIn: boolean;
  /** A built-in part the owner changed: its conditions, its details or its removal. */
  changed: boolean;
  removed: boolean;
}

/** A Maintenance Task a new Vehicle starts with, one per Standard Part it has (an oil filter goes with the oil). */
export interface StarterTask {
  /** The template's part code: it identifies the Task for good, whatever the owner renames it. */
  code: StandardPartKey;
  name: string;
  nameFr: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  category: PartCategory;
  action: TaskAction;
  /** Other names for the same job (the part's own name, older wordings): a Task already named so is this Task. */
  sameAs: string[];
}

const BUILT_IN_CODES = new Set<string>(PART_TEMPLATES.map((t) => t.code));

export function isBuiltInPart(code: string): boolean {
  return BUILT_IN_CODES.has(code);
}

/**
 * The Standard Parts and when a Vehicle has them: the built-in list, with the owner's changes. Every question about
 * a part goes through it, so a change in Settings reaches every screen.
 */
export class Catalogue {
  /** Every part, removed ones included: built-in ones in their order, then the owner's own in the order added. */
  readonly all: readonly CataloguePart[];
  private readonly byCode: Map<string, CataloguePart>;

  constructor(entries: readonly CatalogueEntry[] = []) {
    const changes = new Map(entries.map((e) => [e.code, e]));
    const builtIn = (PART_TEMPLATES as readonly PartTemplate[]).map((t): CataloguePart => {
      const change = changes.get(t.code);
      const o = change?.overrides;
      const task = t.task ? { en: o?.name ?? t.task.en, fr: o?.nameFr ?? o?.name ?? t.task.fr } : undefined;
      return {
        ...t,
        ...(task ? { task } : {}),
        category: o?.category ?? t.category,
        intervalKm: change?.interval ? change.interval.intervalKm : t.intervalKm,
        intervalMonths: change?.interval ? change.interval.intervalMonths : t.intervalMonths,
        conditions: change?.conditions ?? conditionsOf(t.kind, t.when ?? []),
        characteristics: change?.characteristics ?? null,
        action: o?.action ?? actionOfName(t.task?.en ?? t.en),
        builtIn: true,
        changed: change !== undefined,
        removed: change?.removed ?? false,
      };
    });
    const own = entries
      .filter((e) => e.own !== null && !BUILT_IN_CODES.has(e.code))
      .map(
        (e): CataloguePart => ({
          code: e.code,
          kind: e.own!.kind,
          en: e.own!.name,
          fr: e.own!.nameFr ?? e.own!.name,
          unit: e.own!.unit,
          category: e.own!.category,
          action: e.own!.action,
          intervalKm: e.own!.intervalKm,
          intervalMonths: e.own!.intervalMonths,
          conditions: e.conditions ?? {},
          characteristics: e.characteristics,
          builtIn: false,
          changed: false,
          removed: false,
        }),
      );
    this.all = [...builtIn, ...own];
    this.byCode = new Map(this.all.map((p) => [p.code, p]));
  }

  /** A part on the list (not removed). */
  part(code: StandardPartKey | null): CataloguePart | undefined {
    const part = code === null ? undefined : this.byCode.get(code);
    return part && !part.removed ? part : undefined;
  }

  /** Any part this catalogue knows, removed ones included. */
  known(code: StandardPartKey | null): CataloguePart | undefined {
    return code === null ? undefined : this.byCode.get(code);
  }

  /** The parts on the list for a kind of Vehicle. */
  partsOf(kind: VehicleKind): CataloguePart[] {
    return this.all.filter((p) => p.kind === kind && !p.removed);
  }

  /** Whether a Standard Part is on a Vehicle with this Build. */
  fits(build: Build, code: StandardPartKey): boolean {
    const part = this.part(code);
    return part !== undefined && part.kind === build.kind && matches(build, part.conditions);
  }

  /** A Standard Part's name in the interface language, or null for one this catalogue does not know. */
  name(code: StandardPartKey, lang: 'en' | 'fr'): string | null {
    return this.known(code)?.[lang] ?? null;
  }

  /**
   * The names a built-in part's Task had before its name said what to do: the part's own name, or for the oil
   * the older "and filter". A Task still carrying one was never renamed by the owner.
   */
  legacyTaskNames(code: StandardPartKey): string[] {
    const part = this.known(code);
    if (!part?.builtIn) return [];
    return [part.en, part.fr, ...(part.goesWith === undefined && part.task && code.endsWith('engine_oil') ? ['Engine oil and filter', 'Huile moteur et filtre'] : [])];
  }

  /** Position of a Standard Part in the catalogue, so screens keep its order; other Parts come after. */
  order(code: StandardPartKey | null): number {
    const index = code === null ? -1 : this.all.findIndex((p) => p.code === code);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }

  category(code: StandardPartKey | null): PartCategory {
    return this.known(code)?.category ?? 'other';
  }

  /** Whether a part's Task is the one of the part it goes with (the oil filter with the oil) on this Build. */
  private bundled(build: Build, part: CataloguePart): boolean {
    return part.goesWith !== undefined && this.fits(build, part.goesWith);
  }

  /** The catalogue's Interval for the Task replacing a Standard Part on a Vehicle with this Build (shorter with a turbo). */
  defaultInterval(build: Build, code: StandardPartKey): Interval | null {
    const part = this.part(code);
    if (!part || part.kind !== build.kind || this.bundled(build, part)) return null;
    return { intervalKm: build.hasTurbo && part.turboIntervalKm ? part.turboIntervalKm : part.intervalKm, intervalMonths: part.intervalMonths };
  }

  /** The Vehicle's maintenance schedule: a Task per Standard Part that fits its Build (the oil filter goes with the oil). */
  starterTasks(build: Build): StarterTask[] {
    const fitting = this.partsOf(build.kind).filter((p) => this.fits(build, p.code));
    return fitting
      .filter((p) => !this.bundled(build, p))
      .map((p) => ({
        code: p.code,
        name: p.task ? p.task.en : p.en,
        nameFr: p.task ? p.task.fr : p.fr,
        ...this.defaultInterval(build, p.code)!,
        category: p.category,
        action: p.action,
        sameAs: [p.en, p.fr, ...this.legacyTaskNames(p.code)],
      }));
  }
}

/** The built-in catalogue, without any change of the owner's. */
export const BUILT_IN_CATALOGUE = new Catalogue();

const bySnapshot = new WeakMap<readonly CatalogueEntry[], Catalogue>();

/** The catalogue a snapshot of the garage carries, built once per snapshot. */
export function catalogueOf(snapshot: { catalogue: readonly CatalogueEntry[] }): Catalogue {
  let catalogue = bySnapshot.get(snapshot.catalogue);
  if (!catalogue) {
    catalogue = new Catalogue(snapshot.catalogue);
    bySnapshot.set(snapshot.catalogue, catalogue);
  }
  return catalogue;
}

/** What a Task named for a job does to its part: "Check…" inspects, "Clean…" cleans, "Adjust…" and "Lubricate…" adjust, otherwise replace. */
export function actionOfName(name: string): 'replace' | 'inspect' | 'clean' | 'adjust' {
  const n = name.trim().toLowerCase();
  if (/^(check|inspect|test|verify)/.test(n)) return 'inspect';
  if (/^clean/.test(n)) return 'clean';
  if (/^(adjust|lubricate|tension|align|set|bleed)/.test(n)) return 'adjust';
  return 'replace';
}
