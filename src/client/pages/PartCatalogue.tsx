import { useState, type FormEvent } from 'react';
import {
  catalogueOf,
  conditionChoices,
  PART_CATEGORIES,
  SPEC_FLAGS,
  type CataloguePart,
  type ConditionKey,
  type Conditions,
  type PartCategory,
  type SpecFlag,
} from '../../shared/catalogue.ts';
import type { PartUnit, VehicleKind } from '../../shared/schemas.ts';
import type { Snapshot } from '../../shared/types.ts';
import { confirmDelete, Field, FormError, Layout, NeedsConnection } from '../components.tsx';
import { messages, useT, type Messages } from '../i18n.ts';
import { navigate } from '../router.ts';
import { online } from '../store.ts';
import { useSubmit } from './SetupForms.tsx';

// The parts catalogue is desk work and needs a connection (ADR 0001).

const LIST = '/settings/parts';

const isFlag = (key: ConditionKey): key is SpecFlag => (SPEC_FLAGS as readonly string[]).includes(key);

function detailLabel(key: ConditionKey, t: Messages): string {
  if (isFlag(key)) return t.setup.flags[key];
  return t.setup[key];
}

function valueLabel(key: ConditionKey, value: string, t: Messages): string {
  if (isFlag(key)) return value === 'true' ? t.settings.yes : t.settings.no;
  const names: Record<Exclude<ConditionKey, SpecFlag>, Record<string, string>> = {
    fuel: t.setup.fuels,
    transmission: t.setup.transmissions,
    drivetrain: t.setup.drivetrains,
    distribution: t.setup.distributions,
    finalDrive: t.setup.finalDrives,
    cooling: t.setup.coolings,
  };
  return names[key][value] ?? value;
}

/** A part's conditions in words, e.g. "Fuel: Petrol, Diesel · Turbo: Yes"; null when every Vehicle of its kind has it. */
function describeConditions(part: CataloguePart, t: Messages): string | null {
  const lines = conditionChoices(part.kind).flatMap(({ key, values }) => {
    const wanted = part.conditions[key];
    if (!wanted || values.every((v) => wanted.includes(v))) return [];
    return [`${detailLabel(key, t)}: ${wanted.map((v) => valueLabel(key, v, t)).join(', ')}`];
  });
  return lines.length > 0 ? lines.join(' · ') : null;
}

function PartRow({ part, t }: { part: CataloguePart; t: Messages }) {
  const conditions = describeConditions(part, t);
  return (
    <li>
      <a className="history-row" href={`#${LIST}/${part.code}`}>
        <span>
          <strong>{part[t.lang]}</strong>
          {part.builtIn ? null : <span className="chip chip-unknown">{t.settings.ownPart}</span>}
          {part.changed && !part.removed ? <span className="chip chip-unknown">{t.settings.changed}</span> : null}
        </span>
        <span className="muted">{conditions ?? t.settings.allOfKind[part.kind]}</span>
        {part.characteristics ? <span className="muted">{part.characteristics}</span> : null}
      </a>
    </li>
  );
}

/** The catalogue by kind of Vehicle and category: which parts there are, and which Builds have them. */
export function CataloguePage({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const [kind, setKind] = useState<VehicleKind>('car');
  const parts = catalogueOf(snapshot).all.filter((p) => p.kind === kind);
  const removed = parts.filter((p) => p.removed);
  return (
    <Layout title={t.settings.partsTitle} back="/settings">
      <p className="muted">{t.settings.partsIntro}</p>
      <div className="heading-row">
        <div className="kind-switch">
          {(['car', 'motorcycle'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`button button-small ${k === kind ? 'button-primary' : ''}`}
              aria-pressed={k === kind}
              onClick={() => setKind(k)}
            >
              {t.setup[k]}
            </button>
          ))}
        </div>
        <a className="button button-small" href={`#${LIST}/new/${kind}`}>
          {t.settings.addPart}
        </a>
      </div>
      {PART_CATEGORIES.map((category) => {
        const inCategory = parts.filter((p) => p.category === category && !p.removed);
        return inCategory.length > 0 ? (
          <section key={category}>
            <h2>{t.workshop.partCategories[category]}</h2>
            <ul className="list">
              {inCategory.map((p) => (
                <PartRow key={p.code} part={p} t={t} />
              ))}
            </ul>
          </section>
        ) : null;
      })}
      {removed.length > 0 ? (
        <details className="sold">
          <summary>{t.settings.removedParts(removed.length)}</summary>
          <ul className="list">
            {removed.map((p) => (
              <PartRow key={p.code} part={p} t={t} />
            ))}
          </ul>
        </details>
      ) : null}
    </Layout>
  );
}

function optionalNumber(text: string, label: string): number | null {
  const cleaned = text.replace(/\s/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isInteger(n) || n <= 0) throw new Error(messages().setup.wholeNumber(label));
  return n;
}

