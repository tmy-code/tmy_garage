import type { IsoDate } from './dates.ts';
import type { VehicleKind } from './schemas.ts';

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
}

export interface Service {
  id: string;
  vehicleId: string;
  date: IsoDate;
  odometer: number;
  taskIds: string[];
  notes: string | null;
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
}
