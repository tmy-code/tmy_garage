import { useMemo, useRef, useState, type FormEvent } from 'react';
import { checkOdometer } from '../../shared/consistency.ts';
import { todayIso } from '../../shared/dates.ts';
import { vehicleDue, pointsOf } from '../../shared/due.ts';
import { averageConsumption, consumptionOf, FUEL_LIMITS, fillupProblem, fillupUnitPrice, sortFillups } from '../../shared/fuel.ts';
import type { Fillup, Snapshot, Vehicle } from '../../shared/types.ts';
import { newId } from '../api.ts';
import { confirmDelete, ConsistencyWarnings, EditHint, Field, FormError, Layout, segmentedKeys } from '../components.tsx';
import { showToast } from '../feedback.ts';
import { currencySymbol, formatDate, formatDecimal, formatKm, formatMoney, matchesQuery, parseNumber } from '../format.ts';
import { useT } from '../i18n.ts';
import type { OutboxOp } from '../outbox.ts';
import { navigate } from '../router.ts';
import { enqueue, online, useStore } from '../store.ts';
import { toastCreated } from './ServiceForm.tsx';

/** Phones show the latest few fill-ups; the rest are one tap away. */
const FUEL_PREVIEW = 5;
/** A long list gets a search box once it is expanded (CLAUDE.md: more than about eight rows). */
const FUEL_SEARCH_FROM = 8;

/** A Vehicle's fuel log: average consumption, then the fill-ups newest first. */
export function FuelSection({ vehicle, snapshot, pending }: { vehicle: Vehicle; snapshot: Snapshot; pending: Set<string> }) {
  const t = useT();
  const owned = vehicle.status === 'owned';
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState('');
  const fillups = useMemo(() => snapshot.fillups.filter((f) => f.vehicleId === vehicle.id), [snapshot.fillups, vehicle.id]);
  const spans = useMemo(() => consumptionOf(fillups), [fillups]);
  const average = averageConsumption(spans.values());
  const newestFirst = useMemo(() => sortFillups(fillups).reverse(), [fillups]);
  const searchable = all && newestFirst.length > FUEL_SEARCH_FROM;
  const shown = all
    ? newestFirst.filter((f) => !searchable || matchesQuery([formatDate(f.date, t), f.date, f.odometer === null ? null : String(f.odometer), f.notes], query))
    : newestFirst.slice(0, FUEL_PREVIEW);

  return (
    <>
      <div className="heading-row">
        <h2>{t.fuel.section}</h2>
        {owned ? (
          <a className="button" href={`#/vehicles/${vehicle.id}/fillup`}>
            {t.fuel.add}
          </a>
        ) : null}
      </div>
      {fillups.length === 0 ? (
        <p className="empty">{t.fuel.empty}</p>
      ) : (
        <>
          <p className="muted">
            {average !== null ? `${t.fuel.average(formatDecimal(average, 1, t))} · ${t.fuel.count(fillups.length)}` : `${t.fuel.needTwoFull} · ${t.fuel.count(fillups.length)}`}
          </p>
          {searchable ? (
            <input type="search" className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.fuel.search} aria-label={t.fuel.search} autoComplete="off" />
          ) : null}
          {shown.length === 0 ? <p className="empty">{t.fuel.noMatch}</p> : null}
          <ul className="list">
            {shown.map((f) => {
              const span = spans.get(f.id);
              return (
                <li key={f.id}>
                  <a href={`#/fillups/${f.id}/edit`} className="history-row">
                    <span className="history-head">
                      <span>
                        <strong>{formatDate(f.date, t)}</strong>
                        {f.odometer !== null ? ` · ${formatKm(f.odometer)}` : ''}
                        {pending.has(f.id) ? <span className="chip chip-pending">{t.vehicle.waitingToSync}</span> : null}
                      </span>
                      <EditHint />
                    </span>
                    <span>
                      {[t.fuel.litresValue(formatDecimal(f.litres, 1, t)), formatMoney(f.totalPaid, t), t.fuel.perLitreShort(formatMoney(fillupUnitPrice(f), t))].join(' · ')}
                    </span>
                    <span>
                      <span className="chip chip-neutral">
                        {span ? t.fuel.consumption(formatDecimal(span.lPer100, 1, t)) : f.fullTank ? t.fuel.fullTank : t.fuel.topUp}
                      </span>
                    </span>
                    {f.notes ? <span className="muted">{f.notes}</span> : null}
                  </a>
                </li>
              );
            })}
          </ul>
          {!all && newestFirst.length > FUEL_PREVIEW ? (
            <button type="button" className="button button-block" onClick={() => setAll(true)}>
              {t.fuel.showAll(newestFirst.length)}
            </button>
          ) : null}
        </>
      )}
    </>
  );
}

