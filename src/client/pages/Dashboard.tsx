import { useMemo, useState, type FormEvent } from 'react';
import { daysBetween, todayIso } from '../../shared/dates.ts';
import { usageOf, vehicleDue } from '../../shared/due.ts';
import { buyStates } from '../../shared/purchases.ts';
import { averageConsumption, consumptionOf } from '../../shared/fuel.ts';
import type { Snapshot, Vehicle } from '../../shared/types.ts';
import { upcoming, type Upcoming } from '../../shared/upcoming.ts';
import { BuyChips, DesktopOnlyNote, FormError, Layout, NeedsConnection } from '../components.tsx';
import { formatDate, formatDueIn, formatDecimal, formatKm, parseNumber, taskName } from '../format.ts';
import { useT, type Messages } from '../i18n.ts';
import { VehicleIcon } from '../brands.tsx';
import { Icon } from '../icons.tsx';
import { isDesktop } from '../native.ts';
import { newId } from '../api.ts';
import { enqueue, online } from '../store.ts';
import { useSubmit } from './SetupForms.tsx';
import { toastCreated } from './ServiceForm.tsx';

const GROUPS = ['overdue', 'dueSoon', 'ok'] as const;

/** The main page: what is coming up, one card per Vehicle shown here (the owned ones unless the user chose otherwise). */
export function Dashboard({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const shown = snapshot.vehicles.filter((v) => v.onGaragePage);
  const others = snapshot.vehicles.filter((v) => !v.onGaragePage);
  const items = useMemo(() => upcoming(snapshot, today), [snapshot, today]);

  return (
    <Layout title={t.garage}>
      {snapshot.vehicles.length === 0 ? (
        <div className="empty">
          <p>{t.dashboard.noVehicles}</p>
          {isDesktop ? (
            <a className="button" href="#/vehicles/new">
              {t.dashboard.addFirst}
            </a>
          ) : (
            <DesktopOnlyNote />
          )}
        </div>
      ) : shown.length === 0 ? (
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
      ) : (
        <div className="card-grid">
          {shown.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              items={items.filter((i) => i.vehicleId === v.id)}
              snapshot={snapshot}
              today={today}
            />
          ))}
        </div>
      )}
      {snapshot.vehicles.length > 0 && isDesktop ? (
        <div className="actions page-buttons">
          <a className="button" href="#/vehicles/manage">
            {t.dashboard.manage}
          </a>
          <a className="button" href="#/vehicles/new">
            {t.dashboard.addVehicle}
          </a>
        </div>
      ) : null}
      {others.length > 0 ? (
        <details className="sold">
          <summary>{t.dashboard.otherVehicles(others.length)}</summary>
          <ul className="list">
            {others.map((v) => (
              <li key={v.id}>
                <a href={`#/vehicles/${v.id}`}>
                  <VehicleIcon vehicle={v} /> {v.name} <SoldNote vehicle={v} />
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Layout>
  );
}

/** "sold 3 March 2025" for a sold Vehicle, nothing for an owned one. */
function SoldNote({ vehicle }: { vehicle: Vehicle }) {
  const t = useT();
  if (vehicle.ownership !== 'sold') return null;
  return <span className="muted">{vehicle.soldDate ? t.dashboard.soldOn(formatDate(vehicle.soldDate, t)) : t.dashboard.sold}</span>;
}

/** Which Vehicles get a card on the garage page, whatever their sale status. Each tick is saved at once. */
export function ManageGaragePage({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const { error, disabled, run } = useSubmit();
  // Owned first, then sold, each in the order they were added.
  const vehicles = [...snapshot.vehicles].sort((a, b) => Number(a.ownership === 'sold') - Number(b.ownership === 'sold'));

  function toggle(vehicle: Vehicle) {
    void run(() => online('PUT', `/api/vehicles/${vehicle.id}/garage-page`, { shown: !vehicle.onGaragePage }));
  }

  return (
    <Layout title={t.dashboard.manageTitle} back="/">
      <NeedsConnection />
      <p className="muted">{t.dashboard.manageIntro}</p>
      <div className="form">
        {vehicles.map((v) => (
          <div key={v.id} className="manage-row">
            <label className={`check ${v.onGaragePage ? 'check-on' : ''}`}>
              <input
                type="checkbox"
                checked={v.onGaragePage}
                onChange={() => toggle(v)}
                disabled={disabled}
                aria-label={t.dashboard.showOnPage(v.name)}
              />
              <span className="due-name with-icon">
                <VehicleIcon vehicle={v} /> {v.name} <SoldNote vehicle={v} />
              </span>
            </label>
            <a className="button button-small" href={`#/vehicles/manage/${v.id}`} aria-label={t.dashboard.editVehicle(v.name)}>
              <Icon name="pencil" /> {t.vehicle.editShort}
            </a>
          </div>
        ))}
        <FormError error={error} />
      </div>
    </Layout>
  );
}

function VehicleCard({ vehicle, items, snapshot, today }: { vehicle: Vehicle; items: Upcoming[]; snapshot: Snapshot; today: string }) {
  const t = useT();
  const usage = useMemo(() => usageOf(snapshot, vehicle.id), [snapshot, vehicle.id]);
  // The average over all full tanks of this Vehicle; nothing until there are two with a known odometer.
  const average = useMemo(
    () => averageConsumption(consumptionOf(snapshot.fillups.filter((f) => f.vehicleId === vehicle.id)).values()),
    [snapshot.fillups, vehicle.id],
  );
  const reading = items.find((i) => i.kind === 'reading');
  const due = items.filter((i) => i.kind !== 'reading');
  // Tasks never done have no due date, so "nothing due" would be a guess: say how many cannot be reminded yet.
  const noHistory = useMemo(
    () => (vehicle.ownership === 'owned' ? vehicleDue(snapshot, vehicle.id, today).due.filter((d) => d.status === 'unknown').length : 0),
    [snapshot, vehicle.id, vehicle.ownership, today],
  );

  return (
    <section className="card vehicle-card">
      <a className="vehicle-head" href={`#/vehicles/${vehicle.id}`}>
        <h2 className="with-icon">
          <VehicleIcon vehicle={vehicle} /> {vehicle.name}
        </h2>
        {usage.latest ? <span className="muted">{formatKm(usage.latest.odometer)}</span> : null}
        {average !== null ? <span className="muted vehicle-consumption">{t.fuel.consumption(formatDecimal(average, 1, t))}</span> : null}
      </a>
      {vehicle.ownership === 'owned' ? (
        <QuickReading vehicle={vehicle} latest={usage.latest?.odometer ?? null} today={today} />
      ) : null}
      {reading ? (
        <a className="nudge" href={`#/vehicles/${vehicle.id}/reading`}>
          {reading.daysSince === null ? t.dashboard.noReading : t.dashboard.staleReading(reading.daysSince)}
        </a>
      ) : null}
      {vehicle.ownership === 'sold' ? (
        <p>
          <SoldNote vehicle={vehicle} />
        </p>
      ) : due.length === 0 ? (
        noHistory > 0 ? (
          <SetupLink vehicle={vehicle} text={t.dashboard.noHistoryOnly(noHistory)} />
        ) : (
          <p className="muted">{t.dashboard.allClear}</p>
        )
      ) : null}
      {GROUPS.map((status) => {
        const group = due.filter((i) => i.status === status);
        if (group.length === 0) return null;
        return (
          <div key={status}>
            <h3 className={`due-group due-group-${status}`}>{status === 'ok' ? t.dashboard.later : t.status[status]}</h3>
            <ul className="due-lines">
              {group.map((item) => (
                <li key={`${item.kind}-${keyOf(item)}`}>
                  <UpcomingLine item={item} vehicle={vehicle} snapshot={snapshot} today={today} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {due.length > 0 && noHistory > 0 ? <SetupLink vehicle={vehicle} text={t.dashboard.noHistory(noHistory)} /> : null}
    </section>
  );
}

/** Tasks never done have no due date and cannot remind: a full-height row that opens the vehicle's set-up block. */
function SetupLink({ vehicle, text }: { vehicle: Vehicle; text: string }) {
  const t = useT();
  // Setting a task's starting point is done on the computer: the phone only says how many are missing.
  if (!isDesktop) return <p className="muted">{text}</p>;
  return (
    <a className="setup-link" href={`#/vehicles/${vehicle.id}/setup`}>
      <span>{text}</span>
      <span className="setup-link-go">{t.dashboard.setUp} ›</span>
    </a>
  );
}

function keyOf(item: Upcoming): string {
  if (item.kind === 'task') return item.due.taskId;
  return '';
}

/** How soon, in a few words: days for what is urgent, the date for what can wait. */
function when(date: string, status: Upcoming['status'], today: string, t: Messages): string {
  if (status === 'ok') return formatDate(date, t);
  return formatDueIn(daysBetween(today, date), t);
}

/** One line: what it is, and when. Opens the screen where it is dealt with. */
function UpcomingLine({ item, vehicle, snapshot, today }: { item: Upcoming; vehicle: Vehicle; snapshot: Snapshot; today: string }) {
  const t = useT();
  let href: string;
  let name: string;
  switch (item.kind) {
    case 'task':
      href = `#/tasks/${item.due.taskId}`;
      name = taskName(snapshot.tasks.find((x) => x.id === item.due.taskId)!, t);
      break;
    case 'reading':
      return null;
  }
  // A Task with a distance interval also says how many km are left before it is due.
  const km = item.kind === 'task' ? item.due.kmRemaining : null;
  const text = [
    item.date !== null ? when(item.date, item.status, today, t) : null,
    km !== null ? (km < 0 ? t.due.over(formatKm(-km)) : t.due.left(formatKm(km))) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // What is urgent can be dealt with right there: a second target next to the link to the task.
  const urgent = item.kind === 'task' && item.status !== 'ok';
  return (
    <>
      <div className="due-line">
        <a href={href}>
          <span>{name}</span>
          <span className="muted">{text}</span>
        </a>
        {urgent ? (
          <a className="button button-small due-line-act" href={`#/vehicles/${vehicle.id}/service/${item.due.taskId}`} aria-label={t.dashboard.addFor(name)}>
            {t.dashboard.addShort}
          </a>
        ) : null}
      </div>
      {item.kind === 'task' && item.status !== 'ok' ? (
        <BuyChips states={buyStates(snapshot, vehicle.id, [{ taskId: item.due.taskId, lastDone: item.due.lastDone?.date ?? null }])} />
      ) : null}
    </>
  );
}

/** One tap to log an Odometer Reading for today, right on the card: a button that opens a single-field form. */
function QuickReading({ vehicle, latest, today }: { vehicle: Vehicle; latest: number | null; today: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="actions card-action">
        <a className="button button-primary" href={`#/vehicles/${vehicle.id}/service`}>
          {t.vehicle.logService}
        </a>
        <a className="button" href={`#/vehicles/${vehicle.id}/fillup`}>
          {t.fuel.add}
        </a>
        <button type="button" className="button" onClick={() => setOpen(true)}>
          {t.vehicle.odometerReading}
        </button>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const odometer = parseNumber(text);
    if (odometer === null || Number.isNaN(odometer) || odometer < 0 || !Number.isInteger(odometer)) {
      setError(t.service.errorOdometer);
      return;
    }
    const op = { kind: 'reading' as const, data: { id: newId(), vehicleId: vehicle.id, date: today, odometer } };
    await enqueue(op);
    toastCreated(op, t.feedback.readingSaved, t, true);
    setOpen(false);
    setText('');
    setError(null);
  }

  return (
    <form className="quick-reading" onSubmit={submit} noValidate>
      <input
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        placeholder={latest !== null ? formatKm(latest) : t.service.example}
        aria-label={t.vehicle.odometerReading}
        aria-invalid={error ? true : undefined}
      />
      <button type="submit" className="button button-primary button-small">
        {t.feedback.save}
      </button>
      <button type="button" className="button button-small" onClick={() => setOpen(false)}>
        {t.feedback.cancel}
      </button>
      {error ? <p className="field-error">{error}</p> : null}
    </form>
  );
}
