import { Fragment, useMemo, useState } from 'react';
import { todayIso } from '../../shared/dates.ts';
import { vehicleDue, type DueInfo } from '../../shared/due.ts';
import { groupByCategory } from '../../shared/workshop.ts';
import type { PerformedBy } from '../../shared/schemas.ts';
import type { MaintenanceTask, PartUsed, Snapshot, Vehicle } from '../../shared/types.ts';
import { Layout, StatusChip } from '../components.tsx';
import { describeDue, describeInterval, formatDate, formatKm, formatMoney, taskName } from '../format.ts';
import { useT } from '../i18n.ts';
import { makeAsName, VehicleIcon } from '../brands.tsx';
import { Icon } from '../icons.tsx';
import { online, useStore } from '../store.ts';
import { showToast } from '../feedback.ts';
import { describePart } from './Workshop.tsx';

/** Phones show the latest few History entries; the rest are one tap away. */
const HISTORY_PREVIEW = 5;

type HistoryEntry =
  | { kind: 'service'; id: string; date: string; odometer: number | null; text: string; notes: string | null; partsUsed: PartUsed[]; performedBy: PerformedBy; totalCost: number | null; repair: string | null }
  | { kind: 'reading'; id: string; date: string; odometer: number };

/** Says a History entry can be changed: the whole row opens its edit form. */
function EditHint() {
  const t = useT();
  return (
    <span className="edit-hint">
      <Icon name="pencil" /> {t.vehicle.editShort}
    </span>
  );
}

