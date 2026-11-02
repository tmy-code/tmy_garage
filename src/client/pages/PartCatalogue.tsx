import { useState, type FormEvent } from 'react';
import {
  BUILT_IN_CATALOGUE,
  catalogueOf,
  conditionChoices,
  PART_CATEGORIES,
  SPEC_FLAGS,
  type CataloguePart,
  type ConditionKey,
  type Conditions,
  type IntervalRule,
  type PartCategory,
  type SpecFlag,
} from '../../shared/catalogue.ts';
import type { PartUnit, VehicleKind } from '../../shared/schemas.ts';
import type { Snapshot } from '../../shared/types.ts';
import { confirmDelete, Field, FormError, Layout, NeedsConnection } from '../components.tsx';
import { describeEvery } from '../format.ts';
import { messages, useT, type Messages } from '../i18n.ts';
import { navigate } from '../router.ts';
import { online } from '../store.ts';
import { useSubmit } from './SetupForms.tsx';

// The task list is desk work and needs a connection (ADR 0001).

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

/** Conditions in words, e.g. "Fuel: Petrol, Diesel · Turbo: Yes"; null when every Vehicle of the kind matches. */
function describeConditions(kind: VehicleKind, conditions: Conditions, t: Messages): string | null {
  const lines = conditionChoices(kind).flatMap(({ key, values }) => {
    const wanted = conditions[key];
    if (!wanted || values.every((v) => wanted.includes(v))) return [];
    return [`${detailLabel(key, t)}: ${wanted.map((v) => valueLabel(key, v, t)).join(', ')}`];
  });
  return lines.length > 0 ? lines.join(' · ') : null;
}

/** What the list shows: the task to do ("Replace front brake pads"), or the name of a part replaced with another's task. */
function listName(part: CataloguePart, t: Messages): string {
  return part.task?.[t.lang] ?? part[t.lang];
}

function PartRow({ part, t }: { part: CataloguePart; t: Messages }) {
  const conditions = describeConditions(part.kind, part.conditions, t);
  const interval = part.goesWith ? null : describeEvery(part.intervalKm, part.intervalMonths, t);
  return (
    <li>
      <a className="history-row" href={`#${LIST}/${part.code}`}>
        <span>
          <strong>{listName(part, t)}</strong>
          {part.unit === null ? <span className="chip chip-unknown">{t.settings.checkChip}</span> : null}
          {part.builtIn ? null : <span className="chip chip-unknown">{t.settings.ownPart}</span>}
          {part.changed && !part.removed ? <span className="chip chip-unknown">{t.settings.changed}</span> : null}
        </span>
        {interval ? (
          <span className="muted">
            {interval}
            {part.rules.length > 0 ? ` · ${t.settings.rulesCount(part.rules.length)}` : ''}
          </span>
        ) : null}
        <span className="muted">{conditions ?? t.settings.allOfKind[part.kind]}</span>
        {part.characteristics ? <span className="muted">{part.characteristics}</span> : null}
      </a>
    </li>
  );
}

/** The task list by kind of Vehicle and category: which tasks and parts there are, and which Builds get them. */
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