/** One built-in part's conditions and default details, or all of a part of the owner's. */
export function PartForm({ part, kind }: { part?: CataloguePart; kind: VehicleKind }) {
  const t = useT();
  const own = part === undefined || !part.builtIn;
  const choices = conditionChoices(kind);
  const [name, setName] = useState(part?.en ?? '');
  const [nameFr, setNameFr] = useState(part && part.fr !== part.en ? part.fr : '');
  const [category, setCategory] = useState<PartCategory>(part?.category ?? 'other');
  const [unit, setUnit] = useState<PartUnit>(part?.unit ?? 'piece');
  const [intervalKm, setIntervalKm] = useState(String(part?.intervalKm ?? ''));
  const [intervalMonths, setIntervalMonths] = useState(String(part?.intervalMonths ?? ''));
  const [characteristics, setCharacteristics] = useState(part?.characteristics ?? '');
  // A detail the part does not depend on has every value ticked.
  const [ticked, setTicked] = useState<Conditions>(() =>
    Object.fromEntries(choices.map(({ key, values }) => [key, part?.conditions[key] ?? values])),
  );
  const { error, disabled, run } = useSubmit();

  function toggle(key: ConditionKey, value: string) {
    const current = ticked[key] ?? [];
    setTicked({ ...ticked, [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  }

  function save(removed: boolean) {
    void run(async () => {
      if (choices.some(({ key }) => (ticked[key] ?? []).length === 0)) throw new Error(t.settings.tickOne);
      const shared = { conditions: ticked, characteristics };
      if (own) {
        const body = {
          ...shared,
          kind,
          name,
          nameFr,
          category,
          unit,
          intervalKm: optionalNumber(intervalKm, t.setup.distanceLabel),
          intervalMonths: optionalNumber(intervalMonths, t.setup.monthsLabel),
        };
        if (body.intervalKm === null && body.intervalMonths === null) throw new Error(t.setup.needInterval);
        if (part) await online('PUT', `/api/catalogue/${part.code}`, body);
        else await online('POST', '/api/catalogue', body);
      } else {
        await online('PUT', `/api/catalogue/${part!.code}`, { ...shared, removed });
      }
      navigate(LIST, { replace: true });
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save(part?.removed ?? false);
  }

  /** A built-in part goes back to how it is built in; a part of the owner's is deleted. */
  async function reset() {
    if (!part) return;
    if (!part.builtIn && !(await confirmDelete(t.settings.confirmDelete(part[t.lang])))) return;
    void run(async () => {
      await online('DELETE', `/api/catalogue/${part.code}`);
      navigate(LIST, { replace: true });
    }, part.builtIn ? messages().feedback.saved : t.feedback.deleted);
  }

  return (
    <Layout title={part ? part[t.lang] : t.settings.newPart(t.setup[kind])} back={LIST}>
      <NeedsConnection />
      <form onSubmit={submit} className="form">
        {part?.removed ? <p className="banner banner-warn">{t.settings.removedNotice}</p> : null}
        {own ? (
          <>
            <Field label={t.settings.partName}>
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} lang="en" />
            </Field>
            <Field label={t.settings.partNameFr}>
              <input value={nameFr} onChange={(e) => setNameFr(e.target.value)} maxLength={120} lang="fr" />
            </Field>
            <Field label={t.setup.taskCategory}>
              <select value={category} onChange={(e) => setCategory(e.target.value as PartCategory)}>
                {PART_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t.workshop.partCategories[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.settings.partType}>
              <select value={unit} onChange={(e) => setUnit(e.target.value as PartUnit)}>
                <option value="piece">{t.settings.fitted}</option>
                <option value="litre">{t.settings.fluid}</option>
              </select>
            </Field>
            <p className="field-label">{t.setup.interval}</p>
            <div className="row">
              <Field label={t.setup.everyKm}>
                <input inputMode="numeric" value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} />
              </Field>
              <Field label={t.setup.everyMonths}>
                <input inputMode="numeric" value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)} />
              </Field>
            </div>
          </>
        ) : null}
        <p className="field-label">{t.settings.appliesTo}</p>
        <p className="muted">{t.settings.appliesHint}</p>
        {choices.map(({ key, values }) => (
          <fieldset key={key} className="field">
            <legend className="field-label">{detailLabel(key, t)}</legend>
            <div className="check-grid">
              {values.map((value) => {
                const on = (ticked[key] ?? []).includes(value);
                return (
                  <label key={value} className={`check ${on ? 'check-on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(key, value)} />
                    <span>{valueLabel(key, value, t)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        <Field label={t.settings.defaultDetails} hint={t.settings.defaultDetailsHint}>
          <input value={characteristics} onChange={(e) => setCharacteristics(e.target.value)} maxLength={500} />
        </Field>
        <FormError error={error} />
        <button type="submit" className="button button-primary button-block" disabled={disabled}>
          {part ? t.setup.save : t.settings.addPart}
        </button>
        {part?.builtIn && !part.removed ? (
          <button type="button" className="button button-danger button-block" disabled={disabled} onClick={() => save(true)}>
            {t.settings.remove}
          </button>
        ) : null}
        {part?.builtIn && part.changed ? (
          <button type="button" className="button button-block" disabled={disabled} onClick={() => void reset()}>
            {t.settings.backToBuiltIn}
          </button>
        ) : null}
        {part && !part.builtIn ? (
          <button type="button" className="button button-danger button-block" disabled={disabled} onClick={() => void reset()}>
            {t.settings.deletePart}
          </button>
        ) : null}
      </form>
    </Layout>
  );
}
