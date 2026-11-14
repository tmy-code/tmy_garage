import { Fragment, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PART_CATEGORIES } from '../../shared/catalogue.ts';
import { todayIso } from '../../shared/dates.ts';
import { requiredConsumables, torqueSpecs } from '../../shared/applicability.ts';
import { vehicleDue } from '../../shared/due.ts';
import type { PartUnit } from '../../shared/schemas.ts';
import type { ComponentSpec, Confirmation, ItemSpec, MaintenanceTask, PartUsed, Snapshot, SpecLine, Vehicle, VehiclePart } from '../../shared/types.ts';
import { confirmAction } from '../feedback.ts';
import { confirmDelete, DesktopOnlyNote, Field, FormError, Layout, NeedsConnection, segmentedKeys, StatusChip, useWide } from '../components.tsx';
import { describeDue, describeInterval, formatDate, formatKm, formatMoney, localizeNumber, matchesQuery, parseNumber, specErrorText, taskName } from '../format.ts';
import { VehicleIcon } from '../brands.tsx';
import { Icon } from '../icons.tsx';
import { messages, useT } from '../i18n.ts';
import { isAndroidApp, isDesktop } from '../native.ts';
import { online } from '../store.ts';
import { useSubmit } from './SetupForms.tsx';

// Specs are desk work: edited on the desktop only, and written to Notion first, so they need a connection. Reading them
// works offline from the phone's copy, which is what matters mid-job (ADR 0009).

/** "Motul 7100 10W-40 · ref. 123" */
export function describePart(part: PartUsed): string {
  return [part.description, part.partNumber].filter(Boolean).join(' · ');
}

/** Text with web links made tappable. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/\S+)/).map((piece, i) =>
        i % 2 === 1 ? (
          <a key={i} href={piece} target="_blank" rel="noreferrer">
            {piece}
          </a>
        ) : (
          <Fragment key={i}>{piece}</Fragment>
        ),
      )}
    </>
  );
}

/** A small form shown in place of a list item (or at the end of the list to add one). */
function InlineEditor({
  onSubmit,
  onCancel,
  onDelete,
  disabled,
  error,
  saveLabel,
  onChange,
  children,
}: {
  onSubmit: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  disabled: boolean;
  error: string | null;
  /** Replaces "Save" while a change is being written. */
  saveLabel?: string;
  /** Called on any change of a field: the editor then holds typed input. */
  onChange?: () => void;
  children: ReactNode;
}) {
  const t = useT();
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <form onSubmit={submit} onChange={onChange} className="form card inline-editor">
      {children}
      <FormError error={error} />
      <NeedsConnection />
      <div className="sticky-actions">
        <div className="actions">
          <button type="button" className="button" onClick={onCancel}>
            {t.workshop.cancel}
          </button>
          <button type="submit" className="button button-primary" disabled={disabled}>
            {saveLabel ?? t.workshop.save}
          </button>
        </div>
      </div>
      {onDelete ? (
        <div className="inline-editor-danger">
          <button type="button" className="button button-danger button-block" onClick={onDelete} disabled={disabled}>
            {t.workshop.delete}
          </button>
        </div>
      ) : null}
    </form>
  );
}

type Editing = string | null;

function useEditor() {
  const [editing, setEditing] = useState<Editing>(null);
  const dirty = useRef(false);
  const submit = useSubmit();
  function save(fn: () => Promise<unknown>, done?: string) {
    void submit.run(async () => {
      await fn();
      dirty.current = false;
      setEditing(null);
    }, done);
  }
  function remove(name: string, fn: () => Promise<unknown>, message?: string) {
    const t = messages();
    void confirmDelete(message ?? t.workshop.confirmDelete(name)).then((ok) => ok && save(fn, t.feedback.deleted));
  }
  /** Opens another editor, or closes this one; asks first when the open one holds typed input. */
  function open(next: Editing) {
    if (next === editing) return;
    const go = () => {
      dirty.current = false;
      submit.setError(null);
      setEditing(next);
    };
    if (!dirty.current || editing === null) return go();
    const t = messages();
    void confirmAction(t.specs.discard, { confirm: t.specs.discardConfirm, cancel: t.specs.keepEditing }).then((ok) => ok && go());
  }
  /** Cancel is the user's own choice: no question. */
  function close() {
    dirty.current = false;
    submit.setError(null);
    setEditing(null);
  }
  return { editing, setEditing: open, close, markDirty: () => void (dirty.current = true), save, remove, ...submit };
}

