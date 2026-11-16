import { useEffect, useState, type FormEvent } from 'react';
import { extensionOf, suggestFileName, withExtension } from '../../shared/archive-name.ts';
import { todayIso } from '../../shared/dates.ts';
import type { DocumentOwnerKind, DocumentType } from '../../shared/schemas.ts';
import type { GarageDocument, Snapshot } from '../../shared/types.ts';
import { ArchiveError, archiveSupported, chooseArchiveRoot, ensureArchiveAccess, fileReceipt, hasArchiveRoot } from '../archive.ts';
import { confirmDelete, Field, FormError } from '../components.tsx';
import { formatDate } from '../format.ts';
import { useT, type Messages } from '../i18n.ts';
import { Icon } from '../icons.tsx';
import { isAndroidApp, openDocument } from '../native.ts';
import { serverUrl } from '../server.ts';
import { online, useStore } from '../store.ts';
import { Submit, useSubmit } from './SetupForms.tsx';

// Documents are desk work and need a connection; their details stay readable offline from the phone's copy.

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

/** What a Service's Receipt needs to be filed in Proton Drive (ADR 0010). */
export interface ArchiveTarget {
  /** The Vehicle's Archive folder; null when it has none yet. */
  folder: string | null;
  /** The Service date and title, for the suggested file name. */
  date: string;
  title: string | null;
}

function archiveMessage(error: unknown, t: Messages, folder: string): string {
  if (error instanceof ArchiveError) {
    if (error.reason === 'no-root') return t.papers.archiveNoRoot;
    if (error.reason === 'no-permission') return t.papers.archiveNoPermission;
    if (error.reason === 'not-found') return t.papers.archiveNotFound(folder);
  }
  return t.papers.archiveWriteFailed;
}

/** Whether a Proton Drive folder was picked on this browser, and the button that picks it. */
function useArchiveRoot() {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    void hasArchiveRoot().then(setReady);
  }, []);
  async function choose() {
    await chooseArchiveRoot();
    setReady(true);
  }
  return { ready, choose };
}

