import { matchesBuild, type Build, type Conditions, type PartCategory } from './catalogue.ts';
import type { SpecGroup, VehicleKind } from './schemas.ts';

/**
 * The spec lines a Vehicle usually has, so the owner only fills in the values. Like the plan templates, they are
 * chosen by the Vehicle's Build. Codes are stored on the spec lines, so never rename one.
 */
interface SpecTemplate {
  code: string;
  kind: VehicleKind;
  en: string;
  fr: string;
  group: SpecGroup;
  category: PartCategory;
  /** The details of the Build a Vehicle needs for the line to apply; none means every Vehicle of its kind. */
  when?: Conditions;
}

/** A spec line a Vehicle starts with, its value still to fill in. */
export interface StarterSpec {
  code: string;
  label: string;
  labelFr: string;
  group: SpecGroup;
  category: PartCategory;
}

const COMBUSTION: Conditions = { fuel: ['petrol', 'flexfuel', 'diesel', 'hybrid', 'phev'] };
const SPARK_IGNITION: Conditions = { fuel: ['petrol', 'flexfuel', 'hybrid', 'phev'] };
const GEARBOX: Conditions = { transmission: ['manual', 'automatic', 'dct', 'cvt', 'e_cvt'] };

export const SPEC_TEMPLATES = [
  // Cars: fluids
  { code: 'engine_oil', kind: 'car', en: 'Engine oil', fr: 'Huile moteur', group: 'fluids', category: 'engine', when: COMBUSTION },
  { code: 'gearbox_oil', kind: 'car', en: 'Gearbox oil', fr: 'Huile de boîte', group: 'fluids', category: 'transmission', when: GEARBOX },
  { code: 'reduction_gear_oil', kind: 'car', en: 'Reduction gear oil', fr: 'Huile de réducteur', group: 'fluids', category: 'transmission', when: { fuel: ['electric'] } },
  { code: 'coolant', kind: 'car', en: 'Coolant', fr: 'Liquide de refroidissement', group: 'fluids', category: 'cooling_climate' },
  { code: 'brake_fluid', kind: 'car', en: 'Brake fluid', fr: 'Liquide de frein', group: 'fluids', category: 'brakes' },
  { code: 'ac_refrigerant', kind: 'car', en: 'A/C refrigerant', fr: 'Gaz de climatisation', group: 'fluids', category: 'cooling_climate', when: { hasAc: ['true'] } },
  // Cars: parts
  { code: 'tyre_front', kind: 'car', en: 'Front tyres', fr: 'Pneus avant', group: 'parts', category: 'chassis' },
  { code: 'tyre_rear', kind: 'car', en: 'Rear tyres', fr: 'Pneus arrière', group: 'parts', category: 'chassis' },
  { code: 'oil_filter', kind: 'car', en: 'Oil filter', fr: 'Filtre à huile', group: 'parts', category: 'engine', when: COMBUSTION },
  { code: 'air_filter', kind: 'car', en: 'Air filter', fr: 'Filtre à air', group: 'parts', category: 'engine', when: COMBUSTION },
  { code: 'fuel_filter', kind: 'car', en: 'Fuel filter', fr: 'Filtre à gazole', group: 'parts', category: 'engine', when: { fuel: ['diesel'] } },
  { code: 'cabin_filter', kind: 'car', en: 'Cabin filter', fr: 'Filtre d’habitacle', group: 'parts', category: 'cooling_climate' },
  { code: 'spark_plugs', kind: 'car', en: 'Spark plugs', fr: 'Bougies', group: 'parts', category: 'engine', when: SPARK_IGNITION },
  { code: 'timing_belt_kit', kind: 'car', en: 'Timing belt kit', fr: 'Kit de distribution', group: 'parts', category: 'engine', when: { distribution: ['belt'] } },
  { code: 'brake_pads_front', kind: 'car', en: 'Front brake pads', fr: 'Plaquettes avant', group: 'parts', category: 'brakes' },
  { code: 'brake_pads_rear', kind: 'car', en: 'Rear brake pads', fr: 'Plaquettes arrière', group: 'parts', category: 'brakes' },
  { code: 'brake_discs_front', kind: 'car', en: 'Front brake discs', fr: 'Disques avant', group: 'parts', category: 'brakes' },
  { code: 'brake_discs_rear', kind: 'car', en: 'Rear brake discs', fr: 'Disques arrière', group: 'parts', category: 'brakes' },
  { code: 'battery_12v', kind: 'car', en: '12 V battery', fr: 'Batterie 12 V', group: 'parts', category: 'electrical' },
  { code: 'wipers', kind: 'car', en: 'Wiper blades', fr: 'Balais d’essuie-glace', group: 'parts', category: 'chassis' },
  // Cars: torque
  { code: 'wheel_nuts', kind: 'car', en: 'Wheel nuts', fr: 'Écrous de roue', group: 'torque', category: 'chassis' },
  { code: 'oil_drain_plug', kind: 'car', en: 'Engine oil drain plug', fr: 'Bouchon de vidange moteur', group: 'torque', category: 'engine', when: COMBUSTION },

  // Motorcycles: fluids
  { code: 'moto_engine_oil', kind: 'motorcycle', en: 'Engine oil', fr: 'Huile moteur', group: 'fluids', category: 'engine', when: COMBUSTION },
  { code: 'moto_dct_oil', kind: 'motorcycle', en: 'DCT oil', fr: 'Huile de boîte DCT', group: 'fluids', category: 'transmission', when: { transmission: ['dct'] } },
  { code: 'moto_final_drive_oil', kind: 'motorcycle', en: 'Final drive oil', fr: 'Huile de transmission finale', group: 'fluids', category: 'transmission', when: { finalDrive: ['shaft', 'gear'] } },
  { code: 'moto_coolant', kind: 'motorcycle', en: 'Coolant', fr: 'Liquide de refroidissement', group: 'fluids', category: 'cooling_climate', when: { cooling: ['liquid'] } },
  { code: 'moto_brake_fluid', kind: 'motorcycle', en: 'Brake fluid', fr: 'Liquide de frein', group: 'fluids', category: 'brakes' },
  { code: 'moto_clutch_fluid', kind: 'motorcycle', en: 'Hydraulic clutch fluid', fr: 'Liquide d’embrayage hydraulique', group: 'fluids', category: 'transmission', when: { hasHydraulicClutch: ['true'] } },
  { code: 'moto_fork_oil', kind: 'motorcycle', en: 'Fork oil', fr: 'Huile de fourche', group: 'fluids', category: 'chassis' },
  // Motorcycles: parts
  { code: 'moto_tyre_front', kind: 'motorcycle', en: 'Front tyre', fr: 'Pneu avant', group: 'parts', category: 'chassis' },
  { code: 'moto_tyre_rear', kind: 'motorcycle', en: 'Rear tyre', fr: 'Pneu arrière', group: 'parts', category: 'chassis' },
  { code: 'moto_oil_filter', kind: 'motorcycle', en: 'Oil filter', fr: 'Filtre à huile', group: 'parts', category: 'engine', when: COMBUSTION },
  { code: 'moto_air_filter', kind: 'motorcycle', en: 'Air filter', fr: 'Filtre à air', group: 'parts', category: 'engine', when: COMBUSTION },
  { code: 'moto_spark_plugs', kind: 'motorcycle', en: 'Spark plugs', fr: 'Bougies', group: 'parts', category: 'engine', when: COMBUSTION },
  { code: 'moto_chain', kind: 'motorcycle', en: 'Chain', fr: 'Chaîne', group: 'parts', category: 'transmission', when: { finalDrive: ['chain'] } },
  { code: 'moto_sprockets', kind: 'motorcycle', en: 'Sprockets', fr: 'Pignon et couronne', group: 'parts', category: 'transmission', when: { finalDrive: ['chain'] } },
  { code: 'moto_drive_belt', kind: 'motorcycle', en: 'Final drive belt', fr: 'Courroie de transmission finale', group: 'parts', category: 'transmission', when: { finalDrive: ['belt'] } },
  { code: 'moto_cvt_belt', kind: 'motorcycle', en: 'CVT drive belt', fr: 'Courroie de variateur', group: 'parts', category: 'transmission', when: { transmission: ['cvt'] } },
  { code: 'moto_cvt_rollers', kind: 'motorcycle', en: 'Variator rollers', fr: 'Galets de variateur', group: 'parts', category: 'transmission', when: { transmission: ['cvt'] } },
  { code: 'moto_brake_pads_front', kind: 'motorcycle', en: 'Front brake pads', fr: 'Plaquettes avant', group: 'parts', category: 'brakes' },
  { code: 'moto_brake_pads_rear', kind: 'motorcycle', en: 'Rear brake pads', fr: 'Plaquettes arrière', group: 'parts', category: 'brakes' },
  { code: 'moto_battery_12v', kind: 'motorcycle', en: '12 V battery', fr: 'Batterie 12 V', group: 'parts', category: 'electrical' },
  // Motorcycles: torque and other
  { code: 'moto_oil_drain_plug', kind: 'motorcycle', en: 'Engine oil drain plug', fr: 'Bouchon de vidange moteur', group: 'torque', category: 'engine', when: COMBUSTION },
  { code: 'moto_axle_front', kind: 'motorcycle', en: 'Front axle nut', fr: 'Écrou d’axe de roue avant', group: 'torque', category: 'chassis' },
  { code: 'moto_axle_rear', kind: 'motorcycle', en: 'Rear axle nut', fr: 'Écrou d’axe de roue arrière', group: 'torque', category: 'chassis' },
  { code: 'moto_chain_slack', kind: 'motorcycle', en: 'Chain slack', fr: 'Tension de la chaîne', group: 'other', category: 'transmission', when: { finalDrive: ['chain'] } },
] as const satisfies readonly SpecTemplate[];

/** The spec lines that fit a Vehicle's Build, in the order of the list. */
export function starterSpecs(build: Build): StarterSpec[] {
  return (SPEC_TEMPLATES as readonly SpecTemplate[])
    .filter((t) => t.kind === build.kind && matchesBuild(build, t.when ?? {}))
    .map((t) => ({ code: t.code, label: t.en, labelFr: t.fr, group: t.group, category: t.category }));
}
