import type { IsoDate } from './dates.ts';
import type { CatalogueEntry, PartCategory, VehicleSpecs } from './catalogue.ts';
import type { DocumentOwnerKind, DocumentType, PartUnit, PerformedBy, SpecGroup, TaskAction, VehicleKind } from './schemas.ts';
/** A car or motorcycle; what it is built with (its Build) comes from VehicleSpecs. */
export interface Vehicle extends VehicleSpecs {
  id: string;
  kind: VehicleKind;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  /** Vehicle identification number. */
  vin: string | null;
  status: 'owned' | 'sold';
  /** Whether it has a card on the garage page, whatever its status; selling it hides it, and the user can change either. */
  onGaragePage: boolean;
  soldDate: IsoDate | null;
  soldOdometer: number | null;
  soldPrice: number | null;
}

export interface MaintenanceTask {
  id: string;
  vehicleId: string;
  /** The name in English; nameFr is shown instead in French when given. */
  name: string;
  nameFr: string | null;
  /** What is done to the part. */
  action: TaskAction;
  intervalKm: number | null;
  intervalMonths: number | null;
  /** When the Task was last done before the garage started tracking it; superseded by any Service. */
  baselineDate: IsoDate | null;
  baselineOdometer: number | null;
  /** Instructions, torque and fluid reminders, standard part codes. */
  notes: string | null;
  /** The owner's category; empty is 'other'. */
  category: PartCategory | null;
  /** Paused on this Vehicle: no status and no reminder. */
  switchedOff: boolean;
}

/** One line of a Vehicle's factory specs: a fluid capacity or grade, a part size or reference, a torque value. */
export interface SpecLine {
  id: string;
  vehicleId: string;
  label: string;
  value: string;
  group: SpecGroup;
  sort: number;
}

/** A component used in a Service, with its brand and variant in the description. */
export interface PartUsed {
  description: string;
  partNumber: string | null;
  quantity: number;
  unit: PartUnit;
}

export interface Service {
  id: string;
  vehicleId: string;
  date: IsoDate;
  /** Null when the Service's Tasks are all time-based and the owner left it out. */
  odometer: number | null;
  taskIds: string[];
  notes: string | null;
  /** Who did the work. */
  performedBy: PerformedBy;
  /** Parts and labour, in one amount. */
  totalCost: number | null;
  partsUsed: PartUsed[];
}

export interface OdometerReading {
  id: string;
  vehicleId: string;
  date: IsoDate;
  odometer: number;
}

/** A stored file (PDF or photo), attached to one Vehicle or Service; on a Service it is the receipt. */
export interface GarageDocument {
  id: string;
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
  specLines: SpecLine[];
  /** Document details only; the files are fetched on demand. */
  documents: GarageDocument[];
  /** The owner's changes to the parts catalogue; see catalogueOf. */
  catalogue: CatalogueEntry[];
}
