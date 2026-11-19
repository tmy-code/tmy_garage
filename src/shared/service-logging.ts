import type { ComponentUsed, MaintenanceTask, Service, VehicleItem } from './types.ts';
import type { Catalogue } from './catalogue.ts';

/** What logging a Service needs to know about one Vehicle. */
export interface ServiceLoggingContext {
  /** Only this Vehicle's Tasks. */
  tasks: readonly Pick<MaintenanceTask, 'id' | 'intervalKm' | 'templateCode'>[];
  /** Only this Vehicle's items. */
  items: readonly Pick<VehicleItem, 'id' | 'name' | 'partNumber'>[];
  catalogue: Pick<Catalogue, 'includedWith'>;
}

export interface LogServiceOptions {
  newId: () => string;
  /** False when the caller cannot add to the items list: `remember` is then ignored. */
  canAddToItems: boolean;
}

export type ServiceLoggingError =
  | { code: 'task-not-on-vehicle'; taskId: string }
  | { code: 'repair-needs-title' }
  | { code: 'maintenance-needs-task' }
  | { code: 'odometer-needed'; taskIds: string[] };

export type NewVehicleItem = Pick<VehicleItem, 'id' | 'vehicleId' | 'name' | 'partNumber' | 'unit' | 'quantity' | 'price' | 'taskId'>;

export type LogServiceResult =
  | { ok: true; service: Service; newItems: NewVehicleItem[] }
  | { ok: false; errors: ServiceLoggingError[] };

/** Compares names ignoring case, accents and spacing. */
export function looseName(name: string | null): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Checks a Service draft against its Vehicle and works out what saving it means: the Tasks it counts
 * (a Task that always comes with another counts that one too), the Components Used linked to the items
 * list, and the items to add for the lines the owner asked to keep. Pure: the caller does the storing.
 */
export function logService(context: ServiceLoggingContext, draft: Service, options: LogServiceOptions): LogServiceResult {
  const { tasks, items, catalogue } = context;
  const ids = [...new Set(draft.taskIds)];

  const errors: ServiceLoggingError[] = [];
  const known = new Map(tasks.map((t) => [t.id, t]));
  for (const taskId of ids) if (!known.has(taskId)) errors.push({ code: 'task-not-on-vehicle', taskId });
  if (draft.kind === 'repair' && !draft.title?.trim()) errors.push({ code: 'repair-needs-title' });
  if (draft.kind === 'maintenance' && ids.length === 0) errors.push({ code: 'maintenance-needs-task' });
  if (draft.odometer === null) {
    const distance = ids.filter((id) => {
      const task = known.get(id);
      return task !== undefined && task.intervalKm !== null;
    });
    if (distance.length > 0) errors.push({ code: 'odometer-needed', taskIds: distance });
  }
  if (errors.length > 0) return { ok: false, errors };

  const oneTask = ids.length === 1 ? ids[0]! : null;

  // A Task that always comes with another (the fork seals with the fork oil) counts that one as done too.
  const taskIds = [...ids];
  for (const id of ids) {
    const code = known.get(id)?.templateCode ?? null;
    const included = code === null ? null : catalogue.includedWith(code);
    if (included === null) continue;
    const other = tasks.find((t) => t.templateCode === included);
    if (other && !taskIds.includes(other.id)) taskIds.push(other.id);
  }

  const list: Pick<VehicleItem, 'id' | 'name' | 'partNumber'>[] = [...items];
  const newItems: NewVehicleItem[] = [];
  const componentsUsed: ComponentUsed[] = draft.componentsUsed.map((p) => {
    let itemId = p.itemId ?? null;
    if (p.remember && options.canAddToItems) {
      if (itemId === null) itemId = options.newId();
      const own = itemId;
      const twin = list.find((r) => r.id !== own && looseName(r.name) === looseName(p.description) && looseName(r.partNumber) === looseName(p.partNumber));
      if (twin) itemId = twin.id;
      else if (!list.some((r) => r.id === own)) {
        const item: NewVehicleItem = {
          id: own,
          vehicleId: draft.vehicleId,
          name: p.description,
          partNumber: p.partNumber,
          unit: p.unit,
          quantity: p.quantity,
          price: p.price ?? null,
          taskId: oneTask,
        };
        newItems.push(item);
        list.push(item);
      }
    }
    // A link to an item that is gone, or on another Vehicle, is dropped: the Service keeps its copy.
    const link = itemId;
    return { ...p, remember: false, itemId: link !== null && list.some((r) => r.id === link) ? link : null };
  });

  const repair = draft.kind === 'repair';
  return {
    ok: true,
    service: { ...draft, taskIds, title: repair ? draft.title : null, category: repair ? draft.category : null, componentsUsed },
    newItems,
  };
}