// --- Item Specs and Component Specs of a Vehicle (kept in Notion; edited on the desktop, written to Notion first) ---

/** Runs a call to the server for a spec edit, telling the owner what went wrong in the app's language. */
async function specCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(specErrorText(error, messages()));
  }
}

const CONFIRMATIONS = [null, 'confirmed', 'to_confirm'] as const;

function ConfirmationPicker({ value, onChange }: { value: Confirmation; onChange: (value: Confirmation) => void }) {
  const t = useT();
  const labels = { unset: t.specs.unset, confirmed: t.notion.confirmed, to_confirm: t.notion.toConfirm };
  return (
    <Field label={t.specs.confirmation}>
      <div className="segmented" role="radiogroup" aria-label={t.specs.confirmation} onKeyDown={segmentedKeys}>
        {CONFIRMATIONS.map((c) => (
          <button type="button" key={c ?? 'unset'} role="radio" aria-checked={value === c} className={value === c ? 'on' : ''} onClick={() => onChange(c)}>
            {labels[c ?? 'unset']}
          </button>
        ))}
      </div>
    </Field>
  );
}

/** How many vehicles the Notion page of a spec covers (an edit changes it for all of them). */
function pageVehicles(rows: { notionId: string; vehicleId: string }[], spec: { notionId: string }): number {
  return new Set(rows.filter((r) => r.notionId === spec.notionId).map((r) => r.vehicleId)).size;
}

function ItemSpecEditor({ vehicle, existing, snapshot, editor }: { vehicle: Vehicle; existing?: ItemSpec; snapshot: Snapshot; editor: ReturnType<typeof useEditor> }) {
  const t = useT();
  const [name, setName] = useState(existing?.name ?? '');
  const [typeId, setTypeId] = useState(existing?.typeId ?? '');
  const [specification, setSpecification] = useState(existing?.specification ?? '');
  const [capacity, setCapacity] = useState(existing?.capacity ?? '');
  const [quantity, setQuantity] = useState(existing?.quantity === null || existing?.quantity === undefined ? '' : String(existing.quantity));
  const [oemRef, setOemRef] = useState(existing?.oemRef ?? '');
  const [productId, setProductId] = useState(existing?.chosenProductId ?? '');
  const [confirmation, setConfirmation] = useState<Confirmation>(existing?.confirmation ?? null);
  const shared = existing ? pageVehicles(snapshot.itemSpecs, existing) : 1;
  const products = snapshot.products.filter((p) => p.id === productId || (typeId !== '' && p.typeId === typeId));
  const base = `/api/notion`;

  function body() {
    const q = parseNumber(quantity);
    if (Number.isNaN(q)) throw new Error(t.specs.quantityError);
    return { name, typeId: typeId || null, specification, oemRef, capacity, quantity: q, chosenProductId: productId || null, confirmation };
  }

  return (
    <InlineEditor
      onSubmit={() =>
        editor.save(() => {
          const payload = body();
          return specCall(() => (existing ? online('PUT', `${base}/item-specs/${existing.id}`, payload) : online('POST', `${base}/vehicles/${vehicle.id}/item-specs`, payload)));
        })
      }
      onCancel={editor.close}
      onChange={editor.markDirty}
      onDelete={
        existing
          ? () => editor.remove(existing.name, () => specCall(() => online('DELETE', `${base}/item-specs/${existing.id}`)), shared > 1 ? t.specs.confirmDetach(existing.name) : t.specs.confirmDelete(existing.name))
          : undefined
      }
      disabled={editor.disabled}
      error={editor.error}
      saveLabel={editor.busy ? t.specs.saving : undefined}
    >
      {shared > 1 ? <p className="banner banner-warn">{t.specs.shared(shared)}</p> : null}
      <Field label={t.specs.name} hint={t.specs.nameHint}>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoFocus />
      </Field>
      <Field label={t.specs.type}>
        <select
          value={typeId}
          onChange={(e) => {
            setTypeId(e.target.value);
            setProductId('');
          }}
        >
          <option value="">{t.specs.noType}</option>
          {[...snapshot.consumableTypes].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.specs.specification} hint={t.specs.specificationHint}>
        <input value={specification} onChange={(e) => setSpecification(e.target.value)} maxLength={200} />
      </Field>
      <div className="row">
        <Field label={t.specs.capacity} hint={t.specs.capacityHint}>
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} maxLength={80} />
        </Field>
        <Field label={t.specs.quantity} hint={t.specs.quantityHint}>
          <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
      </div>
      <Field label={t.specs.oemRef}>
        <input value={oemRef} onChange={(e) => setOemRef(e.target.value)} maxLength={120} />
      </Field>
      <Field label={t.specs.chosenProduct} hint={t.specs.compatibleInNotion}>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">{t.specs.noProduct}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || [p.brand, p.reference].filter(Boolean).join(' ')}
            </option>
          ))}
        </select>
      </Field>
      <ConfirmationPicker value={confirmation} onChange={setConfirmation} />
    </InlineEditor>
  );
}

