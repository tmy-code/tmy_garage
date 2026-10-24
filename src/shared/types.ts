import type { IsoDate } from './dates.ts';
import type { PartUnit, VehicleKind, VehicleSpecKind } from './schemas.ts';

export interface Vehicle {
  id: string;
  kind: VehicleKind;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  registration: string | null;
  status: 'owned' | 'sold';
  soldDate: IsoDate | null;
  soldOdometer: number | null;
  soldPrice: number | null;
}

export interface MaintenanceTask {
  id: string;
  vehicleId: string;
  name: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  /** The Official Interval from the Vehicle's Service Schedule; the stricter of the two applies. */
  officialIntervalKm: number | null;
  officialIntervalMonths: number | null;
  /** When the Task was last done before the garage started tracking it; superseded by any Service. */
  baselineDate: IsoDate | null;
  baselineOdometer: number | null;
  /** Free-text steps, warnings and links for doing the job. */
  workshopNotes: string | null;
  requiredParts: RequiredPart[];
  /** Required Tools, in checklist order. */
  tools: string[];
  /** Vehicle Specs (torque values, pressures…) the job involves. */
  specIds: string[];
}

/** A Part Spec and the quantity of it a Maintenance Task needs. */
export interface RequiredPart {
  partSpecId: string;
  quantity: number;
}

/** Technical reference data about a Vehicle; a Torque Spec when kind is 'torque'. */
export interface VehicleSpec {
  id: string;
  vehicleId: string;
  kind: VehicleSpecKind;
  name: string;
  value: string;
  notes: string | null;
}

/** What a Part a Vehicle takes must be, without quantity. */
export interface PartSpec {
  id: string;
  vehicleId: string;
  name: string;
  characteristics: string | null;
  partNumbers: string | null;
  unit: PartUnit;
}

/** A named location on a Vehicle that holds one Part at a time. */
export interface FitmentPosition {
  id: string;
  vehicleId: string;
  name: string;
}

/** The actual Part fitted or consumed during a Service. */
export interface PartUsed {
  partSpecId: string | null;
  positionId: string | null;
  description: string;
  partNumber: string | null;
  quantity: number;
  unit: PartUnit;
  price: number | null;
  supplier: string | null;
}

export interface Service {
  id: string;
  vehicleId: string;
  date: IsoDate;
  odometer: number;
  taskIds: string[];
  notes: string | null;
  partsUsed: PartUsed[];
}

export interface OdometerReading {
  id: string;
  vehicleId: string;
  date: IsoDate;
  odometer: number;
}

/** Everything the phone needs to work offline in the garage. */
export interface Snapshot {
  vehicles: Vehicle[];
  tasks: MaintenanceTask[];
  services: Service[];
  readings: OdometerReading[];
  vehicleSpecs: VehicleSpec[];
  partSpecs: PartSpec[];
  positions: FitmentPosition[];
}
