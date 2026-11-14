// Which Catalogue Tasks apply to a Vehicle, and what a task needs: pure, shared by the server (which derives plans) and
// the screens (which show the needs offline).
import type { ComponentType, ConsumableType, Product, RefTask, Snapshot, VehicleConsumable, ComponentSpec } from './types.ts';
import { refKey } from './workshop.ts';

/** The Catalogue Tasks whose every "Applicable si" tag is among the equipment; a task with no tag applies to all. */
export function applicableRefTasks(refTasks: RefTask[], equipment: string[]): RefTask[] {
  const have = new Set(equipment.map(refKey));
  return refTasks.filter((r) => r.applicableIf.every((tag) => have.has(refKey(tag))));
}

/** An Interval: the Plan's own for this Vehicle, else the Catalogue Task's default. */
export function resolveInterval(
  ref: Pick<RefTask, 'defaultKm' | 'defaultMonths'>,
  plan: { intervalKm: number | null; intervalMonths: number | null } | null,
): { intervalKm: number | null; intervalMonths: number | null } {
  return {
    intervalKm: plan?.intervalKm ?? ref.defaultKm,
    intervalMonths: plan?.intervalMonths ?? ref.defaultMonths,
  };
}

export interface RequiredConsumable {
  type: ConsumableType;
  /** What this Vehicle takes of the type; empty when Notion lists nothing for it. */
  rows: VehicleConsumable[];
  /** The specification of the first row that has one. */
  spec: string | null;
  /** The chosen product first, then the compatible ones, then the other products of the type. */
  products: Product[];
}

/** The Consumable Types a Task needs, with this Vehicle's details. Nothing for an inspection or a Task not linked to the catalogue. */
export function requiredConsumables(snapshot: Snapshot, vehicleId: string, taskId: string): RequiredConsumable[] {
  const task = snapshot.tasks.find((t) => t.id === taskId);
  if (!task?.refTaskId) return [];
  const ref = snapshot.refTasks.find((r) => r.id === task.refTaskId);
  if (!ref || ref.action === 'inspect' || task.action === 'inspect') return [];
  const result: RequiredConsumable[] = [];
  for (const typeId of ref.consumableTypeIds) {
    const type = snapshot.consumableTypes.find((c) => c.id === typeId);
    if (!type) continue;
    const rows = snapshot.vehicleConsumables.filter((c) => c.vehicleId === vehicleId && c.typeId === typeId);
    const byId = new Map(snapshot.products.map((p) => [p.id, p]));
    const ordered: Product[] = [];
    const add = (id: string | undefined | null) => {
      const p = id ? byId.get(id) : undefined;
      if (p && !ordered.includes(p)) ordered.push(p);
    };
    for (const r of rows) add(r.chosenProductId);
    for (const r of rows) for (const id of r.compatibleProductIds) add(id);
    for (const p of snapshot.products) if (p.typeId === typeId) add(p.id);
    result.push({ type, rows, spec: rows.find((r) => r.specification)?.specification ?? null, products: ordered });
  }
  return result;
}

/** Whether a Spec is a torque value, by its unit (N·m) or its category. */
export function isTorqueSpec(spec: Pick<ComponentSpec, 'unit' | 'category'>): boolean {
  const text = `${refKey(spec.unit)} ${refKey(spec.category)}`;
  return /\bn[^a-z0-9]?m\b/.test(text) || /couple|torque/.test(text);
}

/** The torque values of the Components a Task works on, for this Vehicle. */
export function torqueSpecs(snapshot: Snapshot, vehicleId: string, taskId: string): { component: ComponentType; spec: ComponentSpec }[] {
  const task = snapshot.tasks.find((t) => t.id === taskId);
  if (!task?.refTaskId) return [];
  const ref = snapshot.refTasks.find((r) => r.id === task.refTaskId);
  if (!ref) return [];
  const result: { component: ComponentType; spec: ComponentSpec }[] = [];
  for (const componentId of ref.componentTypeIds) {
    const component = snapshot.componentTypes.find((c) => c.id === componentId);
    if (!component) continue;
    for (const spec of snapshot.componentSpecs) {
      if (spec.vehicleId === vehicleId && spec.componentTypeId === componentId && isTorqueSpec(spec)) result.push({ component, spec });
    }
  }
  return result;
}