/** Log a Fill-up, or correct or delete one. Logging works offline, like a Service. */
export function FillupForm({ vehicle, snapshot, existing }: { vehicle: Vehicle; snapshot: Snapshot; existing?: Fillup }) {
  const t = useT();
  const { outbox, reachable } = useStore();
  const today = todayIso();
  const { usage } = useMemo(() => vehicleDue(snapshot, vehicle.id, today), [snapshot, vehicle.id, today]);
  const [fullTank, setFullTank] = useState(existing?.fullTank ?? true);
  const [date, setDate] = useState(existing?.date ?? today);
  // A new fill-up starts from the last known figure, to be updated or cleared.
  const [odometerText, setOdometerText] = useState(existing ? (existing.odometer !== null ? String(existing.odometer) : '') : usage.latest ? String(usage.latest.odometer) : '');
  const [litresText, setLitresText] = useState(existing ? String(existing.litres) : '');
  const [totalText, setTotalText] = useState(existing ? String(existing.totalPaid) : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [odometerError, setOdometerError] = useState<string | null>(null);
  const [litresError, setLitresError] = useState<string | null>(null);
  const [totalError, setTotalError] = useState<string | null>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const odometerInput = useRef<HTMLInputElement>(null);
  const litresInput = useRef<HTMLInputElement>(null);
  const totalInput = useRef<HTMLInputElement>(null);

  const back = `/vehicles/${vehicle.id}`;
  const pending = existing ? outbox.some((op) => op.data.id === existing.id) : false;
  const odometer = parseNumber(odometerText);
  const litres = parseNumber(litresText);
  const total = parseNumber(totalText);
  const validOdometer = odometer !== null && Number.isInteger(odometer) && odometer >= 0 ? odometer : null;
  const worked = litres !== null && total !== null && !Number.isNaN(litres) && !Number.isNaN(total) && litres > 0 && total >= 0 ? fillupUnitPrice({ litres, totalPaid: total }) : null;
  const check = useMemo(
    () => (validOdometer === null ? null : checkOdometer(pointsOf(snapshot, vehicle.id, existing?.id), { date, odometer: validOdometer })),
    [snapshot, vehicle.id, existing?.id, date, validOdometer],
  );
  const latestKm = usage.latest ? usage.latest.odometer : null;
  // The prefilled figure left as it is, for a later date: probably forgotten to update.
  const sameAsLast = usage.latest !== null && validOdometer === usage.latest.odometer && date > usage.latest.date ? t.fuel.sameAsLast : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const badDate = date === '' || date > today;
    const badOdometer = odometer !== null && (Number.isNaN(odometer) || odometer < 0 || !Number.isInteger(odometer));
    const badLitres = litres === null || Number.isNaN(litres) || litres <= 0;
    const badTotal = total === null || Number.isNaN(total) || total < 0;
    setDateError(badDate ? t.fuel.errorDate : null);
    setOdometerError(badOdometer ? t.fuel.errorOdometer : null);
    const min = formatDecimal(FUEL_LIMITS.litresMin, 1, t);
    const max = formatDecimal(FUEL_LIMITS.litresMax, 0, t);
    let litresMessage: string | null = null;
    let totalMessage: string | null = null;
    if (badLitres) litresMessage = t.fuel.errorLitres(min, max);
    else if (badTotal) totalMessage = t.fuel.errorTotal(formatMoney(FUEL_LIMITS.totalMax, t));
    else {
      const problem = fillupProblem({ litres, totalPaid: total });
      if (problem === 'litres') litresMessage = t.fuel.errorLitres(min, max);
      else if (problem === 'totalPaid') totalMessage = t.fuel.errorTotal(formatMoney(FUEL_LIMITS.totalMax, t));
      else if (problem === 'pricePerLitre') {
        totalMessage = t.fuel.errorPrice(formatMoney(FUEL_LIMITS.pricePerLitreMin, t), formatMoney(FUEL_LIMITS.pricePerLitreMax, t));
      }
    }
    setLitresError(litresMessage);
    setTotalError(totalMessage);
    if (badDate) {
      dateInput.current?.focus();
      dateInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (badOdometer) {
      odometerInput.current?.focus();
      odometerInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (litresMessage) {
      litresInput.current?.focus();
      litresInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (totalMessage) {
      totalInput.current?.focus();
      totalInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const op: OutboxOp = {
      kind: 'fillup',
      data: {
        id: existing?.id ?? newId(),
        vehicleId: vehicle.id,
        date,
        odometer: odometer === null ? null : odometer,
        litres: litres!,
        totalPaid: total!,
        fullTank,
        notes: notes.trim() || null,
      },
    };
    try {
      // Coming back lands on the fuel tab, where the new fill-up shows.
      sessionStorage.setItem(`vehicle-tab-${vehicle.id}`, 'fuel');
    } catch {
      // the vehicle then opens on its usual tab
    }
    await enqueue(op);
    navigate(back, { replace: true });
    toastCreated(op, existing ? t.feedback.saved : t.feedback.fillupSaved, t, !existing);
  }

  async function remove() {
    if (!existing || !(await confirmDelete(t.fuel.confirmDelete))) return;
    try {
      await online('DELETE', `/api/fillups/${existing.id}`);
      navigate(back, { replace: true });
      showToast(t.feedback.deleted);
    } catch (e) {
      console.warn('Could not delete fill-up', e);
      setError(t.fuel.deleteFailed);
    }
  }

  return (
    <Layout title={existing ? t.fuel.titleEdit : t.fuel.titleNew(vehicle.name)} back={back} entry>
      <form onSubmit={submit} className="form" noValidate>
        <div className="segmented" role="radiogroup" aria-label={t.fuel.tankLabel} onKeyDown={segmentedKeys}>
          {([true, false] as const).map((full) => (
            <button type="button" key={String(full)} role="radio" aria-checked={fullTank === full} className={fullTank === full ? 'on' : ''} onClick={() => setFullTank(full)}>
              {full ? t.fuel.fullTank : t.fuel.topUp}
            </button>
          ))}
        </div>
        <Field label={t.fuel.date} error={dateError}>
          <input ref={dateInput} type="date" value={date} max={today} onChange={(e) => { setDate(e.target.value); setDateError(null); }} required />
        </Field>
        <Field label={t.fuel.odometer} error={odometerError} hint={t.fuel.odometerHint(latestKm !== null ? formatKm(latestKm) : null)}>
          <input
            ref={odometerInput}
            inputMode="numeric"
            autoComplete="off"
            value={odometerText}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setOdometerText(e.target.value);
              setOdometerError(null);
            }}
            aria-invalid={odometerError ? true : undefined}
          />
        </Field>
        <ConsistencyWarnings check={check} extra={sameAsLast} />
        <Field label={t.fuel.litres('L')} error={litresError}>
          <input
            ref={litresInput}
            inputMode="decimal"
            autoComplete="off"
            value={litresText}
            onChange={(e) => {
              setLitresText(e.target.value);
              setLitresError(null);
              setTotalError(null);
            }}
            aria-invalid={litresError ? true : undefined}
          />
        </Field>
        <Field label={t.fuel.totalPaid(currencySymbol(t))} error={totalError} hint={worked !== null ? t.fuel.perLitre(formatMoney(worked, t)) : undefined}>
          <input
            ref={totalInput}
            inputMode="decimal"
            autoComplete="off"
            value={totalText}
            onChange={(e) => {
              setTotalText(e.target.value);
              setTotalError(null);
            }}
            aria-invalid={totalError ? true : undefined}
          />
        </Field>
        <Field label={t.fuel.notes}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} />
        </Field>
        <FormError error={error} />
        <div className="sticky-actions">
          <button type="submit" className="button button-primary button-block">
            {existing ? t.fuel.saveChanges : t.fuel.save}
          </button>
        </div>
        {!reachable ? <p className="muted center">{t.service.offlineHint}</p> : null}
        {existing ? (
          <button type="button" className="button button-danger button-block" onClick={remove} disabled={!reachable || pending}>
            {pending ? t.fuel.deleteAfterSync : t.fuel.delete}
          </button>
        ) : null}
      </form>
    </Layout>
  );
}
