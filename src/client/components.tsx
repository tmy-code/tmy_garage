import type { ReactNode } from 'react';
import type { DueInfo } from '../shared/due.ts';
import { formatDate } from './format.ts';
import { LANGS, setLang, useT } from './i18n.ts';
import { refreshPushSubscription } from './push.ts';
import { dismissRejected, sync, useStore } from './store.ts';

export function Layout({ title, back, actions, children }: { title: string; back?: string; actions?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <>
      <header className="topbar">
        {back !== undefined ? (
          <a className="back" href={`#${back}`} aria-label={t.back}>
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
  const t = useT();
  const { outbox, reachable, contacted, syncing } = useStore();
  const waiting = outbox.length;
  let label: string;
  let tone: string;
  if (reachable && !contacted) {
    label = t.sync.connecting;
    tone = 'syncing';
  } else if (!reachable) {
    label = waiting > 0 ? t.sync.offlineWaiting(waiting) : t.sync.offline;
    tone = 'offline';
  } else if (syncing || waiting > 0) {
    label = waiting > 0 ? t.sync.syncingCount(waiting) : t.sync.syncing;
    tone = 'syncing';
  } else {
    label = t.sync.synced;
    tone = 'synced';
  }
  return (
    <button type="button" className={`sync sync-${tone}`} onClick={() => void sync()} title={t.sync.tapToSync}>
      {label}
    </button>
  );
}

function RejectedBanner() {
  const t = useT();
  const { rejected } = useStore();
  if (rejected.length === 0) return null;
  return (
    <div className="banner banner-error" role="alert">
      <p>{t.rejected.title(rejected.length)}</p>
      <ul>
        {rejected.map(({ op, reason }) => (
          <li key={op.data.id}>
            {op.kind === 'service' ? t.rejected.service(formatDate(op.data.date, t)) : t.rejected.reading(formatDate(op.data.date, t))}:{' '}
            {reason}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void dismissRejected()}>
        {t.rejected.dismiss}
      </button>
    </div>
  );
}

export function StatusChip({ status }: { status: DueInfo['status'] }) {
  const t = useT();
  return <span className={`chip chip-${status}`}>{t.status[status]}</span>;
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
  const t = useT();
  const { reachable } = useStore();
  if (reachable) return null;
  return <p className="banner banner-warn">{t.needsConnection}</p>;
}

export function NotFound({ what }: { what: 'vehicle' | 'task' | 'service' | 'page' }) {
  const t = useT();
  return (
    <Layout title={t.notFound.title} back="/">
      <p className="empty">{t.notFound[what]}</p>
    </Layout>
  );
}

export function LanguageSwitch() {
  const t = useT();
  return (
    <div className="language" role="radiogroup" aria-label={t.language}>
      <span className="muted">{t.language}</span>
      {LANGS.map(({ code, label }) => (
        <button
          type="button"
          key={code}
          role="radio"
          aria-checked={t.lang === code}
          className={t.lang === code ? 'on' : ''}
          onClick={() => {
            setLang(code);
            // Reminders are written in the language the device last chose.
            void refreshPushSubscription();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
