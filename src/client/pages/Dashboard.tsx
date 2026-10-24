import { useMemo } from 'react';
import { daysBetween, todayIso } from '../../shared/dates.ts';
import { vehicleDue } from '../../shared/due.ts';
import type { Snapshot, Vehicle } from '../../shared/types.ts';
import { LanguageSwitch, Layout, StatusChip } from '../components.tsx';
import { describeDue, formatDate, formatKm } from '../format.ts';
import { useT } from '../i18n.ts';

const ICON: Record<Vehicle['kind'], string> = { car: '🚗', motorcycle: '🏍️' };
/** Nudge for a fresh odometer reading so the projection stays honest. */
const STALE_READING_DAYS = 30;

export function Dashboard({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const owned = snapshot.vehicles.filter((v) => v.status === 'owned');
  const sold = snapshot.vehicles.filter((v) => v.status === 'sold');

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
        owned.map((v) => <VehicleCard key={v.id} vehicle={v} snapshot={snapshot} today={today} />)
      )}
      {owned.length > 0 ? (
        <a className="button button-block" href="#/shopping">
          🛒 {t.workshop.shopping}
        </a>
      ) : null}
      {sold.length > 0 ? (
        <details className="sold">
          <summary>{t.dashboard.soldVehicles(sold.length)}</summary>
          <ul className="list">
            {sold.map((v) => (
              <li key={v.id}>
                <a href={`#/vehicles/${v.id}`}>
                  {ICON[v.kind]} {v.name} <span className="muted">{v.soldDate ? t.dashboard.soldOn(formatDate(v.soldDate, t)) : ''}</span>
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

function VehicleCard({ vehicle, snapshot, today }: { vehicle: Vehicle; snapshot: Snapshot; today: string }) {
  const t = useT();
  const { usage, due } = useMemo(() => vehicleDue(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const urgent = due.filter((d) => d.status === 'overdue' || d.status === 'dueSoon');
  const next = urgent.length > 0 ? urgent : due.slice(0, 1);
  const taskName = (id: string) => snapshot.tasks.find((task) => task.id === id)?.name ?? '';
  const staleDays = usage.latest ? daysBetween(usage.latest.date, today) : null;

  return (
    <a className="card vehicle-card" href={`#/vehicles/${vehicle.id}`}>
      <div className="card-head">
        <h2>
          {ICON[vehicle.kind]} {vehicle.name}
        </h2>
        {usage.estimatedOdometer !== null ? (
          <span className="muted">
            {usage.kmPerDay ? '≈ ' : ''}
            {formatKm(usage.estimatedOdometer)}
          </span>
        ) : null}
      </div>
      {due.length === 0 ? <p className="muted">{t.dashboard.noTasks}</p> : null}
      <ul className="due-list">
        {next.map((d) => (
          <li key={d.taskId}>
            <StatusChip status={d.status} />
            <span className="due-name">{taskName(d.taskId)}</span>
            <span className="due-text">{describeDue(d, t)}</span>
          </li>
        ))}
      </ul>
      {staleDays === null ? (
        <p className="nudge">{t.dashboard.noReading}</p>
      ) : staleDays > STALE_READING_DAYS ? (
        <p className="nudge">{t.dashboard.staleReading(staleDays)}</p>
      ) : null}
    </a>
  );
}