/** A typed number for a summary line: nothing while it is empty or not a number yet. */
function numberOrNull(text: string): number | null {
  const n = Number(text.replace(/\s/g, ''));
  return text.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

/** What a task is for: a fitted part, a fluid, or a check or service with nothing to buy. */
type TaskType = PartUnit | 'check';

/** Every detail of a Build with its values as checkboxes: ticked is what is allowed. */
function ConditionGrid({ kind, ticked, onChange }: { kind: VehicleKind; ticked: Conditions; onChange: (ticked: Conditions) => void }) {
  const t = useT();
  function toggle(key: ConditionKey, value: string) {
    const current = ticked[key] ?? [];
    onChange({ ...ticked, [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  }
  return (
    <>
      {conditionChoices(kind).map(({ key, values }) => (
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
    </>
  );
}

/** A detail the task does not depend on has every value ticked. */
function allTicked(kind: VehicleKind, conditions: Conditions): Conditions {
  return Object.fromEntries(conditionChoices(kind).map(({ key, values }) => [key, conditions[key] ?? values]));
}

/** An Interval rule being edited: what is ticked, and the distance and months as typed. */
interface RuleDraft {
  key: number;
  ticked: Conditions;
  km: string;
  months: string;
  fresh: boolean;
}

let nextRuleKey = 1;

function toDraft(kind: VehicleKind, rule: IntervalRule): RuleDraft {
  return { key: nextRuleKey++, ticked: allTicked(kind, rule.conditions), km: String(rule.intervalKm ?? ''), months: String(rule.intervalMonths ?? ''), fresh: false };
}

/** One built-in task's interval, rules, conditions and default details, or all of a task of the owner's. */
export function PartForm({ part, kind }: { part?: CataloguePart; kind: VehicleKind }) {
  const t = useT();
  const own = part === undefined || !part.builtIn;
  const choices = conditionChoices(kind);
  const [name, setName] = useState(part?.en ?? '');
  const [nameFr, setNameFr] = useState(part && part.fr !== part.en ? part.fr : '');
  const [category, setCategory] = useState<PartCategory>(part?.category ?? 'other');
  const [type, setType] = useState<TaskType>(part ? (part.unit ?? 'check') : 'piece');
  const [intervalKm, setIntervalKm] = useState(String(part?.intervalKm ?? ''));
  const [intervalMonths, setIntervalMonths] = useState(String(part?.intervalMonths ?? ''));
  const [rules, setRules] = useState<RuleDraft[]>(() => (part?.rules ?? []).map((rule) => toDraft(kind, rule)));
  const [characteristics, setCharacteristics] = useState(part?.characteristics ?? '');
  const [ticked, setTicked] = useState<Conditions>(() => allTicked(kind, part?.conditions ?? {}));
  const { error, disabled, run } = useSubmit();
  // The oil filter is replaced with the oil, on the oil's task: it has no interval of its own.
  const together = part?.goesWith ? BUILT_IN_CATALOGUE.known(part.goesWith) : undefined;

  function setRule(key: number, patch: Partial<RuleDraft>) {
    setRules(rules.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function save(removed: boolean) {
    void run(async () => {
      if (choices.some(({ key }) => (ticked[key] ?? []).length === 0)) throw new Error(t.settings.tickOne);
      const intervals = {
        intervalKm: optionalNumber(intervalKm, t.setup.distanceLabel),
        intervalMonths: optionalNumber(intervalMonths, t.setup.monthsLabel),
        rules: rules.map((r) => {
          if (choices.some(({ key }) => (r.ticked[key] ?? []).length === 0)) throw new Error(t.settings.tickOne);
          // A rule that every build matches would only repeat the default interval.
          if (choices.every(({ key, values }) => (r.ticked[key] ?? []).length === values.length)) throw new Error(t.settings.ruleNeedsCondition);
          const rule = { conditions: r.ticked, intervalKm: optionalNumber(r.km, t.setup.distanceLabel), intervalMonths: optionalNumber(r.months, t.setup.monthsLabel) };
          if (rule.intervalKm === null && rule.intervalMonths === null) throw new Error(t.setup.needInterval);
          return rule;
        }),
      };
      if (!together && intervals.intervalKm === null && intervals.intervalMonths === null) throw new Error(t.setup.needInterval);
      const shared = { conditions: ticked, characteristics: type === 'check' ? '' : characteristics, ...(together ? {} : intervals) };
      if (own) {
        const body = { ...shared, kind, name, nameFr, category, unit: type === 'check' ? null : type };
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

  /** A built-in task goes back to how it is built in; a task of the owner's is deleted. */
  async function reset() {
    if (!part) return;
    if (!part.builtIn && !(await confirmDelete(t.settings.confirmDelete(part[t.lang])))) return;
    void run(async () => {
      await online('DELETE', `/api/catalogue/${part.code}`);
      navigate(LIST, { replace: true });
    }, part.builtIn ? messages().feedback.saved : t.feedback.deleted);
  }

  return (
    <Layout title={part ? listName(part, t) : t.settings.newPart(t.setup[kind])} back={LIST}>
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
              {/* A check cannot become a part, nor a part a check: Part Specs would have to be made or dropped. */}
              <select value={type} onChange={(e) => setType(e.target.value as TaskType)}>
                {part?.unit === null ? null : (
                  <>
                    <option value="piece">{t.settings.fitted}</option>
                    <option value="litre">{t.settings.fluid}</option>
                  </>
                )}
                {part && part.unit !== null ? null : <option value="check">{t.settings.check}</option>}
              </select>
            </Field>
          </>
        ) : null}
        <p className="field-label">{t.settings.appliesTo}</p>
        <p className="muted">{t.settings.appliesHint}</p>
        <ConditionGrid kind={kind} ticked={ticked} onChange={setTicked} />
        {together ? (
          <p className="muted">{t.settings.goesWith(together[t.lang])}</p>
        ) : (
          <>
            <p className="field-label">{t.setup.interval}</p>
            <p className="muted">{t.settings.intervalHint}</p>
            <div className="row">
              <Field label={t.setup.everyKm}>
                <input inputMode="numeric" value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} />
              </Field>
              <Field label={t.setup.everyMonths}>
                <input inputMode="numeric" value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)} />
              </Field>
            </div>
            <p className="field-label">{t.settings.rulesTitle}</p>
            <p className="muted">{t.settings.rulesHint}</p>
            {rules.map((rule) => (
              <details key={rule.key} className="part-details" open={rule.fresh}>
                <summary>
                  {describeConditions(kind, rule.ticked, t) ?? t.settings.ruleEvery} · {describeEvery(numberOrNull(rule.km), numberOrNull(rule.months), t)}
                </summary>
                <ConditionGrid kind={kind} ticked={rule.ticked} onChange={(next) => setRule(rule.key, { ticked: next })} />
                <div className="row">
                  <Field label={t.setup.everyKm}>
                    <input inputMode="numeric" value={rule.km} onChange={(e) => setRule(rule.key, { km: e.target.value })} />
                  </Field>
                  <Field label={t.setup.everyMonths}>
                    <input inputMode="numeric" value={rule.months} onChange={(e) => setRule(rule.key, { months: e.target.value })} />
                  </Field>
                </div>
                <button type="button" className="button button-small button-danger" onClick={() => setRules(rules.filter((r) => r.key !== rule.key))}>
                  {t.settings.removeRule}
                </button>
              </details>
            ))}
            <button
              type="button"
              className="button button-small"
              onClick={() => setRules([...rules, { key: nextRuleKey++, ticked: allTicked(kind, {}), km: '', months: '', fresh: true }])}
            >
              {t.settings.addRule}
            </button>
          </>
        )}
        {type === 'check' ? null : (
          <Field label={t.settings.defaultDetails} hint={t.settings.defaultDetailsHint}>
            <input value={characteristics} onChange={(e) => setCharacteristics(e.target.value)} maxLength={500} />
          </Field>
        )}
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