function ComponentSpecEditor({ vehicle, existing, snapshot, editor }: { vehicle: Vehicle; existing?: ComponentSpec; snapshot: Snapshot; editor: ReturnType<typeof useEditor> }) {
  const t = useT();
  const [label, setLabel] = useState(existing?.label ?? '');
  const [componentTypeId, setComponentTypeId] = useState(existing?.componentTypeId ?? '');
  const known = PART_CATEGORIES as readonly string[];
  const [category, setCategory] = useState(existing?.category && known.includes(existing.category) ? existing.category : '');
  const [value, setValue] = useState(existing?.value ?? '');
  const [unit, setUnit] = useState(existing?.unit ?? '');
  const [source, setSource] = useState(existing?.source ?? '');
  const [confirmation, setConfirmation] = useState<Confirmation>(existing?.confirmation ?? null);
  const shared = existing ? pageVehicles(snapshot.componentSpecs, existing) : 1;
  const units = [...new Set(snapshot.componentSpecs.flatMap((s) => (s.unit ? [s.unit] : [])))].sort();
  const base = `/api/notion`;
  const payload = { label, componentTypeId: componentTypeId || null, category: category || null, value, unit, source, confirmation };

  return (
    <InlineEditor
      onSubmit={() =>
        editor.save(() =>
          specCall(() => (existing ? online('PUT', `${base}/component-specs/${existing.id}`, payload) : online('POST', `${base}/vehicles/${vehicle.id}/component-specs`, payload))),
        )
      }
      onCancel={editor.close}
      onChange={editor.markDirty}
      onDelete={
        existing
          ? () => editor.remove(existing.label, () => specCall(() => online('DELETE', `${base}/component-specs/${existing.id}`)), shared > 1 ? t.specs.confirmDetach(existing.label) : t.specs.confirmDelete(existing.label))
          : undefined
      }
      disabled={editor.disabled}
      error={editor.error}
      saveLabel={editor.busy ? t.specs.saving : undefined}
    >
      {shared > 1 ? <p className="banner banner-warn">{t.specs.shared(shared)}</p> : null}
      <Field label={t.specs.label} hint={t.specs.labelHint}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={200} autoFocus />
      </Field>
      <Field label={t.specs.componentType}>
        <select value={componentTypeId} onChange={(e) => setComponentTypeId(e.target.value)}>
          <option value="">{t.specs.noType}</option>
          {[...snapshot.componentTypes].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.setup.taskCategory}>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t.specs.unset}</option>
          {PART_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t.workshop.partCategories[c]}
            </option>
          ))}
        </select>
      </Field>
      <div className="row">
        <Field label={t.specs.value} hint={t.specs.valueHint}>
          <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} />
        </Field>
        <Field label={t.specs.unit} hint={t.specs.unitHint}>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} list="spec-units" />
          <datalist id="spec-units">
            {units.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label={t.specs.source} hint={t.specs.sourceHint}>
        <input value={source} onChange={(e) => setSource(e.target.value)} maxLength={500} />
      </Field>
      <ConfirmationPicker value={confirmation} onChange={setConfirmation} />
    </InlineEditor>
  );
}

function ConfirmationChip({ confirmation }: { confirmation: Confirmation }) {
  const t = useT();
  if (!confirmation) return null;
  return <span className={`chip ${confirmation === 'confirmed' ? 'chip-ok' : 'chip-dueSoon'}`}>{confirmation === 'confirmed' ? t.notion.confirmed : t.notion.toConfirm}</span>;
}

