import { Fragment, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { PART_CATEGORIES, type PartCategory } from '../../shared/catalogue.ts';
import { todayIso } from '../../shared/dates.ts';
import { requiredConsumables, torqueSpecs } from '../../shared/applicability.ts';
import { vehicleDue } from '../../shared/due.ts';
import type { PartUnit, SpecGroup } from '../../shared/schemas.ts';
import type { MaintenanceTask, PartUsed, Snapshot, SpecLine, Vehicle, VehiclePart, VehicleSpec } from '../../shared/types.ts';
import { confirmDelete, Field, FormError, Layout, NeedsConnection, segmentedKeys, StatusChip } from '../components.tsx';
import { describeDue, describeInterval, formatDate, formatKm, formatMoney, localizeNumber, matchesQuery, parseNumber, taskName } from '../format.ts';
import { VehicleIcon } from '../brands.tsx';
import { Icon } from '../icons.tsx';
import { showToast } from '../feedback.ts';
import { getLang, messages, useT } from '../i18n.ts';
import { online } from '../store.ts';
import { useSubmit } from './SetupForms.tsx';

// Specs are desk work and need a connection, like other setup. Reading them works offline from the phone's copy,
// which is what matters mid-job.

const GROUPS: readonly SpecGroup[] = ['fluids', 'parts', 'torque', 'other'];

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
  children,
}: {
  onSubmit: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  disabled: boolean;
  error: string | null;
  children: ReactNode;
}) {
  const t = useT();
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <form onSubmit={submit} className="form card inline-editor">
      {children}
      <FormError error={error} />
      <div className="actions">
        <button type="button" className="button" onClick={onCancel}>
          {t.workshop.cancel}
        </button>
        <button type="submit" className="button button-primary" disabled={disabled}>
          {t.workshop.save}
        </button>
      </div>
      {onDelete ? (
        <button type="button" className="button button-danger button-block" onClick={onDelete} disabled={disabled}>
          {t.workshop.delete}
        </button>
      ) : null}
    </form>
  );
}

type Editing = string | 'new' | null;

function AddButton({ editor, label }: { editor: ReturnType<typeof useEditor>; label?: string }) {
  const t = useT();
  if (editor.editing === 'new') return null;
  return (
    <button type="button" className="button button-small" onClick={() => editor.setEditing('new')}>
      + {label ?? t.workshop.add}
    </button>
  );
}

function useEditor() {
  const [editing, setEditing] = useState<Editing>(null);
  const submit = useSubmit();
  function save(fn: () => Promise<unknown>, done?: string) {
    void submit.run(async () => {
      await fn();
      setEditing(null);
    }, done);
  }
  function remove(name: string, fn: () => Promise<unknown>) {
    const t = messages();
    void confirmDelete(t.workshop.confirmDelete(name)).then((ok) => ok && save(fn, t.feedback.deleted));
  }
  return { editing, setEditing: (e: Editing) => (submit.setError(null), setEditing(e)), save, remove, ...submit };
}

// --- Spec lines of a Vehicle Profile ---

const WIDE = '(min-width: 1000px)';

/** Whether the screen is wide enough for an editor beside its list (the same width the page layout switches at). */
function useWide(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => window.matchMedia(WIDE).matches,
  );
}

