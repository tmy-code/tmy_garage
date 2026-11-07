import { LanguageSwitch, NeedsConnection, Layout } from '../components.tsx';
import { useT } from '../i18n.ts';
import { Icon } from '../icons.tsx';

/** What the owner sets up for the app on this device: the parts catalogue and the language. */
export function SettingsPage() {
  const t = useT();
  return (
    <Layout title={t.settings.title} back="/">
      <NeedsConnection />
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
