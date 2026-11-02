import { useState, type FormEvent, type ReactNode } from 'react';
import {
  COOLINGS,
  distributionsOf,
  DRIVETRAINS,
  FINAL_DRIVES,
  flagsOf,
  catalogueOf,
  fuelsOf,
  PART_CATEGORIES,
  SPEC_FLAGS,
  transmissionsOf,
  type PartCategory,
  type SpecFlag,
} from '../../shared/catalogue.ts';
import { todayIso } from '../../shared/dates.ts';
import type { Cooling, Distribution, Drivetrain, FinalDrive, FuelType, TaskAction, Transmission } from '../../shared/schemas.ts';
import type { MaintenanceTask, Snapshot, Vehicle } from '../../shared/types.ts';
import { confirmDelete, Field, FormError, IntervalFields, Layout, NeedsConnection } from '../components.tsx';
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

/** A required choice among a few values; nothing is chosen until the user picks one. */
function BuildSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | '';
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  const t = useT();
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} required>
        <option value="" disabled>
          {t.setup.choose}
        </option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** The value if it is still one of the options, the only option if there is just one, or nothing chosen. */
function within<T extends string>(value: T | '', options: readonly T[]): T | '' {
  if (options.length === 1) return options[0]!;
  return value && options.includes(value) ? value : '';
}

