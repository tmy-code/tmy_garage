import { useMemo, useState, type FormEvent } from 'react';
import { todayIso } from '../../shared/dates.ts';
import { vehicleDue } from '../../shared/due.ts';
import type { PartUnit } from '../../shared/schemas.ts';
import type { PartUsed, Service, Snapshot, Vehicle } from '../../shared/types.ts';
import { lastUsed, partSpecsOf } from '../../shared/workshop.ts';
import { newId } from '../api.ts';
import { Field, Layout, StatusChip } from '../components.tsx';
import { formatKm, parseNumber, partName, taskName } from '../format.ts';
import { useT, type Messages } from '../i18n.ts';
import { navigate } from '../router.ts';
import { enqueue, online, useStore } from '../store.ts';
import { DocumentsPanel } from './Papers.tsx';

/** A Part Used as typed in the form: numbers stay text until saved. */
interface PartDraft {
  key: number;
  partSpecId: string | null;
  positionId: string | null;
  description: string;
  partNumber: string;
  quantity: string;
  unit: PartUnit;
  price: string;
  supplier: string;
}

let nextKey = 1;

function toDraft(p: PartUsed): PartDraft {
  return {
    key: nextKey++,
    partSpecId: p.partSpecId,
    positionId: p.positionId,
    description: p.description,
    partNumber: p.partNumber ?? '',
    quantity: String(p.quantity),
    unit: p.unit,
    price: p.price === null ? '' : String(p.price),
    supplier: p.supplier ?? '',
  };
}

function fromDraft(d: PartDraft, t: Messages): PartUsed {
  const quantity = parseNumber(d.quantity);
  const price = parseNumber(d.price);
  if (!d.description.trim() || quantity === null || Number.isNaN(quantity) || quantity <= 0) throw new Error(t.workshop.partError);
  if (price !== null && (Number.isNaN(price) || price < 0)) throw new Error(t.workshop.priceError);
  return {
    partSpecId: d.partSpecId,
    positionId: d.positionId,
    description: d.description.trim(),
    partNumber: d.partNumber.trim() || null,
    quantity,
    unit: d.unit,
    price,
    supplier: d.supplier.trim() || null,
  };
}

