import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { todayIso } from '../../shared/dates.ts';
import { checkOdometer, findDuplicateService } from '../../shared/consistency.ts';
import { pointsOf, readingOn, vehicleDue } from '../../shared/due.ts';
import { PART_CATEGORIES, catalogueOf, type PartCategory } from '../../shared/catalogue.ts';
import { logService, type ServiceLoggingError } from '../../shared/service-logging.ts';
import { buyStates } from '../../shared/purchases.ts';
import { formFigure, mergeNeeds, prefillForType, prefillFromProduct, type MergedNeed } from '../../shared/session-consumables.ts';
import type { PartUnit, PerformedBy, ServiceKind } from '../../shared/schemas.ts';
import type { OdometerReading, ComponentUsed, Service, Snapshot, Vehicle, VehicleItem } from '../../shared/types.ts';
import { newId } from '../api.ts';
import { confirmDelete, ConsistencyWarnings, Field, FormError, Layout, segmentedKeys, StatusChip } from '../components.tsx';
import { formatKm, formatMoney, formatQuantity, matchesQuery, parseNumber, taskName } from '../format.ts';
import { showToast } from '../feedback.ts';
import { useT, type Messages } from '../i18n.ts';
import { isDesktop } from '../native.ts';
import { navigate } from '../router.ts';
import { enqueue, online, undoCreate, useStore } from '../store.ts';
import { serviceToSend, type OutboxOp } from '../outbox.ts';
import { DocumentsPanel } from './Documents.tsx';
import { OTHER_PRODUCT, SessionConsumables } from './SessionConsumables.tsx';

/** A Part Used as typed in the form: numbers stay text until saved. */
interface ComponentUsedDraft {
  key: number;
  description: string;
  partNumber: string;
  quantity: string;
  unit: PartUnit;
  /** Price per piece or litre, as typed. */
  price: string;
  /** The item of the Vehicle's list it was picked from, if it still is that item. */
  itemId: string | null;
  /** A component typed by hand is also kept in the list, unless the owner unticks it. */
  remember: boolean;
  /** The required Consumable Type (from the Notion catalogue) and the Product it is for, when picked from a Task's block. */
  consumableTypeId: string | null;
  productId: string | null;
}

/** A search box shows above the task list once it is longer than this. */
const SEARCH_FROM = 8;

let nextKey = 1;

function toDraft(p: ComponentUsed): ComponentUsedDraft {
  return {
    key: nextKey++,
    description: p.description,
    partNumber: p.partNumber ?? '',
    quantity: String(p.quantity),
    unit: p.unit,
    price: p.price != null ? String(p.price) : '',
    itemId: p.itemId ?? null,
    remember: false,
    consumableTypeId: p.consumableTypeId ?? null,
    productId: p.productId ?? null,
  };
}

function draftOfListed(p: VehicleItem): ComponentUsedDraft {
  return {
    key: nextKey++,
    description: p.name,
    partNumber: p.partNumber ?? '',
    quantity: String(p.quantity),
    unit: p.unit,
    price: p.price !== null ? String(p.price) : '',
    itemId: p.id,
    remember: false,
    consumableTypeId: null,
    productId: null,
  };
}

