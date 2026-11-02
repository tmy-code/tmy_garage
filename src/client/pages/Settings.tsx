import { useEffect, useState } from 'react';
import { LanguageSwitch, NeedsConnection, Layout } from '../components.tsx';
import { useT } from '../i18n.ts';
import { Icon } from '../icons.tsx';
import { pushState, PushRefused, sendTest, turnOff, turnOn, type PushState } from '../push.ts';

/** What the owner sets up for the app on this device: Reminders and the language. */
export function SettingsPage() {
  const t = useT();
  return (
    <Layout title={t.settings.title} back="/">
      <NeedsConnection />
      <section>
        <h2 className="with-icon">
          <Icon name="bell" /> {t.reminders.title}
        </h2>
        <Reminders />
      </section>
      <section>
        <h2 className="with-icon">
          <Icon name="part" /> {t.settings.partsTitle}
        </h2>
        <ul className="list">
          <li>
            <a href="#/settings/parts" className="history-row">
              <span>{t.settings.partsLink}</span>
              <span className="muted">{t.settings.partsLinkHint}</span>
            </a>
          </li>
        </ul>
      </section>
      <section>
        <LanguageSwitch />
      </section>
    </Layout>
  );
}

/** Turning Reminders on or off on this device, and sending a test one. */
function Reminders() {
  const t = useT();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  async function run(action: () => Promise<void>, done?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (done) setNotice({ text: done, error: false });
    } catch (error) {
      setNotice({ text: error instanceof PushRefused ? t.reminders.refused : (error as Error).message, error: true });
    } finally {
      setState(await pushState());
      setBusy(false);
    }
  }

  const explanation: Partial<Record<PushState, string>> = {
    insecure: t.reminders.insecure,
    needsInstall: t.reminders.needsInstall,
    unsupported: t.reminders.unsupported,
    blocked: t.reminders.blocked,
  };

  return (
    <>
      <p>{t.reminders.intro}</p>
      <p className="muted">{t.reminders.eachDevice}</p>
      {state && explanation[state] ? <p className="banner banner-warn">{explanation[state]}</p> : null}
      {state === 'on' ? <p className="banner banner-ok with-icon">
          <Icon name="bell" /> {t.reminders.on}
        </p> : null}
      {notice ? <p className={`banner ${notice.error ? 'banner-error' : 'banner-ok'}`}>{notice.text}</p> : null}
      <div className="actions">
        {state === 'off' ? (
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void run(turnOn)}>
            {busy ? t.reminders.working : t.reminders.turnOn}
          </button>
        ) : null}
        {state === 'on' ? (
          <>
            <button type="button" className="button" disabled={busy} onClick={() => void run(sendTest, t.reminders.testSent)}>
              {t.reminders.test}
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => void run(turnOff)}>
              {t.reminders.turnOff}
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}
