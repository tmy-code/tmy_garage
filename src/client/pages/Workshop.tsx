import { Fragment, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { todayIso } from '../../shared/dates.ts';
import { vehicleDue } from '../../shared/due.ts';
import type { PartUnit, VehicleSpecKind } from '../../shared/schemas.ts';
import type { FitmentPosition, MaintenanceTask, PartSpec, PartUsed, Snapshot, Vehicle, VehicleSpec } from '../../shared/types.ts';
import { fitments, lastUsed, SHOPPING_HORIZON_DAYS, shoppingList, type PartUsage } from '../../shared/workshop.ts';
import { Field, Layout, NeedsConnection, StatusChip } from '../components.tsx';
import { describeDue, describeInterval, describeOfficialInterval, formatDate, formatKm, formatQuantity, parseNumber } from '../format.ts';
import { messages, useT, type Messages } from '../i18n.ts';
import { navigate } from '../router.ts';
import { online } from '../store.ts';
import { Submit, useSubmit } from './SetupForms.tsx';

// Workshop data (specs, Part Specs, positions, workshop cards) is desk work and needs a connection, like other setup.
// Reading it works offline from the phone's copy, which is what matters mid-job.

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

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          type="button"
          key={v}
          role="radio"
          aria-checked={value === v}
          className={value === v ? 'on' : ''}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
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
      {error ? <p className="banner banner-error">{error}</p> : null}
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

function useEditor() {
  const [editing, setEditing] = useState<Editing>(null);
  const submit = useSubmit();
  function save(fn: () => Promise<unknown>) {
    void submit.run(async () => {
      await fn();
      setEditing(null);
    });
  }
  function remove(name: string, fn: () => Promise<unknown>) {
    if (window.confirm(messages().workshop.confirmDelete(name))) save(fn);
  }
  return { editing, setEditing: (e: Editing) => (submit.setError(null), setEditing(e)), save, remove, ...submit };
}

// --- Vehicle Specs ---

function SpecEditor({ vehicle, existing, editor }: { vehicle: Vehicle; existing?: VehicleSpec; editor: ReturnType<typeof useEditor> }) {
  const t = useT();
  const [kind, setKind] = useState<VehicleSpecKind>(existing?.kind ?? 'torque');
  const [name, setName] = useState(existing?.name ?? '');
  const [value, setValue] = useState(existing?.value ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const body = { kind, name, value, notes };
  return (
    <InlineEditor
      onSubmit={() =>
        editor.save(() =>
          existing ? online('PUT', `/api/specs/${existing.id}`, body) : online('POST', `/api/vehicles/${vehicle.id}/specs`, body),
        )
      }
      onCancel={() => editor.setEditing(null)}
      onDelete={existing ? () => editor.remove(existing.name, () => online('DELETE', `/api/specs/${existing.id}`)) : undefined}
      disabled={editor.disabled}
      error={editor.error}
    >
      <Segmented
        label={t.setup.kind}
        value={kind}
        onChange={setKind}
        options={[
          ['torque', t.workshop.torque],
          ['other', t.workshop.other],
        ]}
      />
      <Field label={t.workshop.specName} hint={t.workshop.specNameHint}>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
      </Field>
      <Field label={t.workshop.value} hint={t.workshop.valueHint}>
        <input value={value} onChange={(e) => setValue(e.target.value)} required maxLength={120} />
      </Field>
      <Field label={t.workshop.notes} hint={t.workshop.specNotesHint}>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </Field>
    </InlineEditor>
  );
}

function SpecLine({ spec }: { spec: VehicleSpec }) {
  return (
    <>
      <span>
        <strong>{spec.name}</strong> · {spec.value}
      </span>
      {spec.notes ? <span className="muted">{spec.notes}</span> : null}
    </>
  );
}

export function SpecsPage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const editor = useEditor();
  const specs = snapshot.vehicleSpecs.filter((s) => s.vehicleId === vehicle.id);
  const groups: [string, VehicleSpec[]][] = [
    [t.workshop.torqueSpecs, specs.filter((s) => s.kind === 'torque')],
    [t.workshop.otherSpecs, specs.filter((s) => s.kind === 'other')],
  ];
  return (
    <Layout title={t.workshop.specsTitle(vehicle.name)} back={`/vehicles/${vehicle.id}`}>
      <NeedsConnection />
      {specs.length === 0 && editor.editing !== 'new' ? <p className="empty">{t.workshop.noSpecs}</p> : null}
      {groups.map(([title, items]) =>
        items.length === 0 ? null : (
          <section key={title}>
            <h2>{title}</h2>
            <ul className="list list-grid">
              {items.map((spec) =>
                editor.editing === spec.id ? (
                  <li key={spec.id} className="editing">
                    <SpecEditor vehicle={vehicle} existing={spec} editor={editor} />
                  </li>
                ) : (
                  <li key={spec.id}>
                    <button type="button" className="item-row" onClick={() => editor.setEditing(spec.id)}>
                      <SpecLine spec={spec} />
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        ),
      )}
      {editor.editing === 'new' ? (
        <SpecEditor vehicle={vehicle} editor={editor} />
      ) : (
        <button type="button" className="button button-block" onClick={() => editor.setEditing('new')}>
          + {t.workshop.add}
        </button>
      )}
    </Layout>
  );
}

// --- Part Specs ---

function PartSpecEditor({ vehicle, existing, editor }: { vehicle: Vehicle; existing?: PartSpec; editor: ReturnType<typeof useEditor> }) {
  const t = useT();
  const [name, setName] = useState(existing?.name ?? '');
  const [characteristics, setCharacteristics] = useState(existing?.characteristics ?? '');
  const [partNumbers, setPartNumbers] = useState(existing?.partNumbers ?? '');
  const [unit, setUnit] = useState<PartUnit>(existing?.unit ?? 'piece');
  const body = { name, characteristics, partNumbers, unit };
  return (
    <InlineEditor
      onSubmit={() =>
        editor.save(() =>
          existing ? online('PUT', `/api/part-specs/${existing.id}`, body) : online('POST', `/api/vehicles/${vehicle.id}/part-specs`, body),
        )
      }
      onCancel={() => editor.setEditing(null)}
      onDelete={existing ? () => editor.remove(existing.name, () => online('DELETE', `/api/part-specs/${existing.id}`)) : undefined}
      disabled={editor.disabled}
      error={editor.error}
    >
      <Field label={t.workshop.partName} hint={t.workshop.partNameHint}>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
      </Field>
      <Field label={t.workshop.characteristics} hint={t.workshop.characteristicsHint}>
        <input value={characteristics} onChange={(e) => setCharacteristics(e.target.value)} maxLength={500} />
      </Field>
      <Field label={t.workshop.partNumbers} hint={t.workshop.partNumbersHint}>
        <input value={partNumbers} onChange={(e) => setPartNumbers(e.target.value)} maxLength={500} />
      </Field>
      <p className="field-label">{t.workshop.unit}</p>
      <Segmented
        label={t.workshop.unit}
        value={unit}
        onChange={setUnit}
        options={[
          ['piece', t.workshop.piece],
          ['litre', t.workshop.litre],
        ]}
      />
    </InlineEditor>
  );
}

function PartSpecLine({ spec }: { spec: PartSpec }) {
  return (
    <>
      <strong>{spec.name}</strong>
      {spec.characteristics ? <span>{spec.characteristics}</span> : null}
      {spec.partNumbers ? <span className="muted">{spec.partNumbers}</span> : null}
    </>
  );
}

export function PartSpecsPage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const editor = useEditor();
  const specs = snapshot.partSpecs.filter((s) => s.vehicleId === vehicle.id);
  return (
    <Layout title={t.workshop.partsTitle(vehicle.name)} back={`/vehicles/${vehicle.id}`}>
      <NeedsConnection />
      {specs.length === 0 && editor.editing !== 'new' ? <p className="empty">{t.workshop.noPartSpecs}</p> : null}
      <ul className="list list-grid">
        {specs.map((spec) =>
          editor.editing === spec.id ? (
            <li key={spec.id} className="editing">
              <PartSpecEditor vehicle={vehicle} existing={spec} editor={editor} />
            </li>
          ) : (
            <li key={spec.id}>
              <button type="button" className="item-row" onClick={() => editor.setEditing(spec.id)}>
                <PartSpecLine spec={spec} />
              </button>
            </li>
          ),
        )}
      </ul>
      {editor.editing === 'new' ? (
        <PartSpecEditor vehicle={vehicle} editor={editor} />
      ) : (
        <button type="button" className="button button-block" onClick={() => editor.setEditing('new')}>
          + {t.workshop.add}
        </button>
      )}
    </Layout>
  );
}

// --- Fitment Positions and what is fitted ---

function PositionEditor({
  vehicle,
  existing,
  editor,
}: {
  vehicle: Vehicle;
  existing?: FitmentPosition;
  editor: ReturnType<typeof useEditor>;
}) {
  const t = useT();
  const [name, setName] = useState(existing?.name ?? '');
  return (
    <InlineEditor
      onSubmit={() =>
        editor.save(() =>
          existing
            ? online('PUT', `/api/positions/${existing.id}`, { name })
            : online('POST', `/api/vehicles/${vehicle.id}/positions`, { name }),
        )
      }
      onCancel={() => editor.setEditing(null)}
      onDelete={existing ? () => editor.remove(existing.name, () => online('DELETE', `/api/positions/${existing.id}`)) : undefined}
      disabled={editor.disabled}
      error={editor.error}
    >
      <Field label={t.workshop.positionName} hint={t.workshop.positionHint}>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
      </Field>
    </InlineEditor>
  );
}

function FittedLine({ usage, estimatedOdometer, t }: { usage: PartUsage; estimatedOdometer: number | null; t: Messages }) {
  const since =
    estimatedOdometer !== null && estimatedOdometer > usage.odometer ? t.workshop.since(formatKm(estimatedOdometer - usage.odometer)) : '';
  return (
    <>
      <span>{describePart(usage.part)}</span>
      <span className="muted">
        {t.workshop.fittedOn(formatDate(usage.date, t), formatKm(usage.odometer))}
        {since}
      </span>
    </>
  );
}

export function FittedPage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const editor = useEditor();
  const today = todayIso();
  const { usage } = useMemo(() => vehicleDue(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const list = fitments(snapshot, vehicle.id);

  function addCommon() {
    editor.save(async () => {
      for (const name of t.workshop.common[vehicle.kind]) await online('POST', `/api/vehicles/${vehicle.id}/positions`, { name });
    });
  }

  return (
    <Layout title={t.workshop.fittedTitle(vehicle.name)} back={`/vehicles/${vehicle.id}`}>
      <NeedsConnection />
      <p className="muted">{t.workshop.fittedIntro}</p>
      {list.length === 0 && editor.editing !== 'new' ? (
        <div className="empty">
          <p>{t.workshop.noPositions}</p>
          <button type="button" className="button" onClick={addCommon} disabled={editor.disabled}>
            {t.workshop.addCommon}
          </button>
          {editor.error ? <p className="banner banner-error">{editor.error}</p> : null}
        </div>
      ) : null}
      <ul className="list list-grid">
        {list.map(({ position, current, previous }) =>
          editor.editing === position.id ? (
            <li key={position.id} className="editing">
              <PositionEditor vehicle={vehicle} existing={position} editor={editor} />
            </li>
          ) : (
            <li key={position.id}>
              <div className="history-row">
                <div className="section-head">
                  <strong>{position.name}</strong>
                  <button type="button" className="button button-small" onClick={() => editor.setEditing(position.id)}>
                    {t.workshop.edit}
                  </button>
                </div>
                {current ? (
                  <FittedLine usage={current} estimatedOdometer={usage.estimatedOdometer} t={t} />
                ) : (
                  <span className="muted">{t.workshop.nothingFitted}</span>
                )}
                {previous.length > 0 ? (
                  <details>
                    <summary className="muted">
                      {t.workshop.previously} {t.workshop.count(previous.length)}
                    </summary>
                    {previous.map((p, i) => (
                      <p key={i} className="history-row">
                        <FittedLine usage={p} estimatedOdometer={null} t={t} />
                      </p>
                    ))}
                  </details>
                ) : null}
              </div>
            </li>
          ),
        )}
      </ul>
      {editor.editing === 'new' ? (
        <PositionEditor vehicle={vehicle} editor={editor} />
      ) : (
        <button type="button" className="button button-block" onClick={() => editor.setEditing('new')}>
          + {t.workshop.add}
        </button>
      )}
    </Layout>
  );
}

// --- A Task's workshop card ---

export function TaskPage({ task, vehicle, snapshot }: { task: MaintenanceTask; vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const due = useMemo(
    () => vehicleDue(snapshot, vehicle.id, today).due.find((d) => d.taskId === task.id),
    [snapshot, vehicle.id, today, task.id],
  );
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const partSpecs = new Map(snapshot.partSpecs.map((p) => [p.id, p]));
  const specs = snapshot.vehicleSpecs.filter((s) => task.specIds.includes(s.id));
  const parts = task.requiredParts.flatMap((r) => {
    const spec = partSpecs.get(r.partSpecId);
    return spec ? [{ spec, quantity: r.quantity, last: lastUsed(snapshot, spec) }] : [];
  });
  const official = describeOfficialInterval(task, t);
  const owned = vehicle.status === 'owned';
  const empty = task.tools.length === 0 && parts.length === 0 && specs.length === 0 && !task.workshopNotes;

  function toggle(i: number) {
    const next = new Set(ticked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setTicked(next);
  }

  return (
    <Layout title={task.name} back={`/vehicles/${vehicle.id}`}>
      <section className="card">
        <p className="muted">{vehicle.name}</p>
        <p>{describeInterval(task, t)}</p>
        {official ? <p className="muted">{official}</p> : null}
        {due && owned ? (
          <p className="task-title">
            <StatusChip status={due.status} /> <span>{describeDue(due, t)}</span>
          </p>
        ) : null}
        {owned ? (
          <a className="button button-primary button-block" href={`#/vehicles/${vehicle.id}/service`}>
            {t.vehicle.logService}
          </a>
        ) : null}
      </section>

      {empty ? <p className="empty">{t.workshop.emptyCard}</p> : null}

      <div className="columns">
        <div>
          {task.tools.length > 0 ? (
            <section>
              <div className="section-head">
                <h2>{t.workshop.checklist}</h2>
                {ticked.size > 0 ? (
                  <button type="button" className="button button-small" onClick={() => setTicked(new Set())}>
                    {t.workshop.untick}
                  </button>
                ) : null}
              </div>
              {task.tools.map((tool, i) => (
                <label key={i} className={`check ${ticked.has(i) ? 'check-on' : ''}`}>
                  <input type="checkbox" checked={ticked.has(i)} onChange={() => toggle(i)} />
                  <span className="due-name">{tool}</span>
                </label>
              ))}
            </section>
          ) : null}

          {parts.length > 0 ? (
            <section>
              <h2>{t.workshop.parts}</h2>
              <ul className="list">
                {parts.map(({ spec, quantity, last }) => (
                  <li key={spec.id}>
                    <div className="history-row">
                      <span>
                        <strong>{spec.name}</strong> · {formatQuantity(quantity, spec.unit, t)}
                      </span>
                      {spec.characteristics ? <span>{spec.characteristics}</span> : null}
                      {spec.partNumbers ? <span className="muted">{spec.partNumbers}</span> : null}
                      {last ? (
                        <span className="muted">{t.workshop.lastUsed(describePart(last.part), formatDate(last.date, t))}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div>
          {specs.length > 0 ? (
            <section>
              <h2>{t.workshop.specsUsed}</h2>
              <ul className="list">
                {specs.map((spec) => (
                  <li key={spec.id}>
                    <div className="history-row">
                      <SpecLine spec={spec} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {task.workshopNotes ? (
            <section>
              <h2>{t.workshop.notesTitle}</h2>
              <p className="card notes">
                <Linked text={task.workshopNotes} />
              </p>
            </section>
          ) : null}
        </div>
      </div>

      <section className="actions actions-footer">
        <a className="button" href={`#/tasks/${task.id}/workshop`}>
          {t.workshop.editWorkshop}
        </a>
        <a className="button" href={`#/tasks/${task.id}/edit`}>
          {t.workshop.editTask}
        </a>
      </section>
    </Layout>
  );
}

export function WorkshopForm({ task, vehicle, snapshot }: { task: MaintenanceTask; vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const partSpecs = snapshot.partSpecs.filter((p) => p.vehicleId === vehicle.id);
  const vehicleSpecs = snapshot.vehicleSpecs.filter((s) => s.vehicleId === vehicle.id);
  const [notes, setNotes] = useState(task.workshopNotes ?? '');
  const [tools, setTools] = useState(task.tools.join('\n'));
  const [parts, setParts] = useState(task.requiredParts.map((r) => ({ partSpecId: r.partSpecId, quantity: String(r.quantity) })));
  const [specIds, setSpecIds] = useState<Set<string>>(new Set(task.specIds));
  const { error, disabled, run } = useSubmit();
  const back = `/tasks/${task.id}`;

  function setPart(i: number, patch: Partial<(typeof parts)[number]>) {
    setParts(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  function toggleSpec(id: string) {
    const next = new Set(specIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSpecIds(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const requiredParts = parts.map((p) => ({ partSpecId: p.partSpecId, quantity: parseNumber(p.quantity) }));
      if (requiredParts.some((p) => p.quantity === null || Number.isNaN(p.quantity) || p.quantity <= 0))
        throw new Error(t.workshop.quantityError);
      if (new Set(requiredParts.map((p) => p.partSpecId)).size !== requiredParts.length) throw new Error(t.workshop.duplicatePart);
      await online('PUT', `/api/tasks/${task.id}/workshop`, {
        workshopNotes: notes,
        requiredParts,
        tools: tools
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        specIds: [...specIds],
      });
      navigate(back, { replace: true });
    });
  }

  return (
    <Layout title={t.workshop.workshopTitle(task.name)} back={back}>
      <NeedsConnection />
      <form onSubmit={submit} className="form">
        <fieldset className="field">
          <legend className="field-label">{t.workshop.requiredParts}</legend>
          {partSpecs.length === 0 ? <p className="muted">{t.workshop.noPartSpecsYet}</p> : null}
          {parts.map((p, i) => {
            const spec = partSpecs.find((s) => s.id === p.partSpecId);
            return (
              <div key={i} className="row part-row">
                <select value={p.partSpecId} onChange={(e) => setPart(i, { partSpecId: e.target.value })} aria-label={t.workshop.partName}>
                  {partSpecs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.characteristics ? ` (${s.characteristics})` : ''}
                    </option>
                  ))}
                </select>
                <input
                  className="quantity"
                  inputMode="decimal"
                  value={p.quantity}
                  onChange={(e) => setPart(i, { quantity: e.target.value })}
                  aria-label={t.workshop.quantity}
                  placeholder={spec ? t.workshop.units[spec.unit](2) : ''}
                />
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => setParts(parts.filter((_, j) => j !== i))}
                  aria-label={t.workshop.remove}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <div className="actions">
            {partSpecs.length > 0 ? (
              <button
                type="button"
                className="button button-small"
                onClick={() => setParts([...parts, { partSpecId: partSpecs[0]!.id, quantity: '1' }])}
              >
                {t.workshop.addPart}
              </button>
            ) : null}
            <a className="button button-small" href={`#/vehicles/${vehicle.id}/parts`}>
              {t.workshop.managePartSpecs}
            </a>
          </div>
        </fieldset>

        <Field label={t.workshop.toolsLabel} hint={t.workshop.toolsHint}>
          <textarea value={tools} onChange={(e) => setTools(e.target.value)} rows={4} />
        </Field>

        <fieldset className="field">
          <legend className="field-label">{t.workshop.specsLabel}</legend>
          {vehicleSpecs.length === 0 ? <p className="muted">{t.workshop.noSpecsYet}</p> : null}
          {vehicleSpecs.map((spec) => (
            <label key={spec.id} className={`check ${specIds.has(spec.id) ? 'check-on' : ''}`}>
              <input type="checkbox" checked={specIds.has(spec.id)} onChange={() => toggleSpec(spec.id)} />
              <span className="due-name">
                {spec.name} · {spec.value}
              </span>
            </label>
          ))}
          <a className="button button-small" href={`#/vehicles/${vehicle.id}/specs`}>
            {t.workshop.manageSpecs}
          </a>
        </fieldset>

        <Field label={t.workshop.notesTitle} hint={t.workshop.notesHint}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={8} maxLength={20_000} />
        </Field>

        {error ? <p className="banner banner-error">{error}</p> : null}
        <Submit disabled={disabled}>{t.workshop.save}</Submit>
      </form>
    </Layout>
  );
}

// --- Shopping list ---

export function ShoppingPage({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const list = useMemo(() => shoppingList(snapshot, todayIso()), [snapshot]);
  return (
    <Layout title={t.workshop.shopping} back="/">
      <p className="muted">{t.workshop.shoppingIntro(SHOPPING_HORIZON_DAYS)}</p>
      {list.length === 0 ? <p className="empty">{t.workshop.nothingToBuy}</p> : null}
      <div className="card-grid">
        {list.map(({ vehicle, items, tasksWithoutParts }) => (
          <section key={vehicle.id}>
            <h2>{vehicle.name}</h2>
            <ul className="list">
              {items.map((item) => (
                <li key={item.partSpec.id}>
                  <div className="history-row">
                    <span>
                      <strong>{item.partSpec.name}</strong> · {formatQuantity(item.quantity, item.partSpec.unit, t)}
                    </span>
                    {item.partSpec.characteristics ? <span>{item.partSpec.characteristics}</span> : null}
                    {item.partSpec.partNumbers ? <span className="muted">{item.partSpec.partNumbers}</span> : null}
                    {item.lastUsed ? (
                      <span className="muted">
                        {t.workshop.lastUsed(describePart(item.lastUsed.part), formatDate(item.lastUsed.date, t))}
                      </span>
                    ) : null}
                    <span className="muted">{t.workshop.forTasks(item.tasks.map(({ task }) => task.name).join(', '))}</span>
                  </div>
                </li>
              ))}
            </ul>
            {tasksWithoutParts.length > 0 ? (
              <p className="nudge">
                {t.workshop.noPartsListed('')}
                {tasksWithoutParts.map((task, i) => (
                  <Fragment key={task.id}>
                    {i > 0 ? ', ' : ''}
                    <a href={`#/tasks/${task.id}/workshop`}>{task.name}</a>
                  </Fragment>
                ))}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </Layout>
  );
}
