import type { IsoDate } from './dates.ts';
import type { CatalogueEntry, PartCategory, VehicleSpecs } from './catalogue.ts';
import type { DocumentOwnerKind, DocumentType, PartUnit, PerformedBy, ServiceKind, SpecGroup, TaskAction, VehicleKind } from './schemas.ts';
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
  /** When it first went on the road (first registration). */
  firstRegistrationDate: IsoDate | null;
  /** When the owner bought it. */
  purchaseDate: IsoDate | null;
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
  /** Set when the Task comes from a standard Plan Template; null for a Task the owner added. */
  templateCode?: string | null;
}

/** One line of a Vehicle's factory specs: a fluid capacity or grade, a part size or reference, a torque value. */
export interface SpecLine {
  id: string;
  vehicleId: string;
  label: string;
  value: string;
  /** The manufacturer's (OEM) reference. */
  oem: string | null;
  group: SpecGroup;
  /** The category it is listed under; empty is 'other'. */
  category: PartCategory | null;
  sort: number;
}

/** A component used in a Service, with its brand and variant in the description. */
export interface PartUsed {
  description: string;
  partNumber: string | null;
  quantity: number;
  unit: PartUnit;
  /** What was paid per piece or per litre. */
  price?: number | null;
  /** The Vehicle Part it was picked from; a copy of its details is kept here, so the history never changes. */
  partId?: string | null;
  /** Only when sending a Service: also keep it in the Vehicle's parts list (under `partId`). */
  remember?: boolean;
}

/** A part or fluid the owner buys for one Vehicle, picked when logging a Service. */
export interface VehiclePart {
  id: string;
  vehicleId: string;
  /** Brand and variant, such as "Motul 7100 10W-40". */
  name: string;
  partNumber: string | null;
  unit: PartUnit;
  /** How much a Service usually uses. */
  quantity: number;
  /** Per piece or per litre; empty when unknown. */
  price: number | null;
  /** The Task it is usually bought for; its parts are suggested first when that Task is ticked. */
  taskId: string | null;
  /** The Spec Line it is for, shown next to it; nothing is copied from it. */
  specLineId: string | null;
  /** To buy (wanted or planned, or to be bought again) rather than Bought. */
  toBuy: boolean;
  /** Shop, link, comparison. */
  notes: string | null;
}

/** One occasion on which the owner bought a Vehicle Part; together they are the part's purchase log. */
export interface Purchase {
  id: string;
  partId: string;
  vehicleId: string;
  date: IsoDate;
  /** In the part's unit. */
  quantity: number;
  /** For the goods only, as on the receipt; never includes delivery fees. */
  totalPaid: number;
  shop: string | null;
  /** Apart from totalPaid. */
  deliveryFees: number | null;
  notes: string | null;
}

/** What a unit cost in a Purchase: Total paid over the quantity. Worked out, never stored. */
export function purchaseUnitPrice(p: Pick<Purchase, 'quantity' | 'totalPaid'>): number {
  return p.totalPaid / p.quantity;
}

export interface Service {
  id: string;
  vehicleId: string;
  date: IsoDate;
  /** Null when the Service's Tasks are all time-based and the owner left it out. */
  odometer: number | null;
  taskIds: string[];
  notes: string | null;
  /** Maintenance of the plan, or a repair outside it. */
  kind: ServiceKind;
  /** What a repair was, in a few words. */
  title: string | null;
  /** The category a repair is filed under; empty is 'other'. */
  category: PartCategory | null;
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
  vehicleParts: VehiclePart[];
  /** The purchase log of every part. */
  purchases: Purchase[];
  /** Document details only; the files are fetched on demand. */
  documents: GarageDocument[];
  /** The owner's changes to the parts catalogue; see catalogueOf. */
  catalogue: CatalogueEntry[];
}
