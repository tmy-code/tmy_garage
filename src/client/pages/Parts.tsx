import { useState, type FormEvent } from 'react';
import { todayIso } from '../../shared/dates.ts';
import type { PartUnit } from '../../shared/schemas.ts';
import { purchaseUnitPrice, type Purchase, type Snapshot, type Vehicle, type VehiclePart } from '../../shared/types.ts';
import { confirmDelete, Field, FormError, Layout, NeedsConnection } from '../components.tsx';
import { formatDate, formatMoney, formatQuantity, matchesQuery, parseNumber, taskName } from '../format.ts';
import { useT } from '../i18n.ts';
import { navigate } from '../router.ts';
import { serverUrl } from '../server.ts';
import { online } from '../store.ts';
import { DocumentsPanel } from './Documents.tsx';
import { Submit, useSubmit } from './SetupForms.tsx';

// The Parts section: every Vehicle's parts and fluids in one place, what is still to buy and what was bought, and the
// purchase log of each part. Desk work, so it needs a connection; it can be read offline from the phone's copy.

type StateFilter = 'all' | 'toBuy' | 'bought';

const unitName = (unit: PartUnit, t: ReturnType<typeof useT>) => (unit === 'litre' ? t.workshop.litre : t.workshop.piece).toLowerCase();

/** "Engine oil: 10W-40, 3.2 L" (just the label while its value is still to fill in). */
function specText(snapshot: Snapshot, specLineId: string | null): string | null {
  const line = snapshot.specLines.find((l) => l.id === specLineId);
  return line ? (line.value ? `${line.label}: ${line.value}` : line.label) : null;
}

