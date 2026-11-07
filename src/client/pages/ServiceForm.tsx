import { useMemo, useRef, useState, type FormEvent } from 'react';
import { todayIso } from '../../shared/dates.ts';
import { effectiveInterval, vehicleDue } from '../../shared/due.ts';
import { PART_CATEGORIES, type PartCategory } from '../../shared/catalogue.ts';
import type { PartUnit, PerformedBy, ServiceKind } from '../../shared/schemas.ts';
import type { OdometerReading, PartUsed, Service, Snapshot, Vehicle, VehiclePart } from '../../shared/types.ts';
import { newId } from '../api.ts';
import { confirmDelete, Field, FormError, Layout, StatusChip } from '../components.tsx';
import { formatKm, formatMoney, formatQuantity, matchesQuery, parseNumber, taskName } from '../format.ts';
import { showToast } from '../feedback.ts';
import { useT, type Messages } from '../i18n.ts';
import { navigate } from '../router.ts';
import { enqueue, online, undoCreate, useStore } from '../store.ts';
import type { OutboxOp } from '../outbox.ts';
import { DocumentsPanel } from './Documents.tsx';

/** A Part Used as typed in the form: numbers stay text until saved. */
interface PartDraft {
  key: number;
  description: string;
  partNumber: string;
  quantity: string;
  unit: PartUnit;
  /** Price per piece or litre, as typed. */
  price: string;
  /** The part of the Vehicle's list it was picked from, if it still is that part. */
  partId: string | null;
  /** A part typed by hand is also kept in the list, unless the owner unticks it. */
  remember: boolean;
}

/** A search box shows above the task list once it is longer than this. */
const SEARCH_FROM = 8;

let nextKey = 1;

function toDraft(p: PartUsed): PartDraft {
  return {
    key: nextKey++,
    description: p.description,
    partNumber: p.partNumber ?? '',
    quantity: String(p.quantity),
    unit: p.unit,
    price: p.price != null ? String(p.price) : '',
    partId: p.partId ?? null,
    remember: false,
  };
}

function draftOfListed(p: VehiclePart): PartDraft {
  return {
    key: nextKey++,
    description: p.name,
    partNumber: p.partNumber ?? '',
    quantity: String(p.quantity),
    unit: p.unit,
    price: p.price !== null ? String(p.price) : '',
    partId: p.id,
    remember: false,
  };
}

function fromDraft(d: PartDraft, t: Messages): PartUsed {
  const quantity = parseNumber(d.quantity);
  const price = parseNumber(d.price);
  if (!d.description.trim() || quantity === null || Number.isNaN(quantity) || quantity <= 0) throw new Error(t.workshop.partError);
  if (price !== null && (Number.isNaN(price) || price < 0)) throw new Error(t.workshop.partError);
  return {
    description: d.description.trim(),
    partNumber: d.partNumber.trim() || null,
    quantity,
    unit: d.unit,
    price,
    // An id made here for a part to keep travels with the Service, so sending it again never doubles it.
    partId: d.partId ?? (d.remember ? newId() : null),
    ...(d.remember && !d.partId ? { remember: true } : {}),
  };
}

/**
 * Log or edit a Service. Works offline: the Service is queued and sent when back in range.
 * Opened from a Task's card, that Task (`preselect`) starts ticked.
 */
