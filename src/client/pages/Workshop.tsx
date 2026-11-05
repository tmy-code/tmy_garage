import { Fragment, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { PART_CATEGORIES, type PartCategory } from '../../shared/catalogue.ts';
import { todayIso } from '../../shared/dates.ts';
import { vehicleDue } from '../../shared/due.ts';
import type { PartUnit, SpecGroup } from '../../shared/schemas.ts';
import type { MaintenanceTask, PartUsed, Snapshot, SpecLine, Vehicle, VehiclePart } from '../../shared/types.ts';
import { confirmDelete, Field, FormError, Layout, NeedsConnection, StatusChip } from '../components.tsx';
import { describeDue, describeInterval, formatDate, formatKm, formatMoney, parseNumber, taskName } from '../format.ts';
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
      <div className="segmented" role="radiogroup" aria-label={t.workshop.specGroup}>
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

export function SpecsPage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const editor = useEditor();
  const wide = useWide();
  const categories = specCategoriesOf(snapshot, vehicle.id);
  const editing = snapshot.specLines.find((l) => l.id === editor.editing);
  async function addStandard() {
    try {
      const { added } = await online<{ added: number }>('POST', `/api/vehicles/${vehicle.id}/add-standard-specs`, { lang: getLang() });
      showToast(t.workshop.standardSpecsAdded(added));
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
          <button type="button" className="button button-block" onClick={addStandard}>
            {t.workshop.addStandardSpecs}
          </button>
          {!wide && editor.editing === 'new' ? <SpecEditor vehicle={vehicle} editor={editor} /> : null}
          {categories.length === 0 && editor.editing !== 'new' ? <p className="empty">{t.workshop.noSpecs}</p> : null}
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
      ) : (
        <p className="empty">{t.workshop.emptyCard}</p>
      )}

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