function SpecEditor({ vehicle, existing, editor }: { vehicle: Vehicle; existing?: SpecLine; editor: ReturnType<typeof useEditor> }) {
  const t = useT();
  const [group, setGroup] = useState<SpecGroup>(existing?.group ?? 'fluids');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [value, setValue] = useState(existing?.value ?? '');
  const [oem, setOem] = useState(existing?.oem ?? '');
  const [category, setCategory] = useState<PartCategory | null>(existing?.category ?? null);
  const body = { group, label, value, oem, category };
  return (
    <InlineEditor
      onSubmit={() =>
        editor.save(() =>
          existing ? online('PUT', `/api/specs/${existing.id}`, body) : online('POST', `/api/vehicles/${vehicle.id}/specs`, body),
        )
      }
      onCancel={() => editor.setEditing(null)}
      onDelete={existing ? () => editor.remove(existing.label, () => online('DELETE', `/api/specs/${existing.id}`)) : undefined}
      disabled={editor.disabled}
      error={editor.error}
    >
      <div className="segmented" role="radiogroup" aria-label={t.workshop.specGroup} onKeyDown={segmentedKeys}>
        {GROUPS.map((g) => (
          <button type="button" key={g} role="radio" aria-checked={group === g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>
            {t.workshop.specGroups[g]}
          </button>
        ))}
      </div>
      <Field label={t.workshop.specLabel} hint={t.workshop.specLabelHint}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} autoFocus />
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
      <Field label={t.workshop.specValue} hint={t.workshop.specValueHint}>
        <input value={value} onChange={(e) => setValue(e.target.value)} required maxLength={200} />
      </Field>
      <Field label={t.workshop.specOem} hint={t.workshop.specOemHint}>
        <input value={oem} onChange={(e) => setOem(e.target.value)} maxLength={80} />
      </Field>
    </InlineEditor>
  );
}

/**
 * A Vehicle's spec lines by category in screen order (what is in none is under Other), then by group (fluids, parts,
 * torque, other), in the order they were entered. Empty categories and groups are left out.
 */
export function specCategoriesOf(snapshot: Snapshot, vehicleId: string): [PartCategory, [SpecGroup, SpecLine[]][]][] {
  const lines = snapshot.specLines.filter((s) => s.vehicleId === vehicleId);
  return PART_CATEGORIES.map((c) => {
    const inCategory = lines.filter((s) => (s.category ?? 'other') === c);
    const groups = GROUPS.map((g) => [g, inCategory.filter((s) => s.group === g).sort((a, b) => a.sort - b.sort)] as [SpecGroup, SpecLine[]]).filter(
      ([, items]) => items.length > 0,
    );
    return [c, groups] as [PartCategory, [SpecGroup, SpecLine[]][]];
  }).filter(([, groups]) => groups.length > 0);
}

