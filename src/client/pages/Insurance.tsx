import { useMemo, useState, type FormEvent } from 'react';
import { addMonths, todayIso } from '../../shared/dates.ts';
import { usageOf } from '../../shared/due.ts';
import { annualKm, compareQuotes, currentCover, isActive, recentClaims, renewal, type Renewal } from '../../shared/insurance.ts';
import type { CoverLevel, MotorcycleLicence, Responsibility } from '../../shared/schemas.ts';
import type { Claim, Cover, Driver, InsurancePolicy, PolicyTerm, Quote, Snapshot, Vehicle } from '../../shared/types.ts';
import { Field, Layout, NeedsConnection } from '../components.tsx';
import { formatCrm, formatDate, formatKm, formatMoney, parseNumber } from '../format.ts';
import { useT, type Messages } from '../i18n.ts';
import { navigate } from '../router.ts';
import { online } from '../store.ts';
import { DocumentsPanel } from './Papers.tsx';
import { Submit, useSubmit } from './SetupForms.tsx';

// Insurance is desk work a few times a year and needs a connection (ADR 0001); details stay readable offline.

const LEVELS: CoverLevel[] = ['thirdParty', 'thirdPartyExtended', 'comprehensive'];
const RESPONSIBILITIES: Responsibility[] = ['notAtFault', 'partlyAtFault', 'atFault'];

/** Parses an optional amount in euros. */
function optionalAmount(text: string, label: string, t: Messages): number | null {
  const n = parseNumber(text);
  if (n !== null && (Number.isNaN(n) || n < 0)) throw new Error(t.insurance.amountError(label));
  return n;
}

const textOf = (n: number | null) => (n === null ? '' : String(n));

