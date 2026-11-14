// What the maintenance session screen needs from the Notion reference data, as pure logic: which products to offer for a
// required consumable type, and what picking one fills in. No React, nothing from the client: the server image can load it.
import { requiredConsumables, torqueSpecs, type RequiredConsumable } from './applicability.ts';
import type { PartUnit } from './schemas.ts';
import type { ComponentType, ConsumableType, Product, Snapshot, ItemSpec, ComponentSpec } from './types.ts';

export type ProductGroup = 'chosen' | 'compatible' | 'other';

export interface ProductChoice {
  product: Product;
  group: ProductGroup;
}

/** A whole or decimal number written alone ("3", "3.2", "3,2"), else null: "3 L" or "au besoin" are not plain numbers. */
export function parsePlainNumber(text: string | number | null | undefined): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  if (typeof text !== 'string') return null;
  const s = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** The products to offer for one required type: the vehicle's chosen one first, then the compatible ones, then the rest of the type. */
export function productChoices(need: RequiredConsumable): ProductChoice[] {
  const chosen = new Set(need.rows.flatMap((r) => (r.chosenProductId ? [r.chosenProductId] : [])));
  const compatible = new Set(need.rows.flatMap((r) => r.compatibleProductIds));
  return need.products.map((product) => ({ product, group: chosen.has(product.id) ? 'chosen' : compatible.has(product.id) ? 'compatible' : 'other' }));
}

/** The quantity a vehicle takes of a type, when it is a plain number: the row's quantity, else a capacity written as a bare number. */
export function usualQuantity(rows: ItemSpec[]): number | null {
  for (const row of rows) {
    const quantity = parsePlainNumber(row.quantity);
    if (quantity !== null && quantity > 0) return quantity;
  }
  for (const row of rows) {
    const capacity = parsePlainNumber(row.capacity);
    if (capacity !== null && capacity > 0) return capacity;
  }
  return null;
}

export interface Prefill {
  description: string;
  partNumber: string;
  /** Empty when the vehicle gives no plain-number quantity: the form keeps its own default. */
  quantity: string;
  unit: PartUnit | null;
  price: string;
  consumableTypeId: string;
  productId: string;
}

/**
 * What picking a product fills in, all of it still editable: its name (not brand + name; its brand and reference stand in
 * only when the name is empty), its reference, the vehicle's usual quantity, the product's default price, the unit its
 * family implies (a fluid in litres, a part in pieces).
 */
export function prefillFromProduct(product: Product, type: ConsumableType, rows: ItemSpec[]): Prefill {
  const quantity = usualQuantity(rows);
  return {
    description: product.name || [product.brand, product.reference].filter(Boolean).join(' '),
    partNumber: product.reference ?? '',
    quantity: quantity === null ? '' : String(quantity),
    unit: type.family === 'fluid' ? 'litre' : type.family === 'part' ? 'piece' : null,
    price: product.price === null ? '' : String(product.price),
    consumableTypeId: type.id,
    productId: product.id,
  };
}

/** The same for a part typed by hand for a required type: only the type and its unit and usual quantity are known. */
export function prefillForType(type: ConsumableType, rows: ItemSpec[]): Omit<Prefill, 'description' | 'partNumber' | 'price' | 'productId'> & { productId: null } {
  const quantity = usualQuantity(rows);
  return {
    quantity: quantity === null ? '' : String(quantity),
    unit: type.family === 'fluid' ? 'litre' : type.family === 'part' ? 'piece' : null,
    consumableTypeId: type.id,
    productId: null,
  };
}

/** One required Consumable Type of a session, with every ticked Task that needs it. */
export interface MergedNeed {
  type: ConsumableType;
  /** The ticked Tasks that need this type, in the order given. */
  taskIds: string[];
  rows: ItemSpec[];
  choices: ProductChoice[];
  /** The torque values of the components of those Tasks, each once. */
  torque: { component: ComponentType; spec: ComponentSpec }[];
}

/**
 * The needs of the ticked Tasks, one entry per Consumable Type however many Tasks ask for it (two Tasks that both change the
 * oil share one block). Nothing for an inspection, a Task needing nothing, or a Task that does not follow the catalogue.
 */
export function mergeNeeds(snapshot: Snapshot, vehicleId: string, taskIds: string[]): MergedNeed[] {
  const merged = new Map<string, MergedNeed>();
  for (const taskId of taskIds) {
    const needs = requiredConsumables(snapshot, vehicleId, taskId);
    if (needs.length === 0) continue;
    const torque = torqueSpecs(snapshot, vehicleId, taskId);
    for (const need of needs) {
      let entry = merged.get(need.type.id);
      if (!entry) merged.set(need.type.id, (entry = { type: need.type, taskIds: [], rows: need.rows, choices: productChoices(need), torque: [] }));
      entry.taskIds.push(taskId);
      for (const t of torque) if (!entry.torque.some((x) => x.spec.id === t.spec.id)) entry.torque.push(t);
    }
  }
  return [...merged.values()];
}

export interface ProductOption extends ProductChoice {
  /** Already has a line in the form: still allowed (two filters can be right), but marked. */
  added: boolean;
}

/** The product choices, each flagged when the form already has a line for that product. */
export function markAdded(choices: ProductChoice[], addedProductIds: (string | null)[]): ProductOption[] {
  const added = new Set(addedProductIds.filter((id): id is string => id !== null));
  return choices.map((c) => ({ ...c, added: added.has(c.product.id) }));
}

/** A number written for the form's own field: with the comma of the language when it uses one. */
export function formFigure(value: number | string, decimalComma: boolean): string {
  const s = String(value);
  return decimalComma ? s.replace('.', ',') : s;
}
