import type { IsoDate } from './dates.ts';
import type { StandardPartKey } from './catalogue.ts';
import type {
  CoverLevel,
  DefectSeverity,
  DocumentOwnerKind,
  DocumentType,
  InspectionResult,
  MotorcycleLicence,
  OvernightParking,
  PartUnit,
  Responsibility,
  VehicleKind,
  VehicleSpecKind,
} from './schemas.ts';

export interface Vehicle {
  id: string;
  kind: VehicleKind;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  registration: string | null;
  /** Date of first registration (carte grise, field B): sets when the first Technical Inspection is due. */
  firstRegistration: IsoDate | null;
  /** Registration certificate facts for a Quote Pack: VIN (field E), version (D.2), fiscal power (P.6), national type (J.1). */
  vin: string | null;
  version: string | null;
  fiscalPower: number | null;
  nationalType: string | null;
  purchaseDate: IsoDate | null;
  overnightParking: OvernightParking | null;
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
  /** Which Standard Part this is; null for another Part, named by the user. */
  standardPart: StandardPartKey | null;
  /** Only meaningful for another Part: a Standard Part is named by the interface language. */
  name: string;
  characteristics: string | null;
  partNumbers: string | null;
  unit: PartUnit;
  /** A Standard Part this Vehicle does not have (e.g. a timing chain on a belt engine). */
  notFitted: boolean;
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

/** The regulatory roadworthiness check of a Vehicle by an approved centre (contrôle technique). */
export interface TechnicalInspection {
  id: string;
  vehicleId: string;
  date: IsoDate;
  odometer: number;
  centre: string | null;
  result: InspectionResult;
  /** The deadline for the next inspection as printed on the report; estimated from the regulatory rhythm when null. */
  nextDueDate: IsoDate | null;
  notes: string | null;
  defects: InspectionDefect[];
}

export interface InspectionDefect {
  description: string;
  severity: DefectSeverity;
  /** The Service in which the user fixed it. */
  fixedServiceId: string | null;
}

/** A change that takes a Vehicle away from its factory configuration. */
export interface Modification {
  id: string;
  vehicleId: string;
  name: string;
  fittedDate: IsoDate;
  fittedOdometer: number | null;
  removedDate: IsoDate | null;
  positionId: string | null;
  declaredToInsurer: boolean;
  notes: string | null;
}

/** A person declared on Insurance Policies as allowed to drive their Vehicles. */
export interface Driver {
  id: string;
  name: string;
  birthDate: IsoDate | null;
  /** Date the car licence (B) was obtained. */
  carLicenceDate: IsoDate | null;
  motorcycleLicenceDate: IsoDate | null;
  motorcycleLicence: MotorcycleLicence | null;
  notes: string | null;
}

/** A contract with one Insurer covering one or more Vehicles, running from a start date until cancelled. */
export interface InsurancePolicy {
  id: string;
  insurer: string;
  policyNumber: string | null;
  startDate: IsoDate;
  cancelledDate: IsoDate | null;
  driverIds: string[];
  notes: string | null;
  /** Oldest first. */
  terms: PolicyTerm[];
}

/** One period of a Policy, ending at its renewal date (échéance), during which its Covers are fixed. */
export interface PolicyTerm {
  id: string;
  policyId: string;
  startDate: IsoDate;
  /** The renewal date. */
  endDate: IsoDate;
  notes: string | null;
  covers: Cover[];
}

/** What a Policy provides for one Vehicle during one Policy Term. */
export interface Cover {
  id: string;
  vehicleId: string;
  level: CoverLevel;
  /** Optional guarantees, free text (e.g. "rider gear, assistance 0 km"). */
  guarantees: string | null;
  excess: number | null;
  /** Yearly premium. */
  premium: number | null;
  /** The bonus-malus coefficient (CRM) of this Vehicle on this Policy. */
  crm: number | null;
  notes: string | null;
}

/** An incident declared to an Insurer under a Policy (sinistre). */
export interface Claim {
  id: string;
  policyId: string;
  vehicleId: string;
  driverId: string | null;
  date: IsoDate;
  responsibility: Responsibility;
  amount: number | null;
  description: string;
  notes: string | null;
}

/** A price offered by an Insurer for one Vehicle, in the same terms as a Cover. */
export interface Quote {
  id: string;
  vehicleId: string;
  insurer: string;
  date: IsoDate;
  level: CoverLevel;
  guarantees: string | null;
  excess: number | null;
  premium: number;
  validUntil: IsoDate | null;
  notes: string | null;
}

/** A stored file (PDF or photo), attached to exactly one Vehicle, Service, Modification, Technical Inspection, Policy, Cover or Claim. */
export interface GarageDocument {
  id: string;
  /** Null for a Document of a Policy, which may cover several Vehicles. */
  vehicleId: string | null;
  ownerKind: DocumentOwnerKind;
  ownerId: string;
  type: DocumentType;
  title: string | null;
  issueDate: IsoDate | null;
  expiryDate: IsoDate | null;
  fileName: string;
  contentType: string;
  size: number;
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
  inspections: TechnicalInspection[];
  modifications: Modification[];
  /** Document details only; the files are fetched on demand. */
  documents: GarageDocument[];
  drivers: Driver[];
  policies: InsurancePolicy[];
  claims: Claim[];
  quotes: Quote[];
}