/** "Third party · rider gear · €300 excess" */
export function describeCover(cover: Pick<Cover, 'level' | 'guarantees' | 'excess'>, t: Messages): string {
  return [
    t.insurance.levels[cover.level],
    cover.guarantees,
    cover.excess !== null ? t.insurance.excessOf(formatMoney(cover.excess, t)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function vehicleName(snapshot: Snapshot, id: string): string {
  return snapshot.vehicles.find((v) => v.id === id)?.name ?? '';
}

/** Insurers already typed, so the same company is spelled the same way on Policies and Quotes. */
function InsurerField({ snapshot, value, onChange }: { snapshot: Snapshot; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const names = [...new Set([...snapshot.policies.map((p) => p.insurer), ...snapshot.quotes.map((q) => q.insurer)])].sort();
  return (
    <Field label={t.insurance.insurer}>
      <input value={value} onChange={(e) => onChange(e.target.value)} required maxLength={80} list="insurers" />
      <datalist id="insurers">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </Field>
  );
}

function CoverTermsFields({
  level,
  setLevel,
  guarantees,
  setGuarantees,
  excess,
  setExcess,
}: {
  level: CoverLevel;
  setLevel: (v: CoverLevel) => void;
  guarantees: string;
  setGuarantees: (v: string) => void;
  excess: string;
  setExcess: (v: string) => void;
}) {
  const t = useT();
  return (
    <>
      <Field label={t.insurance.level}>
        <select value={level} onChange={(e) => setLevel(e.target.value as CoverLevel)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {t.insurance.levels[l]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.insurance.guarantees} hint={t.insurance.guaranteesHint}>
        <input value={guarantees} onChange={(e) => setGuarantees(e.target.value)} maxLength={500} />
      </Field>
      <Field label={t.insurance.excess}>
        <input inputMode="decimal" value={excess} onChange={(e) => setExcess(e.target.value)} />
      </Field>
    </>
  );
}

function RenewalLine({ due, t }: { due: Renewal; t: Messages }) {
  return (
    <span className="task-title">
      {due.status !== 'ok' ? <span className={`chip chip-${due.status}`}>{t.status[due.status]}</span> : null}
      <span>
        {due.status === 'overdue' ? t.insurance.renewalPassed(formatDate(due.date, t)) : t.insurance.renewsOn(formatDate(due.date, t))}
      </span>
    </span>
  );
}

// --- Overview ---

export function InsurancePage({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const active = snapshot.policies.filter((p) => isActive(p, today));
  const cancelled = snapshot.policies.filter((p) => !isActive(p, today));
  const claims = recentClaims(snapshot, today);
  const owned = snapshot.vehicles.filter((v) => v.status === 'owned');

  const policyRow = (p: InsurancePolicy) => {
    const due = renewal(p, today);
    const latest = p.terms[p.terms.length - 1];
    return (
      <li key={p.id}>
        <a href={`#/policies/${p.id}`} className="history-row">
          <strong>🛡️ {p.insurer}</strong>
          <span className="muted">
            {latest ? latest.covers.map((c) => vehicleName(snapshot, c.vehicleId)).join(', ') : t.insurance.noTerms}
            {p.policyNumber ? ` · ${p.policyNumber}` : ''}
          </span>
          {due ? <RenewalLine due={due} t={t} /> : null}
          {p.cancelledDate ? <span className="muted">{t.insurance.cancelledOn(formatDate(p.cancelledDate, t))}</span> : null}
        </a>
      </li>
    );
  };

  return (
    <Layout
      title={t.insurance.title}
      back="/"
      actions={
        <a className="button button-small" href="#/policies/new">
          {t.insurance.addPolicy}
        </a>
      }
    >
      <div className="split">
        <div className="split-main">
          <section>
            <h2>{t.insurance.policies}</h2>
            {active.length === 0 ? <p className="empty">{t.insurance.noPolicies}</p> : null}
            <ul className="list list-grid">{active.map(policyRow)}</ul>
            {cancelled.length > 0 ? (
              <details className="sold">
                <summary>{t.insurance.cancelledPolicies(cancelled.length)}</summary>
                <ul className="list">{cancelled.map(policyRow)}</ul>
              </details>
            ) : null}
          </section>

          <section>
            <h2>{t.insurance.quotesSection}</h2>
            <p className="muted">{t.insurance.quotesIntro}</p>
            <ul className="list list-grid">
              {owned.map((v) => {
                const cover = currentCover(snapshot, v.id, today);
                const quotes = snapshot.quotes.filter((q) => q.vehicleId === v.id).length;
                return (
                  <li key={v.id}>
                    <a href={`#/vehicles/${v.id}/insurance`} className="history-row">
                      <strong>{v.name}</strong>
                      <span className="muted">
                        {cover ? `${cover.policy.insurer} · ${t.insurance.levels[cover.cover.level]}` : t.insurance.notInsured}
                        {quotes > 0 ? ` · ${t.insurance.quoteCount(quotes)}` : ''}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="split-side">
          <section>
            <div className="section-head">
              <h2>{t.insurance.drivers}</h2>
              <a className="button button-small" href="#/drivers/new">
                {t.insurance.addDriver}
              </a>
            </div>
            {snapshot.drivers.length === 0 ? <p className="muted">{t.insurance.noDrivers}</p> : null}
            <ul className="list">
              {snapshot.drivers.map((d) => (
                <li key={d.id}>
                  <a href={`#/drivers/${d.id}`} className="history-row">
                    <strong>{d.name}</strong>
                    <span className="muted">{describeLicences(d, t)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>{t.insurance.claimsHistory}</h2>
            {claims.length === 0 ? <p className="muted">{t.insurance.noClaims}</p> : null}
            <ul className="list">
              {claims.map((c) => (
                <ClaimRow key={c.id} claim={c} snapshot={snapshot} />
              ))}
            </ul>
          </section>
        </div>
      </div>
    </Layout>
  );
}

function describeLicences(d: Driver, t: Messages): string {
  return [
    d.carLicenceDate ? t.insurance.carLicenceSince(formatDate(d.carLicenceDate, t)) : null,
    d.motorcycleLicenceDate || d.motorcycleLicence
      ? t.insurance.motorcycleLicenceSince(
          d.motorcycleLicence ?? 'A',
          d.motorcycleLicenceDate ? formatDate(d.motorcycleLicenceDate, t) : '',
        )
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function ClaimRow({ claim, snapshot }: { claim: Claim; snapshot: Snapshot }) {
  const t = useT();
  return (
    <li>
      <a href={`#/claims/${claim.id}`} className="history-row">
        <span>
          <strong>{formatDate(claim.date, t)}</strong> · {vehicleName(snapshot, claim.vehicleId)}
        </span>
        <span>{claim.description}</span>
        <span className={claim.responsibility === 'notAtFault' ? 'muted' : 'nudge'}>
          {t.insurance.responsibilities[claim.responsibility]}
          {claim.amount !== null ? ` · ${formatMoney(claim.amount, t)}` : ''}
        </span>
      </a>
    </li>
  );
}

// --- Policies ---

export function PolicyForm({ snapshot, existing }: { snapshot: Snapshot; existing?: InsurancePolicy }) {
  const t = useT();
  const [insurer, setInsurer] = useState(existing?.insurer ?? '');
  const [policyNumber, setPolicyNumber] = useState(existing?.policyNumber ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayIso());
  const [cancelledDate, setCancelledDate] = useState(existing?.cancelledDate ?? '');
  const [driverIds, setDriverIds] = useState<string[]>(existing?.driverIds ?? snapshot.drivers.map((d) => d.id));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { error, disabled, run } = useSubmit();
  const back = existing ? `/policies/${existing.id}` : '/insurance';

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const body = { insurer, policyNumber, startDate, cancelledDate: cancelledDate || null, driverIds, notes };
      const saved = existing
        ? await online<InsurancePolicy>('PUT', `/api/policies/${existing.id}`, body)
        : await online<InsurancePolicy>('POST', '/api/policies', body);
      navigate(existing ? back : `/policies/${saved.id}/terms/new`, { replace: true });
    });
  }

  function remove() {
    if (!existing || !window.confirm(t.insurance.confirmDeletePolicy)) return;
    void run(async () => {
      await online('DELETE', `/api/policies/${existing.id}`);
      navigate('/insurance', { replace: true });
    });
  }

  return (
    <Layout title={existing ? t.insurance.editPolicy : t.insurance.newPolicy} back={back}>
      <NeedsConnection />
      <form onSubmit={submit} className="form">
        <InsurerField snapshot={snapshot} value={insurer} onChange={setInsurer} />
        <Field label={t.insurance.policyNumber}>
          <input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} maxLength={40} />
        </Field>
        <div className="row">
          <Field label={t.insurance.startDate} hint={t.insurance.startDateHint}>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
          <Field label={t.insurance.cancelledDate}>
            <input type="date" value={cancelledDate} onChange={(e) => setCancelledDate(e.target.value)} />
          </Field>
        </div>
        <fieldset className="field">
          <legend className="field-label">{t.insurance.declaredDrivers}</legend>
          {snapshot.drivers.length === 0 ? <p className="muted">{t.insurance.addDriversFirst}</p> : null}
          {snapshot.drivers.map((d) => {
            const on = driverIds.includes(d.id);
            return (
              <label key={d.id} className={`check ${on ? 'check-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setDriverIds(e.target.checked ? [...driverIds, d.id] : driverIds.filter((id) => id !== d.id))}
                />
                <span className="due-name">{d.name}</span>
              </label>
            );
          })}
        </fieldset>
        <Field label={t.papers.notes}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </Field>
        {error ? <p className="banner banner-error">{error}</p> : null}
        <Submit disabled={disabled}>{existing ? t.insurance.savePolicy : t.insurance.addPolicyAndTerm}</Submit>
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
            {t.insurance.deletePolicy}
          </button>
        ) : null}
      </form>
    </Layout>
  );
}

export function PolicyPage({ policy, snapshot }: { policy: InsurancePolicy; snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const due = renewal(policy, today);
  const drivers = snapshot.drivers.filter((d) => policy.driverIds.includes(d.id));
  const claims = snapshot.claims.filter((c) => c.policyId === policy.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const terms = [...policy.terms].reverse();

  return (
    <Layout
      title={policy.insurer}
      back="/insurance"
      actions={
        <a className="button button-small" href={`#/policies/${policy.id}/edit`}>
          {t.insurance.edit}
        </a>
      }
    >
      <div className="split">
        <div className="split-main">
          <section className="card">
            <p className="muted">{[policy.policyNumber, t.insurance.since(formatDate(policy.startDate, t))].filter(Boolean).join(' · ')}</p>
            {policy.cancelledDate ? (
              <p className="banner banner-warn">{t.insurance.cancelledOn(formatDate(policy.cancelledDate, t))}</p>
            ) : null}
            {due ? (
              <>
                <p>
                  <RenewalLine due={due} t={t} />
                </p>
                <p className="muted">{due.canCancelAnyTime ? t.insurance.hamonOpen : t.insurance.hamonFirstYear}</p>
              </>
            ) : null}
            <p className="muted">
              {t.insurance.declaredDrivers}: {drivers.length > 0 ? drivers.map((d) => d.name).join(', ') : t.insurance.none}
            </p>
            {policy.notes ? <p className="notes">{policy.notes}</p> : null}
          </section>

          <section>
            <div className="section-head">
              <h2>{t.insurance.terms}</h2>
              <a className="button button-small" href={`#/policies/${policy.id}/terms/new`}>
                {t.insurance.addTerm}
              </a>
            </div>
            {terms.length === 0 ? <p className="empty">{t.insurance.noTerms}</p> : null}
            <ul className="list">
              {terms.map((term) => (
                <li key={term.id}>
                  <a href={`#/terms/${term.id}`} className="history-row">
                    <strong>
                      {formatDate(term.startDate, t)} → {formatDate(term.endDate, t)}
                    </strong>
                    {term.covers.map((c) => (
                      <span key={c.id} className="muted">
                        {vehicleName(snapshot, c.vehicleId)} · {describeCover(c, t)}
                        {c.premium !== null ? ` · ${t.insurance.perYear(formatMoney(c.premium, t))}` : ''}
                        {c.crm !== null ? ` · ${t.insurance.crmValue(formatCrm(c.crm, t))}` : ''}
                      </span>
                    ))}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="section-head">
              <h2>{t.insurance.claims}</h2>
              <a className="button button-small" href={`#/policies/${policy.id}/claims/new`}>
                {t.insurance.addClaim}
              </a>
            </div>
            {claims.length === 0 ? <p className="muted">{t.insurance.noClaimsOnPolicy}</p> : null}
            <ul className="list">
              {claims.map((c) => (
                <ClaimRow key={c.id} claim={c} snapshot={snapshot} />
              ))}
            </ul>
          </section>
        </div>
        <div className="split-side">
          <DocumentsPanel
            snapshot={snapshot}
            ownerKind="policy"
            ownerId={policy.id}
            defaultType="claimsStatement"
            title={t.insurance.policyDocuments}
          />
          <p className="muted">{t.insurance.claimsStatementHint}</p>
        </div>
      </div>
    </Layout>
  );
}

// --- Policy Terms ---

interface CoverDraft {
  vehicleId: string;
  included: boolean;
  level: CoverLevel;
  guarantees: string;
  excess: string;
  premium: string;
  crm: string;
  notes: string;
}

function coverDraft(vehicleId: string, cover: Cover | undefined, renewing: boolean): CoverDraft {
  return {
    vehicleId,
    included: cover !== undefined,
    level: cover?.level ?? 'thirdParty',
    guarantees: cover?.guarantees ?? '',
    excess: textOf(cover?.excess ?? null),
    // A renewal changes the premium and the CRM: they come from the new notice, not the old Term.
    premium: renewing ? '' : textOf(cover?.premium ?? null),
    crm: renewing ? '' : textOf(cover?.crm ?? null),
    notes: cover?.notes ?? '',
  };
}

export function TermForm({ policy, snapshot, existing }: { policy: InsurancePolicy; snapshot: Snapshot; existing?: PolicyTerm }) {
  const t = useT();
  const latest = policy.terms[policy.terms.length - 1];
  const template = existing ?? latest;
  const startDefault = existing?.startDate ?? latest?.endDate ?? policy.startDate;
  const [startDate, setStartDate] = useState(startDefault);
  const [endDate, setEndDate] = useState(existing?.endDate ?? addMonths(startDefault, 12));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const vehicleIds = useMemo(() => {
    const covered = template?.covers.map((c) => c.vehicleId) ?? [];
    const owned = snapshot.vehicles.filter((v) => v.status === 'owned').map((v) => v.id);
    return [...new Set([...covered, ...owned])];
  }, [template, snapshot.vehicles]);
  const [covers, setCovers] = useState<CoverDraft[]>(() =>
    vehicleIds.map((id) =>
      coverDraft(
        id,
        template?.covers.find((c) => c.vehicleId === id),
        !existing,
      ),
    ),
  );
  const { error, disabled, run } = useSubmit();
  const back = `/policies/${policy.id}`;

  function setCover(vehicleId: string, patch: Partial<CoverDraft>) {
    setCovers(covers.map((c) => (c.vehicleId === vehicleId ? { ...c, ...patch } : c)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const chosen = covers.filter((c) => c.included);
      if (chosen.length === 0) throw new Error(t.insurance.needCover);
      const body = {
        startDate,
        endDate,
        notes,
        covers: chosen.map((c) => {
          const crm = parseNumber(c.crm);
          if (crm !== null && (Number.isNaN(crm) || crm < 0.5 || crm > 3.5)) throw new Error(t.insurance.crmError);
          return {
            vehicleId: c.vehicleId,
            level: c.level,
            guarantees: c.guarantees,
            excess: optionalAmount(c.excess, t.insurance.excess, t),
            premium: optionalAmount(c.premium, t.insurance.premium, t),
            crm,
            notes: c.notes,
          };
        }),
      };
      if (existing) await online('PUT', `/api/terms/${existing.id}`, body);
      else await online('POST', `/api/policies/${policy.id}/terms`, body);
      navigate(back, { replace: true });
    });
  }

  function remove() {
    if (!existing || !window.confirm(t.insurance.confirmDeleteTerm)) return;
    void run(async () => {
      await online('DELETE', `/api/terms/${existing.id}`);
      navigate(back, { replace: true });
    });
  }

  return (
    <Layout title={existing ? t.insurance.editTerm(policy.insurer) : t.insurance.newTerm(policy.insurer)} back={back}>
      <NeedsConnection />
      <div className="columns">
        <form onSubmit={submit} className="form">
          <div className="row">
            <Field label={t.insurance.termStart}>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </Field>
            <Field label={t.insurance.renewalDate} hint={t.insurance.renewalDateHint}>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </Field>
          </div>
          {!existing && latest ? <p className="muted">{t.insurance.renewalPrefill}</p> : null}
          {covers.map((c) => (
            <fieldset key={c.vehicleId} className="card part-used">
              <label className={`check ${c.included ? 'check-on' : ''}`}>
                <input type="checkbox" checked={c.included} onChange={(e) => setCover(c.vehicleId, { included: e.target.checked })} />
                <span className="due-name">{t.insurance.covers(vehicleName(snapshot, c.vehicleId))}</span>
              </label>
              {c.included ? (
                <>
                  <CoverTermsFields
                    level={c.level}
                    setLevel={(level) => setCover(c.vehicleId, { level })}
                    guarantees={c.guarantees}
                    setGuarantees={(guarantees) => setCover(c.vehicleId, { guarantees })}
                    excess={c.excess}
                    setExcess={(excess) => setCover(c.vehicleId, { excess })}
                  />
                  <div className="row">
                    <Field label={t.insurance.premium}>
                      <input inputMode="decimal" value={c.premium} onChange={(e) => setCover(c.vehicleId, { premium: e.target.value })} />
                    </Field>
                    <Field label={t.insurance.crm} hint={t.insurance.crmHint}>
                      <input inputMode="decimal" value={c.crm} onChange={(e) => setCover(c.vehicleId, { crm: e.target.value })} />
                    </Field>
                  </div>
                </>
              ) : null}
            </fieldset>
          ))}
          <Field label={t.papers.notes}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </Field>
          {error ? <p className="banner banner-error">{error}</p> : null}
          <Submit disabled={disabled}>{t.insurance.saveTerm}</Submit>
          {existing ? (
            <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
              {t.insurance.deleteTerm}
            </button>
          ) : null}
        </form>
        <div>
          {existing ? (
            existing.covers.map((c) => (
              <DocumentsPanel
                key={c.id}
                snapshot={snapshot}
                ownerKind="cover"
                ownerId={c.id}
                defaultType="insuranceCertificate"
                title={t.insurance.coverDocuments(vehicleName(snapshot, c.vehicleId))}
              />
            ))
          ) : (
            <p className="muted">{t.papers.saveFirst}</p>
          )}
        </div>
      </div>
    </Layout>
  );
}

// --- Claims ---

export function ClaimForm({ policy, snapshot, existing }: { policy: InsurancePolicy; snapshot: Snapshot; existing?: Claim }) {
  const t = useT();
  const covered = new Set(policy.terms.flatMap((term) => term.covers.map((c) => c.vehicleId)));
  const vehicles = snapshot.vehicles.filter((v) => covered.has(v.id) || v.id === existing?.vehicleId);
  const choices = vehicles.length > 0 ? vehicles : snapshot.vehicles;
  const [vehicleId, setVehicleId] = useState(existing?.vehicleId ?? choices[0]?.id ?? '');
  const [driverId, setDriverId] = useState(existing?.driverId ?? policy.driverIds[0] ?? '');
  const [date, setDate] = useState(existing?.date ?? todayIso());
  const [responsibility, setResponsibility] = useState<Responsibility>(existing?.responsibility ?? 'notAtFault');
  const [amount, setAmount] = useState(textOf(existing?.amount ?? null));
  const [description, setDescription] = useState(existing?.description ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { error, disabled, run } = useSubmit();
  const back = `/policies/${policy.id}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const body = {
        vehicleId,
        driverId: driverId || null,
        date,
        responsibility,
        amount: optionalAmount(amount, t.insurance.amount, t),
        description,
        notes,
      };
      if (existing) await online('PUT', `/api/claims/${existing.id}`, body);
      else await online('POST', `/api/policies/${policy.id}/claims`, body);
      navigate(back, { replace: true });
    });
  }

  function remove() {
    if (!existing || !window.confirm(t.insurance.confirmDeleteClaim)) return;
    void run(async () => {
      await online('DELETE', `/api/claims/${existing.id}`);
      navigate(back, { replace: true });
    });
  }

  return (
    <Layout title={existing ? t.insurance.editClaim : t.insurance.newClaim(policy.insurer)} back={back}>
      <NeedsConnection />
      <div className="columns">
        <form onSubmit={submit} className="form">
          <Field label={t.insurance.claimDescription} hint={t.insurance.claimDescriptionHint}>
            <input value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={300} />
          </Field>
          <div className="row">
            <Field label={t.papers.date}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label={t.insurance.vehicle}>
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
                {choices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label={t.insurance.driver}>
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">{t.insurance.noDriver}</option>
                {snapshot.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.insurance.responsibility}>
              <select value={responsibility} onChange={(e) => setResponsibility(e.target.value as Responsibility)}>
                {RESPONSIBILITIES.map((r) => (
                  <option key={r} value={r}>
                    {t.insurance.responsibilities[r]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t.insurance.amount}>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t.papers.notes}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
          </Field>
          {error ? <p className="banner banner-error">{error}</p> : null}
          <Submit disabled={disabled}>{t.insurance.saveClaim}</Submit>
          {existing ? (
            <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
              {t.insurance.deleteClaim}
            </button>
          ) : null}
        </form>
        <div>
          {existing ? (
            <DocumentsPanel
              snapshot={snapshot}
              ownerKind="claim"
              ownerId={existing.id}
              defaultType="claimReport"
              title={t.insurance.claimDocuments}
            />
          ) : (
            <p className="muted">{t.papers.saveFirst}</p>
          )}
        </div>
      </div>
    </Layout>
  );
}

// --- Drivers ---

export function DriverForm({ existing }: { existing?: Driver }) {
  const t = useT();
  const [name, setName] = useState(existing?.name ?? '');
  const [birthDate, setBirthDate] = useState(existing?.birthDate ?? '');
  const [carLicenceDate, setCarLicenceDate] = useState(existing?.carLicenceDate ?? '');
  const [motorcycleLicence, setMotorcycleLicence] = useState<MotorcycleLicence | ''>(existing?.motorcycleLicence ?? '');
  const [motorcycleLicenceDate, setMotorcycleLicenceDate] = useState(existing?.motorcycleLicenceDate ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { error, disabled, run } = useSubmit();

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const body = {
        name,
        birthDate: birthDate || null,
        carLicenceDate: carLicenceDate || null,
        motorcycleLicence: motorcycleLicence || null,
        motorcycleLicenceDate: motorcycleLicenceDate || null,
        notes,
      };
      if (existing) await online('PUT', `/api/drivers/${existing.id}`, body);
      else await online('POST', '/api/drivers', body);
      navigate('/insurance', { replace: true });
    });
  }

  function remove() {
    if (!existing || !window.confirm(t.insurance.confirmDeleteDriver(existing.name))) return;
    void run(async () => {
      await online('DELETE', `/api/drivers/${existing.id}`);
      navigate('/insurance', { replace: true });
    });
  }

  return (
    <Layout title={existing ? t.insurance.editDriver : t.insurance.newDriver} back="/insurance">
      <NeedsConnection />
      <form onSubmit={submit} className="form">
        <Field label={t.setup.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </Field>
        <Field label={t.insurance.birthDate}>
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </Field>
        <Field label={t.insurance.carLicenceDate}>
          <input type="date" value={carLicenceDate} onChange={(e) => setCarLicenceDate(e.target.value)} />
        </Field>
        <div className="row">
          <Field label={t.insurance.motorcycleLicence}>
            <select value={motorcycleLicence} onChange={(e) => setMotorcycleLicence(e.target.value as MotorcycleLicence | '')}>
              <option value="">{t.insurance.none}</option>
              {(['A1', 'A2', 'A'] as const).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.insurance.motorcycleLicenceDate}>
            <input type="date" value={motorcycleLicenceDate} onChange={(e) => setMotorcycleLicenceDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t.papers.notes} hint={t.insurance.driverNotesHint}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </Field>
        {error ? <p className="banner banner-error">{error}</p> : null}
        <Submit disabled={disabled}>{t.insurance.saveDriver}</Submit>
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
            {t.insurance.deleteDriver}
          </button>
        ) : null}
      </form>
    </Layout>
  );
}

// --- A Vehicle's insurance: current Cover and Quotes side by side ---

export function VehicleInsurancePage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const current = currentCover(snapshot, vehicle.id, today);
  const due = current ? renewal(current.policy, today) : null;
  const quotes = compareQuotes(snapshot, vehicle.id, today);
  const change =
    current && current.cover.premium !== null && current.previousPremium ? current.cover.premium / current.previousPremium - 1 : null;

  return (
    <Layout
      title={t.insurance.vehicleTitle(vehicle.name)}
      back={`/vehicles/${vehicle.id}`}
      actions={
        <a className="button button-small" href={`#/vehicles/${vehicle.id}/quotes/new`}>
          {t.insurance.addQuote}
        </a>
      }
    >
      <div className="split">
        <div className="split-main">
          <section className="card">
            <h2>{t.insurance.currentCover}</h2>
            {current ? (
              <>
                <p>
                  <a href={`#/policies/${current.policy.id}`}>
                    <strong>{current.policy.insurer}</strong>
                  </a>{' '}
                  · {describeCover(current.cover, t)}
                </p>
                <p>
                  {current.cover.premium !== null ? <strong>{t.insurance.perYear(formatMoney(current.cover.premium, t))}</strong> : null}
                  {change !== null ? (
                    <span className={change > 0 ? 'nudge' : 'muted'}> {t.insurance.premiumChange(Math.round(change * 100))}</span>
                  ) : null}
                  {current.cover.crm !== null ? (
                    <span className="muted"> · {t.insurance.crmValue(formatCrm(current.cover.crm, t))}</span>
                  ) : null}
                </p>
                {due ? (
                  <p>
                    <RenewalLine due={due} t={t} />
                  </p>
                ) : null}
                {due ? <p className="muted">{due.canCancelAnyTime ? t.insurance.hamonOpen : t.insurance.hamonFirstYear}</p> : null}
              </>
            ) : (
              <p className="muted">
                {t.insurance.notInsured} <a href="#/insurance">{t.insurance.recordPolicy}</a>
              </p>
            )}
            <div className="actions">
              <a className="button button-primary" href={`#/vehicles/${vehicle.id}/quote-pack`}>
                📋 {t.insurance.quotePack}
              </a>
            </div>
          </section>

          <section>
            <h2>{t.insurance.quotes}</h2>
            {quotes.length === 0 ? <p className="empty">{t.insurance.noQuotes}</p> : null}
            <ul className="list list-grid">
              {quotes.map(({ quote, difference, expired }) => (
                <li key={quote.id} className={expired ? 'unset' : undefined}>
                  <a href={`#/quotes/${quote.id}`} className="history-row">
                    <span className="section-head">
                      <strong>{quote.insurer}</strong>
                      <strong>{t.insurance.perYear(formatMoney(quote.premium, t))}</strong>
                    </span>
                    <span className="muted">{describeCover(quote, t)}</span>
                    {difference !== null ? (
                      <span className={difference < 0 ? 'saving' : 'muted'}>
                        {difference < 0
                          ? t.insurance.cheaperBy(formatMoney(-difference, t))
                          : difference > 0
                            ? t.insurance.dearerBy(formatMoney(difference, t))
                            : t.insurance.samePrice}
                        {current && quote.level !== current.cover.level ? ` · ${t.insurance.differentLevel}` : ''}
                      </span>
                    ) : null}
                    <span className="muted">
                      {t.insurance.quotedOn(formatDate(quote.date, t))}
                      {quote.validUntil
                        ? ` · ${expired ? t.insurance.expiredOn(formatDate(quote.validUntil, t)) : t.insurance.validUntil(formatDate(quote.validUntil, t))}`
                        : ''}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </Layout>
  );
}

export function QuoteForm({ vehicle, snapshot, existing }: { vehicle: Vehicle; snapshot: Snapshot; existing?: Quote }) {
  const t = useT();
  // A new Quote starts from the current Cover's terms, so the comparison is like for like.
  const current = currentCover(snapshot, vehicle.id, todayIso())?.cover;
  const [insurer, setInsurer] = useState(existing?.insurer ?? '');
  const [date, setDate] = useState(existing?.date ?? todayIso());
  const [level, setLevel] = useState<CoverLevel>(existing?.level ?? current?.level ?? 'thirdParty');
  const [guarantees, setGuarantees] = useState(existing?.guarantees ?? current?.guarantees ?? '');
  const [excess, setExcess] = useState(textOf(existing?.excess ?? current?.excess ?? null));
  const [premium, setPremium] = useState(textOf(existing?.premium ?? null));
  const [validUntil, setValidUntil] = useState(existing?.validUntil ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { error, disabled, run } = useSubmit();
  const back = `/vehicles/${vehicle.id}/insurance`;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const price = optionalAmount(premium, t.insurance.premium, t);
      if (price === null) throw new Error(t.insurance.needPremium);
      const body = {
        insurer,
        date,
        level,
        guarantees,
        excess: optionalAmount(excess, t.insurance.excess, t),
        premium: price,
        validUntil: validUntil || null,
        notes,
      };
      if (existing) await online('PUT', `/api/quotes/${existing.id}`, body);
      else await online('POST', `/api/vehicles/${vehicle.id}/quotes`, body);
      navigate(back, { replace: true });
    });
  }

  function remove() {
    if (!existing || !window.confirm(t.insurance.confirmDeleteQuote)) return;
    void run(async () => {
      await online('DELETE', `/api/quotes/${existing.id}`);
      navigate(back, { replace: true });
    });
  }

  return (
    <Layout title={existing ? t.insurance.editQuote : t.insurance.newQuote(vehicle.name)} back={back}>
      <NeedsConnection />
      <form onSubmit={submit} className="form">
        <InsurerField snapshot={snapshot} value={insurer} onChange={setInsurer} />
        <div className="row">
          <Field label={t.insurance.premium}>
            <input inputMode="decimal" value={premium} onChange={(e) => setPremium(e.target.value)} required />
          </Field>
          <Field label={t.papers.date}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <CoverTermsFields
          level={level}
          setLevel={setLevel}
          guarantees={guarantees}
          setGuarantees={setGuarantees}
          excess={excess}
          setExcess={setExcess}
        />
        <Field label={t.insurance.validUntilLabel}>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Field>
        <Field label={t.papers.notes}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </Field>
        {error ? <p className="banner banner-error">{error}</p> : null}
        <Submit disabled={disabled}>{t.insurance.saveQuote}</Submit>
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={disabled}>
            {t.insurance.deleteQuote}
          </button>
        ) : null}
      </form>
    </Layout>
  );
}

// --- Quote Pack: everything a comparison site or competing Insurer asks, in the order they ask it ---

function Fact({ label, value }: { label: string; value: string | null }) {
  const t = useT();
  return (
    <>
      <dt>{label}</dt>
      <dd className={value ? undefined : 'nudge'}>{value || t.insurance.missing}</dd>
    </>
  );
}

/** A relevé d'information older than this is worth asking for again before a round of Quotes. */
const STATEMENT_FRESH_MONTHS = 3;

export function QuotePackPage({ vehicle, snapshot }: { vehicle: Vehicle; snapshot: Snapshot }) {
  const t = useT();
  const today = todayIso();
  const usage = usageOf(snapshot, vehicle.id, today);
  const current = currentCover(snapshot, vehicle.id, today);
  const claims = recentClaims(snapshot, today);
  const drivers = current ? snapshot.drivers.filter((d) => current.policy.driverIds.includes(d.id)) : snapshot.drivers;
  const mods = snapshot.modifications.filter((m) => m.vehicleId === vehicle.id && m.removedDate === null);
  // Motorcycle insurers also ask for the bonus-malus earned on the car, and the other way round.
  const otherCovers = snapshot.vehicles
    .filter((v) => v.id !== vehicle.id && v.status === 'owned')
    .map((v) => ({ vehicle: v, current: currentCover(snapshot, v.id, today) }))
    .filter((x) => x.current?.cover.crm != null);
  const policyIds = new Set(snapshot.policies.map((p) => p.id));
  const statements = snapshot.documents
    .filter((d) => d.type === 'claimsStatement' && d.ownerKind === 'policy' && policyIds.has(d.ownerId))
    .sort((a, b) => ((a.issueDate ?? '') < (b.issueDate ?? '') ? 1 : -1));
  const freshStatement = statements.some((d) => d.issueDate !== null && d.issueDate >= addMonths(today, -STATEMENT_FRESH_MONTHS));
  const registrationDocs = snapshot.documents.filter((d) => d.vehicleId === vehicle.id && d.type === 'registration');
  const km = annualKm(usage.kmPerDay);
  const date = (d: string | null) => (d ? formatDate(d, t) : null);

  return (
    <Layout
      title={t.insurance.quotePackTitle(vehicle.name)}
      back={`/vehicles/${vehicle.id}/insurance`}
      actions={
        <button type="button" className="button button-small" onClick={() => window.print()}>
          {t.insurance.print}
        </button>
      }
    >
      <p className="muted no-print">
        {t.insurance.quotePackIntro} <a href={`#/vehicles/${vehicle.id}/edit`}>{t.insurance.editVehicleFacts}</a>
      </p>
      <div className="card-grid">
        <section className="card">
          <h2>{t.insurance.packVehicle}</h2>
          <dl className="facts">
            <Fact label={t.insurance.makeModel} value={[vehicle.make, vehicle.model, vehicle.version].filter(Boolean).join(' ') || null} />
            <Fact label={t.setup.registration} value={vehicle.registration} />
            <Fact label={t.insurance.vin} value={vehicle.vin} />
            <Fact label={t.setup.firstRegistration} value={date(vehicle.firstRegistration)} />
            <Fact label={t.insurance.nationalType} value={vehicle.nationalType} />
            <Fact label={t.insurance.fiscalPower} value={vehicle.fiscalPower !== null ? t.insurance.cv(vehicle.fiscalPower) : null} />
            <Fact label={t.insurance.purchaseDate} value={date(vehicle.purchaseDate)} />
            <Fact label={t.insurance.parking} value={vehicle.overnightParking ? t.insurance.parkings[vehicle.overnightParking] : null} />
            <Fact label={t.insurance.annualKm} value={km !== null ? t.insurance.perYearKm(formatKm(km)) : null} />
            <Fact label={t.insurance.odometerNow} value={usage.estimatedOdometer !== null ? formatKm(usage.estimatedOdometer) : null} />
          </dl>
        </section>

        <section className="card">
          <h2>{t.insurance.packCurrent}</h2>
          {current ? (
            <dl className="facts">
              <Fact label={t.insurance.insurer} value={current.policy.insurer} />
              <Fact label={t.insurance.insuredSince} value={date(current.policy.startDate)} />
              <Fact label={t.insurance.level} value={describeCover(current.cover, t)} />
              <Fact
                label={t.insurance.premiumPerYear}
                value={current.cover.premium !== null ? formatMoney(current.cover.premium, t) : null}
              />
              <Fact label={t.insurance.crm} value={current.cover.crm !== null ? formatCrm(current.cover.crm, t) : null} />
              <Fact label={t.insurance.renewalDate} value={date(current.term.endDate)} />
              {otherCovers.map((x) => (
                <Fact key={x.vehicle.id} label={t.insurance.crmOn(x.vehicle.name)} value={formatCrm(x.current!.cover.crm!, t)} />
              ))}
            </dl>
          ) : (
            <p className="nudge">{t.insurance.notInsured}</p>
          )}
        </section>

        <section className="card">
          <h2>{t.insurance.drivers}</h2>
          {drivers.length === 0 ? <p className="nudge">{t.insurance.noDrivers}</p> : null}
          {drivers.map((d) => (
            <dl key={d.id} className="facts">
              <Fact label={t.setup.name} value={d.name} />
              <Fact label={t.insurance.birthDate} value={date(d.birthDate)} />
              <Fact label={t.insurance.carLicenceDate} value={date(d.carLicenceDate)} />
              {vehicle.kind === 'motorcycle' || d.motorcycleLicence ? (
                <Fact
                  label={t.insurance.motorcycleLicence}
                  value={
                    d.motorcycleLicence
                      ? `${d.motorcycleLicence}${d.motorcycleLicenceDate ? ` · ${date(d.motorcycleLicenceDate)}` : ''}`
                      : null
                  }
                />
              ) : null}
            </dl>
          ))}
        </section>

        <section className="card">
          <h2>{t.insurance.packClaims}</h2>
          {claims.length === 0 ? <p>{t.insurance.noClaims}</p> : null}
          <ul className="list">
            {claims.map((c) => (
              <ClaimRow key={c.id} claim={c} snapshot={snapshot} />
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>{t.papers.modifications}</h2>
          {mods.length === 0 ? <p>{t.insurance.noModifications}</p> : null}
          <ul className="list">
            {mods.map((m) => (
              <li key={m.id}>
                <div className="history-row">
                  <strong>{m.name}</strong>
                  <span className={m.declaredToInsurer ? 'muted' : 'nudge'}>
                    {t.papers.fitted(formatDate(m.fittedDate, t))} · {m.declaredToInsurer ? t.papers.declared : t.papers.notDeclared}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>{t.insurance.packAttach}</h2>
          {!freshStatement ? <p className="nudge">{t.insurance.askStatement}</p> : null}
          <ul className="list">
            {[...statements, ...registrationDocs].map((d) => (
              <li key={d.id}>
                <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="history-row">
                  <strong>📄 {d.title ?? t.papers.types[d.type]}</strong>
                  <span className="muted">
                    {t.papers.types[d.type]}
                    {d.issueDate ? ` · ${t.insurance.issuedOn(formatDate(d.issueDate, t))}` : ''}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Layout>
  );
}
