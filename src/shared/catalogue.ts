import type { PartUnit, VehicleKind } from './schemas.ts';

/**
 * The Standard Parts every car or every motorcycle has. Each Vehicle lists those of its kind; what varies
 * between Vehicles is only the Part Spec (characteristics and part numbers). Keys are stored, so never
 * rename one; names come from the interface language.
 */
export const STANDARD_PARTS = {
  motorcycle: [
    ['engineOil', 'litre'],
    ['oilFilter', 'piece'],
    ['airFilter', 'piece'],
    ['sparkPlugs', 'piece'],
    ['brakeFluid', 'litre'],
    ['coolant', 'litre'],
    ['forkOil', 'litre'],
    ['frontBrakePads', 'piece'],
    ['rearBrakePads', 'piece'],
    ['chainKit', 'piece'],
    ['frontTyre', 'piece'],
    ['rearTyre', 'piece'],
    ['battery', 'piece'],
  ],
  car: [
    ['engineOil', 'litre'],
    ['oilFilter', 'piece'],
    ['airFilter', 'piece'],
    ['cabinFilter', 'piece'],
    ['fuelFilter', 'piece'],
    ['sparkPlugs', 'piece'],
    ['gearboxOil', 'litre'],
    ['brakeFluid', 'litre'],
    ['coolant', 'litre'],
    ['acRefrigerant', 'piece'],
    ['frontBrakePads', 'piece'],
    ['rearBrakePads', 'piece'],
    ['frontBrakeDiscs', 'piece'],
    ['rearBrakeDiscs', 'piece'],
    ['accessoryBelt', 'piece'],
    ['timingBeltKit', 'piece'],
    ['timingChainKit', 'piece'],
    ['frontShocks', 'piece'],
    ['rearShocks', 'piece'],
    ['frontTyres', 'piece'],
    ['rearTyres', 'piece'],
    ['wiperBlades', 'piece'],
    ['battery', 'piece'],
  ],
} as const satisfies Record<VehicleKind, readonly (readonly [string, PartUnit])[]>;

export type StandardPartKey = (typeof STANDARD_PARTS)[VehicleKind][number][0];

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
  gearboxOil: 'fluids',
  brakeFluid: 'fluids',
  coolant: 'fluids',
  acRefrigerant: 'fluids',
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
  cabinFilter: 'electrics',
  wiperBlades: 'electrics',
  battery: 'electrics',
};

export function partCategory(key: StandardPartKey | null): PartCategory {
  return key === null ? 'other' : CATEGORY_OF[key];
}
