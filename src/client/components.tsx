import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import type { OdometerCheck } from '../shared/consistency.ts';
import type { DueInfo } from '../shared/due.ts';
import type { Service } from '../shared/types.ts';
import { confirmAction, dismissToast, useFeedback } from './feedback.ts';
import { formatDate, formatKm } from './format.ts';
import { LANGS, messages, setLang, useT } from './i18n.ts';
import { Icon } from './icons.tsx';
import { useRoute } from './router.ts';
import { dismissRejected, needsServerAddress, sync, useStore } from './store.ts';

/** The app and the server speak different API versions: changes stay on the phone until one is updated. */
function VersionBanner() {
  const t = useT();
  const { versionMismatch, outbox } = useStore();
  if (!versionMismatch) return null;
  return (
    <p className="banner banner-warn" role="alert">
      {versionMismatch === 'app' ? t.version.updateApp : t.version.updateServer}
      {outbox.length > 0 ? ` ${t.version.kept}` : ''}
    </p>
  );
}

/** Matches the stylesheet's wide-screen breakpoint, where pages split into columns. */
const WIDE = '(min-width: 1000px)';

/** True on a wide screen; follows the window as it is resized. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = matchMedia(WIDE);
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => matchMedia(WIDE).matches,
  );
}

/**
 * Arrow keys move through the choices of a segmented control (radio group or tab list) and pick the one reached,
 * as a keyboard user expects. Put it on the container as `onKeyDown`.
 */
export function segmentedKeys(event: KeyboardEvent<HTMLElement>): void {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (step === undefined) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"], button[role="tab"]'));
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  event.preventDefault();
  const next = buttons[(at + step + buttons.length) % buttons.length]!;
  next.focus();
  next.click();
}

export function Layout({
  title,
  back,
  titleAction,
  entry,
  children,
}: {
  title: string;
  back?: string;
  /** Sits right next to the page's name, for acting on what it names. */
  titleAction?: ReactNode;
  /** A screen with typed input: on a phone the bottom menu is hidden so it does not cover the keyboard and the save button. */
  entry?: boolean;
  children: ReactNode;
}) {
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
        <NavBar entry={entry} />
        <div className="topbar-side topbar-end">
          <SyncBadge />
        </div>
      </header>
      <VersionBanner />
      <RejectedBanner />
      <main>
        {titleAction ? (
          <div className="page-title-row">
            <h1 className="page-title">{title}</h1>
            {titleAction}
          </div>
        ) : (
          <h1 className={back !== undefined ? 'page-title' : 'visually-hidden'}>{title}</h1>
        )}
        {children}
      </main>
      <ToastHost />
      <ConfirmHost />
    </>
  );
}

const SECTIONS = [
  ['garage', '/', 'home'],
  ['parts', '/parts', 'cart'],
  ['workshop', '/workshop', 'wrench'],
  ['settings', '/settings', 'settings'],
] as const;

type Section = (typeof SECTIONS)[number][0];

/** Which menu entry the screen at this route belongs to. */
function sectionOf([section, , sub]: string[]): Section {
  if (section === 'workshop' || section === 'tasks') return 'workshop';
  if (section === 'parts' || (section === 'vehicles' && sub === 'parts')) return 'parts';
  if (section === 'vehicles' && sub === 'specs') return 'workshop';
  if (section === 'settings') return 'settings';
  return 'garage';
}

/** The main sections, one tap away: a bar along the bottom on a phone, in the top bar on a wide screen. */
function NavBar({ entry }: { entry?: boolean }) {
  const t = useT();
  const current = sectionOf(useRoute());
  return (
    <nav className={`tabbar${entry ? ' tabbar-entry' : ''}`} aria-label={t.nav.label}>
      {SECTIONS.map(([key, path, icon]) => (
        <a key={key} href={`#${path}`} className={key === current ? 'active' : undefined} aria-current={key === current ? 'page' : undefined}>
          <Icon name={icon} />
          <span>{t.nav[key]}</span>
        </a>
      ))}
    </nav>
  );
}

