import { useState, type FormEvent } from 'react';
import { todayIso } from '../../shared/dates.ts';
import type { DocumentOwnerKind, DocumentType } from '../../shared/schemas.ts';
import type { GarageDocument, Snapshot } from '../../shared/types.ts';
import { confirmDelete, Field, FormError } from '../components.tsx';
import { formatDate } from '../format.ts';
import { useT, type Messages } from '../i18n.ts';
import { Icon } from '../icons.tsx';
import { online, useStore } from '../store.ts';
import { Submit, useSubmit } from './SetupForms.tsx';

// Papers are desk work and need a connection; their details stay readable offline from the phone's copy.

function documentName(doc: GarageDocument, t: Messages): string {
  return doc.title ?? t.papers.types[doc.type];
}

function ExpiryNote({ doc, today, t }: { doc: GarageDocument; today: string; t: Messages }) {
  if (!doc.expiryDate) return null;
  const expired = doc.expiryDate < today;
  return (
    <span className={expired ? 'nudge' : 'muted'}>
      {expired ? t.papers.expired(formatDate(doc.expiryDate, t)) : t.papers.expires(formatDate(doc.expiryDate, t))}
    </span>
  );
}

function DocumentRow({ doc, label }: { doc: GarageDocument; label?: string }) {
  const t = useT();
  const { reachable } = useStore();
  const { error, disabled, run } = useSubmit();
  async function remove() {
    if (!(await confirmDelete(t.papers.confirmDeleteDocument(documentName(doc, t))))) return;
    void run(() => online('DELETE', `/api/documents/${doc.id}`), t.feedback.deleted);
  }
  return (
    <li>
      <div className="history-row">
        <div className="section-head">
          <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer">
            <strong className="with-icon">
              <Icon name="document" /> {documentName(doc, t)}
            </strong>
          </a>
          <button type="button" className="button button-small button-danger" onClick={remove} disabled={disabled}>
            {t.workshop.delete}
          </button>
        </div>
        <span className="muted">
          {doc.title ? `${t.papers.types[doc.type]} · ` : ''}
          {doc.fileName}
          {label ? ` · ${label}` : ''}
        </span>
        <ExpiryNote doc={doc} today={todayIso()} t={t} />
        {!reachable ? <span className="muted">{t.papers.needsConnectionToOpen}</span> : null}
        {error ? <span className="banner banner-error">{error}</span> : null}
      </div>
    </li>
  );
}

/** The Documents attached to one thing, and a form to add one (a PDF, or a photo taken on the spot). */
export function DocumentsPanel({
  snapshot,
  ownerKind,
  ownerId,
  defaultType,
  title,
}: {
  snapshot: Snapshot;
  ownerKind: DocumentOwnerKind;
  ownerId: string;
  defaultType: DocumentType;
  title: string;
}) {
  const t = useT();
  const docs = snapshot.documents.filter((d) => d.ownerKind === ownerKind && d.ownerId === ownerId);
  const [file, setFile] = useState<File | null>(null);
  const [formKey, setFormKey] = useState(0);
  const { error, busy, disabled, run } = useSubmit();

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (!file) throw new Error(t.papers.noFile);
      const form = new FormData();
      form.set('file', file);
      form.set('ownerKind', ownerKind);
      form.set('ownerId', ownerId);
      form.set('type', defaultType);
      await online('POST', '/api/documents', form);
      setFile(null);
      setFormKey(formKey + 1);
    });
  }

  return (
    <section>
      <h2>{title}</h2>
      {docs.length === 0 ? <p className="muted">{t.papers.noDocuments}</p> : null}
      <ul className="list list-grid">
        {docs.map((d) => (
          <DocumentRow key={d.id} doc={d} />
        ))}
      </ul>
      <form key={formKey} onSubmit={submit} className="form card">
        <Field label={t.papers.file} hint={t.papers.fileHint}>
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <FormError error={error} />
        <Submit disabled={disabled || !file}>{busy ? t.papers.uploading : t.papers.upload}</Submit>
      </form>
    </section>
  );
}