export function ServiceForm({
  vehicle,
  snapshot,
  existing,
  preselect,
}: {
  vehicle: Vehicle;
  snapshot: Snapshot;
  existing?: Service;
  preselect?: string;
}) {
  const t = useT();
  const { outbox, reachable } = useStore();
  const today = todayIso();
  const { usage, due } = useMemo(() => vehicleDue(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));

  const [date, setDate] = useState(existing?.date ?? today);
  const [odometerText, setOdometerText] = useState(existing ? String(existing.odometer ?? '') : '');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(existing?.taskIds ?? due.filter((d) => d.taskId === preselect).map((d) => d.taskId)),
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [taskQuery, setTaskQuery] = useState('');
  // The list is searched by name; a task already ticked stays shown, so nothing ticked is ever hidden.
  const shownDue = due.filter((d) => {
    const task = tasks.get(d.taskId);
    return selected.has(d.taskId) || !task || matchesQuery([taskName(task, t), task.name, task.nameFr], taskQuery);
  });
  const [kind, setKind] = useState<ServiceKind>(existing?.kind ?? 'maintenance');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [category, setCategory] = useState<PartCategory | null>(existing?.category ?? null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [performedBy, setPerformedBy] = useState<PerformedBy>(existing?.performedBy ?? 'diy');
  const [costText, setCostText] = useState(existing?.totalCost != null ? String(existing.totalCost) : '');
  const [parts, setParts] = useState<PartDraft[]>(() => (existing?.partsUsed ?? []).map(toDraft));
  const [error, setError] = useState<string | null>(null);
  const [odometerError, setOdometerError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const odometerInput = useRef<HTMLInputElement>(null);
  const tasksField = useRef<HTMLFieldSetElement>(null);

  const odometer = parseNumber(odometerText);
  // The odometer is needed when a ticked Task counts distance; for time-based ones alone it can be left out.
  const needsOdometer = [...selected].some((id) => {
    const task = tasks.get(id);
    return task !== undefined && effectiveInterval(task).km !== null;
  });
  const lowerThanLatest =
    odometer !== null && !Number.isNaN(odometer) && usage.latest && date >= usage.latest.date && odometer < usage.latest.odometer;
  const back = `/vehicles/${vehicle.id}`;
  const pending = existing ? outbox.some((op) => op.data.id === existing.id) : false;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setTasksError(null);
  }

  function setPart(key: number, patch: Partial<PartDraft>) {
    setParts(parts.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addEmptyPart() {
    setParts([
      ...parts,
      {
        key: nextKey++,
        description: '',
        partNumber: '',
        quantity: '1',
        unit: 'piece',
        price: '',
        partId: null,
        remember: true,
      },
    ]);
  }

  /** The Vehicle's listed parts: those usually bought for a ticked Task first. */
  const listed = snapshot.vehicleParts.filter((p) => p.vehicleId === vehicle.id).sort((a, b) => a.name.localeCompare(b.name));
  // Bought parts first; those still to buy come last, and picking one marks it bought when the Service is saved.
  const forTasks = listed.filter((p) => !p.toBuy && p.taskId !== null && selected.has(p.taskId));
  const others = listed.filter((p) => !p.toBuy && !forTasks.includes(p));
  const stillToBuy = listed.filter((p) => p.toBuy);
  function pickListed(id: string) {
    const part = listed.find((p) => p.id === id);
    if (part) setParts([...parts, draftOfListed(part)]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    // Each problem is shown next to its field, and the first one is brought into view.
    const badOdometer =
      odometer === null ? needsOdometer : Number.isNaN(odometer) || odometer < 0 || !Number.isInteger(odometer);
    setOdometerError(badOdometer ? (odometer === null ? t.service.needsOdometer : t.service.errorOdometer) : null);
    const noTasks = kind === 'maintenance' && selected.size === 0;
    setTasksError(noTasks ? t.service.errorTasks : null);
    const noTitle = kind === 'repair' && !title.trim();
    setTitleError(noTitle ? t.service.errorTitle : null);
    if (badOdometer) {
      odometerInput.current?.focus();
      odometerInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (noTasks) {
      tasksField.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (noTitle) return;
    const totalCost = parseNumber(costText);
    if (totalCost !== null && (Number.isNaN(totalCost) || totalCost < 0)) {
      setError(t.service.totalCostError);
      return;
    }
    let partsUsed: PartUsed[];
    try {
      partsUsed = parts.map((d) => fromDraft(d, t));
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const op: OutboxOp = {
      kind: 'service',
      data: {
        id: existing?.id ?? newId(),
        vehicleId: vehicle.id,
        date,
        odometer,
        taskIds: [...selected],
        kind,
        title: kind === 'repair' ? title.trim() : null,
        category: kind === 'repair' ? category : null,
        notes: notes.trim() || null,
        performedBy,
        totalCost,
        partsUsed,
      },
    };
    await enqueue(op);
    navigate(back, { replace: true });
    toastCreated(op, existing ? t.feedback.saved : t.feedback.serviceSaved, t, !existing);
  }

  async function remove() {
    if (!existing || !(await confirmDelete(t.service.confirmDelete))) return;
    try {
      await online('DELETE', `/api/services/${existing.id}`);
      navigate(back, { replace: true });
      showToast(t.feedback.deleted);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Layout title={existing ? t.service.titleEdit : t.service.titleNew(vehicle.name)} back={back}>
      <form onSubmit={submit} className="form form-wide">
        <div className="form-columns">
          <div className="form">
            <Field label={t.service.date}>
              <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field
              label={t.service.odometer}
              error={odometerError}
              hint={
                lowerThanLatest
                  ? t.service.lowerThanLatest(formatKm(usage.latest!.odometer))
                  : [
                      usage.latest ? t.service.lastReading(formatKm(usage.latest.odometer)) : null,
                      needsOdometer || selected.size === 0 ? null : t.service.odometerOptional,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined
              }
            >
              <input
                ref={odometerInput}
                inputMode="numeric"
                autoComplete="off"
                value={odometerText}
                onChange={(e) => {
                  setOdometerText(e.target.value);
                  setOdometerError(null);
                }}
                placeholder={t.service.example}
                aria-invalid={odometerError ? true : undefined}
              />
            </Field>

            <div className="segmented" role="radiogroup" aria-label={t.service.kind}>
              {(['maintenance', 'repair'] as const).map((k) => (
                <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                  {t.service.kinds[k]}
                </button>
              ))}
            </div>
            {kind === 'repair' ? (
              <>
                <Field label={t.service.repairTitle} hint={t.service.repairTitleHint} error={titleError}>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
                </Field>
                <Field label={t.setup.taskCategory}>
                  <select value={category ?? 'other'} onChange={(e) => setCategory(e.target.value === 'other' ? null : (e.target.value as PartCategory))}>
                    {PART_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t.workshop.partCategories[c]}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : null}
            <div className="row">
              <Field label={t.service.performedBy}>
                <select value={performedBy} onChange={(e) => setPerformedBy(e.target.value as PerformedBy)}>
                  {(['diy', 'garage', 'dealership'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t.service.performers[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.service.totalCost} hint={t.service.totalCostHint}>
                <input inputMode="decimal" value={costText} onChange={(e) => setCostText(e.target.value)} />
              </Field>
            </div>

            <fieldset ref={tasksField} className={`field ${tasksError ? 'field-invalid' : ''}`}>
              <legend className="field-label">{t.service.tasksDone}</legend>
              {tasksError ? (
                <span className="field-error" role="alert">
                  {tasksError}
                </span>
              ) : null}
              {due.length === 0 ? <p className="muted">{t.service.noTasks}</p> : null}
              {due.length > SEARCH_FROM ? (
                <input
                  type="search"
                  value={taskQuery}
                  onChange={(e) => setTaskQuery(e.target.value)}
                  placeholder={t.service.searchTasks}
                  aria-label={t.service.searchTasks}
                  autoComplete="off"
                />
              ) : null}
              {shownDue.length === 0 && due.length > 0 ? <p className="muted">{t.service.noTaskMatches}</p> : null}
              <div className="check-grid">
                {shownDue.map((d) => (
                  <label key={d.taskId} className={`check ${selected.has(d.taskId) ? 'check-on' : ''}`}>
                    <input type="checkbox" checked={selected.has(d.taskId)} onChange={() => toggle(d.taskId)} />
                    <span className="due-name">{tasks.get(d.taskId) ? taskName(tasks.get(d.taskId)!, t) : null}</span>
                    <StatusChip status={d.status} />
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="form">
            <fieldset className="field">
              <legend className="field-label">{t.workshop.partsUsed}</legend>
              {parts.map((d) => (
                <div key={d.key} className="card part-used">
                  <div className="section-head">
                    <span className="field-label">{t.workshop.description}</span>
                    <button
                      type="button"
                      className="button button-small button-danger"
                      onClick={() => setParts(parts.filter((p) => p.key !== d.key))}
                    >
                      {t.workshop.remove}
                    </button>
                  </div>
                  <input
                    value={d.description}
                    onChange={(e) => setPart(d.key, { description: e.target.value, ...(d.partId ? { partId: null, remember: true } : {}) })}
                    maxLength={200}
                    placeholder={t.workshop.descriptionHint}
                    aria-label={t.workshop.description}
                  />
                  <div className="row">
                    <Field label={t.workshop.quantity}>
                      <input inputMode="decimal" value={d.quantity} onChange={(e) => setPart(d.key, { quantity: e.target.value })} />
                    </Field>
                    <Field label={t.workshop.unit}>
                      <select value={d.unit} onChange={(e) => setPart(d.key, { unit: e.target.value as PartUnit })}>
                        <option value="piece">{t.workshop.piece}</option>
                        <option value="litre">{t.workshop.litre}</option>
                      </select>
                    </Field>
                    <Field label={t.workshop.unitPrice}>
                      <input inputMode="decimal" value={d.price} onChange={(e) => setPart(d.key, { price: e.target.value })} />
                    </Field>
                  </div>
                  {d.partId === null ? (
                    <label className="check">
                      <input type="checkbox" checked={d.remember} onChange={(e) => setPart(d.key, { remember: e.target.checked })} />
                      <span>{t.workshop.keepPart}</span>
                    </label>
                  ) : null}
                  <details className="part-details">
                    <summary>{t.workshop.moreDetails}</summary>
                    <div className="row">
                      <Field label={t.workshop.partNumber}>
                        <input value={d.partNumber} onChange={(e) => setPart(d.key, { partNumber: e.target.value, ...(d.partId ? { partId: null, remember: true } : {}) })} maxLength={120} />
                      </Field>
                    </div>
                  </details>
                </div>
              ))}
              <div className="actions">
                {listed.length > 0 ? (
                  <select value="" onChange={(e) => pickListed(e.target.value)} aria-label={t.workshop.pickPart}>
                    <option value="">{t.workshop.pickPart}</option>
                    {forTasks.length > 0 ? (
                      <optgroup label={t.workshop.pickPartForTasks}>
                        {forTasks.map((p) => (
                          <option key={p.id} value={p.id}>
                            {listedLabel(p, t, snapshot)}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {others.length > 0 ? (
                      <optgroup label={forTasks.length > 0 ? t.workshop.pickPartOthers : t.workshop.partsListLink}>
                        {others.map((p) => (
                          <option key={p.id} value={p.id}>
                            {listedLabel(p, t, snapshot)}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {stillToBuy.length > 0 ? (
                      <optgroup label={t.workshop.pickPartToBuy}>
                        {stillToBuy.map((p) => (
                          <option key={p.id} value={p.id}>
                            {listedLabel(p, t, snapshot)}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                ) : null}
                <button type="button" className="button button-small" onClick={addEmptyPart}>
                  {t.workshop.addPartUsed}
                </button>
              </div>
            </fieldset>

            <Field label={t.service.notes} hint={t.service.notesHint}>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
            </Field>
          </div>
        </div>

        <FormError error={error} />
        {/* The save button stays in view while the long list of tasks scrolls. */}
        <div className="sticky-actions">
          <button type="submit" className="button button-primary button-block">
            {existing ? t.service.saveChanges : t.service.save}
          </button>
        </div>
        {!reachable ? <p className="muted center">{t.service.offlineHint}</p> : null}
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={!reachable || pending}>
            {pending ? t.service.deleteAfterSync : t.service.delete}
          </button>
        ) : null}
      </form>
      {existing && !pending ? (
        <DocumentsPanel snapshot={snapshot} ownerKind="service" ownerId={existing.id} defaultType="invoice" title={t.papers.receipt} />
      ) : null}
    </Layout>
  );
}

/** "Motul 7100 10W-40 · 3.2 L · spec 10W-40, 3.2 L" in the picker: the factory spec it is for is shown to compare. */
function listedLabel(p: VehiclePart, t: Messages, snapshot: Snapshot): string {
  const spec = snapshot.specLines.find((l) => l.id === p.specLineId);
  return `${p.name} · ${formatQuantity(p.quantity, p.unit, t)}${p.price !== null ? ` · ${formatMoney(p.price, t)}` : ''}${spec?.value ? ` · ${t.parts.specShown(spec.value)}` : ''}`;
}

/** Says a Service or Odometer Reading was saved; a new one can be taken back for a few seconds. */
export function toastCreated(op: OutboxOp, text: string, t: Messages, created: boolean) {
  showToast(
    text,
    created
      ? {
          label: t.feedback.undo,
          run: async () => {
            try {
              await undoCreate(op);
              showToast(t.feedback.undone);
            } catch (e) {
              showToast((e as Error).message);
            }
          },
        }
      : undefined,
  );
}


/** Log an Odometer Reading, or correct or delete one. Logging works offline, like a Service. */
export function ReadingForm({ vehicle, snapshot, existing }: { vehicle: Vehicle; snapshot: Snapshot; existing?: OdometerReading }) {
  const t = useT();
  const { outbox, reachable } = useStore();
  const today = todayIso();
  const { usage } = useMemo(() => vehicleDue(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const [date, setDate] = useState(existing?.date ?? today);
  const [odometerText, setOdometerText] = useState(existing ? String(existing.odometer) : '');
  const [odometerError, setOdometerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const odometer = parseNumber(odometerText);
  const back = `/vehicles/${vehicle.id}`;
  const pending = existing ? outbox.some((op) => op.data.id === existing.id) : false;
  // Compared with the latest other reading, so correcting the latest one doesn't warn against itself.
  const latest = existing ? latestOther(snapshot, vehicle.id, existing.id) : usage.latest;
  const lowerThanLatest = odometer !== null && !Number.isNaN(odometer) && latest && date >= latest.date && odometer < latest.odometer;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (odometer === null || Number.isNaN(odometer) || odometer < 0 || !Number.isInteger(odometer)) {
      setOdometerError(t.service.errorOdometer);
      return;
    }
    const op: OutboxOp = { kind: 'reading', data: { id: existing?.id ?? newId(), vehicleId: vehicle.id, date, odometer } };
    await enqueue(op);
    navigate(back, { replace: true });
    toastCreated(op, existing ? t.feedback.saved : t.feedback.readingSaved, t, !existing);
  }

  async function remove() {
    if (!existing || !(await confirmDelete(t.service.confirmDeleteReading))) return;
    try {
      await online('DELETE', `/api/odometer-readings/${existing.id}`);
      navigate(back, { replace: true });
      showToast(t.feedback.deleted);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Layout title={existing ? t.service.readingEditTitle : t.service.readingTitle(vehicle.name)} back={back}>
      <form onSubmit={submit} className="form" noValidate>
        <Field label={t.service.date}>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field
          label={t.service.odometer}
          error={odometerError}
          hint={
            lowerThanLatest
              ? t.service.lowerThanLatest(formatKm(latest!.odometer))
              : latest
                ? t.service.lastReading(formatKm(latest.odometer))
                : undefined
          }
        >
          <input
            inputMode="numeric"
            autoComplete="off"
            autoFocus={!existing}
            value={odometerText}
            onChange={(e) => {
              setOdometerText(e.target.value);
              setOdometerError(null);
            }}
            placeholder={t.service.example}
            aria-invalid={odometerError ? true : undefined}
          />
        </Field>
        <FormError error={error} />
        <button type="submit" className="button button-primary button-block">
          {existing ? t.service.saveChanges : t.service.saveReading}
        </button>
        {!reachable ? <p className="muted center">{t.service.offlineHint}</p> : null}
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={!reachable || pending}>
            {pending ? t.service.deleteAfterSync : t.service.deleteReading}
          </button>
        ) : null}
      </form>
    </Layout>
  );
}

function latestOther(snapshot: Snapshot, vehicleId: string, exceptId: string): OdometerReading | null {
  let latest: OdometerReading | null = null;
  for (const r of snapshot.readings) {
    if (r.vehicleId !== vehicleId || r.id === exceptId) continue;
    if (!latest || r.date > latest.date || (r.date === latest.date && r.odometer > latest.odometer)) latest = r;
  }
  return latest;
}
