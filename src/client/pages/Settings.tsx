import { useState } from 'react';
import { ApiError, NetworkError } from '../api.ts';
import { LanguageSwitch, NeedsConnection, Layout } from '../components.tsx';
import { formatDateTime } from '../format.ts';
import { useT } from '../i18n.ts';
import { Icon } from '../icons.tsx';
import { showToast } from '../feedback.ts';
import { isAndroidApp, isDesktop } from '../native.ts';
import { online, useStore } from '../store.ts';
import { ServerAddress } from './Server.tsx';

/** How a "Sync now" failed: the server could not be reached, Notion is not set up, a sync is running, or Notion/the server said no. */
type SyncFailure = { kind: 'network' } | { kind: 'busy' } | { kind: 'server'; message: string };

/**
 * The Notion sync: when it last ran, what it could not understand, how many tasks it paused, and a button to run it now.
 * Syncing is online only. Hidden when the server has no Notion set up. The server's own messages are English only, so
 * they are always labelled as such.
 */
function NotionCard() {
  const t = useT();
  const { view, reachable } = useStore();
  const [running, setRunning] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [failure, setFailure] = useState<SyncFailure | null>(null);
  const status = view?.notion ?? null;
  if (!status) return null;

  if (unavailable) {
    return (
      <section>
        <h2>{t.notion.title}</h2>
        <p className="banner banner-warn" role="status">
          {t.notion.notConfigured}
        </p>
      </section>
    );
  }

  async function syncNow() {
    setRunning(true);
    setFailure(null);
    try {
      await online('POST', '/api/notion/sync');
      showToast(t.notion.syncDone);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setUnavailable(true);
        showToast(t.notion.notConfigured);
      } else if (e instanceof ApiError && e.status === 409) setFailure({ kind: 'busy' });
      else if (e instanceof NetworkError) setFailure({ kind: 'network' });
      else setFailure({ kind: 'server', message: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section>
      <div className="heading-row">
        <h2>{t.notion.title}</h2>
        <button type="button" className="button" onClick={() => void syncNow()} disabled={running || !reachable} aria-describedby={reachable ? undefined : 'notion-offline'}>
          {running ? t.notion.syncing : t.notion.syncNow}
        </button>
      </div>
      {!reachable ? (
        <p className="muted" id="notion-offline">
          {t.notion.needsOnline}
        </p>
      ) : null}
      <div className="card">
        <p className="muted">{t.notion.intro}</p>
        <p>{status.lastSyncAt ? t.notion.lastSync(formatDateTime(status.lastSyncAt, t)) : t.notion.neverSynced}</p>
        {failure ? (
          <p className="banner banner-error" role="alert">
            {failure.kind === 'network' ? (
              t.notion.unreachable
            ) : failure.kind === 'busy' ? (
              t.notion.alreadyRunning
            ) : (
              <>
                {t.notion.syncFailed} <span lang="en">{failure.message}</span> <span className="muted">{t.notion.warningsEnglishOnly}</span> {t.notion.nextStep}
              </>
            )}
          </p>
        ) : null}
        {status.lastError ? (
          <p className="banner banner-warn">
            {t.notion.lastError} <span lang="en">{status.lastError}</span> <span className="muted">{t.notion.warningsEnglishOnly}</span> {t.notion.nextStep}
          </p>
        ) : null}
        {status.pausedTasks > 0 ? <p className="banner banner-warn">{t.notion.pausedTasks(status.pausedTasks)}</p> : null}
        {status.warnings.length > 0 ? (
          <details className="sold">
            <summary>{t.notion.warnings(status.warnings.length)}</summary>
            <p className="muted">{t.notion.warningsEnglishOnly}</p>
            <ul>
              {status.warnings.map((w) => (
                <li key={w} lang="en">
                  {w}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}

/** What the owner sets up for the app on this device: the parts catalogue and the language. */
export function SettingsPage() {
  const t = useT();
  const { view } = useStore();
  const showTools = view !== null && (view.notion !== null || view.tools.length > 0);
  return (
    <Layout title={t.settings.title} back="/">
      <NeedsConnection />
      <NotionCard />
      {isDesktop || showTools ? (
        <section>
          <h2 className="with-icon">
            <Icon name="part" /> {t.settings.partsTitle}
          </h2>
          <ul className="list">
            {isDesktop ? (
              <li>
                <a href="#/settings/parts" className="history-row">
                  <span>{t.settings.partsLink}</span>
                  <span className="muted">{t.settings.partsLinkHint}</span>
                </a>
              </li>
            ) : null}
            {showTools ? (
              <li>
                <a href="#/tools" className="history-row">
                  <span>{t.notion.toolsLink}</span>
                  <span className="muted">{t.notion.toolsLinkHint}</span>
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
      {isAndroidApp ? (
        <section>
          <h2>{t.server.title}</h2>
          <ServerAddress />
        </section>
      ) : null}
      <section>
        <LanguageSwitch />
      </section>
    </Layout>
  );
}
