import { useState, type FormEvent, type ReactNode } from 'react';
import { todayIso } from '../../shared/dates.ts';
import type { MaintenanceTask, Snapshot, Vehicle } from '../../shared/types.ts';
import { Field, Layout, NeedsConnection } from '../components.tsx';
import { parseNumber } from '../format.ts';
import { navigate } from '../router.ts';
import { online, useStore } from '../store.ts';

// Vehicle and Maintenance Task setup is desk work and needs a connection (ADR 0001).

function useSubmit() {
  const { reachable } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { error, setError, busy, disabled: busy || !reachable, run };
}

function Submit({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return (
    <button type="submit" className="button button-primary button-block" disabled={disabled}>
      {children}
    </button>
  );
}

function optionalNumber(text: string, label: string): number | null {
  const n = parseNumber(text);
  if (n !== null && (Number.isNaN(n) || n < 0 || !Number.isInteger(n))) throw new Error(`${label} must be a whole number.`);
  return n;
}

export function VehicleForm({ existing }: { existing?: Vehicle }) {
  const [kind, setKind] = useState<Vehicle['kind']>(existing?.kind ?? 'motorcycle');
  const [name, setName] = useState(existing?.name ?? '');
  const [make, setMake] = useState(existing?.make ?? '');
  const [model, setModel] = useState(existing?.model ?? '');
  const [year, setYear] = useState(existing?.year ? String(existing.year) : '');
  const [registration, setRegistration] = useState(existing?.registration ?? '');
  const { error, disabled, run } = useSubmit();
  const back = existing ? `/vehicles/${existing.id}` : '/';

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const body = { kind, name, make, model, year: optionalNumber(year, 'Year'), registration };
      const saved = existing
        ? await online<Vehicle>('PUT', `/api/vehicles/${existing.id}`, body)
        : await online<Vehicle>('POST', '/api/vehicles', body);
      navigate(`/vehicles/${saved.id}`, { replace: true });
    });
  }

  return (
    <Layout title={existing ? 'Edit vehicle' : 'New vehicle'} back={back}>
      <NeedsConnection />
      <form onSubmit={submit} className="form">
        <div className="segmented" role="radiogroup" aria-label="Kind">
          {(['motorcycle', 'car'] as const).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k === 'car' ? '🚗 Car' : '🏍️ Motorcycle'}
            </button>
          ))}
        </div>
        <Field label="Name" hint="What you call it, e.g. “The Tracer” or “Clio”.">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </Field>
        <Field label="Make">
          <input value={make} onChange={(e) => setMake(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Model">
          <input value={model} onChange={(e) => setModel(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Year">
          <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} maxLength={4} />
        </Field>
        <Field label="Registration">
          <input value={registration} onChange={(e) => setRegistration(e.target.value.toUpperCase())} maxLength={20} />
        </Field>
        {error ? <p className="banner banner-error">{error}</p> : null}
        <Submit disabled={disabled}>{existing ? 'Save' : 'Add vehicle'}</Submit>
      </form>
    </Layout>
  );
}

export function SellForm({ vehicle }: { vehicle: Vehicle }) {
  const [date, setDate] = useState(vehicle.soldDate ?? todayIso());
  const [odometer, setOdometer] = useState(vehicle.soldOdometer !== null ? String(vehicle.soldOdometer) : '');
  const [price, setPrice] = useState(vehicle.soldPrice !== null ? String(vehicle.soldPrice) : '');
  const { error, disabled, run } = useSubmit();
  const back = `/vehicles/${vehicle.id}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const p = parseNumber(price);
      if (p !== null && (Number.isNaN(p) || p < 0)) throw new Error('Price must be a positive number.');
      await online('POST', `/api/vehicles/${vehicle.id}/sell`, { date, odometer: optionalNumber(odometer, 'Odometer'), price: p });
      navigate(back, { replace: true });
    });
  }

  function unsell() {
    void run(async () => {
      await online('POST', `/api/vehicles/${vehicle.id}/unsell`);
      navigate(back, { replace: true });
    });
  }

  return (
    <Layout title={`Sell ${vehicle.name}`} back={back}>
      <NeedsConnection />
      <p className="muted">A sold vehicle keeps its full history but no longer shows anything due.</p>
      <form onSubmit={submit} className="form">
        <Field label="Sale date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Odometer at sale (km)">
          <input inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </Field>
        <Field label="Price (€)">
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        {error ? <p className="banner banner-error">{error}</p> : null}
        <Submit disabled={disabled}>{vehicle.status === 'sold' ? 'Save sale details' : 'Mark as sold'}</Submit>
        {vehicle.status === 'sold' ? (
          <button type="button" className="button button-block" onClick={unsell} disabled={disabled}>
            Undo: I still own it
          </button>
        ) : null}
      </form>
    </Layout>
  );
}

export function TaskForm({ vehicle, existing }: { vehicle: Vehicle; existing?: MaintenanceTask }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [intervalKm, setIntervalKm] = useState(String(existing?.intervalKm ?? ''));
  const [intervalMonths, setIntervalMonths] = useState(String(existing?.intervalMonths ?? ''));
  const [baselineDate, setBaselineDate] = useState(existing?.baselineDate ?? '');
  const [baselineOdometer, setBaselineOdometer] = useState(String(existing?.baselineOdometer ?? ''));
  const { error, disabled, run } = useSubmit();
  const back = `/vehicles/${vehicle.id}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const body = {
        name,
        intervalKm: optionalNumber(intervalKm, 'Distance'),
        intervalMonths: optionalNumber(intervalMonths, 'Months'),
        baselineDate: baselineDate || null,
        baselineOdometer: optionalNumber(baselineOdometer, 'Odometer'),
      };
      if (body.intervalKm === null && body.intervalMonths === null) throw new Error('Give a distance, a duration, or both.');
      if (body.baselineOdometer !== null && body.baselineDate === null) throw new Error('Add the date it was last done too.');
      if (existing) await online('PUT', `/api/tasks/${existing.id}`, body);
      else await online('POST', `/api/vehicles/${vehicle.id}/tasks`, body);
      navigate(back, { replace: true });
    });
  }

  function remove() {
    if (!existing || !window.confirm(`Delete “${existing.name}”?`)) return;
    void run(async () => {
      await online('DELETE', `/api/tasks/${existing.id}`);
      navigate(back, { replace: true });
    });
  }

  return (
    <Layout title={existing ? 'Edit task' : `New task · ${vehicle.name}`} back={back}>
      <NeedsConnection />
      <form onSubmit={submit} className="form">
        <Field label="Task" hint="e.g. “Engine oil and filter change”.">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <p className="field-label">Interval: whichever comes first</p>
        <div className="row">
          <Field label="Every (km)">
            <input inputMode="numeric" value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} placeholder="6000" />
          </Field>
          <Field label="or every (months)">
            <input inputMode="numeric" value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)} placeholder="12" />
          </Field>
        </div>
        <p className="field-label">Last done before you started tracking (optional)</p>
        <div className="row">
          <Field label="Date">
            <input type="date" value={baselineDate} onChange={(e) => setBaselineDate(e.target.value)} />
          </Field>
          <Field label="At (km)">
            <input inputMode="numeric" value={baselineOdometer} onChange={(e) => setBaselineOdometer(e.target.value)} />
          </Field>
        </div>
        <p className="muted">Once you log a Service including this task, the Service takes over from this.</p>
        {error ? <p className="banner banner-error">{error}</p> : null}
        <Submit disabled={disabled}>{existing ? 'Save' : 'Add task'}</Submit>
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
            Delete task
          </button>
        ) : null}
      </form>
    </Layout>
  );
}

