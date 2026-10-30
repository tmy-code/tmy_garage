import { useMemo, useState } from 'react';
import { todayIso } from '../../shared/dates.ts';
import { vehicleDue } from '../../shared/due.ts';
import { nextInspection, openDefects } from '../../shared/inspections.ts';
import { currentCover, renewal } from '../../shared/insurance.ts';
import type { PartUsed, Snapshot, Vehicle } from '../../shared/types.ts';
import { Layout, StatusChip } from '../components.tsx';
import { describeDue, describeInterval, describeOfficialInterval, formatDate, formatKm, formatMoney, taskName } from '../format.ts';
import { useT } from '../i18n.ts';
import { Icon } from '../icons.tsx';
import { useStore } from '../store.ts';
import { describePart } from './Workshop.tsx';

/** Phones show the latest few History entries; the rest are one tap away. */
const HISTORY_PREVIEW = 5;

type HistoryEntry =
  | { kind: 'service'; id: string; date: string; odometer: number; text: string; notes: string | null; partsUsed: PartUsed[] }
  | { kind: 'reading'; id: string; date: string; odometer: number };

export function VehiclePage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const { outbox } = useStore();
  const today = todayIso();
  const { usage, due } = useMemo(() => vehicleDue(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const tasks = new Map(snapshot.tasks.filter((task) => task.vehicleId === vehicle.id).map((task) => [task.id, task]));
  const pending = new Set(outbox.map((op) => op.data.id));
  const owned = vehicle.status === 'owned';
  const inspection = nextInspection(snapshot, vehicle, today);
  const defects = openDefects(snapshot, vehicle).length;
  const documentCount = snapshot.documents.filter((d) => d.vehicleId === vehicle.id).length;
  const modificationCount = snapshot.modifications.filter((m) => m.vehicleId === vehicle.id).length;
  const positionCount = snapshot.positions.filter((p) => p.vehicleId === vehicle.id).length;
  const partSpecCount = snapshot.partSpecs.filter((p) => p.vehicleId === vehicle.id).length;
  const specCount = snapshot.vehicleSpecs.filter((s) => s.vehicleId === vehicle.id).length;
  const cover = currentCover(snapshot, vehicle.id, today);
  const insuranceDue = cover ? renewal(cover.policy, today) : null;
  const [allHistory, setAllHistory] = useState(false);

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
        text: s.taskIds.map((id) => (tasks.get(id) ? taskName(tasks.get(id)!, t) : t.vehicle.deletedTask)).join(', '),
      })),
    ...snapshot.readings.filter((r) => r.vehicleId === vehicle.id).map((r) => ({ kind: 'reading' as const, ...r })),
  ].sort((a, b) => (a.date === b.date ? b.odometer - a.odometer : a.date < b.date ? 1 : -1));

  const subtitle = [vehicle.make, vehicle.model, vehicle.year, vehicle.registration].filter(Boolean).join(' · ');
  const saleDetails = [
    vehicle.soldDate ? t.vehicle.soldDate(formatDate(vehicle.soldDate, t)) : '',
    vehicle.soldOdometer !== null ? t.vehicle.soldAt(formatKm(vehicle.soldOdometer)) : '',
    vehicle.soldPrice !== null ? t.vehicle.soldFor(formatMoney(vehicle.soldPrice, t)) : '',
  ].join('');

  return (
    <Layout
      title={vehicle.name}
      back="/"
      actions={
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
                <Icon name={vehicle.kind} /> {subtitle}
              </p>
            ) : null}
            {vehicle.status === 'sold' ? <p className="banner banner-warn">{t.vehicle.sold(saleDetails)}</p> : null}
            {owned && (inspection.status === 'overdue' || inspection.status === 'dueSoon') && inspection.dueDate ? (
              <p className="task-title">
                <span className={`chip chip-${inspection.status}`}>{t.status[inspection.status]}</span>
                <a href={`#/vehicles/${vehicle.id}/inspections`}>
                  {t.papers.nextInspection} · {t.papers.dueBy(formatDate(inspection.dueDate, t))}
                </a>
              </p>
            ) : null}
            <p className="odometer">
              {usage.estimatedOdometer === null ? (
                t.vehicle.noReading
              ) : (
                <>
                  <strong>{formatKm(usage.estimatedOdometer)}</strong>
                  <span className="muted">
                    {usage.kmPerDay ? t.vehicle.rate(Math.round(usage.kmPerDay * 30)) : ''}
                    {usage.latest ? t.vehicle.lastReading(formatKm(usage.latest.odometer), formatDate(usage.latest.date, t)) : ''}
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
            <div className="section-head">
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
              <ul className="list list-grid">
                {due.map((d) => {
                  const task = tasks.get(d.taskId)!;
                  const official = describeOfficialInterval(task, t);
                  return (
                    <li key={d.taskId}>
                      <a href={`#/tasks/${task.id}`} className="task-row">
                        <div className="task-title">
                          {owned ? <StatusChip status={d.status} /> : null}
                          <span className="due-name">{taskName(task, t)}</span>
                        </div>
                        <span className="muted">{describeInterval(task, t)}</span>
                        {official ? <span className="muted">{official}</span> : null}
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
            )}
          </section>
        </div>

        <div className="split-side">
          <section>
            <h2>{t.papers.section}</h2>
            <ul className="list">
              <li>
                <a href={`#/vehicles/${vehicle.id}/insurance`} className="history-row">
                  <span>{t.insurance.title}</span>
                  <span className="muted">
                    {cover ? `${cover.policy.insurer} · ${t.insurance.levels[cover.cover.level]}` : t.insurance.notInsured}
                    {insuranceDue ? ` · ${t.insurance.renewsOn(formatDate(insuranceDue.date, t))}` : ''}
                  </span>
                </a>
              </li>
              <li>
                <a href={`#/vehicles/${vehicle.id}/documents`}>
                  {t.papers.documents} <span className="muted">{t.workshop.count(documentCount)}</span>
                </a>
              </li>
              <li>
                <a href={`#/vehicles/${vehicle.id}/inspections`} className="history-row">
                  <span>{t.papers.inspections}</span>
                  <span className="muted">
                    {inspection.dueDate ? t.papers.dueBy(formatDate(inspection.dueDate, t)) : t.papers.basis.unknown}
                    {defects > 0 ? ` · ${t.papers.openDefects(defects)}` : ''}
                  </span>
                </a>
              </li>
              <li>
                <a href={`#/vehicles/${vehicle.id}/modifications`}>
                  {t.papers.modifications} <span className="muted">{t.workshop.count(modificationCount)}</span>
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2>{t.workshop.section}</h2>
            <ul className="list">
              <li>
                <a href={`#/vehicles/${vehicle.id}/fitted`}>
                  {t.workshop.fitted} <span className="muted">{t.workshop.count(positionCount)}</span>
                </a>
              </li>
              <li>
                <a href={`#/vehicles/${vehicle.id}/parts`}>
                  {t.workshop.partSpecs} <span className="muted">{t.workshop.count(partSpecCount)}</span>
                </a>
              </li>
              <li>
                <a href={`#/vehicles/${vehicle.id}/specs`}>
                  {t.workshop.specs} <span className="muted">{t.workshop.count(specCount)}</span>
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
                      <span>
                        <strong>{formatDate(h.date, t)}</strong> · {formatKm(h.odometer)}
                        {pending.has(h.id) ? <span className="chip chip-pending">{t.vehicle.waitingToSync}</span> : null}
                      </span>
                      <span className="with-icon">
                        <Icon name="wrench" /> {h.text}
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
                      <span>
                        <strong>{formatDate(h.date, t)}</strong> · {formatKm(h.odometer)}
                        {pending.has(h.id) ? <span className="chip chip-pending">{t.vehicle.waitingToSync}</span> : null}
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