/** The Item Spec row: what the vehicle takes, in a few words. */
function ItemSpecText({ spec }: { spec: ItemSpec }) {
  const t = useT();
  const detail = [spec.specification, spec.capacity ? localizeNumber(spec.capacity, t) : null, spec.quantity !== null ? `×${localizeNumber(spec.quantity, t)}` : null].filter(Boolean).join(' · ');
  return (
    <>
      <span>
        <strong>{spec.name}</strong>
        <span className="spec-badges">
          <ConfirmationChip confirmation={spec.confirmation} />
        </span>
      </span>
      <span>
        {detail || <span className="muted">{t.workshop.specToFill}</span>}
        {spec.oemRef ? <small className="muted spec-oem">{t.workshop.specOemShown(spec.oemRef)}</small> : null}
      </span>
    </>
  );
}

/** The Component Spec row: a figure with its unit and where it comes from. */
function ComponentSpecText({ spec }: { spec: ComponentSpec }) {
  const t = useT();
  return (
    <>
      <span>
        <strong>{spec.label}</strong>
        <span className="spec-badges">
          <ConfirmationChip confirmation={spec.confirmation} />
        </span>
      </span>
      <span>
        {spec.value ? [localizeNumber(spec.value, t), spec.unit].filter(Boolean).join(' ') : <span className="muted">{t.workshop.specToFill}</span>}
        {spec.source ? <small className="muted spec-oem">{spec.source}</small> : null}
      </span>
    </>
  );
}

/** An old Spec Line not moved to Notion: read-only. */
function SpecLineText({ spec }: { spec: SpecLine }) {
  const t = useT();
  return (
    <>
      <strong>{spec.label}</strong>
      <span>
        {spec.value || <span className="muted">{t.workshop.specToFill}</span>}
        {spec.oem ? <small className="muted spec-oem">{t.workshop.specOemShown(spec.oem)}</small> : null}
      </span>
    </>
  );
}

