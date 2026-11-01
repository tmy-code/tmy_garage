import type { Cooling, FinalDrive, FuelType, Gearbox, PartUnit, TimingDrive, VehicleKind } from './schemas.ts';

/** The characteristics of a Vehicle that decide which Standard Parts it has. Null is unknown or not applicable. */
export interface Traits {
  fuel: FuelType | null;
  gearbox: Gearbox | null;
  timing: TimingDrive | null;
  finalDrive: FinalDrive | null;
  cooling: Cooling | null;
}

export const TRAIT_KEYS = ['fuel', 'gearbox', 'timing', 'finalDrive', 'cooling'] as const satisfies readonly (keyof Traits)[];
export type TraitKey = (typeof TRAIT_KEYS)[number];

/**
 * When a Standard Part is on a Vehicle: each listed trait must be one of the values given. A trait that is
 * unknown counts as a match, so a Vehicle whose traits are not filled in still lists every part it might have,
 * unless the part is `strict` (added after Vehicles existed, so it stays off until the trait says it fits).
 */
interface Needs {
  fuel?: readonly FuelType[];
  gearbox?: readonly Gearbox[];
  timing?: readonly TimingDrive[];
  finalDrive?: readonly FinalDrive[];
  cooling?: readonly Cooling[];
  strict?: true;
}

/** Fuels with a combustion engine. */
const BURNS = ['petrol', 'diesel', 'hybrid'] as const;

/**
 * The Standard Parts every car or every motorcycle might have, and the traits each one needs. Each Vehicle lists
 * those that fit it; what varies between Vehicles is only the Part Spec (characteristics and part numbers).
 * Keys are stored, so never rename one; names come from the interface language.
 */
export const STANDARD_PARTS = {
  motorcycle: [
    ['engineOil', 'litre', { fuel: BURNS }],
    ['oilFilter', 'piece', { fuel: BURNS }],
    ['airFilter', 'piece', { fuel: BURNS }],
    ['sparkPlugs', 'piece', { fuel: ['petrol', 'hybrid'] }],
    ['brakeFluid', 'litre', {}],
    ['coolant', 'litre', { cooling: ['liquid'] }],
    ['forkOil', 'litre', {}],
    ['frontBrakePads', 'piece', {}],
    ['rearBrakePads', 'piece', {}],
    ['chainKit', 'piece', { finalDrive: ['chain'] }],
    ['finalDriveBelt', 'piece', { finalDrive: ['belt'], strict: true }],
    ['finalDriveOil', 'litre', { finalDrive: ['shaft'], strict: true }],
    ['frontTyre', 'piece', {}],
    ['rearTyre', 'piece', {}],
    ['battery', 'piece', {}],
  ],
  car: [
    ['engineOil', 'litre', { fuel: BURNS }],
    ['oilFilter', 'piece', { fuel: BURNS }],
    ['airFilter', 'piece', { fuel: BURNS }],
    ['cabinFilter', 'piece', {}],
    ['fuelFilter', 'piece', { fuel: BURNS }],
    ['sparkPlugs', 'piece', { fuel: ['petrol', 'hybrid'] }],
    ['glowPlugs', 'piece', { fuel: ['diesel'], strict: true }],
    ['adBlue', 'litre', { fuel: ['diesel'], strict: true }],
    ['gearboxOil', 'litre', {}],
    ['gearboxFilter', 'piece', { gearbox: ['automatic'], strict: true }],
    ['clutchKit', 'piece', { gearbox: ['manual'], strict: true }],
    ['brakeFluid', 'litre', {}],
    ['coolant', 'litre', {}],
    ['acRefrigerant', 'piece', {}],
    ['frontBrakePads', 'piece', {}],
    ['rearBrakePads', 'piece', {}],
    ['frontBrakeDiscs', 'piece', {}],
    ['rearBrakeDiscs', 'piece', {}],
    ['accessoryBelt', 'piece', { fuel: BURNS }],
    ['timingBeltKit', 'piece', { fuel: BURNS, timing: ['belt'] }],
    ['timingChainKit', 'piece', { fuel: BURNS, timing: ['chain'] }],
    ['frontShocks', 'piece', {}],
    ['rearShocks', 'piece', {}],
    ['frontTyres', 'piece', {}],
    ['rearTyres', 'piece', {}],
    ['wiperBlades', 'piece', {}],
    ['battery', 'piece', {}],
  ],
} as const satisfies Record<VehicleKind, readonly (readonly [string, PartUnit, Needs])[]>;

