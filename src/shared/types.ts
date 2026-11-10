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
  /** The equipment tags the owner keeps in Notion (e.g. "Transmission chaîne"); they decide which catalogue tasks apply. Read-only here. */
  equipment: string[];
  /** The Vehicle's page in the Notion Véhicules database, once the sync has seen it. */
  notionPageId?: string | null;
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
  /** Paused on this Vehicle: no status. */
  switchedOff: boolean;
  /** Set when the Task comes from a standard Plan Template; null for a Task the owner added. */
  templateCode?: string | null;
  /** The Catalogue Task (from Notion) this Task follows; its name, action, intervals and notes are then Notion's. */
  refTaskId?: string | null;
  /** The Notion Plan page behind it, once one exists. */
  notionPlanId?: string | null;
}

/** Whether Notion owns this Task's name, action, intervals and notes (it is linked to a Catalogue Task). */
export function isNotionOwned(task: Pick<MaintenanceTask, 'refTaskId'>): boolean {
  return !!task.refTaskId;
}

/** A fluid or a part: what a Consumable Type is. */
export type Family = 'fluid' | 'part';

/** A task of the Notion catalogue: what to do, when it applies, and what it needs. Read-only. */
export interface RefTask {
  id: string;
  name: string;
  action: 'inspect' | 'replace';
  /** Equipment tags a vehicle must all have; empty applies to every vehicle. */
  applicableIf: string[];
  defaultKm: number | null;
  defaultMonths: number | null;
  consumableTypeIds: string[];
  componentTypeIds: string[];
  toolIds: string[];
  /** Plain text. */
  instructions: string | null;
  notionId: string;
}

export interface ComponentType {
  id: string;
  name: string;
  category: string | null;
  notes: string | null;
  notionId: string;
}

export interface ConsumableType {
  id: string;
  name: string;
  category: string | null;
  family: Family | null;
  notes: string | null;
  notionId: string;
}

export interface Product {
  id: string;
  typeId: string | null;
  name: string;
  brand: string | null;
  reference: string | null;
  supplier: string | null;
  /** A default price, not a purchase. */
  price: number | null;
  notes: string | null;
  notionId: string;
}

export interface Tool {
  id: string;
  name: string;
  kind: string | null;
  size: string | null;
  owned: boolean;
  price: number | null;
  notes: string | null;
  notionId: string;
}

/** What one Vehicle takes of a Consumable Type: specification, OEM reference, capacity, quantity, products. */
export interface VehicleConsumable {
  id: string;
  vehicleId: string;
  name: string;
  typeId: string | null;
  /** Extension point: a link to a spec, unused for now. */
  specId?: string | null;
  /** The specification as written in Notion (grade, norm, size). */
  specification: string | null;
  oemRef: string | null;
  capacity: string | null;
  quantity: number | null;
  compatibleProductIds: string[];
  chosenProductId: string | null;
  status: 'confirmed' | 'to_confirm' | null;
  notionId: string;
}

/** One spec of a Vehicle from Notion (a torque, a size, a capacity). Read-only. */
export interface VehicleSpec {
  id: string;
  vehicleId: string;
  label: string;
  componentTypeId: string | null;
  category: string | null;
  /** A number or text, as written in Notion. */
  value: string;
  unit: string | null;
  source: string | null;
  status: 'confirmed' | 'to_confirm' | null;
  notionId: string;
}

/** How the last Notion sync went, for the Settings card. */
export interface NotionStatus {
  lastSyncAt: string | null;
  lastError: string | null;
  warnings: string[];
  /** Tasks paused by the last sync because their Plan page vanished or they stopped applying. */
  pausedTasks: number;
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
  /** The Consumable Type and Product it was, from the Notion referentials (types only for now). */
  consumableTypeId?: string | null;
  productId?: string | null;
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

/**
 * One visit to the pump. The price per litre is never stored: work it out with fillupUnitPrice.
 * A top-up (fullTank false) does not fill the tank, so it gives no consumption of its own.
 */
export interface Fillup {
  id: string;
  vehicleId: string;
  date: IsoDate;
  /** Null when the owner did not note it; such a Fill-up gives no distance. */
  odometer: number | null;
  litres: number;
  /** What was paid for the whole fill-up. */
  totalPaid: number;
  fullTank: boolean;
  notes: string | null;
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
  /** The fuel log of every Vehicle. */
  fillups: Fillup[];
  specLines: SpecLine[];
  vehicleParts: VehiclePart[];
  /** The purchase log of every part. */
  purchases: Purchase[];
  /** Document details only; the files are fetched on demand. */
  documents: GarageDocument[];
  /** The owner's changes to the parts catalogue; see catalogueOf. */
  catalogue: CatalogueEntry[];
  /** The Notion referentials, read-only on the phone. */
  refTasks: RefTask[];
  componentTypes: ComponentType[];
  consumableTypes: ConsumableType[];
  products: Product[];
  tools: Tool[];
  vehicleConsumables: VehicleConsumable[];
  vehicleSpecs: VehicleSpec[];
  /** Null when the Notion sync is not set up on the server. */
  notion: NotionStatus | null;
}
