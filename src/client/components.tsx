import { useEffect, useRef, type ReactNode } from 'react';
import type { DueInfo } from '../shared/due.ts';
import { confirmAction, dismissToast, useFeedback } from './feedback.ts';
import { formatDate } from './format.ts';
import { LANGS, messages, setLang, useT } from './i18n.ts';
import { Icon } from './icons.tsx';
import { refreshPushSubscription } from './push.ts';
import { dismissRejected, sync, useStore } from './store.ts';

export function Layout({ title, back, actions, children }: { title: string; back?: string; actions?: ReactNode; children: ReactNode }) {
  const t = useT();
  // "Garage" sits in the middle of every top bar and leads home; the page's own name is its heading below.
  // Home screens (no back arrow) would only repeat "Garage", so their heading is for screen readers only.
  return (
    <>
      <header className="topbar">
        <div className="topbar-side">
          {back !== undefined ? (
            <a className="back" href={`#${back}`} aria-label={t.back}>
              ‹
            </a>
          ) : null}
        </div>
        <a className="home-link" href="#/">
          {t.garage}
        </a>
        <div className="topbar-side topbar-end">
          <SyncBadge />
          {actions}
        </div>
      </header>
      <RejectedBanner />
      <main>
        <h1 className={back !== undefined ? 'page-title' : 'visually-hidden'}>{title}</h1>
        {children}
      </main>
      <ToastHost />
      <ConfirmHost />
    </>
  );
}

function SyncBadge() {
  const t = useT();
  const { outbox, reachable, contacted, syncing } = useStore();
  const waiting = outbox.length;
  let label: string;
  let tone: 'syncing' | 'offline' | 'synced';
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
  // When all is well only a small tick shows, so the page title keeps the room; problems are spelled out.
  return (
    <button
      type="button"
      className={`sync sync-${tone}`}
      onClick={() => void sync()}
      title={`${label} · ${t.sync.tapToSync}`}
      aria-label={`${label} · ${t.sync.tapToSync}`}
    >
      <Icon name={tone === 'synced' ? 'check' : tone === 'offline' ? 'cloudOff' : 'sync'} />
      <span className="sync-label">{label}</span>
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

function ToastHost() {
  const t = useT();
  const { toast } = useFeedback();
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toast ? (
        <div className="toast" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undo ? (
            <button
              type="button"
              onClick={() => {
                const undo = toast.undo!;
                dismissToast();
                void undo.run();
              }}
            >
              {toast.undo.label}
            </button>
          ) : null}
          <button type="button" className="toast-close" onClick={dismissToast} aria-label={t.feedback.close}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ConfirmHost() {
  const { confirm } = useFeedback();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (confirm && !el.open) el.showModal();
    if (!confirm && el.open) el.close();
  }, [confirm]);
  return (
    <dialog
      ref={dialog}
      className="confirm"
      onCancel={(e) => {
        e.preventDefault();
        confirm?.resolve(false);
      }}
    >
      {confirm ? (
        <>
          <p>{confirm.message}</p>
          <div className="actions">
            {/* Cancel first and focused: the safe choice is the default one. */}
            <button type="button" className="button" autoFocus onClick={() => confirm.resolve(false)}>
              {confirm.cancelLabel}
            </button>
            <button type="button" className="button button-danger-solid" onClick={() => confirm.resolve(true)}>
              {confirm.confirmLabel}
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

/** Asks before deleting something, in the app's own dialog. */
export function confirmDelete(message: string): Promise<boolean> {
  const t = messages();
  return confirmAction(message, { confirm: t.feedback.delete, cancel: t.feedback.cancel });
}

/** A form's error, brought into view when it appears so it isn't missed below the fold. */
export function FormError({ error }: { error: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [error]);
  if (!error) return null;
  return (
    <p ref={ref} className="banner banner-error" role="alert">
      {error}
    </p>
  );
}

export function StatusChip({ status }: { status: DueInfo['status'] }) {
  const t = useT();
  return <span className={`chip chip-${status}`}>{t.status[status]}</span>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className={`field ${error ? 'field-invalid' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
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
