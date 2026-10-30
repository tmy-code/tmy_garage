import { useState, type FormEvent } from 'react';
import { todayIso } from '../../shared/dates.ts';
import { nextInspection, openDefects } from '../../shared/inspections.ts';
import type { DefectSeverity, DocumentOwnerKind, DocumentType, InspectionResult } from '../../shared/schemas.ts';
import type { GarageDocument, Modification, Snapshot, TechnicalInspection, Vehicle } from '../../shared/types.ts';
import { confirmDelete, Field, FormError, Layout, NeedsConnection } from '../components.tsx';
import { formatDate, formatKm, parseNumber } from '../format.ts';
import { messages, useT, type Messages } from '../i18n.ts';
import { Icon } from '../icons.tsx';
import { navigate } from '../router.ts';
import { online, useStore } from '../store.ts';
import { Submit, useSubmit } from './SetupForms.tsx';

// Papers are desk work and need a connection; their details stay readable offline from the phone's copy.

const DOCUMENT_TYPES: DocumentType[] = [
  'registration',
  'invoice',
  'inspectionReport',
  'manual',
  'photo',
  'policySchedule',
  'insuranceCertificate',
  'claimsStatement',
  'claimReport',
  'other',
];

function wholeKm(text: string, t: Messages): number | null {
  const n = parseNumber(text);
  if (n !== null && (Number.isNaN(n) || n < 0 || !Number.isInteger(n))) throw new Error(t.setup.wholeNumber(t.setup.odometerLabel));
  return n;
}

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
  const [type, setType] = useState<DocumentType>(defaultType);
  const [docTitle, setDocTitle] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
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
      form.set('type', type);
      if (docTitle.trim()) form.set('title', docTitle.trim());
      if (issueDate) form.set('issueDate', issueDate);
      if (expiryDate) form.set('expiryDate', expiryDate);
      await online('POST', '/api/documents', form);
      setFile(null);
      setDocTitle('');
      setIssueDate('');
      setExpiryDate('');
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
        <div className="row">
          <Field label={t.papers.type}>
            <select value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
              {DOCUMENT_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t.papers.types[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.papers.title}>
            <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} maxLength={120} />
          </Field>
        </div>
        <div className="row">
          <Field label={t.papers.issueDate}>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label={t.papers.expiryDate}>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </Field>
        </div>
        <FormError error={error} />
        <Submit disabled={disabled || !file}>{busy ? t.papers.uploading : t.papers.upload}</Submit>
      </form>
    </section>
  );
}

// --- Documents of a Vehicle ---

export function DocumentsPage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const elsewhere = snapshot.documents.filter((d) => d.vehicleId === vehicle.id && d.ownerKind !== 'vehicle');
  function ownerLabel(d: GarageDocument): string {
    if (d.ownerKind === 'service') {
      const s = snapshot.services.find((x) => x.id === d.ownerId);
      return s ? t.papers.owner.service(formatDate(s.date, t)) : '';
    }
    if (d.ownerKind === 'inspection') {
      const i = snapshot.inspections.find((x) => x.id === d.ownerId);
      return i ? t.papers.owner.inspection(formatDate(i.date, t)) : '';
    }
    if (d.ownerKind === 'cover') {
      const policy = snapshot.policies.find((p) => p.terms.some((term) => term.covers.some((c) => c.id === d.ownerId)));
      return policy ? t.papers.owner.cover(policy.insurer) : '';
    }
    if (d.ownerKind === 'claim') {
      const claim = snapshot.claims.find((x) => x.id === d.ownerId);
      return claim ? t.papers.owner.claim(formatDate(claim.date, t)) : '';
    }
    return snapshot.modifications.find((x) => x.id === d.ownerId)?.name ?? '';
  }
  return (
    <Layout title={t.papers.documentsTitle(vehicle.name)} back={`/vehicles/${vehicle.id}`}>
      <NeedsConnection />
      <DocumentsPanel snapshot={snapshot} ownerKind="vehicle" ownerId={vehicle.id} defaultType="registration" title={t.papers.documents} />
      {elsewhere.length > 0 ? (
        <section>
          <h2>{t.papers.attachedElsewhere}</h2>
          <ul className="list list-grid">
            {elsewhere.map((d) => (
              <DocumentRow key={d.id} doc={d} label={ownerLabel(d)} />
            ))}
          </ul>
        </section>
      ) : null}
    </Layout>
  );
}

