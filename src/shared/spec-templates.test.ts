import { describe, expect, it } from 'vitest';
import { PART_TEMPLATES } from './catalogue.ts';
import { SPEC_TEMPLATES } from './spec-templates.ts';

/**
 * The owner buys parts and fluids from the spec lines, so every Standard Part (a thing the maintenance plan has the
 * owner buy) needs a usual spec line. Where one line covers several parts (one gearbox oil for every kind of gearbox),
 * it is named here. A new Standard Part fails this test until its spec line is added.
 */
const SPEC_OF_PART: Record<string, string> = {
  tires_front: 'tyre_front',
  tires_rear: 'tyre_rear',
  shock_absorbers_front: 'shock_absorbers_front',
  shock_absorbers_rear: 'shock_absorbers_rear',
  brake_pads_front: 'brake_pads_front',
  brake_pads_rear: 'brake_pads_rear',
  brake_discs_front: 'brake_discs_front',
  brake_discs_rear: 'brake_discs_rear',
  brake_fluid: 'brake_fluid',
  wipers: 'wipers',
  cabin_filter: 'cabin_filter',
  battery_12v: 'battery_12v',
  battery_12v_agm: 'battery_12v',
  engine_oil: 'engine_oil',
  oil_filter: 'oil_filter',
  air_filter: 'air_filter',
  drive_belt: 'drive_belt',
  coolant: 'coolant',
  timing_belt_kit: 'timing_belt_kit',
  spark_plugs: 'spark_plugs',
  fuel_filter: 'fuel_filter',
  clutch_kit: 'clutch_kit',
  clutch_fluid: 'clutch_fluid',
  atf: 'gearbox_oil',
  dct_oil: 'gearbox_oil',
  cvt_fluid: 'gearbox_oil',
  ecvt_fluid: 'gearbox_oil',
  diff_oil_rear: 'diff_oil_rear',
  diff_oil_front: 'diff_oil_front',
  transfer_case_oil: 'transfer_case_oil',
  inverter_coolant: 'inverter_coolant',
  ev_battery_coolant: 'ev_battery_coolant',
  ev_reduction_gear_oil: 'reduction_gear_oil',
  ev_reduction_gear_oil_rear: 'reduction_gear_oil_rear',
  ac_dryer: 'ac_dryer',

  moto_tire_front: 'moto_tyre_front',
  moto_tire_rear: 'moto_tyre_rear',
  moto_brake_pads_front: 'moto_brake_pads_front',
  moto_brake_pads_rear: 'moto_brake_pads_rear',
  moto_brake_discs_front: 'moto_brake_discs_front',
  moto_brake_discs_rear: 'moto_brake_discs_rear',
  moto_brake_fluid: 'moto_brake_fluid',
  moto_brake_hoses: 'moto_brake_hoses',
  moto_fork_oil: 'moto_fork_oil',
  moto_fork_seals: 'moto_fork_seals',
  moto_battery: 'moto_battery_12v',
  moto_engine_oil: 'moto_engine_oil',
  moto_oil_filter: 'moto_oil_filter',
  moto_air_filter: 'moto_air_filter',
  moto_spark_plugs: 'moto_spark_plugs',
  moto_coolant: 'moto_coolant',
  moto_clutch_plates: 'moto_clutch_plates',
  moto_clutch_fluid: 'moto_clutch_fluid',
  moto_dct_oil: 'moto_dct_oil',
  moto_cvt_belt: 'moto_cvt_belt',
  moto_cvt_rollers: 'moto_cvt_rollers',
  moto_chain: 'moto_chain',
  moto_sprockets: 'moto_sprockets',
  moto_drive_belt: 'moto_drive_belt',
  moto_shaft_oil: 'moto_final_drive_oil',
  moto_gear_oil: 'moto_final_drive_oil',
  moto_ev_coolant: 'moto_ev_coolant',
};

describe('usual spec lines', () => {
  const specs = new Map<string, { kind: string }>(SPEC_TEMPLATES.map((s) => [s.code, s]));

  it('has a line for every Standard Part, of the same kind of Vehicle', () => {
    for (const part of PART_TEMPLATES) {
      // A check that replaces no part (tyre pressure) has nothing to buy, so no spec line is needed for it.
      if (part.unit === null) continue;
      const code = SPEC_OF_PART[part.code];
      expect(code, `no spec line named for the part ${part.code}`).toBeDefined();
      expect(specs.get(code!)?.kind, `spec line ${code} for the part ${part.code}`).toBe(part.kind);
    }
  });

  it('names no part that does not exist', () => {
    const parts = new Set<string>(PART_TEMPLATES.map((p) => p.code));
    for (const code of Object.keys(SPEC_OF_PART)) expect(parts.has(code), code).toBe(true);
  });

  it('has no two lines with the same code', () => {
    expect(specs.size).toBe(SPEC_TEMPLATES.length);
  });
});