/** A Vehicle's Item Specs by the category of their consumable type (what has no type is last), in the order Notion gave them. */
function itemSpecGroups(snapshot: Snapshot, vehicleId: string): [string | null, ItemSpec[]][] {
  const specs = snapshot.itemSpecs.filter((s) => s.vehicleId === vehicleId);
  const categoryOf = (s: ItemSpec) => snapshot.consumableTypes.find((c) => c.id === s.typeId)?.category ?? null;
  const categories = [...new Set(specs.map(categoryOf))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  return categories.map((c) => [c, specs.filter((s) => categoryOf(s) === c)]);
}

/** The Component Specs of a Vehicle by category (what has none is last), in the order Notion gave them. */
function componentSpecGroups(snapshot: Snapshot, vehicleId: string): [string | null, ComponentSpec[]][] {
  const specs = snapshot.componentSpecs.filter((s) => s.vehicleId === vehicleId);
  const categories = [...new Set(specs.map((s) => s.category))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  return categories.map((c) => [c, specs.filter((s) => s.category === c)]);
}

export function SpecsPage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const editor = useEditor();
  const wide = useWide();
  const itemGroups = itemSpecGroups(snapshot, vehicle.id);
  const componentGroups = componentSpecGroups(snapshot, vehicle.id);
  const legacy = snapshot.specLines.filter((l) => l.vehicleId === vehicle.id);
  const empty = itemGroups.length === 0 && componentGroups.length === 0 && legacy.length === 0;
  // Specs are written to Notion first, on the desktop only; a sold vehicle has no Notion page.
  const sold = vehicle.ownership !== 'owned';
  const canEdit = isDesktop && snapshot.notion !== null && !sold;
  const editing = editor.editing;
  const editingItem = editing?.startsWith('item:') ? snapshot.itemSpecs.find((s) => s.id === editing.slice(5)) : undefined;
  const editingComponent = editing?.startsWith('component:') ? snapshot.componentSpecs.find((s) => s.id === editing.slice(10)) : undefined;
  const editorFor = (e: string) =>
    e.startsWith('item:') ? (
      <ItemSpecEditor key={e} vehicle={vehicle} existing={editingItem} snapshot={snapshot} editor={editor} />
    ) : (
      <ComponentSpecEditor key={e} vehicle={vehicle} existing={editingComponent} snapshot={snapshot} editor={editor} />
    );

  const addButton = (kind: 'item' | 'component') =>
    canEdit && editing !== `${kind}:new` ? (
      <button type="button" className="button button-small" aria-label={kind === 'item' ? t.specs.addItem : t.specs.addComponent} onClick={() => editor.setEditing(`${kind}:new`)}>
        + {t.workshop.add}
      </button>
    ) : null;

  function note() {
    if (isAndroidApp) return <DesktopOnlyNote />;
    if (snapshot.notion === null) return <p className="muted">{t.specs.notionOff}</p>;
    if (sold) return <p className="muted">{t.specs.soldNoEdit}</p>;
    return null;
  }

  function row(kind: 'item' | 'component', id: string, content: ReactNode) {
    const key = `${kind}:${id}`;
    if (!canEdit) return <div className="spec-row">{content}</div>;
    return (
      <button type="button" className={`item-row spec-row ${editing === key ? 'item-selected' : ''}`} onClick={() => editor.setEditing(key)}>
        {content}
      </button>
    );
  }

  return (
    <Layout title={t.workshop.specsTitle(vehicle.name)} back={`/vehicles/${vehicle.id}`}>
      <NeedsConnection />
      <p className="muted">{canEdit ? t.specs.intro : t.specs.readOnlyIntro}</p>
      {note()}
      <div className={wide ? 'split' : undefined}>
        <div className="split-main">
          {empty && editing !== 'item:new' && editing !== 'component:new' ? (
            <p className="empty">
              {t.specs.empty} {canEdit ? t.specs.emptyDesktop : ''}
            </p>
          ) : null}

          <section>
            <div className="heading-row">
              <h2>{t.specs.itemTitle}</h2>
              {addButton('item')}
            </div>
            {!wide && editing === 'item:new' ? editorFor('item:new') : null}
            {itemGroups.map(([category, specs]) => (
              <Fragment key={category ?? 'none'}>
                <h3 className="due-group">{category ?? t.specs.noTypeGroup}</h3>
                <ul className="list list-plain">
                  {specs.map((spec) =>
                    !wide && editing === `item:${spec.id}` ? (
                      <li key={spec.id} className="editing">
                        {editorFor(`item:${spec.id}`)}
                      </li>
                    ) : (
                      <li key={spec.id}>{row('item', spec.id, <ItemSpecText spec={spec} />)}</li>
                    ),
                  )}
                </ul>
              </Fragment>
            ))}
          </section>

          <section>
            <div className="heading-row">
              <h2>{t.specs.componentTitle}</h2>
              {addButton('component')}
            </div>
            {!wide && editing === 'component:new' ? editorFor('component:new') : null}
            {componentGroups.map(([category, specs]) => (
              <Fragment key={category ?? 'none'}>
                <h3 className="due-group">{category ?? t.specs.noTypeGroup}</h3>
                <ul className="list list-plain">
                  {specs.map((spec) =>
                    !wide && editing === `component:${spec.id}` ? (
                      <li key={spec.id} className="editing">
                        {editorFor(`component:${spec.id}`)}
                      </li>
                    ) : (
                      <li key={spec.id}>{row('component', spec.id, <ComponentSpecText spec={spec} />)}</li>
                    ),
                  )}
                </ul>
              </Fragment>
            ))}
          </section>

          {legacy.length > 0 ? (
            <details>
              <summary>{t.specs.legacyTitle}</summary>
              <p className="muted">{t.specs.legacyHint}</p>
              <ul className="list list-plain">
                {legacy.map((spec) => (
                  <li key={spec.id}>
                    <div className="spec-row">
                      <SpecLineText spec={spec} />
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        {wide && editing && (editing === 'item:new' || editing === 'component:new' || editingItem || editingComponent) ? <div className="side-editor">{editorFor(editing)}</div> : null}
      </div>
    </Layout>
  );
}

// --- A Task's card ---

/** What a Task that follows the Notion catalogue needs: instructions, consumables, components with torque, tools. Read-only, works offline. */
function TaskNeeds({ task, vehicle, snapshot }: { task: MaintenanceTask; vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const ref = snapshot.refTasks.find((r) => r.id === task.refTaskId);
  if (!ref) return null;
  const tools = ref.toolIds.flatMap((id) => snapshot.tools.filter((x) => x.id === id));
  const components = ref.componentTypeIds.flatMap((id) => snapshot.componentTypes.filter((c) => c.id === id));
  const torque = torqueSpecs(snapshot, vehicle.id, task.id);
  const needs = requiredConsumables(snapshot, vehicle.id, task.id);
  return (
    <>
      <p className="muted">{t.notion.followsNotion}</p>
      {ref.instructions ? (
        <section>
          <h2>{t.notion.instructions}</h2>
          <p className="card notes">
            <Linked text={ref.instructions} />
          </p>
        </section>
      ) : null}
      {needs.length > 0 ? (
        <section>
          <h2>{t.notion.consumables}</h2>
          <ul className="list">
            {needs.map((need) => (
              <li key={need.type.id}>
                <div className="history-row">
                  <strong>{need.type.name}</strong>
                  {need.rows.length === 0 ? <span className="muted">{t.notion.nothingListed}</span> : null}
                  {need.rows.map((row) => (
                    <span key={row.id}>
                      {[row.specification, row.capacity ? localizeNumber(row.capacity, t) : null, row.quantity !== null ? `×${localizeNumber(row.quantity, t)}` : null, row.oemRef ? t.workshop.specOemShown(row.oemRef) : null].filter(Boolean).join(' · ') || row.name}
                      {row.confirmation ? <span className={`chip ${row.confirmation === 'confirmed' ? 'chip-ok' : 'chip-dueSoon'}`}>{row.confirmation === 'confirmed' ? t.notion.confirmed : t.notion.toConfirm}</span> : null}
                    </span>
                  ))}
                  {need.products.length > 0 ? (
                    <span className="muted">
                      {t.notion.productsLine(
                        need.products
                          .map((p) => `${p.name || [p.brand, p.reference].filter(Boolean).join(' ')}${need.rows.some((r) => r.chosenProductId === p.id) ? ` (${t.notion.chosenProduct})` : ''}`)
                          .join(', '),
                      )}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {components.length > 0 ? (
        <section>
          <h2>{t.notion.components}</h2>
          <ul className="list">
            {components.map((c) => (
              <li key={c.id}>
                <div className="history-row">
                  <strong>{c.name}</strong>
                  {torque
                    .filter((x) => x.component.id === c.id)
                    .map(({ spec }) => (
                      <span key={spec.id}>
                        {t.notion.torqueLine([localizeNumber(spec.value, t), spec.unit].filter(Boolean).join(' '))}
                        {spec.confirmation === 'to_confirm' ? <span className="chip chip-dueSoon">{t.notion.toConfirm}</span> : null}
                      </span>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {tools.length > 0 ? (
        <section>
          <h2>{t.notion.toolsNeeded}</h2>
          <ul className="list">
            {tools.map((tool) => (
              <li key={tool.id}>
                <div className="history-row">
                  <strong>
                    {tool.name}
                    <span className={`chip ${tool.owned ? 'chip-ok' : 'chip-unknown'}`}>{tool.owned ? t.notion.owned : t.notion.notOwned}</span>
                  </strong>
                  {tool.size ? <span className="muted">{tool.size}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export function TaskPage({ task, vehicle, snapshot }: { task: MaintenanceTask; vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const due = useMemo(
    () => vehicleDue(snapshot, vehicle.id, today).due.find((d) => d.taskId === task.id),
    [snapshot, vehicle.id, today, task.id],
  );
  const owned = vehicle.ownership === 'owned';
  const history = snapshot.services
    .filter((s) => s.taskIds.includes(task.id))
    .sort((a, b) => (a.date === b.date ? (b.odometer ?? 0) - (a.odometer ?? 0) : a.date < b.date ? 1 : -1));

  return (
    <Layout
      title={taskName(task, t)}
      back={`/vehicles/${vehicle.id}`}
      titleAction={
        isDesktop ? (
          <a className="button button-small" href={`#/tasks/${task.id}/edit`} aria-label={t.workshop.editTask}>
            <Icon name="pencil" /> {t.vehicle.editShort}
          </a>
        ) : undefined
      }
    >
      <section className="card">
        <p className="muted">
          {vehicle.name} · {t.setup.actions[task.action]}
        </p>
        <p>{describeInterval(task, t)}</p>
        {due && owned ? (
          <p className="task-title">
            <StatusChip status={due.status} /> <span>{describeDue(due, t)}</span>
          </p>
        ) : null}
        {owned ? (
          <a className="button button-primary button-block" href={`#/vehicles/${vehicle.id}/service/${task.id}`}>
            {t.vehicle.logService}
          </a>
        ) : null}
      </section>

      {task.notes ? (
        <section>
          <h2>{t.workshop.notesTitle}</h2>
          <p className="card notes">
            <Linked text={task.notes} />
          </p>
        </section>
      ) : task.refTaskId ? null : (
        <p className="empty">{t.workshop.emptyCard}</p>
      )}

      <TaskNeeds task={task} vehicle={vehicle} snapshot={snapshot} />

      <section>
        <h2>{t.vehicle.history}</h2>
        {history.length === 0 && task.baselineDate === null ? <p className="empty">{t.workshop.noTaskHistory}</p> : null}
        <ul className="list">
          {history.map((s) => (
            <li key={s.id}>
              <a href={`#/services/${s.id}/edit`} className="history-row">
                <span>
                  <strong>{formatDate(s.date, t)}</strong>
                  {s.odometer !== null ? ` · ${formatKm(s.odometer)}` : ''}
                </span>
                <span className="muted">
                  {t.service.performers[s.performedBy]}
                  {s.totalCost !== null ? ` · ${formatMoney(s.totalCost, t)}` : ''}
                </span>
                {s.partsUsed.length > 0 ? <span className="muted">{s.partsUsed.map(describePart).join(', ')}</span> : null}
                {s.notes ? <span className="muted">{s.notes}</span> : null}
              </a>
            </li>
          ))}
          {task.baselineDate !== null ? (
            <li>
              <div className="history-row">
                <span>
                  <strong>{formatDate(task.baselineDate, t)}</strong>
                  {task.baselineOdometer !== null ? ` · ${formatKm(task.baselineOdometer)}` : ''}
                </span>
                <span className="muted">{t.vehicle.beforeTracking.replace(/^[\s(·]+|[)\s]+$/g, '')}</span>
              </div>
            </li>
          ) : null}
        </ul>
      </section>

    </Layout>
  );
}

// --- The tools listed in Notion, for the whole garage ---

/** Longer than this, the list gets a search box. */
const TOOLS_SEARCH_FROM = 8;

export function ToolsPage({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const tools = snapshot.tools.filter((tool) => matchesQuery([tool.name, tool.kind, tool.size, tool.notes], query)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Layout title={t.notion.toolsTitle} back="/settings">
      <p className="muted">{t.notion.toolsIntro}</p>
      {snapshot.tools.length > TOOLS_SEARCH_FROM ? (
        <input type="search" className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.notion.toolsSearch} aria-label={t.notion.toolsSearch} autoComplete="off" />
      ) : null}
      {snapshot.tools.length > 0 ? <p className="muted">{t.notion.toolCount(tools.length)}</p> : null}
      {snapshot.tools.length === 0 ? <p className="empty">{t.notion.toolsEmpty}</p> : tools.length === 0 ? <p className="empty">{t.notion.toolsNoMatch}</p> : null}
      <ul className="list list-grid list-even">
        {tools.map((tool) => (
          <li key={tool.id}>
            <div className="history-row">
              <strong>
                {tool.name}
                <span className={`chip ${tool.owned ? 'chip-ok' : 'chip-unknown'}`}>{tool.owned ? t.notion.owned : t.notion.notOwned}</span>
              </strong>
              {tool.kind || tool.size ? <span className="muted">{[tool.kind, tool.size].filter(Boolean).join(' · ')}</span> : null}
              {tool.price !== null ? <span className="muted nowrap">{formatMoney(tool.price, t)}</span> : null}
              {tool.notes ? <span className="muted">{tool.notes}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </Layout>
  );
}

// --- One tab per vehicle on the garage page, reached from the menu; each opens that vehicle's specs page ---

export function WorkshopPage({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const shown = snapshot.vehicles.filter((v) => v.onGaragePage);
  return (
    <Layout title={t.workshop.section}>
      {snapshot.vehicles.length === 0 ? <p className="empty">{t.dashboard.noVehicles}</p> : null}
      {snapshot.vehicles.length > 0 && shown.length === 0 ? (
        <div className="empty">
          <p>{t.dashboard.noneShown}</p>
          {isDesktop ? (
            <a className="button" href="#/vehicles/manage">
              {t.dashboard.manage}
            </a>
          ) : (
            <DesktopOnlyNote />
          )}
        </div>
      ) : null}
      <nav className="vehicle-tabs" aria-label={t.workshop.section}>
        {shown.map((v) => (
          <a key={v.id} className="button button-block with-icon" href={`#/vehicles/${v.id}/specs`}>
            <VehicleIcon vehicle={v} /> {v.name}
          </a>
        ))}
      </nav>
    </Layout>
  );
}
