import { useState, type FormEvent } from 'react';
import type { PartUnit } from '../../shared/schemas.ts';
import type { Snapshot, Vehicle, VehiclePart } from '../../shared/types.ts';
import { confirmDelete, Field, FormError, Layout, NeedsConnection } from '../components.tsx';
import { formatMoney, formatQuantity, matchesQuery, parseNumber, taskName } from '../format.ts';
import { useT } from '../i18n.ts';
import { navigate } from '../router.ts';
import { online } from '../store.ts';
import { Submit, useSubmit } from './SetupForms.tsx';

// The Parts section: every Vehicle's parts and fluids in one place. Desk work, so it needs a connection; it can be read
// offline from the phone's copy. What was bought is tracked in Notion (ADR 0008).

/** "Engine oil: 10W-40, 3.2 L" (just the label while its value is still to fill in). */
function specText(snapshot: Snapshot, specLineId: string | null): string | null {
  const line = snapshot.specLines.find((l) => l.id === specLineId);
  return line ? (line.value ? `${line.label}: ${line.value}` : line.label) : null;
}

/** All the parts, or those of one Vehicle (opened from its page), by name. */
export function PartsPage({ snapshot, vehicleId }: { snapshot: Snapshot; vehicleId?: string }) {
  const t = useT();
  const [vehicleFilter, setVehicleFilter] = useState(vehicleId ?? '');
  const [query, setQuery] = useState('');
  const vehicles = new Map(snapshot.vehicles.map((v) => [v.id, v]));
  const parts = snapshot.vehicleParts
    .filter((p) => (vehicleFilter === '' || p.vehicleId === vehicleFilter) && matchesQuery([p.name, p.partNumber, p.notes], query))
    .sort((a, b) => a.name.localeCompare(b.name));
  const addPath = vehicleFilter ? `#/parts/new/${vehicleFilter}` : '#/parts/new';

  return (
    <Layout title={t.parts.title} back={vehicleId ? `/vehicles/${vehicleId}` : undefined} titleAction={<a className="button button-small" href={addPath}>{t.parts.add}</a>}>
      <NeedsConnection />
      <p className="muted">{t.parts.intro}</p>
      <div className="row filters">
        <Field label={t.parts.vehicle}>
          <select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)}>
            <option value="">{t.parts.allVehicles}</option>
            {snapshot.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {snapshot.vehicleParts.length > 0 ? (
        <input type="search" className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.parts.search} aria-label={t.parts.search} autoComplete="off" />
      ) : null}
      {parts.length === 0 ? <p className="empty">{snapshot.vehicleParts.length === 0 ? t.parts.empty : t.parts.emptyFiltered}</p> : null}
      <ul className="list list-grid list-even">
        {parts.map((part) => (
          <li key={part.id}>
            <a className="history-row" href={`#/parts/part/${part.id}`}>
              <strong>{part.name}</strong>
              {part.partNumber ? <span>{part.partNumber}</span> : null}
              {vehicleFilter === '' ? <span className="muted">{vehicles.get(part.vehicleId)?.name}</span> : null}
              <span className="muted">
                {t.workshop.usualQuantity}: {formatQuantity(part.quantity, part.unit, t)}
                {part.price !== null ? <> · <span className="nowrap">{formatMoney(part.price, t)} / {t.parts.unitSingular[part.unit]}</span></> : null}
              </span>
              {specText(snapshot, part.specLineId) ? <span className="muted">{t.parts.specShown(specText(snapshot, part.specLineId)!)}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </Layout>
  );
}

/** Add a part, or edit one. */
export function VehiclePartForm({ snapshot, existing, vehicleId }: { snapshot: Snapshot; existing?: VehiclePart; vehicleId?: string }) {
  const t = useT();
  const owned = snapshot.vehicles.filter((v) => v.status === 'owned');
  const [vehicle, setVehicle] = useState(existing?.vehicleId ?? (owned.some((v) => v.id === vehicleId) ? vehicleId! : (owned[0]?.id ?? '')));
  const [name, setName] = useState(existing?.name ?? '');
  const [partNumber, setPartNumber] = useState(existing?.partNumber ?? '');
  const [unit, setUnit] = useState<PartUnit>(existing?.unit ?? 'piece');
  const [quantity, setQuantity] = useState(String(existing?.quantity ?? 1));
  const [price, setPrice] = useState(existing?.price != null ? String(existing.price) : '');
  const [taskId, setTaskId] = useState(existing?.taskId ?? '');
  const [specLineId, setSpecLineId] = useState(existing?.specLineId ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { error, setError, busy, disabled, run } = useSubmit();
  const tasks = snapshot.tasks.filter((task) => task.vehicleId === vehicle);
  const specLines = snapshot.specLines.filter((l) => l.vehicleId === vehicle).sort((a, b) => a.label.localeCompare(b.label));
  const owner: Vehicle | undefined = snapshot.vehicles.find((v) => v.id === vehicle);

  function submit(event: FormEvent) {
    event.preventDefault();
    const qty = parseNumber(quantity);
    const unitPrice = parseNumber(price);
    if (qty === null || Number.isNaN(qty) || qty <= 0 || (unitPrice !== null && (Number.isNaN(unitPrice) || unitPrice < 0))) {
      setError(t.workshop.partError);
      return;
    }
    const body = { name, partNumber, unit, quantity: qty, price: unitPrice, taskId: taskId || null, specLineId: specLineId || null, notes };
    void run(async () => {
      if (existing) {
        await online('PUT', `/api/parts/${existing.id}`, body);
      } else {
        await online('POST', `/api/vehicles/${vehicle}/parts`, body);
        navigate('/parts', { replace: true });
      }
    }, existing ? undefined : t.parts.created);
  }

  async function remove() {
    if (!existing || !(await confirmDelete(t.parts.confirmDelete(existing.name)))) return;
    void run(async () => {
      await online('DELETE', `/api/parts/${existing.id}`);
      navigate('/parts', { replace: true });
    }, t.feedback.deleted);
  }

  return (
    <Layout title={existing ? t.parts.editTitle : t.parts.newTitle} back="/parts" entry>
      <NeedsConnection />
      {owned.length === 0 && !existing ? <p className="empty">{t.parts.noOwnedVehicle}</p> : null}
      <form onSubmit={submit} className="form" noValidate>
        <Field label={t.parts.vehicle} hint={existing ? t.parts.vehicleLocked : undefined}>
          <select
            value={vehicle}
            disabled={existing !== undefined}
            onChange={(e) => {
              setVehicle(e.target.value);
              setTaskId('');
              setSpecLineId('');
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
        <Field label={t.workshop.partTask} hint={t.workshop.partTaskHint}>
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">{t.workshop.noTask}</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {taskName(task, t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.parts.forSpec} hint={t.parts.forSpecHint}>
          <select value={specLineId} onChange={(e) => setSpecLineId(e.target.value)}>
            <option value="">{t.parts.noSpec}</option>
            {specLines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.value ? `${l.label}: ${l.value}` : l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.parts.notes} hint={t.parts.notesHint}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </Field>
        <FormError error={error} />
        <Submit disabled={disabled || (!existing && !owner)}>{busy ? '…' : t.parts.save}</Submit>
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
            {t.parts.deletePart}
          </button>
        ) : null}
      </form>
    </Layout>
  );
}
