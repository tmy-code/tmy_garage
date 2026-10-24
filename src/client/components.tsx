import type { ReactNode } from 'react';
import type { DueInfo } from '../shared/due.ts';
import { STATUS_LABEL } from './format.ts';
import { dismissRejected, sync, useStore } from './store.ts';

export function Layout({ title, back, actions, children }: { title: string; back?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        {back !== undefined ? (
          <a className="back" href={`#${back}`} aria-label="Back">
            ‹
          </a>
        ) : null}
        <h1>{title}</h1>
        <SyncBadge />
        {actions}
      </header>
      <RejectedBanner />
      <main>{children}</main>
    </>
  );
}

function SyncBadge() {
  const { outbox, reachable, contacted, syncing } = useStore();
  const waiting = outbox.length;
  let label: string;
  let tone: string;
  if (reachable && !contacted) {
    label = 'Connecting…';
    tone = 'syncing';
  } else if (!reachable) {
    label = waiting > 0 ? `Offline · ${waiting} waiting` : 'Offline';
    tone = 'offline';
  } else if (syncing || waiting > 0) {
    label = waiting > 0 ? `Syncing ${waiting}…` : 'Syncing…';
    tone = 'syncing';
  } else {
    label = 'Synced';
    tone = 'synced';
  }
  return (
    <button type="button" className={`sync sync-${tone}`} onClick={() => void sync()} title="Tap to sync now">
      {label}
    </button>
  );
}

function RejectedBanner() {
  const { rejected } = useStore();
  if (rejected.length === 0) return null;
  return (
    <div className="banner banner-error" role="alert">
      <p>
        {rejected.length === 1 ? 'A change' : `${rejected.length} changes`} made offline could not be saved:
      </p>
      <ul>
        {rejected.map(({ op, reason }) => (
          <li key={op.data.id}>
            {op.kind === 'service' ? `Service of ${op.data.date}` : `Odometer reading of ${op.data.date}`}: {reason}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void dismissRejected()}>
        Dismiss
      </button>
    </div>
  );
}

export function StatusChip({ status }: { status: DueInfo['status'] }) {
  return <span className={`chip chip-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function NeedsConnection() {
  const { reachable } = useStore();
  if (reachable) return null;
  return <p className="banner banner-warn">This needs a connection to the garage server. Services and odometer readings work offline.</p>;
}

export function NotFound({ what }: { what: string }) {
  return (
    <Layout title="Not found" back="/">
      <p className="empty">This {what} doesn't exist, or hasn't been synced to this phone yet.</p>
    </Layout>
  );
}
