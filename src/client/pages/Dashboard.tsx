import { useMemo } from 'react';
import { daysBetween, todayIso } from '../../shared/dates.ts';
import { vehicleDue } from '../../shared/due.ts';
import { expiringDocuments, nextInspection, openDefects } from '../../shared/inspections.ts';
import type { Snapshot, Vehicle } from '../../shared/types.ts';
import { LanguageSwitch, Layout, StatusChip } from '../components.tsx';
import { describeDue, formatDate, formatKm } from '../format.ts';
import { useT } from '../i18n.ts';

const ICON: Record<Vehicle['kind'], string> = { car: '🚗', motorcycle: '🏍️' };
/** Nudge for a fresh odometer reading so the projection stays honest. */
const STALE_READING_DAYS = 30;
/** Wide screens have room to show what comes up next, not only what is urgent. */
const WIDE_PREVIEW = 4;

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
        <div className="card-grid">
          {owned.map((v) => (
            <VehicleCard key={v.id} vehicle={v} snapshot={snapshot} today={today} />
          ))}
        </div>
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
  const onPhone = urgent.length > 0 ? urgent.length : 1;
  const next = due.slice(0, Math.max(onPhone, WIDE_PREVIEW));
  const taskName = (id: string) => snapshot.tasks.find((task) => task.id === id)?.name ?? '';
  const staleDays = usage.latest ? daysBetween(usage.latest.date, today) : null;
  const inspection = nextInspection(snapshot, vehicle, today);
  const defects = openDefects(snapshot, vehicle).length;
  const expiring = expiringDocuments(snapshot, vehicle.id, today);

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
        {inspection.dueDate && (inspection.status === 'overdue' || inspection.status === 'dueSoon') ? (
          <li>
            <span className={`chip chip-${inspection.status}`}>{t.status[inspection.status]}</span>
            <span className="due-name">{t.papers.nextInspection}</span>
            <span className="due-text">{t.papers.dueBy(formatDate(inspection.dueDate, t))}</span>
          </li>
        ) : null}
        {defects > 0 ? (
          <li>
            <span className="chip chip-dueSoon">{t.status.dueSoon}</span>
            <span className="due-name">{t.papers.openDefects(defects)}</span>
          </li>
        ) : null}
        {expiring.map((d) => (
          <li key={d.id}>
            <span className={`chip chip-${d.expiryDate! < today ? 'overdue' : 'dueSoon'}`}>
              {t.status[d.expiryDate! < today ? 'overdue' : 'dueSoon']}
            </span>
            <span className="due-name">{d.title ?? t.papers.types[d.type]}</span>
            <span className="due-text">
              {d.expiryDate! < today ? t.papers.expired(formatDate(d.expiryDate!, t)) : t.papers.expires(formatDate(d.expiryDate!, t))}
            </span>
          </li>
        ))}
        {next.map((d, i) => (
          <li key={d.taskId} className={i >= onPhone ? 'wide-only' : undefined}>
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
