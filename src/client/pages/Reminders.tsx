import { useEffect, useState } from 'react';
import { NeedsConnection, Layout } from '../components.tsx';
import { useT } from '../i18n.ts';
import { pushState, PushRefused, sendTest, turnOff, turnOn, type PushState } from '../push.ts';

export function RemindersPage() {
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
    <Layout title={t.reminders.title} back="/">
      <NeedsConnection />
      <p>{t.reminders.intro}</p>
      <p className="muted">{t.reminders.eachDevice}</p>
      {state && explanation[state] ? <p className="banner banner-warn">{explanation[state]}</p> : null}
      {state === 'on' ? <p className="banner banner-ok">🔔 {t.reminders.on}</p> : null}
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
    </Layout>
  );
}