function purchasesOf(snapshot: Snapshot, partId: string): Purchase[] {
  return snapshot.purchases.filter((p) => p.partId === partId).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** All the parts, or those of one Vehicle (opened from its page): To buy first, then by name. */
export function PartsPage({ snapshot, vehicleId }: { snapshot: Snapshot; vehicleId?: string }) {
  const t = useT();
  const [vehicleFilter, setVehicleFilter] = useState(vehicleId ?? '');
  const [state, setState] = useState<StateFilter>('all');
  const [query, setQuery] = useState('');
  const vehicles = new Map(snapshot.vehicles.map((v) => [v.id, v]));
  // The counts beside the choices follow the vehicle and the search, so they say what choosing one would show.
  const matching = snapshot.vehicleParts.filter(
    (p) => (vehicleFilter === '' || p.vehicleId === vehicleFilter) && matchesQuery([p.name, p.partNumber, p.notes], query),
  );
  const counts = { all: matching.length, toBuy: matching.filter((p) => p.toBuy).length, bought: matching.filter((p) => !p.toBuy).length };
  const parts = matching
    .filter((p) => state === 'all' || (state === 'toBuy') === p.toBuy)
    .sort((a, b) => Number(b.toBuy) - Number(a.toBuy) || a.name.localeCompare(b.name));
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
        <Field label={t.parts.show}>
          <select value={state} onChange={(e) => setState(e.target.value as StateFilter)}>
            <option value="all">{`${t.parts.states.all} (${counts.all})`}</option>
            <option value="toBuy">{`${t.parts.states.toBuy} (${counts.toBuy})`}</option>
            <option value="bought">{`${t.parts.states.bought} (${counts.bought})`}</option>
          </select>
        </Field>
      </div>
      {snapshot.vehicleParts.length > 0 ? (
        <input type="search" className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.parts.search} aria-label={t.parts.search} autoComplete="off" />
      ) : null}
      {parts.length === 0 ? <p className="empty">{snapshot.vehicleParts.length === 0 ? t.parts.empty : t.parts.emptyFiltered}</p> : null}
      <ul className="list list-grid list-even">
        {parts.map((part) => {
          const log = purchasesOf(snapshot, part.id);
          return (
            <li key={part.id}>
              <a className="history-row" href={`#/parts/part/${part.id}`}>
                <strong>
                  {part.name}
                  {part.toBuy ? <span className="chip chip-pending">{t.parts.toBuyLabel}</span> : null}
                </strong>
                {part.partNumber ? <span>{part.partNumber}</span> : null}
                {vehicleFilter === '' ? <span className="muted">{vehicles.get(part.vehicleId)?.name}</span> : null}
                <span className="muted">
                  {t.workshop.usualQuantity}: {formatQuantity(part.quantity, part.unit, t)}
                  {part.price !== null ? <> · <span className="nowrap">{formatMoney(part.price, t)} / {t.parts.unitSingular[part.unit]}</span></> : null}
                </span>
                {specText(snapshot, part.specLineId) ? <span className="muted">{t.parts.specShown(specText(snapshot, part.specLineId)!)}</span> : null}
                {log.length > 0 ? (
                  <span className="muted">
                    {t.parts.lastBought(formatDate(log[0]!.date, t))} · {t.parts.count(log.length)}
                  </span>
                ) : !part.toBuy ? (
                  <span className="muted">{t.parts.noPurchaseRecorded}</span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
      <p>
        <a className="button" href={serverUrl('/api/purchases.csv')} download>
          {t.parts.downloadCsv}
        </a>
      </p>
      <p className="muted">{t.parts.csvHint}</p>
    </Layout>
  );
}

/** Add a part (to buy, by default), or edit one and keep its purchase log. */
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
  const [toBuy, setToBuy] = useState(existing?.toBuy ?? true);
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
    const body = { name, partNumber, unit, quantity: qty, price: unitPrice, taskId: taskId || null, specLineId: specLineId || null, toBuy, notes };
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
    <Layout title={existing ? t.parts.editTitle : t.parts.newTitle} back="/parts">
      <NeedsConnection />
      {owned.length === 0 && !existing ? <p className="empty">{t.parts.noOwnedVehicle}</p> : null}
      {/* The item beside its purchase log on a wide screen; stacked on a phone. */}
      <div className="split">
        <div className="split-main">
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
        <label className="check">
          <input type="checkbox" checked={toBuy} onChange={(e) => setToBuy(e.target.checked)} />
          <span>{t.parts.toBuyLabel}</span>
        </label>
        <p className="muted">{t.parts.toBuyHint}</p>
        <FormError error={error} />
        <Submit disabled={disabled || (!existing && !owner)}>{busy ? '…' : t.parts.save}</Submit>
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
            {t.parts.deletePart}
          </button>
        ) : null}
      </form>
        </div>
        <div className="split-side">
          {existing ? <PurchaseLog snapshot={snapshot} part={existing} /> : <p className="muted">{t.parts.saveFirst}</p>}
        </div>
      </div>
    </Layout>
  );
}

/** The purchases of one part, newest first, with a form to record one. */
function PurchaseLog({ snapshot, part }: { snapshot: Snapshot; part: VehiclePart }) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const log = purchasesOf(snapshot, part.id);
  const unit = unitName(part.unit, t);
  return (
    <section>
      <div className="heading-row">
        <h2>{t.parts.purchaseLog}</h2>
        {editing !== 'new' ? (
          <button type="button" className="button button-small" onClick={() => setEditing('new')}>
            {t.parts.addPurchase}
          </button>
        ) : null}
      </div>
      {editing === 'new' ? <PurchaseEditor part={part} onDone={() => setEditing(null)} snapshot={snapshot} /> : null}
      {log.length === 0 && editing !== 'new' ? <p className="muted">{t.parts.noPurchases}</p> : null}
      <ul className="list">
        {log.map((p) =>
          editing === p.id ? (
            <li key={p.id} className="editing">
              <PurchaseEditor part={part} existing={p} onDone={() => setEditing(null)} snapshot={snapshot} />
            </li>
          ) : (
            <li key={p.id}>
              <button type="button" className="item-row" onClick={() => setEditing(p.id)}>
                <strong>
                  {formatDate(p.date, t)} · {formatQuantity(p.quantity, part.unit, t)} · {formatMoney(p.totalPaid, t)}
                </strong>
                <span className="muted">
                  {t.parts.perUnit(formatMoney(purchaseUnitPrice(p), t), t.parts.unitSingular[part.unit])}
                  {p.deliveryFees !== null ? ` · ${t.parts.delivery(formatMoney(p.deliveryFees, t))}` : ''}
                  {p.shop ? ` · ${p.shop}` : ''}
                </span>
                {p.notes ? <span className="muted">{p.notes}</span> : null}
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function PurchaseEditor({ part, existing, onDone, snapshot }: { part: VehiclePart; existing?: Purchase; onDone: () => void; snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const unit = unitName(part.unit, t);
  const [date, setDate] = useState(existing?.date ?? today);
  const [quantity, setQuantity] = useState(String(existing?.quantity ?? part.quantity));
  const [totalPaid, setTotalPaid] = useState(existing ? String(existing.totalPaid) : '');
  const [shop, setShop] = useState(existing?.shop ?? '');
  const [deliveryFees, setDeliveryFees] = useState(existing?.deliveryFees != null ? String(existing.deliveryFees) : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { error, setError, busy, disabled, run } = useSubmit();
  const qty = parseNumber(quantity);
  const total = parseNumber(totalPaid);
  const fees = parseNumber(deliveryFees);
  const worked = qty !== null && total !== null && !Number.isNaN(qty) && !Number.isNaN(total) && qty > 0 && total >= 0 ? purchaseUnitPrice({ quantity: qty, totalPaid: total }) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (qty === null || Number.isNaN(qty) || qty <= 0 || total === null || Number.isNaN(total) || total < 0 || (fees !== null && (Number.isNaN(fees) || fees < 0))) {
      setError(t.parts.purchaseError);
      return;
    }
    const body = { date, quantity: qty, totalPaid: total, shop, deliveryFees: fees, notes };
    void run(async () => {
      await online(existing ? 'PUT' : 'POST', existing ? `/api/purchases/${existing.id}` : `/api/parts/${part.id}/purchases`, body);
      onDone();
    }, t.parts.purchaseSaved);
  }

  async function remove() {
    if (!existing || !(await confirmDelete(t.parts.confirmDeletePurchase))) return;
    void run(async () => {
      await online('DELETE', `/api/purchases/${existing.id}`);
      onDone();
    }, t.feedback.deleted);
  }

  return (
    <>
      <form onSubmit={submit} className="form card" noValidate>
        <Field label={t.parts.purchaseDate}>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <div className="row">
          <Field label={t.parts.purchaseQuantity(unit)}>
            <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label={t.parts.totalPaid} hint={worked !== null ? t.parts.perUnit(formatMoney(worked, t), t.parts.unitSingular[part.unit]) : t.parts.totalPaidHint}>
            <input inputMode="decimal" value={totalPaid} onChange={(e) => setTotalPaid(e.target.value)} autoFocus />
          </Field>
        </div>
        <Field label={t.parts.deliveryFees} hint={t.parts.deliveryFeesHint}>
          <input inputMode="decimal" value={deliveryFees} onChange={(e) => setDeliveryFees(e.target.value)} />
        </Field>
        <Field label={t.parts.shop}>
          <input value={shop} onChange={(e) => setShop(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t.parts.purchaseNotes}>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>
        <FormError error={error} />
        <Submit disabled={disabled}>{busy ? '…' : t.parts.save}</Submit>
        <button type="button" className="button button-block" onClick={onDone}>
          {t.workshop.cancel}
        </button>
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
            {t.parts.deletePurchase}
          </button>
        ) : null}
      </form>
      {existing ? <DocumentsPanel snapshot={snapshot} ownerKind="purchase" ownerId={existing.id} defaultType="invoice" title={t.parts.receipt} /> : null}
    </>
  );
}