export type StandardPartKey = (typeof STANDARD_PARTS)[VehicleKind][number][0];

const NEEDS = Object.fromEntries(
  Object.entries(STANDARD_PARTS).map(([kind, list]) => [kind, new Map<string, Needs>(list.map(([key, , needs]) => [key, needs]))]),
) as Record<VehicleKind, Map<string, Needs>>;

/** Whether a Standard Part is on a Vehicle of this kind with these traits. */
export function partFits(kind: VehicleKind, key: StandardPartKey, traits: Traits): boolean {
  const needs = NEEDS[kind].get(key);
  if (!needs) return false;
  return TRAIT_KEYS.every((trait) => {
    const allowed = needs[trait] as readonly string[] | undefined;
    if (!allowed) return true;
    const value = traits[trait];
    return value === null ? !needs.strict : allowed.includes(value);
  });
}

/** The traits that mean something for a Vehicle of this kind and fuel; the others are always null. */
export function relevantTraits(kind: VehicleKind, fuel: FuelType | null): readonly TraitKey[] {
  if (kind === 'motorcycle') return ['fuel', 'finalDrive', 'cooling'];
  return fuel === 'electric' ? ['fuel'] : ['fuel', 'gearbox', 'timing'];
}

/** The fuels a Vehicle of this kind can run on. */
export function fuelsOf(kind: VehicleKind): readonly FuelType[] {
  return kind === 'motorcycle' ? ['petrol', 'electric'] : ['petrol', 'diesel', 'hybrid', 'electric'];
}

/** The traits of a Vehicle, with those that do not apply to its kind and fuel cleared. */
export function cleanTraits(kind: VehicleKind, traits: Traits): Traits {
  const keep = relevantTraits(kind, traits.fuel);
  return Object.fromEntries(TRAIT_KEYS.map((trait) => [trait, keep.includes(trait) ? traits[trait] : null])) as unknown as Traits;
}

const ALL_KEYS = new Set<string>(Object.values(STANDARD_PARTS).flatMap((list) => list.map(([key]) => key)));

export function isStandardPartKey(key: string): key is StandardPartKey {
  return ALL_KEYS.has(key);
}

/** Position of a Standard Part in its kind's list, so screens keep the catalogue order; other Parts come after. */
export function catalogueOrder(kind: VehicleKind, key: StandardPartKey | null): number {
  const index = key === null ? -1 : STANDARD_PARTS[kind].findIndex(([k]) => k === key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Groups for listing Part Specs, in screen order. Parts that are not Standard Parts go under 'other'. */
export const PART_CATEGORIES = ['engine', 'fluids', 'brakes', 'wheels', 'electrics', 'other'] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

const CATEGORY_OF: Record<StandardPartKey, PartCategory> = {
  engineOil: 'engine',
  oilFilter: 'engine',
  airFilter: 'engine',
  fuelFilter: 'engine',
  sparkPlugs: 'engine',
  accessoryBelt: 'engine',
  timingBeltKit: 'engine',
  timingChainKit: 'engine',
  glowPlugs: 'engine',
  clutchKit: 'engine',
  gearboxOil: 'fluids',
  brakeFluid: 'fluids',
  coolant: 'fluids',
  acRefrigerant: 'fluids',
  adBlue: 'fluids',
  gearboxFilter: 'fluids',
  finalDriveOil: 'fluids',
  forkOil: 'fluids',
  frontBrakePads: 'brakes',
  rearBrakePads: 'brakes',
  frontBrakeDiscs: 'brakes',
  rearBrakeDiscs: 'brakes',
  frontShocks: 'wheels',
  rearShocks: 'wheels',
  frontTyres: 'wheels',
  rearTyres: 'wheels',
  frontTyre: 'wheels',
  rearTyre: 'wheels',
  chainKit: 'wheels',
  finalDriveBelt: 'wheels',
  cabinFilter: 'electrics',
  wiperBlades: 'electrics',
  battery: 'electrics',
};

export function partCategory(key: StandardPartKey | null): PartCategory {
  return key === null ? 'other' : CATEGORY_OF[key];
}