// --- Technical Inspections ---

function NextInspectionCard({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const next = nextInspection(snapshot, vehicle, todayIso());
  const open = openDefects(snapshot, vehicle);
  return (
    <section className="card">
      <h2>{t.papers.nextInspection}</h2>
      {next.dueDate ? (
        <p className="task-title">
          <span className={`chip chip-${next.status}`}>{t.status[next.status]}</span>
          <strong>{t.papers.dueBy(formatDate(next.dueDate, t))}</strong>
        </p>
      ) : null}
      <p className="muted">{t.papers.basis[next.basis]}</p>
      {open.length > 0 ? <p className="nudge">{t.papers.openDefects(open.length)}</p> : null}
    </section>
  );
}

export function InspectionsPage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const inspections = snapshot.inspections.filter((i) => i.vehicleId === vehicle.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <Layout
      title={t.papers.inspectionsTitle(vehicle.name)}
      back={`/vehicles/${vehicle.id}`}
      actions={
        <a className="button button-small" href={`#/vehicles/${vehicle.id}/inspections/new`}>
          {t.papers.addInspection}
        </a>
      }
    >
      <NextInspectionCard vehicle={vehicle} snapshot={snapshot} />
      {inspections.length === 0 ? <p className="empty">{t.papers.noInspections}</p> : null}
      <ul className="list list-grid">
        {inspections.map((i) => {
          const open = i.defects.filter((d) => d.fixedServiceId === null).length;
          return (
            <li key={i.id}>
              <a href={`#/inspections/${i.id}`} className="history-row">
                <span>
                  <strong>{formatDate(i.date, t)}</strong> · {formatKm(i.odometer)}
                </span>
                <span>{t.papers.results[i.result]}</span>
                {i.centre ? <span className="muted">{i.centre}</span> : null}
                {i.defects.length > 0 ? (
                  <span className={open > 0 ? 'nudge' : 'muted'}>
                    {i.defects.length} {t.papers.defects.toLowerCase()}
                    {open > 0 ? ` · ${t.papers.openDefects(open)}` : ''}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </Layout>
  );
}

interface DefectDraft {
  key: number;
  description: string;
  severity: DefectSeverity;
  fixedServiceId: string | null;
}

let nextDefectKey = 1;

export function InspectionForm({ vehicle, snapshot, existing }: { vehicle: Vehicle; snapshot: Snapshot; existing?: TechnicalInspection }) {
  const t = useT();
  const [date, setDate] = useState(existing?.date ?? todayIso());
  const [odometer, setOdometer] = useState(existing ? String(existing.odometer) : '');
  const [centre, setCentre] = useState(existing?.centre ?? '');
  const [result, setResult] = useState<InspectionResult>(existing?.result ?? 'passed');
  const [nextDueDate, setNextDueDate] = useState(existing?.nextDueDate ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [defects, setDefects] = useState<DefectDraft[]>(() => (existing?.defects ?? []).map((d) => ({ ...d, key: nextDefectKey++ })));
  const { error, disabled, run } = useSubmit();
  const services = snapshot.services.filter((s) => s.vehicleId === vehicle.id && s.date >= date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const back = `/vehicles/${vehicle.id}/inspections`;

  function setDefect(key: number, patch: Partial<DefectDraft>) {
    setDefects(defects.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const km = wholeKm(odometer, t);
      if (km === null) throw new Error(t.service.errorOdometer);
      if (defects.some((d) => !d.description.trim())) throw new Error(t.papers.defectError);
      const body = {
        date,
        odometer: km,
        centre,
        result,
        nextDueDate: nextDueDate || null,
        notes,
        defects: defects.map(({ description, severity, fixedServiceId }) => ({ description, severity, fixedServiceId })),
      };
      if (existing) await online('PUT', `/api/inspections/${existing.id}`, body);
      else await online('POST', `/api/vehicles/${vehicle.id}/inspections`, body);
      navigate(back, { replace: true });
    });
  }

  async function remove() {
    if (!existing || !(await confirmDelete(t.papers.confirmDeleteInspection))) return;
    void run(async () => {
      await online('DELETE', `/api/inspections/${existing.id}`);
      navigate(back, { replace: true });
    }, t.feedback.deleted);
  }

  return (
    <Layout title={existing ? t.papers.editInspection : t.papers.newInspection(vehicle.name)} back={back}>
      <NeedsConnection />
      <div className="columns">
        <form onSubmit={submit} className="form">
          <div className="row">
            <Field label={t.papers.date}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label={t.papers.odometer}>
              <input inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} required />
            </Field>
          </div>
          <Field label={t.papers.centre}>
            <input value={centre} onChange={(e) => setCentre(e.target.value)} maxLength={120} />
          </Field>
          <Field label={t.papers.result}>
            <select value={result} onChange={(e) => setResult(e.target.value as InspectionResult)}>
              {(['passed', 'majorDefects', 'criticalDefects'] as const).map((r) => (
                <option key={r} value={r}>
                  {t.papers.results[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.papers.nextDueDate} hint={t.papers.nextDueHint}>
            <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
          </Field>

          <fieldset className="field">
            <legend className="field-label">{t.papers.defects}</legend>
            {defects.length === 0 ? <p className="muted">{t.papers.noDefects}</p> : null}
            {defects.map((d) => (
              <div key={d.key} className="card part-used">
                <div className="section-head">
                  <span className="field-label">{t.papers.defect}</span>
                  <button
                    type="button"
                    className="button button-small button-danger"
                    onClick={() => setDefects(defects.filter((x) => x.key !== d.key))}
                  >
                    {t.workshop.remove}
                  </button>
                </div>
                <input
                  value={d.description}
                  onChange={(e) => setDefect(d.key, { description: e.target.value })}
                  maxLength={300}
                  aria-label={t.papers.defect}
                />
                <div className="row">
                  <Field label={t.papers.severity}>
                    <select value={d.severity} onChange={(e) => setDefect(d.key, { severity: e.target.value as DefectSeverity })}>
                      {(['minor', 'major', 'critical'] as const).map((s) => (
                        <option key={s} value={s}>
                          {t.papers.severities[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.papers.fixedBy}>
                    <select value={d.fixedServiceId ?? ''} onChange={(e) => setDefect(d.key, { fixedServiceId: e.target.value || null })}>
                      <option value="">{t.papers.notFixed}</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {t.papers.owner.service(formatDate(s.date, t))}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="button button-small"
              onClick={() => setDefects([...defects, { key: nextDefectKey++, description: '', severity: 'minor', fixedServiceId: null }])}
            >
              {t.papers.addDefect}
            </button>
          </fieldset>

          <Field label={t.papers.notes}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
          </Field>
          <FormError error={error} />
          <Submit disabled={disabled}>{t.papers.saveInspection}</Submit>
          {existing ? (
            <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
              {t.papers.deleteInspection}
            </button>
          ) : null}
        </form>
        <div>
          {existing ? (
            <DocumentsPanel
              snapshot={snapshot}
              ownerKind="inspection"
              ownerId={existing.id}
              defaultType="inspectionReport"
              title={t.papers.report}
            />
          ) : (
            <p className="muted">{t.papers.saveFirst}</p>
          )}
        </div>
      </div>
    </Layout>
  );
}

// --- Modifications ---

export function ModificationsPage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const mods = snapshot.modifications.filter((m) => m.vehicleId === vehicle.id).sort((a, b) => (a.fittedDate < b.fittedDate ? 1 : -1));
  const positions = new Map(snapshot.positions.map((p) => [p.id, p.name]));
  return (
    <Layout
      title={t.papers.modificationsTitle(vehicle.name)}
      back={`/vehicles/${vehicle.id}`}
      actions={
        <a className="button button-small" href={`#/vehicles/${vehicle.id}/modifications/new`}>
          {t.papers.addModification}
        </a>
      }
    >
      {mods.length === 0 ? <p className="empty">{t.papers.noModifications}</p> : null}
      <ul className="list list-grid">
        {mods.map((m) => (
          <li key={m.id} className={m.removedDate ? 'unset' : undefined}>
            <a href={`#/modifications/${m.id}`} className="history-row">
              <strong>🛠️ {m.name}</strong>
              <span className="muted">
                {t.papers.fitted(formatDate(m.fittedDate, t))}
                {m.positionId && positions.get(m.positionId) ? ` · ${positions.get(m.positionId)}` : ''}
                {m.removedDate ? ` · ${t.papers.removed(formatDate(m.removedDate, t))}` : ''}
              </span>
              {!m.removedDate ? (
                <span className={m.declaredToInsurer ? 'muted' : 'nudge'}>
                  {m.declaredToInsurer ? t.papers.declared : t.papers.notDeclared}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </Layout>
  );
}

export function ModificationForm({ vehicle, snapshot, existing }: { vehicle: Vehicle; snapshot: Snapshot; existing?: Modification }) {
  const t = useT();
  const positions = snapshot.positions.filter((p) => p.vehicleId === vehicle.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [fittedDate, setFittedDate] = useState(existing?.fittedDate ?? todayIso());
  const [fittedOdometer, setFittedOdometer] = useState(existing?.fittedOdometer != null ? String(existing.fittedOdometer) : '');
  const [removedDate, setRemovedDate] = useState(existing?.removedDate ?? '');
  const [positionId, setPositionId] = useState(existing?.positionId ?? '');
  const [declared, setDeclared] = useState(existing?.declaredToInsurer ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { error, disabled, run } = useSubmit();
  const back = `/vehicles/${vehicle.id}/modifications`;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const body = {
        name,
        fittedDate,
        fittedOdometer: wholeKm(fittedOdometer, t),
        removedDate: removedDate || null,
        positionId: positionId || null,
        declaredToInsurer: declared,
        notes,
      };
      if (existing) await online('PUT', `/api/modifications/${existing.id}`, body);
      else await online('POST', `/api/vehicles/${vehicle.id}/modifications`, body);
      navigate(back, { replace: true });
    });
  }

  async function remove() {
    if (!existing || !(await confirmDelete(t.papers.confirmDeleteModification))) return;
    void run(async () => {
      await online('DELETE', `/api/modifications/${existing.id}`);
      navigate(back, { replace: true });
    }, t.feedback.deleted);
  }

  return (
    <Layout title={existing ? t.papers.editModification : t.papers.newModification(vehicle.name)} back={back}>
      <NeedsConnection />
      <div className="columns">
        <form onSubmit={submit} className="form">
          <Field label={t.papers.modificationName} hint={t.papers.modificationNameHint}>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </Field>
          <div className="row">
            <Field label={t.papers.fittedDate}>
              <input type="date" value={fittedDate} onChange={(e) => setFittedDate(e.target.value)} required />
            </Field>
            <Field label={t.papers.fittedOdometer}>
              <input inputMode="numeric" value={fittedOdometer} onChange={(e) => setFittedOdometer(e.target.value)} />
            </Field>
          </div>
          {positions.length > 0 ? (
            <Field label={t.papers.position}>
              <select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
                <option value="">{t.papers.noPosition}</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <label className={`check ${declared ? 'check-on' : ''}`}>
            <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
            <span className="due-name">{t.papers.declared}</span>
          </label>
          <Field label={t.papers.removedDate}>
            <input type="date" value={removedDate} onChange={(e) => setRemovedDate(e.target.value)} />
          </Field>
          <Field label={t.papers.notes}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
          </Field>
          <FormError error={error} />
          <Submit disabled={disabled}>{t.papers.saveModification}</Submit>
          {existing ? (
            <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
              {t.papers.deleteModification}
            </button>
          ) : null}
        </form>
        <div>
          {existing ? (
            <DocumentsPanel
              snapshot={snapshot}
              ownerKind="modification"
              ownerId={existing.id}
              defaultType="invoice"
              title={t.papers.invoices}
            />
          ) : (
            <p className="muted">{t.papers.saveFirst}</p>
          )}
        </div>
      </div>
    </Layout>
  );
}