function DocumentRow({ doc, label, archive }: { doc: GarageDocument; label?: string; archive?: ArchiveTarget }) {
  const t = useT();
  const { reachable } = useStore();
  const { error, setError, disabled, run } = useSubmit();
  async function remove() {
    const question = archive ? t.papers.confirmDeleteReceipt(documentName(doc, t)) : t.papers.confirmDeleteDocument(documentName(doc, t));
    if (!(await confirmDelete(question))) return;
    void run(() => online('DELETE', `/api/documents/${doc.id}`), t.feedback.deleted);
  }
  // Retry for a Pending Receipt: fetch the app's copy and file it in Proton Drive now.
  async function fileNow() {
    if (!archive?.folder) return;
    setError(null);
    try {
      await ensureArchiveAccess();
      const blob = await (await fetch(serverUrl(`/api/documents/${doc.id}/file`))).blob();
      const name = suggestFileName(archive.date, archive.title, extensionOf(doc.fileName, doc.contentType));
      const path = await fileReceipt(blob, archive.folder, name);
      await run(() => online('PUT', `/api/documents/${doc.id}/archive`, { path }));
    } catch (e) {
      setError(archiveMessage(e, t, archive.folder));
    }
  }
  return (
    <li>
      <div className="history-row">
        <div className="section-head">
          <a
            href={serverUrl(`/api/documents/${doc.id}/file`)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              // The Android app's browser cannot show a PDF: hand the file to the phone's own viewer.
              if (!isAndroidApp) return;
              e.preventDefault();
              setError(null);
              openDocument(serverUrl(`/api/documents/${doc.id}/file`), doc.fileName, doc.contentType).catch(() =>
                setError(t.papers.needsConnectionToOpen),
              );
            }}
          >
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
        {archive ? (
          doc.archivePath ? (
            <span className="muted">{t.papers.filed(doc.archivePath)}</span>
          ) : (
            <>
              <span className="muted">{t.papers.pending}</span>
              {archive.folder && archiveSupported ? (
                <button type="button" className="button button-small" onClick={fileNow} disabled={disabled || !reachable}>
                  {t.papers.fileNow}
                </button>
              ) : null}
            </>
          )
        ) : null}
        {!reachable ? (
          <span className="muted">{archive && !doc.archivePath && archive.folder ? t.papers.archiveNeedsConnection : t.papers.needsConnectionToOpen}</span>
        ) : null}
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
  archive,
}: {
  snapshot: Snapshot;
  ownerKind: DocumentOwnerKind;
  ownerId: string;
  defaultType: DocumentType;
  title: string;
  /** Set for a Service's Receipts: they are also filed in Proton Drive (ADR 0010). */
  archive?: ArchiveTarget;
}) {
  const t = useT();
  const docs = snapshot.documents.filter((d) => d.ownerKind === ownerKind && d.ownerId === ownerId);
  const [file, setFile] = useState<File | null>(null);
  const [archiveName, setArchiveName] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const { error, busy, disabled, run } = useSubmit();
  const root = useArchiveRoot();
  const filing = Boolean(archive?.folder) && archiveSupported;

  function choose(picked: File | null) {
    setFile(picked);
    setArchiveError(null);
    if (picked && archive) setArchiveName(suggestFileName(archive.date, archive.title, extensionOf(picked.name, picked.type)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (!file) throw new Error(t.papers.noFile);
      setArchiveError(null);
      // The browser only allows the Proton folder prompt right after a click, so ask before the (slower) upload.
      let access = filing;
      let accessError: string | null = null;
      if (filing) {
        await ensureArchiveAccess().catch((e) => {
          access = false;
          accessError = archiveMessage(e, t, archive!.folder!);
        });
      }
      const form = new FormData();
      form.set('file', file);
      form.set('ownerKind', ownerKind);
      form.set('ownerId', ownerId);
      form.set('type', defaultType);
      const saved = await online<GarageDocument>('POST', '/api/documents', form);
      // The app copy is saved first and always counts; a failure here leaves the Receipt Pending, with a retry button.
      if (filing && access) {
        try {
          const name = withExtension(archiveName || suggestFileName(archive!.date, archive!.title, extensionOf(file.name, file.type)), extensionOf(file.name, file.type));
          const path = await fileReceipt(file, archive!.folder!, name);
          await online('PUT', `/api/documents/${saved.id}/archive`, { path });
        } catch (e) {
          setArchiveError(`${t.papers.receiptSaved} ${archiveMessage(e, t, archive!.folder!)} ${t.papers.retryHint}`);
        }
      } else if (accessError) {
        setArchiveError(`${t.papers.receiptSaved} ${accessError} ${t.papers.retryHint}`);
      }
      setFile(null);
      setArchiveName('');
      setFormKey(formKey + 1);
    });
  }

  return (
    <section>
      <h2>{title}</h2>
      {docs.length === 0 ? <p className="muted">{t.papers.noDocuments}</p> : null}
      <ul className="list list-grid">
        {docs.map((d) => (
          <DocumentRow key={d.id} doc={d} archive={archive} />
        ))}
      </ul>
      <form key={formKey} onSubmit={submit} className="form card">
        <Field label={t.papers.file} hint={t.papers.fileHint}>
          <input type="file" accept="application/pdf,image/*" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        </Field>
        {/* Opens the camera straight away: the Android app's file picker offers no camera. */}
        <label className="button button-block">
          <Icon name="camera" /> {t.papers.takePhoto}
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        </label>
        {file ? <p className="muted">{t.papers.photoChosen(file.name)}</p> : null}
        {archive && !archiveSupported ? <p className="muted">{t.papers.archiveUnsupported}</p> : null}
        {archive && archiveSupported && !archive.folder ? <p className="muted">{t.papers.noArchiveFolder}</p> : null}
        {filing && root.ready === false ? (
          <>
            <button type="button" className="button button-block" onClick={() =>
                void root.choose().catch((e) => {
                  // Closing the picker is not an error; anything else needs a word.
                  if (!(e instanceof DOMException && e.name === 'AbortError')) setArchiveError(t.papers.archiveNoPermission);
                })
              }>
              {t.papers.chooseRoot}
            </button>
            <p className="muted">{t.papers.chooseRootHint}</p>
          </>
        ) : null}
        {filing && root.ready && file ? (
          <Field label={t.papers.archiveName} hint={t.papers.archiveNameHint}>
            <input value={archiveName} onChange={(e) => setArchiveName(e.target.value)} maxLength={120} />
          </Field>
        ) : null}
        {archiveError ? <p className="banner banner-warn">{archiveError}</p> : null}
        <FormError error={error} />
        <Submit disabled={disabled || !file}>{busy ? t.papers.uploading : t.papers.upload}</Submit>
      </form>
    </section>
  );
}