function SpecText({ spec }: { spec: SpecLine }) {
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

/** A spec from Notion: read-only, with where it comes from and whether it is confirmed. */
function NotionSpecRow({ spec }: { spec: VehicleSpec }) {
  const t = useT();
  return (
    <li>
      <div className="spec-row">
        <span>
          <strong>{spec.label}</strong>
          <span className="spec-badges">
            <span className="chip chip-neutral">{t.notion.badge}</span>
            {spec.status ? <span className={`chip ${spec.status === 'confirmed' ? 'chip-ok' : 'chip-dueSoon'}`}>{spec.status === 'confirmed' ? t.notion.confirmed : t.notion.toConfirm}</span> : null}
          </span>
        </span>
        <span>
          {spec.value ? [localizeNumber(spec.value, t), spec.unit].filter(Boolean).join(' ') : <span className="muted">{t.workshop.specToFill}</span>}
          {spec.source ? <small className="muted spec-oem">{spec.source}</small> : null}
        </span>
      </div>
    </li>
  );
}

/** The specs Notion keeps for a Vehicle, by category (what has none is last), in the order Notion gave them. */
function notionSpecGroups(snapshot: Snapshot, vehicleId: string): [string | null, VehicleSpec[]][] {
  const specs = snapshot.vehicleSpecs.filter((s) => s.vehicleId === vehicleId);
  const categories = [...new Set(specs.map((s) => s.category))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  return categories.map((c) => [c, specs.filter((s) => s.category === c)]);
}

export function SpecsPage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const editor = useEditor();
  const wide = useWide();
  const categories = specCategoriesOf(snapshot, vehicle.id);
  const notionGroups = notionSpecGroups(snapshot, vehicle.id);
  // Once the Notion catalogue exists the usual specs are not added any more.
  const catalogueActive = snapshot.refTasks.length > 0;
  const editing = snapshot.specLines.find((l) => l.id === editor.editing);
  async function addStandard() {
    try {
      const { added, skipped } = await online<{ added: number; skipped?: string }>('POST', `/api/vehicles/${vehicle.id}/add-standard-specs`, { lang: getLang() });
      showToast(skipped ? t.notion.standardSkipped : t.workshop.standardSpecsAdded(added));
    } catch (e) {
      showToast((e as Error).message);
    }
  }
  return (
    <Layout title={t.workshop.specsTitle(vehicle.name)} back={`/vehicles/${vehicle.id}`} titleAction={<AddButton editor={editor} />}>
      <NeedsConnection />
      <p className="muted">{t.workshop.specsIntro}</p>
      <div className={wide ? 'split' : undefined}>
        <div className="split-main">
          {catalogueActive ? null : (
            <button type="button" className="button button-block" onClick={addStandard}>
              {t.workshop.addStandardSpecs}
            </button>
          )}
          {notionGroups.length > 0 ? (
            <section>
              <h2>{t.notion.specsFromNotion}</h2>
              <p className="muted">{t.notion.readOnlyHint}</p>
              {notionGroups.map(([category, specs]) => (
                <Fragment key={category ?? 'none'}>
                  {category ? <h3 className="due-group">{category}</h3> : null}
                  <ul className="list list-plain">
                    {specs.map((spec) => (
                      <NotionSpecRow key={spec.id} spec={spec} />
                    ))}
                  </ul>
                </Fragment>
              ))}
            </section>
          ) : null}
          {!wide && editor.editing === 'new' ? <SpecEditor vehicle={vehicle} editor={editor} /> : null}
          {categories.length === 0 && notionGroups.length === 0 && editor.editing !== 'new' ? <p className="empty">{t.workshop.noSpecs}</p> : null}
          {categories.length > 0 && notionGroups.length > 0 ? <h2>{t.notion.specsOwn}</h2> : null}
          {categories.map(([category, groups]) => (
            <section key={category}>
              <h2>{t.workshop.partCategories[category]}</h2>
              {groups.map(([group, items]) => (
                <Fragment key={group}>
                  <h3 className="due-group">{t.workshop.specGroups[group]}</h3>
                  <ul className="list list-plain">
                    {items.map((spec) =>
                      !wide && editor.editing === spec.id ? (
                        <li key={spec.id} className="editing">
                          <SpecEditor vehicle={vehicle} existing={spec} editor={editor} />
                        </li>
                      ) : (
                        <li key={spec.id}>
                          <button type="button" className={`item-row spec-row ${editor.editing === spec.id ? 'item-selected' : ''}`} onClick={() => editor.setEditing(spec.id)}>
                            <SpecText spec={spec} />
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                </Fragment>
              ))}
            </section>
          ))}
        </div>
        {wide && editor.editing ? (
          <div className="side-editor">
            <SpecEditor key={editor.editing} vehicle={vehicle} existing={editing} editor={editor} />
          </div>
        ) : null}
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
                      {row.status ? <span className={`chip ${row.status === 'confirmed' ? 'chip-ok' : 'chip-dueSoon'}`}>{row.status === 'confirmed' ? t.notion.confirmed : t.notion.toConfirm}</span> : null}
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
                        {spec.status === 'to_confirm' ? <span className="chip chip-dueSoon">{t.notion.toConfirm}</span> : null}
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
  const owned = vehicle.status === 'owned';
  const history = snapshot.services
    .filter((s) => s.taskIds.includes(task.id))
    .sort((a, b) => (a.date === b.date ? (b.odometer ?? 0) - (a.odometer ?? 0) : a.date < b.date ? 1 : -1));

  return (
    <Layout
      title={taskName(task, t)}
      back={`/vehicles/${vehicle.id}`}
      titleAction={
        <a className="button button-small" href={`#/tasks/${task.id}/edit`} aria-label={t.workshop.editTask}>
          <Icon name="pencil" /> {t.vehicle.editShort}
        </a>
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
          <a className="button" href="#/vehicles/manage">
            {t.dashboard.manage}
          </a>
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