function SyncBadge() {
  const t = useT();
  const store = useStore();
  const { outbox, reachable, contacted, syncing, versionMismatch } = store;
  const waiting = outbox.length;
  // Nothing to sync with until the Android app knows the server's address.
  if (needsServerAddress(store)) return null;
  let label: string;
  let tone: 'syncing' | 'offline' | 'synced';
  if (versionMismatch) {
    label = waiting > 0 ? t.sync.blockedWaiting(waiting) : t.sync.blocked;
    tone = 'offline';
  } else if (reachable && !contacted) {
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
            {op.kind === 'service'
              ? t.rejected.service(formatDate(op.data.date, t))
              : op.kind === 'fillup'
                ? t.rejected.fillup(formatDate(op.data.date, t))
                : t.rejected.reading(formatDate(op.data.date, t))}
            :{' '}
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

/** Says a History entry can be changed: the whole row opens its edit form. */
export function EditHint() {
  const t = useT();
  return (
    <span className="edit-hint">
      <Icon name="pencil" /> {t.vehicle.editShort}
    </span>
  );
}

/**
 * Warns, without blocking, that an odometer value contradicts what was logged, or that a Service looks logged twice.
 * Shown under the odometer field; nothing when all is consistent.
 */
export function ConsistencyWarnings({ check, duplicate, extra }: { check: OdometerCheck | null; duplicate?: Service | null; extra?: string | null }) {
  const t = useT();
  return (
    <div aria-live="polite">
      {check?.tooLowFor ? (
        <p className="banner banner-warn">
          {t.consistency.tooLow(formatKm(check.tooLowFor.odometer), formatDate(check.tooLowFor.date, t))}
        </p>
      ) : null}
      {check?.tooHighFor ? (
        <p className="banner banner-warn">
          {t.consistency.tooHigh(formatKm(check.tooHighFor.odometer), formatDate(check.tooHighFor.date, t))}
        </p>
      ) : null}
      {duplicate && duplicate.odometer !== null ? (
        <p className="banner banner-warn">
          {t.consistency.duplicate(formatDate(duplicate.date, t), formatKm(duplicate.odometer))}
        </p>
      ) : null}
      {extra ? <p className="banner banner-warn">{extra}</p> : null}
    </div>
  );
}

export function StatusChip({ status }: { status: DueInfo['status'] }) {
  const t = useT();
  return <span className={`chip chip-${status}`}>{t.status[status]}</span>;
}

type IntervalMode = 'distance' | 'time' | 'both';

/** An Interval as one of three choices: a distance, a duration, or both, due at whichever is reached first. */
export function IntervalFields({
  km,
  months,
  onKm,
  onMonths,
  kmPlaceholder,
  monthsPlaceholder,
}: {
  km: string;
  months: string;
  onKm: (value: string) => void;
  onMonths: (value: string) => void;
  kmPlaceholder?: string;
  monthsPlaceholder?: string;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<IntervalMode>(km !== '' && months === '' ? 'distance' : km === '' && months !== '' ? 'time' : 'both');
  // A value set from outside (the default Interval) shows its field even when the choice would hide it.
  const mode: IntervalMode = (chosen === 'distance' && months !== '') || (chosen === 'time' && km !== '') ? 'both' : chosen;

  function choose(next: IntervalMode) {
    setChosen(next);
    // What the choice leaves out is not part of the Interval.
    if (next === 'distance') onMonths('');
    if (next === 'time') onKm('');
  }

  return (
    <>
      <div className="segmented" role="radiogroup" aria-label={t.setup.interval} onKeyDown={segmentedKeys}>
        {(['distance', 'time', 'both'] as const).map((m) => (
          <button type="button" key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => choose(m)}>
            {t.setup.intervalModes[m]}
          </button>
        ))}
      </div>
      <div className="row">
        {mode === 'time' ? null : (
          <Field label={t.setup.everyKm}>
            <input inputMode="numeric" value={km} onChange={(e) => onKm(e.target.value)} placeholder={kmPlaceholder} />
          </Field>
        )}
        {mode === 'distance' ? null : (
          <Field label={mode === 'both' ? t.setup.everyMonths : t.setup.everyMonthsOnly}>
            <input inputMode="numeric" value={months} onChange={(e) => onMonths(e.target.value)} placeholder={monthsPlaceholder} />
          </Field>
        )}
      </div>
    </>
  );
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
    <div className="language" role="radiogroup" aria-label={t.language} onKeyDown={segmentedKeys}>
      <span className="muted">{t.language}</span>
      {LANGS.map(({ code, label }) => (
        <button
          type="button"
          key={code}
          role="radio"
          aria-checked={t.lang === code}
          className={t.lang === code ? 'on' : ''}
          onClick={() => setLang(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