/** Maintenance Tasks, one per line: status, name, interval, when due and when last done. */
function TaskList({ due, tasks, owned }: { due: DueInfo[]; tasks: Map<string, MaintenanceTask>; owned: boolean }) {
  const t = useT();
  return (
    <ul className="list">
      {due.map((d) => {
        const task = tasks.get(d.taskId)!;
        return (
          <li key={d.taskId}>
            <a href={`#/tasks/${task.id}`} className="task-row">
              <div className="task-title">
                {owned ? <StatusChip status={d.status} /> : null}
                <span className="due-name">{taskName(task, t)}</span>
                {task.templateCode ? <span className="chip chip-standard">{t.vehicle.standardTask}</span> : null}
              </div>
              <span className="muted">{describeInterval(task, t)}</span>
              {owned ? <span className="due-text">{describeDue(d, t)}</span> : null}
              {d.lastDone ? (
                <span className="muted">
                  {t.vehicle.lastDone(formatDate(d.lastDone.date, t))}
                  {d.lastDone.odometer !== null ? ` ${t.due.at(formatKm(d.lastDone.odometer))}` : ''}
                  {d.lastDone.source === 'baseline' ? t.vehicle.beforeTracking : ''}
                </span>
              ) : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function VehiclePage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const { outbox } = useStore();
  const today = todayIso();
  const { usage, due } = useMemo(() => vehicleDue(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const tasks = new Map(snapshot.tasks.filter((task) => task.vehicleId === vehicle.id).map((task) => [task.id, task]));
  const groups = groupByCategory(due, tasks);
  const pending = new Set(outbox.map((op) => op.data.id));
  const owned = vehicle.status === 'owned';
  const specCount = snapshot.specLines.filter((s) => s.vehicleId === vehicle.id).length;
  const partCount = snapshot.vehicleParts.filter((p) => p.vehicleId === vehicle.id).length;
  const [allHistory, setAllHistory] = useState(false);
  async function addFromTemplates() {
    try {
      const { added } = await online<{ added: number }>('POST', `/api/vehicles/${vehicle.id}/add-from-templates`);
      showToast(t.vehicle.templatesAdded(added));
    } catch (e) {
      showToast((e as Error).message);
    }
  }

  const history: HistoryEntry[] = [
    ...snapshot.services
      .filter((s) => s.vehicleId === vehicle.id)
      .map((s) => ({
        kind: 'service' as const,
        id: s.id,
        date: s.date,
        odometer: s.odometer,
        notes: s.notes,
        partsUsed: s.partsUsed,
        performedBy: s.performedBy,
        totalCost: s.totalCost,
        repair: s.kind === 'repair' ? s.title : null,
        text: s.taskIds.map((id) => (tasks.get(id) ? taskName(tasks.get(id)!, t) : t.vehicle.deletedTask)).join(', '),
      })),
    ...snapshot.readings.filter((r) => r.vehicleId === vehicle.id).map((r) => ({ kind: 'reading' as const, ...r })),
  ].sort((a, b) => (a.date === b.date ? (b.odometer ?? 0) - (a.odometer ?? 0) : a.date < b.date ? 1 : -1));

  // A motorbike's make is already shown in capitals in front.
  const subtitle = [makeAsName(vehicle) ? null : vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' · ');
  const saleDetails = [
    vehicle.soldDate ? t.vehicle.soldDate(formatDate(vehicle.soldDate, t)) : '',
    vehicle.soldOdometer !== null ? t.vehicle.soldAt(formatKm(vehicle.soldOdometer)) : '',
    vehicle.soldPrice !== null ? t.vehicle.soldFor(formatMoney(vehicle.soldPrice, t)) : '',
  ].join('');

  return (
    <Layout
      title={vehicle.name}
      back="/"
      titleAction={
        <a className="button button-small" href={`#/vehicles/${vehicle.id}/edit`} aria-label={t.vehicle.edit}>
          <Icon name="pencil" /> {t.vehicle.editShort}
        </a>
      }
    >
      <div className="split">
        <div className="split-main">
          <section className="card">
            {subtitle ? (
              <p className="muted vehicle-subtitle">
                <VehicleIcon vehicle={vehicle} /> {subtitle}
              </p>
            ) : null}
            {vehicle.status === 'sold' ? <p className="banner banner-warn">{t.vehicle.sold(saleDetails)}</p> : null}
            <p className="odometer">
              {usage.latest === null ? (
                t.vehicle.noReading
              ) : (
                <>
                  <strong>{formatKm(usage.latest.odometer)}</strong>
                  <span className="muted">
                    {t.vehicle.lastReading(formatDate(usage.latest.date, t))}
                    {usage.kmPerDay ? t.vehicle.rate(Math.round(usage.kmPerDay * 30)) : ''}
                  </span>
                </>
              )}
            </p>
            {owned ? (
              <div className="actions">
                <a className="button button-primary" href={`#/vehicles/${vehicle.id}/service`}>
                  {t.vehicle.logService}
                </a>
                <a className="button" href={`#/vehicles/${vehicle.id}/reading`}>
                  {t.vehicle.odometerReading}
                </a>
              </div>
            ) : null}
          </section>

          <section>
            <div className="heading-row">
              <h2>{t.vehicle.tasks}</h2>
              {owned ? (
                <a className="button button-small" href={`#/vehicles/${vehicle.id}/tasks/new`}>
                  {t.vehicle.addTask}
                </a>
              ) : null}
            </div>
            {due.length === 0 ? (
              <div className="empty">
                <p>{t.vehicle.noTasks}</p>
                {owned ? (
                  <a className="button" href={`#/vehicles/${vehicle.id}/copy-tasks`}>
                    {t.vehicle.copyTasks}
                  </a>
                ) : null}
              </div>
            ) : (
              <>
                {groups.groups.map((g) => (
                  <Fragment key={g.category}>
                    <h3 className="due-group">{t.workshop.partCategories[g.category]}</h3>
                    <TaskList due={g.due} tasks={tasks} owned={owned} />
                  </Fragment>
                ))}
                {groups.paused.length > 0 ? (
                  <details className="sold">
                    <summary>{t.vehicle.pausedTasks(groups.paused.length)}</summary>
                    <TaskList due={groups.paused} tasks={tasks} owned={owned} />
                  </details>
                ) : null}
              </>
            )}
          </section>
        </div>

        <div className="split-side">
          <section>
            <h2>{t.workshop.section}</h2>
            <ul className="list">
              <li>
                <a href={`#/vehicles/${vehicle.id}/specs`}>
                  {t.workshop.section} <span className="muted">{t.workshop.count(specCount)}</span>
                </a>
              </li>
              <li>
                <a href={`#/vehicles/${vehicle.id}/parts`}>
                  {t.workshop.partsListLink} <span className="muted">{t.workshop.count(partCount)}</span>
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2>{t.vehicle.history}</h2>
            {history.length === 0 ? <p className="empty">{t.vehicle.nothingLogged}</p> : null}
            <ul className="list">
              {(allHistory ? history : history.slice(0, HISTORY_PREVIEW)).map((h) => (
                <li key={`${h.kind}-${h.id}`}>
                  {h.kind === 'service' ? (
                    <a href={`#/services/${h.id}/edit`} className="history-row">
                      <span className="history-head">
                        <span>
                          <strong>{formatDate(h.date, t)}</strong>
                          {h.odometer !== null ? ` · ${formatKm(h.odometer)}` : ''}
                          {pending.has(h.id) ? <span className="chip chip-pending">{t.vehicle.waitingToSync}</span> : null}
                        </span>
                        <EditHint />
                      </span>
                      <span className="with-icon">
                        <Icon name="wrench" /> {[h.repair, h.text].filter(Boolean).join(' · ')}
                      </span>
                      <span className="muted">
                        {t.service.performers[h.performedBy]}
                        {h.totalCost !== null ? ` · ${formatMoney(h.totalCost, t)}` : ''}
                      </span>
                      {h.partsUsed.length > 0 ? (
                        <span className="muted with-icon">
                          <Icon name="part" /> {h.partsUsed.map(describePart).join(', ')}
                        </span>
                      ) : null}
                      {h.notes ? <span className="muted">{h.notes}</span> : null}
                    </a>
                  ) : (
                    <a href={`#/readings/${h.id}/edit`} className="history-row">
                      <span className="history-head">
                        <span>
                          <strong>{formatDate(h.date, t)}</strong> · {formatKm(h.odometer)}
                          {pending.has(h.id) ? <span className="chip chip-pending">{t.vehicle.waitingToSync}</span> : null}
                        </span>
                        <EditHint />
                      </span>
                      <span className="muted">{t.vehicle.readingEntry}</span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {!allHistory && history.length > HISTORY_PREVIEW ? (
              <button type="button" className="button button-block" onClick={() => setAllHistory(true)}>
                {t.vehicle.showAllHistory(history.length)}
              </button>
            ) : null}
          </section>

          <section className="actions actions-footer">
            {owned ? (
              <button type="button" className="button" onClick={() => void addFromTemplates()}>
                {t.vehicle.addFromTemplates}
              </button>
            ) : null}
            {owned && due.length > 0 ? (
              <a className="button" href={`#/vehicles/${vehicle.id}/copy-tasks`}>
                {t.vehicle.copyTasksShort}
              </a>
            ) : null}
            <a className={`button ${owned ? 'button-danger' : ''}`} href={`#/vehicles/${vehicle.id}/sell`}>
              {owned ? t.vehicle.markSold : t.vehicle.saleDetails}
            </a>
          </section>
        </div>
      </div>
    </Layout>
  );
}
