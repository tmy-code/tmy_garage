import { useMemo } from 'react';
import { daysBetween, todayIso } from '../../shared/dates.ts';
import { usageOf } from '../../shared/due.ts';
import type { Snapshot, Vehicle } from '../../shared/types.ts';
import { upcoming, type Upcoming } from '../../shared/upcoming.ts';
import { LanguageSwitch, Layout } from '../components.tsx';
import { formatDate, formatKm, taskName } from '../format.ts';
import { useT, type Messages } from '../i18n.ts';
import { VehicleIcon } from '../brands.tsx';

const GROUPS = ['overdue', 'dueSoon', 'ok'] as const;

/** The main page: what is coming up, one card per owned Vehicle, grouped by how urgent it is. */
export function Dashboard({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const owned = snapshot.vehicles.filter((v) => v.status === 'owned');
  const sold = snapshot.vehicles.filter((v) => v.status === 'sold');
  const items = useMemo(() => upcoming(snapshot, today), [snapshot, today]);

  return (
    <Layout
      title={t.garage}
      actions={
        <a className="button button-small" href="#/vehicles/new">
          {t.dashboard.addVehicle}
        </a>
      }
    >
      {owned.length === 0 ? (
        <div className="empty">
          <p>{t.dashboard.noVehicles}</p>
          <a className="button" href="#/vehicles/new">
            {t.dashboard.addFirst}
          </a>
        </div>
      ) : (
        <div className="card-grid">
          {owned.map((v) => (
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
      {sold.length > 0 ? (
        <details className="sold">
          <summary>{t.dashboard.soldVehicles(sold.length)}</summary>
          <ul className="list">
            {sold.map((v) => (
              <li key={v.id}>
                <a href={`#/vehicles/${v.id}`}>
                  <VehicleIcon vehicle={v} /> {v.name} <span className="muted">{v.soldDate ? t.dashboard.soldOn(formatDate(v.soldDate, t)) : ''}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <LanguageSwitch />
    </Layout>
  );
}

function VehicleCard({ vehicle, items, snapshot, today }: { vehicle: Vehicle; items: Upcoming[]; snapshot: Snapshot; today: string }) {
  const t = useT();
  const usage = useMemo(() => usageOf(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const reading = items.find((i) => i.kind === 'reading');
  const due = items.filter((i) => i.kind !== 'reading');

  return (
    <section className="card vehicle-card">
      <a className="vehicle-head" href={`#/vehicles/${vehicle.id}`}>
        <h2 className="with-icon">
          <VehicleIcon vehicle={vehicle} /> {vehicle.name}
        </h2>
        {usage.estimatedOdometer !== null ? <span className="muted">{formatKm(usage.estimatedOdometer)}</span> : null}
      </a>
      {reading ? (
        <a className="nudge" href={`#/vehicles/${vehicle.id}/reading`}>
          {reading.daysSince === null ? t.dashboard.noReading : t.dashboard.staleReading(reading.daysSince)}
        </a>
      ) : null}
      {due.length === 0 ? <p className="muted">{t.dashboard.allClear}</p> : null}
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
    </section>
  );
}

function keyOf(item: Upcoming): string {
  if (item.kind === 'task') return item.due.taskId;
  if (item.kind === 'document') return item.document.id;
  return '';
}

/** How soon, in a few words: days for what is urgent, the date for what can wait. */
function when(date: string, status: Upcoming['status'], today: string, t: Messages): string {
  if (status === 'ok') return formatDate(date, t);
  const days = daysBetween(today, date);
  return days < 0 ? t.due.daysAgo(-days) : days === 0 ? t.due.today : t.due.inDays(days);
}

/** One line: what it is, and when. Opens the screen where it is dealt with. */
function UpcomingLine({ item, vehicle, snapshot, today }: { item: Upcoming; vehicle: Vehicle; snapshot: Snapshot; today: string }) {
  const t = useT();
  const base = `#/vehicles/${vehicle.id}`;
  let href: string;
  let name: string;
  switch (item.kind) {
    case 'task':
      href = `#/tasks/${item.due.taskId}`;
      name = taskName(snapshot.tasks.find((x) => x.id === item.due.taskId)!, t);
      break;
    case 'inspection':
      href = `${base}/inspections`;
      name = t.papers.nextInspection;
      break;
    case 'insurance':
      href = `${base}/insurance`;
      name = item.insurer;
      break;
    case 'document':
      href = `${base}/documents`;
      name = item.document.title ?? t.papers.types[item.document.type];
      break;
    case 'defects':
      href = `${base}/inspections`;
      name = t.papers.openDefects(item.count);
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

  return (
    <a href={href}>
      <span>{name}</span>
      <span className="muted">{text}</span>
    </a>
  );
}