/** Log or edit a Service. Works offline: the Service is queued and sent when back in range. */
export function ServiceForm({ vehicle, snapshot, existing }: { vehicle: Vehicle; snapshot: Snapshot; existing?: Service }) {
  const t = useT();
  const { outbox, reachable } = useStore();
  const today = todayIso();
  const { usage, due } = useMemo(() => vehicleDue(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));

  const [date, setDate] = useState(existing?.date ?? today);
  const [odometerText, setOdometerText] = useState(existing ? String(existing.odometer) : '');
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.taskIds ?? []));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [parts, setParts] = useState<PartDraft[]>(() => (existing?.partsUsed ?? []).map(toDraft));
  const partSpecs = partSpecsOf(snapshot, vehicle, { keep: (existing?.partsUsed ?? []).map((p) => p.partSpecId) });
  const positions = snapshot.positions.filter((p) => p.vehicleId === vehicle.id);
  const missingParts = [...selected]
    .flatMap((id) => tasks.get(id)?.requiredParts ?? [])
    .filter((r) => partSpecs.some((s) => s.id === r.partSpecId) && !parts.some((p) => p.partSpecId === r.partSpecId));
  const [error, setError] = useState<string | null>(null);

  const odometer = parseNumber(odometerText);
  const lowerThanLatest =
    odometer !== null && !Number.isNaN(odometer) && usage.latest && date >= usage.latest.date && odometer < usage.latest.odometer;
  const back = `/vehicles/${vehicle.id}`;
  const pending = existing ? outbox.some((op) => op.data.id === existing.id) : false;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function setPart(key: number, patch: Partial<PartDraft>) {
    setParts(parts.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  /** Adds the Required Parts of the ticked Tasks, filled in with what was used last time. */
  function addFromTasks() {
    const added: PartDraft[] = [];
    for (const r of missingParts) {
      const spec = partSpecs.find((s) => s.id === r.partSpecId)!;
      if (added.some((p) => p.partSpecId === spec.id)) continue;
      const last = lastUsed(snapshot, spec)?.part;
      added.push({
        key: nextKey++,
        partSpecId: spec.id,
        positionId: last?.positionId ?? null,
        description: last?.description ?? [partName(spec, t), spec.characteristics].filter(Boolean).join(' '),
        partNumber: last?.partNumber ?? '',
        quantity: String(r.quantity),
        unit: spec.unit,
        price: '',
        supplier: last?.supplier ?? '',
      });
    }
    setParts([...parts, ...added]);
  }

  function addEmptyPart() {
    setParts([
      ...parts,
      {
        key: nextKey++,
        partSpecId: null,
        positionId: null,
        description: '',
        partNumber: '',
        quantity: '1',
        unit: 'piece',
        price: '',
        supplier: '',
      },
    ]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (odometer === null || Number.isNaN(odometer) || odometer < 0 || !Number.isInteger(odometer)) {
      setError(t.service.errorOdometer);
      return;
    }
    if (selected.size === 0) {
      setError(t.service.errorTasks);
      return;
    }
    let partsUsed: PartUsed[];
    try {
      partsUsed = parts.map((d) => fromDraft(d, t));
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    await enqueue({
      kind: 'service',
      data: {
        id: existing?.id ?? newId(),
        vehicleId: vehicle.id,
        date,
        odometer,
        taskIds: [...selected],
        notes: notes.trim() || null,
        partsUsed,
      },
    });
    navigate(back, { replace: true });
  }

  async function remove() {
    if (!existing || !window.confirm(t.service.confirmDelete)) return;
    try {
      await online('DELETE', `/api/services/${existing.id}`);
      navigate(back, { replace: true });
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
              hint={
                lowerThanLatest
                  ? t.service.lowerThanLatest(formatKm(usage.latest!.odometer))
                  : usage.estimatedOdometer !== null && !existing
                    ? t.service.estimatedToday(formatKm(usage.estimatedOdometer))
                    : undefined
              }
            >
              <input
                inputMode="numeric"
                autoComplete="off"
                value={odometerText}
                onChange={(e) => setOdometerText(e.target.value)}
                placeholder={usage.estimatedOdometer !== null ? String(usage.estimatedOdometer) : t.service.example}
                required
              />
            </Field>

            <fieldset className="field">
              <legend className="field-label">{t.service.tasksDone}</legend>
              {due.length === 0 ? <p className="muted">{t.service.noTasks}</p> : null}
              <div className="check-grid">
                {due.map((d) => (
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
                    onChange={(e) => setPart(d.key, { description: e.target.value })}
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
                  </div>
                  {positions.length > 0 ? (
                    <Field label={t.workshop.position}>
                      <select value={d.positionId ?? ''} onChange={(e) => setPart(d.key, { positionId: e.target.value || null })}>
                        <option value="">{t.workshop.noPosition}</option>
                        {positions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  <details className="part-details">
                    <summary>{t.workshop.moreDetails}</summary>
                    <div className="row">
                      <Field label={t.workshop.partNumber}>
                        <input value={d.partNumber} onChange={(e) => setPart(d.key, { partNumber: e.target.value })} maxLength={120} />
                      </Field>
                      <Field label={t.workshop.price}>
                        <input inputMode="decimal" value={d.price} onChange={(e) => setPart(d.key, { price: e.target.value })} />
                      </Field>
                    </div>
                    {partSpecs.length > 0 ? (
                      <Field label={t.workshop.spec}>
                        <select value={d.partSpecId ?? ''} onChange={(e) => setPart(d.key, { partSpecId: e.target.value || null })}>
                          <option value="">{t.workshop.noSpec}</option>
                          {partSpecs.map((s) => (
                            <option key={s.id} value={s.id}>
                              {partName(s, t)}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : null}
                    <Field label={t.workshop.supplier}>
                      <input value={d.supplier} onChange={(e) => setPart(d.key, { supplier: e.target.value })} maxLength={120} />
                    </Field>
                  </details>
                </div>
              ))}
              <div className="actions">
                {missingParts.length > 0 ? (
                  <button type="button" className="button button-small" onClick={addFromTasks}>
                    {t.workshop.addFromTasks}
                  </button>
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

        {error ? <p className="banner banner-error">{error}</p> : null}
        <button type="submit" className="button button-primary button-block">
          {existing ? t.service.saveChanges : t.service.save}
        </button>
        {!reachable ? <p className="muted center">{t.service.offlineHint}</p> : null}
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={!reachable || pending}>
            {pending ? t.service.deleteAfterSync : t.service.delete}
          </button>
        ) : null}
      </form>
      {existing && !pending ? (
        <DocumentsPanel snapshot={snapshot} ownerKind="service" ownerId={existing.id} defaultType="invoice" title={t.papers.invoices} />
      ) : null}
    </Layout>
  );
}

export function ReadingForm({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const { usage } = useMemo(() => vehicleDue(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const [date, setDate] = useState(today);
  const [odometerText, setOdometerText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const odometer = parseNumber(odometerText);
  const back = `/vehicles/${vehicle.id}`;
  const lowerThanLatest =
    odometer !== null && !Number.isNaN(odometer) && usage.latest && date >= usage.latest.date && odometer < usage.latest.odometer;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (odometer === null || Number.isNaN(odometer) || odometer < 0 || !Number.isInteger(odometer)) {
      setError(t.service.errorOdometer);
      return;
    }
    await enqueue({ kind: 'reading', data: { id: newId(), vehicleId: vehicle.id, date, odometer } });
    navigate(back, { replace: true });
  }

  return (
    <Layout title={t.service.readingTitle(vehicle.name)} back={back}>
      <form onSubmit={submit} className="form">
        <Field label={t.service.date}>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field
          label={t.service.odometer}
          hint={
            lowerThanLatest
              ? t.service.lowerThanLatest(formatKm(usage.latest!.odometer))
              : usage.latest
                ? t.service.lastReading(formatKm(usage.latest.odometer))
                : undefined
          }
        >
          <input
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={odometerText}
            onChange={(e) => setOdometerText(e.target.value)}
            placeholder={usage.estimatedOdometer !== null ? String(usage.estimatedOdometer) : t.service.example}
            required
          />
        </Field>
        {error ? <p className="banner banner-error">{error}</p> : null}
        <button type="submit" className="button button-primary button-block">
          {t.service.saveReading}
        </button>
      </form>
    </Layout>
  );
}
