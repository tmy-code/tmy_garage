import { useState, type FormEvent } from 'react';
import type { PartUnit } from '../../shared/schemas.ts';
import type { Snapshot, Vehicle, VehicleItem } from '../../shared/types.ts';
import { itemSpecText } from '../../shared/workshop.ts';
import { confirmDelete, DesktopOnlyNote, Field, FormError, Layout, NeedsConnection } from '../components.tsx';
import { formatMoney, formatQuantity, matchesQuery, parseNumber, taskName } from '../format.ts';
import { useT } from '../i18n.ts';
import { isDesktop } from '../native.ts';
import { navigate } from '../router.ts';
import { online } from '../store.ts';
import { Submit, useSubmit } from './SetupForms.tsx';

// The Items section: every Vehicle's parts and fluids in one place. Desk work, so it needs a connection; it can be read
// offline from the phone's copy. What was bought is tracked in Notion (ADR 0008).

/** "Engine oil: 10W-40, 3.2 L" from the item's Item Spec; for an item not re-pointed yet, from its old Spec Line while that is still listed. */
function specText(snapshot: Snapshot, item: VehicleItem): string | null {
  const spec = snapshot.itemSpecs.find((s) => s.id === item.itemSpecId);
  if (spec) return itemSpecText(spec);
  const line = snapshot.specLines.find((l) => l.id === item.specLineId);
  return line ? (line.value ? `${line.label}: ${line.value}` : line.label) : null;
}

