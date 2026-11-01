import { useMemo } from 'react';
import { todayIso } from '../../shared/dates.ts';
import { usageOf } from '../../shared/due.ts';
import type { Snapshot, Vehicle } from '../../shared/types.ts';
import { upcoming, type Upcoming } from '../../shared/upcoming.ts';
import { LanguageSwitch, Layout, StatusChip } from '../components.tsx';
import { describeDue, formatDate, formatKm, taskName } from '../format.ts';
import { useT } from '../i18n.ts';
import { VehicleIcon } from '../brands.tsx';
import { Icon } from '../icons.tsx';

/** The main page: what is coming up on every owned Vehicle, in one list, most urgent first. */
export function Dashboard({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const owned = snapshot.vehicles.filter((v) => v.status === 'owned');
  const sold = snapshot.vehicles.filter((v) => v.status === 'sold');
  const items = useMemo(() => upcoming(snapshot, today), [snapshot, today]);
  const vehicles = new Map(owned.map((v) => [v.id, v]));

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
        <>
          <section>
            <h2>{t.dashboard.upcoming}</h2>
            {items.every((i) => i.kind === 'reading') ? <p className="muted">{t.dashboard.allClear}</p> : null}
            <ul className="list list-grid">
              {items.map((item) => (
                <li key={`${item.kind}-${item.vehicleId}-${keyOf(item)}`}>
                  <UpcomingRow item={item} vehicle={vehicles.get(item.vehicleId)!} snapshot={snapshot} today={today} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>{t.dashboard.vehicles}</h2>
            <ul className="list list-grid">
              {owned.map((v) => (
                <li key={v.id}>
                  <VehicleRow vehicle={v} snapshot={snapshot} today={today} />
                </li>
              ))}
            </ul>
          </section>

          <div className="actions dashboard-actions">
            <a className="button" href="#/shopping">
              <Icon name="cart" /> {t.workshop.shopping}
            </a>
            <a className="button" href="#/insurance">
              <Icon name="shield" /> {t.insurance.title}
            </a>
            <a className="button" href="#/reminders">
              <Icon name="bell" /> {t.reminders.title}
            </a>
          </div>
        </>
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

function keyOf(item: Upcoming): string {
  if (item.kind === 'task') return item.due.taskId;
  if (item.kind === 'document') return item.document.id;
  return '';
}

/** One coming-up line, opening the screen where it is dealt with. */
function UpcomingRow({ item, vehicle, snapshot, today }: { item: Upcoming; vehicle: Vehicle; snapshot: Snapshot; today: string }) {
  const t = useT();
  const base = `#/vehicles/${vehicle.id}`;
  let href: string;
  let name: string;
  let text: string | null = null;
  switch (item.kind) {
    case 'task': {
      const task = snapshot.tasks.find((x) => x.id === item.due.taskId)!;
      href = `#/tasks/${task.id}`;
      name = taskName(task, t);
      text = describeDue(item.due, t);
      break;
    }
    case 'inspection':
      href = `${base}/inspections`;
      name = t.papers.nextInspection;
      text = t.papers.dueBy(formatDate(item.date!, t));
      break;
    case 'insurance':
      href = `${base}/insurance`;
      name = item.insurer;
      text = item.status === 'overdue' ? t.insurance.renewalPassed(formatDate(item.date!, t)) : t.insurance.renewsOn(formatDate(item.date!, t));
      break;
    case 'document':
      href = `${base}/documents`;
      name = item.document.title ?? t.papers.types[item.document.type];
      text = item.date! < today ? t.papers.expired(formatDate(item.date!, t)) : t.papers.expires(formatDate(item.date!, t));
      break;
    case 'defects':
      href = `${base}/inspections`;
      name = t.papers.openDefects(item.count);
      break;
    case 'reading':
      href = `${base}/reading`;
      name = t.vehicle.odometerReading;
      text = item.daysSince === null ? t.dashboard.noReading : t.dashboard.staleReading(item.daysSince);
      break;
  }

  return (
    <a href={href} className="task-row">
      <div className="task-title">
        {item.kind === 'reading' ? null : <StatusChip status={item.status} />}
        <span className="due-name with-icon">
          <VehicleIcon vehicle={vehicle} /> {vehicle.name} · {name}
        </span>
      </div>
      {text ? <span className={item.kind === 'reading' ? 'nudge' : 'due-text'}>{text}</span> : null}
    </a>
  );
}

function VehicleRow({ vehicle, snapshot, today }: { vehicle: Vehicle; snapshot: Snapshot; today: string }) {
  const usage = useMemo(() => usageOf(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  return (
    <a href={`#/vehicles/${vehicle.id}`} className="history-row">
      <span className="due-name with-icon">
        <VehicleIcon vehicle={vehicle} /> {vehicle.name}
      </span>
      {usage.estimatedOdometer !== null ? <span className="muted">{formatKm(usage.estimatedOdometer)}</span> : null}
    </a>
  );
}