export function CopyTasks({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const sources = snapshot.vehicles.filter((v) => v.id !== vehicle.id && snapshot.tasks.some((t) => t.vehicleId === v.id));
  const [fromVehicleId, setFrom] = useState(sources[0]?.id ?? '');
  const { error, disabled, run } = useSubmit();
  const back = `/vehicles/${vehicle.id}`;
  const count = snapshot.tasks.filter((t) => t.vehicleId === fromVehicleId).length;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await online('POST', `/api/vehicles/${vehicle.id}/copy-tasks`, { fromVehicleId });
      navigate(back, { replace: true });
    });
  }

  return (
    <Layout title="Copy tasks" back={back}>
      <NeedsConnection />
      {sources.length === 0 ? (
        <p className="empty">No other vehicle has Maintenance Tasks to copy yet.</p>
      ) : (
        <form onSubmit={submit} className="form">
          <Field label="Copy from" hint={`${count} task${count === 1 ? '' : 's'} will be added to ${vehicle.name}. Their history is not copied.`}>
            <select value={fromVehicleId} onChange={(e) => setFrom(e.target.value)}>
              {sources.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          {error ? <p className="banner banner-error">{error}</p> : null}
          <Submit disabled={disabled}>Copy tasks</Submit>
        </form>
      )}
    </Layout>
  );
}