/** All the items, or those of one Vehicle (opened from its page), by name. */
export function ItemsPage({ snapshot, vehicleId }: { snapshot: Snapshot; vehicleId?: string }) {
  const t = useT();
  const [vehicleFilter, setVehicleFilter] = useState(vehicleId ?? '');
  const [query, setQuery] = useState('');
  const vehicles = new Map(snapshot.vehicles.map((v) => [v.id, v]));
  const items = snapshot.vehicleItems
    .filter((p) => (vehicleFilter === '' || p.vehicleId === vehicleFilter) && matchesQuery([p.name, p.partNumber, p.notes], query))
    .sort((a, b) => a.name.localeCompare(b.name));
  const addPath = vehicleFilter ? `#/items/new/${vehicleFilter}` : '#/items/new';

  return (
    <Layout title={t.items.title} back={vehicleId ? `/vehicles/${vehicleId}` : undefined} titleAction={isDesktop ? <a className="button button-small" href={addPath}>{t.items.add}</a> : undefined}>
      <NeedsConnection />
      <p className="muted">{t.items.intro}</p>
      <DesktopOnlyNote />
      <div className="row filters">
        <Field label={t.items.vehicle}>
          <select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)}>
            <option value="">{t.items.allVehicles}</option>
            {snapshot.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {snapshot.vehicleItems.length > 0 ? (
        <input type="search" className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.items.search} aria-label={t.items.search} autoComplete="off" />
      ) : null}
      {items.length === 0 ? <p className="empty">{snapshot.vehicleItems.length === 0 ? t.items.empty : t.items.emptyFiltered}</p> : null}
      <ul className="list list-grid list-even">
        {items.map((item) => {
          const spec = specText(snapshot, item);
          const content = (
            <>
              <strong>{item.name}</strong>
              {item.partNumber ? <span>{item.partNumber}</span> : null}
              {vehicleFilter === '' ? <span className="muted">{vehicles.get(item.vehicleId)?.name}</span> : null}
              <span className="muted">
                {t.workshop.usualQuantity}: {formatQuantity(item.quantity, item.unit, t)}
                {item.price !== null ? <> · <span className="nowrap">{formatMoney(item.price, t)} / {t.items.unitSingular[item.unit]}</span></> : null}
              </span>
              {spec ? <span className="muted">{t.items.specShown(spec)}</span> : null}
            </>
          );
          return (
            <li key={item.id}>
              {isDesktop ? (
                <a className="history-row" href={`#/items/item/${item.id}`}>
                  {content}
                </a>
              ) : (
                <div className="history-row">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Layout>
  );
}

/** Add an item, or edit one. */
export function VehicleItemForm({ snapshot, existing, vehicleId }: { snapshot: Snapshot; existing?: VehicleItem; vehicleId?: string }) {
  const t = useT();
  const owned = snapshot.vehicles.filter((v) => v.ownership === 'owned');
  const [vehicle, setVehicle] = useState(existing?.vehicleId ?? (owned.some((v) => v.id === vehicleId) ? vehicleId! : (owned[0]?.id ?? '')));
  const [name, setName] = useState(existing?.name ?? '');
  const [partNumber, setPartNumber] = useState(existing?.partNumber ?? '');
  const [unit, setUnit] = useState<PartUnit>(existing?.unit ?? 'piece');
  const [quantity, setQuantity] = useState(String(existing?.quantity ?? 1));
  const [price, setPrice] = useState(existing?.price != null ? String(existing.price) : '');
  const [taskId, setTaskId] = useState(existing?.taskId ?? '');
  const [itemSpecId, setItemSpecId] = useState(existing?.itemSpecId ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { error, setError, busy, disabled, run } = useSubmit();
  const tasks = snapshot.tasks.filter((task) => task.vehicleId === vehicle);
  const itemSpecs = snapshot.itemSpecs.filter((s) => s.vehicleId === vehicle).sort((a, b) => a.name.localeCompare(b.name));
  const owner: Vehicle | undefined = snapshot.vehicles.find((v) => v.id === vehicle);

  function submit(event: FormEvent) {
    event.preventDefault();
    const qty = parseNumber(quantity);
    const unitPrice = parseNumber(price);
    if (qty === null || Number.isNaN(qty) || qty <= 0 || (unitPrice !== null && (Number.isNaN(unitPrice) || unitPrice < 0))) {
      setError(t.workshop.itemError);
      return;
    }
    const body = { name, partNumber, unit, quantity: qty, price: unitPrice, taskId: taskId || null, itemSpecId: itemSpecId || null, notes };
    void run(async () => {
      if (existing) {
        await online('PUT', `/api/items/${existing.id}`, body);
      } else {
        await online('POST', `/api/vehicles/${vehicle}/items`, body);
        navigate('/items', { replace: true });
      }
    }, existing ? undefined : t.items.created);
  }

  async function remove() {
    if (!existing || !(await confirmDelete(t.items.confirmDelete(existing.name)))) return;
    void run(async () => {
      await online('DELETE', `/api/items/${existing.id}`);
      navigate('/items', { replace: true });
    }, t.feedback.deleted);
  }

  return (
    <Layout title={existing ? t.items.editTitle : t.items.newTitle} back="/items" entry>
      <NeedsConnection />
      {owned.length === 0 && !existing ? <p className="empty">{t.items.noOwnedVehicle}</p> : null}
      <form onSubmit={submit} className="form" noValidate>
        <Field label={t.items.vehicle} hint={existing ? t.items.vehicleLocked : undefined}>
          <select
            value={vehicle}
            disabled={existing !== undefined}
            onChange={(e) => {
              setVehicle(e.target.value);
              setTaskId('');
              setItemSpecId('');
            }}
          >
            {(existing ? snapshot.vehicles : owned).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.workshop.description} hint={t.workshop.descriptionHint}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoFocus={!existing} />
        </Field>
        <Field label={t.workshop.partNumber}>
          <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} maxLength={120} />
        </Field>
        <div className="row">
          <Field label={t.workshop.unit}>
            <select value={unit} onChange={(e) => setUnit(e.target.value as PartUnit)}>
              <option value="piece">{t.workshop.piece}</option>
              <option value="litre">{t.workshop.litre}</option>
            </select>
          </Field>
          <Field label={t.workshop.usualQuantity}>
            <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label={t.workshop.unitPrice}>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <Field label={t.workshop.itemTask} hint={t.workshop.itemTaskHint}>
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">{t.workshop.noTask}</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {taskName(task, t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.items.forSpec} hint={t.items.forSpecHint}>
          <select value={itemSpecId} onChange={(e) => setItemSpecId(e.target.value)}>
            <option value="">{t.items.noSpec}</option>
            {itemSpecs.map((s) => (
              <option key={s.id} value={s.id}>
                {itemSpecText(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.items.notes} hint={t.items.notesHint}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </Field>
        <FormError error={error} />
        <Submit disabled={disabled || (!existing && !owner)}>{busy ? '…' : t.items.save}</Submit>
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
            {t.items.deleteItem}
          </button>
        ) : null}
      </form>
    </Layout>
  );
}
