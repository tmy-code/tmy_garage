import { useState, type FormEvent } from 'react';
import { Field, FormError } from '../components.tsx';
import { useT } from '../i18n.ts';
import { connectServer, useStore } from '../store.ts';

/** Where the Android app finds the server: typed once, kept on the phone (ADR 0006). */
export function ServerAddress() {
  const t = useT();
  const { server } = useStore();
  const [address, setAddress] = useState(server || 'https://');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connectServer(address, t.server.notFound);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.server.notFound);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <Field label={t.server.address} hint={t.server.hint}>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://nas.example.ts.net:8443"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </Field>
      <FormError error={error} />
      <button type="submit" className="button button-primary button-block" disabled={busy || !/^https?:\/\/.+/.test(address.trim())}>
        {busy ? t.server.connecting : t.server.connect}
      </button>
    </form>
  );
}
