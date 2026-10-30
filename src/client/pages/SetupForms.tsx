import { useState, type FormEvent, type ReactNode } from 'react';
import { todayIso } from '../../shared/dates.ts';
import type { OvernightParking } from '../../shared/schemas.ts';
import type { MaintenanceTask, Snapshot, Vehicle } from '../../shared/types.ts';
import { confirmDelete, Field, FormError, Layout, NeedsConnection } from '../components.tsx';
import { showToast } from '../feedback.ts';
import { parseNumber, taskName } from '../format.ts';
import { messages, useT, type Messages } from '../i18n.ts';
import { KNOWN_MAKES } from '../brands.tsx';
import { Icon } from '../icons.tsx';
import { navigate } from '../router.ts';
import { online, useStore } from '../store.ts';

// Vehicle and Maintenance Task setup is desk work and needs a connection (ADR 0001).

export function useSubmit() {
  const { reachable } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Runs a change; once it succeeds, says so briefly (`done`, "Saved" by default). */
  async function run(fn: () => Promise<unknown>, done: string = messages().feedback.saved) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      showToast(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { error, setError, busy, disabled: busy || !reachable, run };
}

export function Submit({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return (
    <button type="submit" className="button button-primary button-block" disabled={disabled}>
      {children}
    </button>
  );
}

function optionalNumber(text: string, label: string, t: Messages): number | null {
  const n = parseNumber(text);
  if (n !== null && (Number.isNaN(n) || n < 0 || !Number.isInteger(n))) throw new Error(t.setup.wholeNumber(label));
  return n;
}

export function VehicleForm({ existing }: { existing?: Vehicle }) {
  const t = useT();
  const [kind, setKind] = useState<Vehicle['kind']>(existing?.kind ?? 'motorcycle');
  const [name, setName] = useState(existing?.name ?? '');
  const [make, setMake] = useState(existing?.make ?? '');
  const [model, setModel] = useState(existing?.model ?? '');
  const [year, setYear] = useState(existing?.year ? String(existing.year) : '');
  const [registration, setRegistration] = useState(existing?.registration ?? '');
  const [firstRegistration, setFirstRegistration] = useState(existing?.firstRegistration ?? '');
  const [vin, setVin] = useState(existing?.vin ?? '');
  const [version, setVersion] = useState(existing?.version ?? '');
  const [nationalType, setNationalType] = useState(existing?.nationalType ?? '');
  const [fiscalPower, setFiscalPower] = useState(existing?.fiscalPower ? String(existing.fiscalPower) : '');
  const [purchaseDate, setPurchaseDate] = useState(existing?.purchaseDate ?? '');
  const [overnightParking, setOvernightParking] = useState<OvernightParking | ''>(existing?.overnightParking ?? '');
  const { error, disabled, run } = useSubmit();
  const back = existing ? `/vehicles/${existing.id}` : '/';

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const body = {
        kind,
        name,
        make,
        model,
        year: optionalNumber(year, t.setup.year, t),
        registration,
        firstRegistration: firstRegistration || null,
        vin,
        version,
        nationalType,
        fiscalPower: optionalNumber(fiscalPower, t.insurance.fiscalPower, t),
        purchaseDate: purchaseDate || null,
        overnightParking: overnightParking || null,
      };
      const saved = existing
        ? await online<Vehicle>('PUT', `/api/vehicles/${existing.id}`, body)
        : await online<Vehicle>('POST', '/api/vehicles', body);
      navigate(`/vehicles/${saved.id}`, { replace: true });
    });
  }

  return (
    <Layout title={existing ? t.setup.editVehicle : t.setup.newVehicle} back={back}>
      <NeedsConnection />
      <form onSubmit={submit} className="form">
        <div className="segmented" role="radiogroup" aria-label={t.setup.kind}>
          {(['motorcycle', 'car'] as const).map((k) => (
            <button
              type="button"
              key={k}
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'on' : ''}
              onClick={() => setKind(k)}
            >
              <Icon name={k} /> {k === 'car' ? t.setup.car : t.setup.motorcycle}
            </button>
          ))}
        </div>
        <Field label={t.setup.name} hint={t.setup.nameHint}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </Field>
        <Field label={t.setup.make}>
          <input value={make} onChange={(e) => setMake(e.target.value)} maxLength={60} list="known-makes" />
          <datalist id="known-makes">
            {KNOWN_MAKES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label={t.setup.model}>
          <input value={model} onChange={(e) => setModel(e.target.value)} maxLength={60} />
        </Field>
        <Field label={t.setup.year}>
          <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} maxLength={4} />
        </Field>
        <Field label={t.setup.registration}>
          <input value={registration} onChange={(e) => setRegistration(e.target.value.toUpperCase())} maxLength={20} />
        </Field>
        <Field label={t.setup.firstRegistration} hint={t.setup.firstRegistrationHint}>
          <input type="date" value={firstRegistration} onChange={(e) => setFirstRegistration(e.target.value)} />
        </Field>
        <details className="part-details" open={Boolean(existing?.vin || existing?.fiscalPower || existing?.overnightParking)}>
          <summary>{t.insurance.factsSection}</summary>
          <p className="muted">{t.insurance.factsHint}</p>
          <Field label={t.insurance.vin}>
            <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} maxLength={17} />
          </Field>
          <Field label={t.insurance.version}>
            <input value={version} onChange={(e) => setVersion(e.target.value)} maxLength={80} />
          </Field>
          <div className="row">
            <Field label={t.insurance.nationalType} hint={t.insurance.nationalTypeHint}>
              <input value={nationalType} onChange={(e) => setNationalType(e.target.value.toUpperCase())} maxLength={10} />
            </Field>
            <Field label={t.insurance.fiscalPower}>
              <input inputMode="numeric" value={fiscalPower} onChange={(e) => setFiscalPower(e.target.value)} maxLength={3} />
            </Field>
          </div>
          <div className="row">
            <Field label={t.insurance.purchaseDate}>
              <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </Field>
            <Field label={t.insurance.parking}>
              <select value={overnightParking} onChange={(e) => setOvernightParking(e.target.value as OvernightParking | '')}>
                <option value="">—</option>
                {(['closedGarage', 'privateParking', 'street'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t.insurance.parkings[k]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </details>
        <FormError error={error} />
        <Submit disabled={disabled}>{existing ? t.setup.save : t.setup.addVehicle}</Submit>
      </form>
    </Layout>
  );
}

export function SellForm({ vehicle }: { vehicle: Vehicle }) {
  const t = useT();
  const [date, setDate] = useState(vehicle.soldDate ?? todayIso());
  const [odometer, setOdometer] = useState(vehicle.soldOdometer !== null ? String(vehicle.soldOdometer) : '');
  const [price, setPrice] = useState(vehicle.soldPrice !== null ? String(vehicle.soldPrice) : '');
  const { error, disabled, run } = useSubmit();
  const back = `/vehicles/${vehicle.id}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const p = parseNumber(price);
      if (p !== null && (Number.isNaN(p) || p < 0)) throw new Error(t.setup.priceError);
      await online('POST', `/api/vehicles/${vehicle.id}/sell`, {
        date,
        odometer: optionalNumber(odometer, t.setup.odometerLabel, t),
        price: p,
      });
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
    <Layout title={t.setup.sellTitle(vehicle.name)} back={back}>
      <NeedsConnection />
      <p className="muted">{t.setup.sellIntro}</p>
      <form onSubmit={submit} className="form">
        <Field label={t.setup.saleDate}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label={t.setup.saleOdometer}>
          <input inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
        </Field>
        <Field label={t.setup.price}>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <FormError error={error} />
        <Submit disabled={disabled}>{vehicle.status === 'sold' ? t.setup.saveSale : t.setup.markSold}</Submit>
        {vehicle.status === 'sold' ? (
          <button type="button" className="button button-block" onClick={unsell} disabled={disabled}>
            {t.setup.unsell}
          </button>
        ) : null}
      </form>
    </Layout>
  );
}

export function TaskForm({ vehicle, existing }: { vehicle: Vehicle; existing?: MaintenanceTask }) {
  const t = useT();
  const [name, setName] = useState(existing?.name ?? '');
  const [nameFr, setNameFr] = useState(existing?.nameFr ?? '');
  const [intervalKm, setIntervalKm] = useState(String(existing?.intervalKm ?? ''));
  const [intervalMonths, setIntervalMonths] = useState(String(existing?.intervalMonths ?? ''));
  const [officialKm, setOfficialKm] = useState(String(existing?.officialIntervalKm ?? ''));
  const [officialMonths, setOfficialMonths] = useState(String(existing?.officialIntervalMonths ?? ''));
  const [baselineDate, setBaselineDate] = useState(existing?.baselineDate ?? '');
  const [baselineOdometer, setBaselineOdometer] = useState(String(existing?.baselineOdometer ?? ''));
  const { error, disabled, run } = useSubmit();
  const back = `/vehicles/${vehicle.id}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const body = {
        name,
        nameFr,
        intervalKm: optionalNumber(intervalKm, t.setup.distanceLabel, t),
        intervalMonths: optionalNumber(intervalMonths, t.setup.monthsLabel, t),
        officialIntervalKm: optionalNumber(officialKm, t.setup.distanceLabel, t),
        officialIntervalMonths: optionalNumber(officialMonths, t.setup.monthsLabel, t),
        baselineDate: baselineDate || null,
        baselineOdometer: optionalNumber(baselineOdometer, t.setup.odometerLabel, t),
      };
      if (body.intervalKm === null && body.intervalMonths === null) throw new Error(t.setup.needInterval);
      if (body.baselineOdometer !== null && body.baselineDate === null) throw new Error(t.setup.needBaselineDate);
      if (existing) await online('PUT', `/api/tasks/${existing.id}`, body);
      else await online('POST', `/api/vehicles/${vehicle.id}/tasks`, body);
      navigate(back, { replace: true });
    });
  }

  async function remove() {
    if (!existing || !(await confirmDelete(t.setup.confirmDeleteTask(taskName(existing, t))))) return;
    void run(async () => {
      await online('DELETE', `/api/tasks/${existing.id}`);
      navigate(back, { replace: true });
    }, t.feedback.deleted);
  }

  return (
    <Layout title={existing ? t.setup.editTask : t.setup.newTask(vehicle.name)} back={back}>
      <NeedsConnection />
      <form onSubmit={submit} className="form">
        <Field label={t.setup.task} hint={t.setup.taskHint}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} lang="en" />
        </Field>
        <Field label={t.setup.taskFr} hint={t.setup.taskFrHint}>
          <input value={nameFr} onChange={(e) => setNameFr(e.target.value)} maxLength={120} lang="fr" />
        </Field>
        <p className="field-label">{t.setup.interval}</p>
        <div className="row">
          <Field label={t.setup.everyKm}>
            <input inputMode="numeric" value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} placeholder="6000" />
          </Field>
          <Field label={t.setup.everyMonths}>
            <input inputMode="numeric" value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)} placeholder="12" />
          </Field>
        </div>
        <p className="field-label">{t.setup.official}</p>
        <div className="row">
          <Field label={t.setup.everyKm}>
            <input inputMode="numeric" value={officialKm} onChange={(e) => setOfficialKm(e.target.value)} />
          </Field>
          <Field label={t.setup.everyMonths}>
            <input inputMode="numeric" value={officialMonths} onChange={(e) => setOfficialMonths(e.target.value)} />
          </Field>
        </div>
        <p className="muted">{t.setup.officialHint}</p>
        <p className="field-label">{t.setup.baseline}</p>
        <div className="row">
          <Field label={t.setup.baselineDate}>
            <input type="date" value={baselineDate} onChange={(e) => setBaselineDate(e.target.value)} />
          </Field>
          <Field label={t.setup.baselineKm}>
            <input inputMode="numeric" value={baselineOdometer} onChange={(e) => setBaselineOdometer(e.target.value)} />
          </Field>
        </div>
        <p className="muted">{t.setup.baselineHint}</p>
        <FormError error={error} />
        <Submit disabled={disabled}>{existing ? t.setup.save : t.setup.addTask}</Submit>
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
            {t.setup.deleteTask}
          </button>
        ) : null}
      </form>
    </Layout>
  );
}

export function CopyTasks({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const sources = snapshot.vehicles.filter((v) => v.id !== vehicle.id && snapshot.tasks.some((task) => task.vehicleId === v.id));
  const [fromVehicleId, setFrom] = useState(sources[0]?.id ?? '');
  const { error, disabled, run } = useSubmit();
  const back = `/vehicles/${vehicle.id}`;
  const count = snapshot.tasks.filter((task) => task.vehicleId === fromVehicleId).length;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await online('POST', `/api/vehicles/${vehicle.id}/copy-tasks`, { fromVehicleId });
      navigate(back, { replace: true });
    });
  }

  return (
    <Layout title={t.setup.copyTitle} back={back}>
      <NeedsConnection />
      {sources.length === 0 ? (
        <p className="empty">{t.setup.nothingToCopy}</p>
      ) : (
        <form onSubmit={submit} className="form">
          <Field label={t.setup.copyFrom} hint={t.setup.copyHint(count, vehicle.name)}>
            <select value={fromVehicleId} onChange={(e) => setFrom(e.target.value)}>
              {sources.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <FormError error={error} />
          <Submit disabled={disabled}>{t.setup.copy}</Submit>
        </form>
      )}
    </Layout>
  );
}