/** `returnTo` is where to go once saved or cancelled, when not the vehicle's page (e.g. the Manage page). */
export function VehicleForm({ existing, returnTo }: { existing?: Vehicle; returnTo?: string }) {
  const t = useT();
  const [kind, setKind] = useState<Vehicle['kind']>(existing?.kind ?? 'motorcycle');
  const [name, setName] = useState(existing?.name ?? '');
  const [make, setMake] = useState(existing?.make ?? '');
  const [model, setModel] = useState(existing?.model ?? '');
  const [year, setYear] = useState(existing?.year ? String(existing.year) : '');
  const [vin, setVin] = useState(existing?.vin ?? '');
  const [firstRegistrationDate, setFirstRegistrationDate] = useState(existing?.firstRegistrationDate ?? '');
  const [purchaseDate, setPurchaseDate] = useState(existing?.purchaseDate ?? '');
  const [fuel, setFuel] = useState<FuelType | ''>(existing?.fuel ?? '');
  const [transmission, setTransmission] = useState<Transmission | ''>(existing?.transmission ?? '');
  const [drivetrain, setDrivetrain] = useState<Drivetrain | ''>(existing?.drivetrain ?? '');
  const [distribution, setDistribution] = useState<Distribution | ''>(existing?.distribution ?? '');
  const [finalDrive, setFinalDrive] = useState<FinalDrive | ''>(existing?.finalDrive ?? '');
  const [cooling, setCooling] = useState<Cooling | ''>(existing?.cooling ?? '');
  const [cylinders, setCylinders] = useState(existing?.cylinders ? String(existing.cylinders) : '');
  const [flags, setFlags] = useState<Record<SpecFlag, boolean>>(
    () => Object.fromEntries(SPEC_FLAGS.map((flag) => [flag, existing?.[flag] ?? false])) as Record<SpecFlag, boolean>,
  );
  const { error, disabled, run } = useSubmit();
  const back = returnTo ?? (existing ? `/vehicles/${existing.id}` : '/');
  // Each choice narrows the next ones (an electric vehicle is single-speed); a choice that no longer fits is dropped.
  const fuelValue = within(fuel, fuelsOf(kind));
  const transmissions = transmissionsOf(kind, fuelValue || null);
  const transmissionValue = within(transmission, transmissions);
  const distributions = distributionsOf(fuelValue || null);
  const distributionValue = within(distribution, distributions);
  const allowedFlags = flagsOf(kind, fuelValue || null, transmissionValue || null);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const body = {
        kind,
        name,
        make,
        model,
        year: optionalNumber(year, t.setup.year, t),
        vin,
        firstRegistrationDate: firstRegistrationDate || null,
        purchaseDate: purchaseDate || null,
        fuel: fuelValue || null,
        transmission: transmissionValue || null,
        drivetrain: drivetrain || null,
        distribution: distributionValue || null,
        cooling: cooling || null,
        finalDrive: finalDrive || null,
        cylinders: optionalNumber(cylinders, t.setup.cylinders, t),
        ...Object.fromEntries(SPEC_FLAGS.map((flag) => [flag, allowedFlags.includes(flag) && flags[flag]])),
      };
      const saved = existing
        ? await online<Vehicle>('PUT', `/api/vehicles/${existing.id}`, body)
        : await online<Vehicle>('POST', '/api/vehicles', body);
      navigate(returnTo ?? `/vehicles/${saved.id}`, { replace: true });
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
          <input value={make} onChange={(e) => setMake(e.target.value)} required maxLength={60} list="known-makes" />
          <datalist id="known-makes">
            {KNOWN_MAKES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label={t.setup.model}>
          <input value={model} onChange={(e) => setModel(e.target.value)} required maxLength={60} />
        </Field>
        <Field label={t.setup.year}>
          <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} maxLength={4} />
        </Field>
        <Field label={t.setup.vin}>
          <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} maxLength={17} />
        </Field>
        <Field label={t.setup.firstRegistrationDate}>
          <input type="date" value={firstRegistrationDate} onChange={(e) => setFirstRegistrationDate(e.target.value)} />
        </Field>
        <Field label={t.setup.purchaseDate}>
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
        </Field>
        <fieldset className="field">
          <legend className="field-label">{t.setup.builtWith}</legend>
          <p className="muted">{t.setup.builtWithHint}</p>
          <BuildSelect
            label={t.setup.fuel}
            value={fuelValue}
            onChange={setFuel}
            options={fuelsOf(kind).map((f) => [f, t.setup.fuels[f]] as const)}
          />
          {transmissions.length > 1 ? (
            <BuildSelect
              label={t.setup.transmission}
              value={transmissionValue}
              onChange={setTransmission}
              options={transmissions.map((x) => [x, t.setup.transmissions[x]] as const)}
            />
          ) : null}
          {kind === 'car' ? (
            <>
              <BuildSelect
                label={t.setup.drivetrain}
                value={drivetrain}
                onChange={setDrivetrain}
                options={DRIVETRAINS.map((x) => [x, t.setup.drivetrains[x]] as const)}
              />
              {distributions.length > 1 ? (
                <BuildSelect
                  label={t.setup.distribution}
                  value={distributionValue}
                  onChange={setDistribution}
                  options={distributions.map((x) => [x, t.setup.distributions[x]] as const)}
                />
              ) : null}
            </>
          ) : (
            <>
              <BuildSelect
                label={t.setup.finalDrive}
                value={finalDrive}
                onChange={setFinalDrive}
                options={FINAL_DRIVES.map((x) => [x, t.setup.finalDrives[x]] as const)}
              />
              <BuildSelect
                label={t.setup.cooling}
                value={cooling}
                onChange={setCooling}
                options={COOLINGS.map((x) => [x, t.setup.coolings[x]] as const)}
              />
              <Field label={t.setup.cylinders}>
                <input inputMode="numeric" value={cylinders} onChange={(e) => setCylinders(e.target.value)} required maxLength={2} />
              </Field>
            </>
          )}
          {allowedFlags.length > 0 ? (
            <>
              <p className="field-label">{t.setup.options}</p>
              <div className="check-grid">
                {allowedFlags.map((flag) => (
                  <label key={flag} className={`check ${flags[flag] ? 'check-on' : ''}`}>
                    <input type="checkbox" checked={flags[flag]} onChange={(e) => setFlags({ ...flags, [flag]: e.target.checked })} />
                    <span>{t.setup.flags[flag]}</span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </fieldset>
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

export function TaskForm({ vehicle, snapshot, existing }: { vehicle: Vehicle; snapshot: Snapshot; existing?: MaintenanceTask }) {
  const t = useT();
  const [name, setName] = useState(existing?.name ?? '');
  const [nameFr, setNameFr] = useState(existing?.nameFr ?? '');
  const [intervalKm, setIntervalKm] = useState(String(existing?.intervalKm ?? ''));
  const [intervalMonths, setIntervalMonths] = useState(String(existing?.intervalMonths ?? ''));
  const [action, setAction] = useState<TaskAction>(existing?.action ?? 'replace');
  const [baselineDate, setBaselineDate] = useState(existing?.baselineDate ?? '');
  const [baselineOdometer, setBaselineOdometer] = useState(String(existing?.baselineOdometer ?? ''));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [category, setCategory] = useState<PartCategory | null>(existing?.category ?? null);
  const [switchedOff, setSwitchedOff] = useState(existing?.switchedOff ?? false);
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
        action,
        baselineDate: baselineDate || null,
        baselineOdometer: optionalNumber(baselineOdometer, t.setup.odometerLabel, t),
        category,
        notes,
        switchedOff,
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

  const siblings = existing ? snapshot.tasks.filter((task) => task.vehicleId === vehicle.id && task.id !== existing.id) : [];
  const [mergeInto, setMergeInto] = useState('');

  async function merge() {
    const target = siblings.find((task) => task.id === mergeInto);
    if (!existing || !target || !(await confirmDelete(t.setup.confirmMergeTask(taskName(existing, t), taskName(target, t))))) return;
    void run(async () => {
      await online('POST', `/api/tasks/${existing.id}/merge`, { intoTaskId: target.id });
      navigate(back, { replace: true });
    });
  }

  return (
    <Layout title={existing ? t.setup.editTask : t.setup.newTask(vehicle.name)} back={back}>
      <NeedsConnection />
      <form onSubmit={submit} className="form">
        {existing?.templateCode ? <p className="muted">{t.setup.standardTaskHint}</p> : null}
        <Field label={t.setup.task} hint={t.setup.taskHint}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} lang="en" />
        </Field>
        <Field label={t.setup.taskFr} hint={t.setup.taskFrHint}>
          <input value={nameFr} onChange={(e) => setNameFr(e.target.value)} maxLength={120} lang="fr" />
        </Field>
        <Field label={t.setup.action}>
          <select value={action} onChange={(e) => setAction(e.target.value as TaskAction)}>
            {(['replace', 'inspect', 'clean', 'adjust'] as const).map((a) => (
              <option key={a} value={a}>
                {t.setup.actions[a]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.setup.taskCategory} hint={t.setup.taskCategoryHint}>
          <select value={category ?? 'other'} onChange={(e) => setCategory(e.target.value === 'other' ? null : (e.target.value as PartCategory))}>
            {PART_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t.workshop.partCategories[c]}
              </option>
            ))}
          </select>
        </Field>
        <p className="field-label">{t.setup.interval}</p>
        <IntervalFields
          km={intervalKm}
          months={intervalMonths}
          onKm={setIntervalKm}
          onMonths={setIntervalMonths}
          kmPlaceholder="6000"
          monthsPlaceholder="12"
        />
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
        <Field label={t.workshop.notesTitle} hint={t.setup.notesHint}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} maxLength={20_000} />
        </Field>
        {existing ? (
          <label className={`check ${switchedOff ? 'check-on' : ''}`}>
            <input type="checkbox" checked={switchedOff} onChange={(e) => setSwitchedOff(e.target.checked)} />
            <span>
              {t.setup.switchedOff}
              <span className="muted"> · {t.setup.switchedOffHint}</span>
            </span>
          </label>
        ) : null}
        <FormError error={error} />
        <Submit disabled={disabled}>{existing ? t.setup.save : t.setup.addTask}</Submit>
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
            {t.setup.deleteTask}
          </button>
        ) : null}
        {siblings.length > 0 ? (
          <Field label={t.setup.mergeTask} hint={t.setup.mergeTaskHint}>
            <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
              <option value="">{t.setup.mergeInto}</option>
              {siblings.map((task) => (
                <option key={task.id} value={task.id}>
                  {taskName(task, t)}
                </option>
              ))}
            </select>
            <button type="button" className="button button-block" onClick={merge} disabled={disabled || !mergeInto}>
              {t.setup.mergeButton}
            </button>
          </Field>
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
