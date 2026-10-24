import { useMemo, useState, type FormEvent } from 'react';
import { todayIso } from '../../shared/dates.ts';
import { vehicleDue } from '../../shared/due.ts';
import type { Service, Snapshot, Vehicle } from '../../shared/types.ts';
import { newId } from '../api.ts';
import { Field, Layout, StatusChip } from '../components.tsx';
import { formatKm, parseNumber } from '../format.ts';
import { useT } from '../i18n.ts';
import { navigate } from '../router.ts';
import { enqueue, online, useStore } from '../store.ts';

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
    await enqueue({
      kind: 'service',
      data: { id: existing?.id ?? newId(), vehicleId: vehicle.id, date, odometer, taskIds: [...selected], notes: notes.trim() || null },
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
      <form onSubmit={submit} className="form">
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
          {due.map((d) => (
            <label key={d.taskId} className={`check ${selected.has(d.taskId) ? 'check-on' : ''}`}>
              <input type="checkbox" checked={selected.has(d.taskId)} onChange={() => toggle(d.taskId)} />
              <span className="due-name">{tasks.get(d.taskId)?.name}</span>
              <StatusChip status={d.status} />
            </label>
          ))}
        </fieldset>

        <Field label={t.service.notes} hint={t.service.notesHint}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </Field>

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