function fromDraft(d: ComponentUsedDraft, t: Messages): ComponentUsed {
  const quantity = parseNumber(d.quantity);
  const price = parseNumber(d.price);
  if (!d.description.trim() || quantity === null || Number.isNaN(quantity) || quantity <= 0) throw new Error(t.workshop.itemError);
  if (price !== null && (Number.isNaN(price) || price < 0)) throw new Error(t.workshop.itemError);
  return {
    description: d.description.trim(),
    partNumber: d.partNumber.trim() || null,
    quantity,
    unit: d.unit,
    price,
    // The id of an item to keep is made when the Service is checked, so sending it again never doubles it.
    itemId: d.itemId ?? null,
    ...(d.remember && !d.itemId ? { remember: true } : {}),
    ...(d.consumableTypeId ? { consumableTypeId: d.consumableTypeId } : {}),
    ...(d.productId ? { productId: d.productId } : {}),
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
  // A new Service starts from the odometer logged that day, when there is one; the owner can still change it.
  const initialLogged = existing ? null : readingOn(snapshot, vehicle.id, date);
  const [odometerText, setOdometerText] = useState(existing ? String(existing.odometer ?? '') : initialLogged === null ? '' : String(initialLogged));
  const [fromLog, setFromLog] = useState<string | null>(initialLogged === null ? null : String(initialLogged));
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
  const [drafts, setDrafts] = useState<ComponentUsedDraft[]>(() => (existing?.componentsUsed ?? []).map(toDraft));
  const [error, setError] = useState<string | null>(null);
  const [odometerError, setOdometerError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const odometerInput = useRef<HTMLInputElement>(null);
  const tasksField = useRef<HTMLFieldSetElement>(null);

  const odometer = parseNumber(odometerText);
  // Only for the hint: a ticked Task that counts distance. Whether the odometer is required is decided by logService.
  const countsDistance = [...selected].some((id) => tasks.get(id)?.intervalKm != null);
  const validOdometer = odometer !== null && Number.isInteger(odometer) && odometer >= 0 ? odometer : null;
  // Warnings only: a value that looks off can still be saved.
  const check = useMemo(
    () => (validOdometer === null ? null : checkOdometer(pointsOf(snapshot, vehicle.id, existing?.id), { date, odometer: validOdometer })),
    [snapshot, vehicle.id, existing?.id, date, validOdometer],
  );
  const duplicate = useMemo(
    () => findDuplicateService(snapshot.services, { vehicleId: vehicle.id, date, odometer: validOdometer }, existing?.id),
    [snapshot.services, vehicle.id, date, validOdometer, existing?.id],
  );
  const back = `/vehicles/${vehicle.id}`;
  const pending = existing ? outbox.some((op) => op.data.id === existing.id) : false;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setTasksError(null);
  }

  function setDraft(key: number, patch: Partial<ComponentUsedDraft>) {
    setDrafts(drafts.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addEmptyPart() {
    setDrafts([
      ...drafts,
      {
        key: nextKey++,
        description: '',
        partNumber: '',
        quantity: '1',
        unit: 'piece',
        price: '',
        itemId: null,
        remember: true,
        consumableTypeId: null,
        productId: null,
      },
    ]);
  }

  /** A line for a required Consumable Type: filled in from the product picked, or empty to type by hand. Everything stays editable. */
  function addForType(need: MergedNeed, productId: string) {
    const product = productId === OTHER_PRODUCT ? undefined : snapshot.products.find((p) => p.id === productId);
    const fill = product ? prefillFromProduct(product, need.type, need.rows) : { ...prefillForType(need.type, need.rows), description: '', partNumber: '', price: '' };
    const comma = t.locale.startsWith('fr');
    const key = nextKey++;
    focusLine.current = key;
    setDrafts([
      ...drafts,
      {
        key,
        description: fill.description,
        partNumber: fill.partNumber,
        quantity: fill.quantity ? formFigure(fill.quantity, comma) : '1',
        unit: fill.unit ?? 'piece',
        price: fill.price ? formFigure(fill.price, comma) : '',
        itemId: null,
        // A product from the Notion catalogue is not also kept in the items list; a component typed by hand is.
        remember: product === undefined,
        consumableTypeId: fill.consumableTypeId,
        productId: fill.productId,
      },
    ]);
  }

  // A new line lands far below its picker on a phone: bring it into view, on its quantity.
  const focusLine = useRef<number | null>(null);
  useEffect(() => {
    if (focusLine.current === null) return;
    const field = document.getElementById(`component-qty-${focusLine.current}`);
    focusLine.current = null;
    field?.scrollIntoView({ block: 'center' });
    field?.focus();
  }, [drafts]);

  // The needs of the ticked Tasks, one block per consumable type.
  // Whether each required type was bought since its Task was last done (Notion's Achats); the strictest date of the ticked Tasks.
  const buy = useMemo(
    () =>
      new Map(
        buyStates(snapshot, vehicle.id, [...selected].map((taskId) => ({ taskId, lastDone: due.find((d) => d.taskId === taskId)?.lastDone?.date ?? null }))).map((s) => [s.type.id, s]),
      ),
    [snapshot, vehicle.id, selected, due],
  );
  const needs = useMemo(() => mergeNeeds(snapshot, vehicle.id, due.filter((d) => selected.has(d.taskId)).map((d) => d.taskId)), [snapshot, vehicle.id, due, selected]);
  const needed = new Set(needs.map((n) => n.type.id));
  const keptLines = drafts.some((p) => p.consumableTypeId !== null && !needed.has(p.consumableTypeId));

  /** The Vehicle's listed items: those usually bought for a ticked Task first. */
  const listed = snapshot.vehicleItems.filter((p) => p.vehicleId === vehicle.id).sort((a, b) => a.name.localeCompare(b.name));
  const forTasks = listed.filter((p) => p.taskId !== null && selected.has(p.taskId));
  const others = listed.filter((p) => !forTasks.includes(p));
  function pickListed(id: string) {
    const item = listed.find((p) => p.id === id);
    if (item) setDrafts([...drafts, draftOfListed(item)]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    // Each problem is shown next to its field, and the first one is brought into view.
    const badOdometerText = odometer !== null && (Number.isNaN(odometer) || odometer < 0 || !Number.isInteger(odometer));
    const totalCost = parseNumber(costText);
    const costBad = totalCost !== null && (Number.isNaN(totalCost) || totalCost < 0);
    let componentsUsed: ComponentUsed[] = [];
    let lineError: string | null = null;
    try {
      componentsUsed = drafts.map((d) => fromDraft(d, t));
    } catch (e) {
      lineError = (e as Error).message;
      componentsUsed = [];
    }
    const draft: Service = {
      id: existing?.id ?? newId(),
      vehicleId: vehicle.id,
      date,
      odometer: badOdometerText ? null : odometer,
      taskIds: [...selected],
      kind,
      title: kind === 'repair' ? title.trim() : null,
      category: kind === 'repair' ? category : null,
      notes: notes.trim() || null,
      performedBy,
      totalCost: costBad ? null : totalCost,
      componentsUsed,
    };
    const r = logService(
      { tasks: snapshot.tasks.filter((x) => x.vehicleId === vehicle.id), items: listed, catalogue: catalogueOf(snapshot) },
      draft,
      { newId, canAddToItems: isDesktop },
    );
    const errs: ServiceLoggingError[] = r.ok ? [] : r.errors;
    const has = (code: ServiceLoggingError['code']) => errs.some((e) => e.code === code);
    setOdometerError(badOdometerText ? t.service.errorOdometer : has('odometer-needed') ? t.service.needsOdometer : null);
    setTasksError(has('maintenance-needs-task') ? t.service.errorTasks : null);
    setTitleError(has('repair-needs-title') ? t.service.errorTitle : null);
    if (has('task-not-on-vehicle')) setError(t.service.errorTaskGone);
    if (badOdometerText || has('odometer-needed')) {
      odometerInput.current?.focus();
      odometerInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (has('maintenance-needs-task')) {
      tasksField.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (has('repair-needs-title') || !r.ok) return;
    if (costBad) {
      setError(t.service.totalCostError);
      return;
    }
    if (lineError !== null) {
      setError(lineError);
      return;
    }
    const op: OutboxOp = { kind: 'service', data: serviceToSend(r) };
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
    <Layout title={existing ? t.service.titleEdit : t.service.titleNew(vehicle.name)} back={back} entry>
      <form onSubmit={submit} className="form form-wide">
        <div className="form-columns">
          <div className="form">
            <div className="segmented" role="radiogroup" aria-label={t.service.kind} onKeyDown={segmentedKeys}>
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

            <SessionConsumables
              needs={needs}
              snapshot={snapshot}
              lines={(typeId) => drafts.filter((p) => p.consumableTypeId === typeId).map((p) => p.productId)}
              buy={buy}
              onAdd={addForType}
            />

            <Field label={t.service.date}>
              <input
                type="date"
                value={date}
                max={today}
                onChange={(e) => {
                  const next = e.target.value;
                  setDate(next);
                  // Follow the date while the km is empty or still the value taken from the log; never overwrite typing.
                  if (!existing && (odometerText === '' || odometerText === fromLog)) {
                    const logged = next === '' ? null : readingOn(snapshot, vehicle.id, next);
                    setOdometerText(logged === null ? '' : String(logged));
                    setFromLog(logged === null ? null : String(logged));
                  }
                }}
                required
              />
            </Field>
            <Field
              label={t.service.odometer}
              error={odometerError}
              hint={
                [
                  fromLog !== null && odometerText === fromLog ? t.service.odometerFromLog : null,
                  usage.latest ? t.service.lastReading(formatKm(usage.latest.odometer)) : null,
                  countsDistance || selected.size === 0 ? null : t.service.odometerOptional,
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
            <ConsistencyWarnings check={check} duplicate={duplicate} />

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
          </div>
          <div className="form">
            <fieldset className="field">
              <legend className="field-label">{t.workshop.componentsUsed}</legend>
              {keptLines ? <p className="muted">{t.notion.keptLines}</p> : null}
              {drafts.map((d) => (
                <div key={d.key} className="card component-used">
                  <div className="section-head">
                    <span className="field-label">{t.workshop.description}</span>
                    <button
                      type="button"
                      className="button button-small button-danger"
                      onClick={() => setDrafts(drafts.filter((p) => p.key !== d.key))}
                    >
                      {t.workshop.remove}
                    </button>
                  </div>
                  {snapshot.consumableTypes.find((c) => c.id === d.consumableTypeId) ? (
                    <p className="muted">{t.notion.forType(snapshot.consumableTypes.find((c) => c.id === d.consumableTypeId)!.name)}</p>
                  ) : null}
                  <input
                    value={d.description}
                    onChange={(e) => setDraft(d.key, { description: e.target.value, ...(d.itemId ? { itemId: null, remember: true } : {}) })}
                    maxLength={200}
                    placeholder={t.workshop.descriptionHint}
                    aria-label={t.workshop.description}
                  />
                  <div className="row">
                    <Field label={t.workshop.quantity}>
                      <input id={`component-qty-${d.key}`} inputMode="decimal" value={d.quantity} onChange={(e) => setDraft(d.key, { quantity: e.target.value })} />
                    </Field>
                    <Field label={t.workshop.unit}>
                      <select value={d.unit} onChange={(e) => setDraft(d.key, { unit: e.target.value as PartUnit })}>
                        <option value="piece">{t.workshop.piece}</option>
                        <option value="litre">{t.workshop.litre}</option>
                      </select>
                    </Field>
                    <Field label={t.workshop.unitPrice}>
                      <input inputMode="decimal" value={d.price} onChange={(e) => setDraft(d.key, { price: e.target.value })} />
                    </Field>
                  </div>
                  {d.itemId === null && isDesktop ? (
                    <label className="check">
                      <input type="checkbox" checked={d.remember} onChange={(e) => setDraft(d.key, { remember: e.target.checked })} />
                      <span>{t.workshop.keepItem}</span>
                    </label>
                  ) : null}
                  <details className="component-details">
                    <summary>{t.workshop.moreDetails}</summary>
                    <div className="row">
                      <Field label={t.workshop.partNumber}>
                        <input value={d.partNumber} onChange={(e) => setDraft(d.key, { partNumber: e.target.value, ...(d.itemId ? { itemId: null, remember: true } : {}) })} maxLength={120} />
                      </Field>
                    </div>
                  </details>
                </div>
              ))}
              <div className="actions">
                {listed.length > 0 ? (
                  <select value="" onChange={(e) => pickListed(e.target.value)} aria-label={t.workshop.pickItem}>
                    <option value="">{t.workshop.pickItem}</option>
                    {forTasks.length > 0 ? (
                      <optgroup label={t.workshop.pickItemForTasks}>
                        {forTasks.map((p) => (
                          <option key={p.id} value={p.id}>
                            {listedLabel(p, t, snapshot)}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {others.length > 0 ? (
                      <optgroup label={forTasks.length > 0 ? t.workshop.pickItemOthers : t.workshop.itemsListLink}>
                        {others.map((p) => (
                          <option key={p.id} value={p.id}>
                            {listedLabel(p, t, snapshot)}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                ) : null}
                <button type="button" className="button button-small" onClick={addEmptyPart}>
                  {t.workshop.addComponentUsed}
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
        // Receipts are added and removed on the desktop only, and never sent to Notion (ADR 0009).
        isDesktop ? (
          <DocumentsPanel
            snapshot={snapshot}
            ownerKind="service"
            ownerId={existing.id}
            defaultType="invoice"
            title={t.papers.receipt}
            archive={{
              folder: snapshot.vehicles.find((v) => v.id === existing.vehicleId)?.archiveFolder ?? null,
              date: existing.date,
              title: existing.title,
            }}
          />
        ) : (
          <p className="muted">{t.desktop.receipt}</p>
        )
      ) : null}
    </Layout>
  );
}

/** "Motul 7100 10W-40 · 3.2 L · spec 10W-40, 3.2 L" in the picker: the Item Spec it is for is shown to compare (the old Spec Line while it is still listed). */
function listedLabel(p: VehicleItem, t: Messages, snapshot: Snapshot): string {
  const itemSpec = snapshot.itemSpecs.find((s) => s.id === p.itemSpecId);
  const line = itemSpec ? undefined : snapshot.specLines.find((l) => l.id === p.specLineId);
  const specValue = itemSpec ? [itemSpec.specification, itemSpec.capacity].filter(Boolean).join(', ') : line?.value;
  return `${p.name} · ${formatQuantity(p.quantity, p.unit, t)}${p.price !== null ? ` · ${formatMoney(p.price, t)}` : ''}${specValue ? ` · ${t.items.specShown(specValue)}` : ''}`;
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
  // The hint names the latest other reading, so correcting the latest one doesn't point at itself.
  const latest = existing ? latestOther(snapshot, vehicle.id, existing.id) : usage.latest;
  const validOdometer = odometer !== null && Number.isInteger(odometer) && odometer >= 0 ? odometer : null;
  const check = useMemo(
    () => (validOdometer === null ? null : checkOdometer(pointsOf(snapshot, vehicle.id, existing?.id), { date, odometer: validOdometer })),
    [snapshot, vehicle.id, existing?.id, date, validOdometer],
  );

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
    <Layout title={existing ? t.service.readingEditTitle : t.service.readingTitle(vehicle.name)} back={back} entry>
      <form onSubmit={submit} className="form" noValidate>
        <Field label={t.service.date}>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field
          label={t.service.odometer}
          error={odometerError}
          hint={latest ? t.service.lastReading(formatKm(latest.odometer)) : undefined}
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
        <ConsistencyWarnings check={check} />
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
