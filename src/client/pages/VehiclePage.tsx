import { useMemo } from 'react';
import { todayIso } from '../../shared/dates.ts';
import { vehicleDue } from '../../shared/due.ts';
import type { Snapshot, Vehicle } from '../../shared/types.ts';
import { Layout, StatusChip } from '../components.tsx';
import { describeDue, describeInterval, formatDate, formatKm, formatMoney } from '../format.ts';
import { useStore } from '../store.ts';

type HistoryEntry =
  | { kind: 'service'; id: string; date: string; odometer: number; text: string; notes: string | null }
  | { kind: 'reading'; id: string; date: string; odometer: number };

export function VehiclePage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const { outbox } = useStore();
  const today = todayIso();
  const { usage, due } = useMemo(() => vehicleDue(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const tasks = new Map(snapshot.tasks.filter((t) => t.vehicleId === vehicle.id).map((t) => [t.id, t]));
  const pending = new Set(outbox.map((op) => op.data.id));
  const owned = vehicle.status === 'owned';

  const history: HistoryEntry[] = [
    ...snapshot.services
      .filter((s) => s.vehicleId === vehicle.id)
      .map((s) => ({
        kind: 'service' as const,
        id: s.id,
        date: s.date,
        odometer: s.odometer,
        notes: s.notes,
        text: s.taskIds.map((id) => tasks.get(id)?.name ?? 'Deleted task').join(', '),
      })),
    ...snapshot.readings.filter((r) => r.vehicleId === vehicle.id).map((r) => ({ kind: 'reading' as const, ...r })),
  ].sort((a, b) => (a.date === b.date ? b.odometer - a.odometer : a.date < b.date ? 1 : -1));

  const subtitle = [vehicle.make, vehicle.model, vehicle.year, vehicle.registration].filter(Boolean).join(' · ');

  return (
    <Layout title={vehicle.name} back="/">
      <section className="card">
        {subtitle ? <p className="muted">{subtitle}</p> : null}
        {vehicle.status === 'sold' ? (
          <p className="banner banner-warn">
            Sold {vehicle.soldDate ? formatDate(vehicle.soldDate) : ''}
            {vehicle.soldOdometer !== null ? ` at ${formatKm(vehicle.soldOdometer)}` : ''}
            {vehicle.soldPrice !== null ? ` for ${formatMoney(vehicle.soldPrice)}` : ''}. History is kept; nothing is due.
          </p>
        ) : null}
        <p className="odometer">
          {usage.estimatedOdometer === null ? (
            'No odometer reading yet'
          ) : (
            <>
              <strong>
                {usage.kmPerDay ? '≈ ' : ''}
                {formatKm(usage.estimatedOdometer)}
              </strong>
              <span className="muted">
                {usage.kmPerDay ? ` today, at ~${Math.round(usage.kmPerDay * 30)} km/month` : ''}
                {usage.latest ? ` · last reading ${formatKm(usage.latest.odometer)} on ${formatDate(usage.latest.date)}` : ''}
              </span>
            </>
          )}
        </p>
        {owned ? (
          <div className="actions">
            <a className="button button-primary" href={`#/vehicles/${vehicle.id}/service`}>
              Log Service
            </a>
            <a className="button" href={`#/vehicles/${vehicle.id}/reading`}>
              Odometer reading
            </a>
          </div>
        ) : null}
      </section>

      <section>
        <div className="section-head">
          <h2>Maintenance Tasks</h2>
          {owned ? (
            <a className="button button-small" href={`#/vehicles/${vehicle.id}/tasks/new`}>
              + Task
            </a>
          ) : null}
        </div>
        {due.length === 0 ? (
          <div className="empty">
            <p>No Maintenance Tasks yet. Add them from the owner's manual, or copy them from another vehicle of the same model.</p>
            {owned ? (
              <a className="button" href={`#/vehicles/${vehicle.id}/copy-tasks`}>
                Copy tasks from another vehicle
              </a>
            ) : null}
          </div>
        ) : (
          <ul className="list">
            {due.map((d) => {
              const task = tasks.get(d.taskId)!;
              return (
                <li key={d.taskId}>
                  <a href={`#/tasks/${task.id}/edit`} className="task-row">
                    <div className="task-title">
                      {owned ? <StatusChip status={d.status} /> : null}
                      <span className="due-name">{task.name}</span>
                    </div>
                    <span className="muted">{describeInterval(task)}</span>
                    {owned ? <span className="due-text">{describeDue(d)}</span> : null}
                    {d.lastDone ? (
                      <span className="muted">
                        Last done {formatDate(d.lastDone.date)}
                        {d.lastDone.odometer !== null ? ` at ${formatKm(d.lastDone.odometer)}` : ''}
                        {d.lastDone.source === 'baseline' ? ' (before tracking)' : ''}
                      </span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>History</h2>
        {history.length === 0 ? <p className="empty">Nothing logged yet.</p> : null}
        <ul className="list">
          {history.map((h) => (
            <li key={`${h.kind}-${h.id}`}>
              {h.kind === 'service' ? (
                <a href={`#/services/${h.id}/edit`} className="history-row">
                  <span>
                    <strong>{formatDate(h.date)}</strong> · {formatKm(h.odometer)}
                    {pending.has(h.id) ? <span className="chip chip-pending">Waiting to sync</span> : null}
                  </span>
                  <span>🔧 {h.text}</span>
                  {h.notes ? <span className="muted">{h.notes}</span> : null}
                </a>
              ) : (
                <div className="history-row">
                  <span>
                    <strong>{formatDate(h.date)}</strong> · {formatKm(h.odometer)}
                    {pending.has(h.id) ? <span className="chip chip-pending">Waiting to sync</span> : null}
                  </span>
                  <span className="muted">Odometer reading</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="actions actions-footer">
        <a className="button" href={`#/vehicles/${vehicle.id}/edit`}>
          Edit vehicle
        </a>
        {owned && due.length > 0 ? (
          <a className="button" href={`#/vehicles/${vehicle.id}/copy-tasks`}>
            Copy tasks from…
          </a>
        ) : null}
        <a className="button" href={`#/vehicles/${vehicle.id}/sell`}>
          {owned ? 'Mark as sold' : 'Sale details'}
        </a>
      </section>
    </Layout>
  );
}
