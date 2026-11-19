import { describe, expect, it } from 'vitest';
import type { StarterTask } from './catalogue.ts';
import { copyPlan, mergeTasks, seedPlan, type CopyTarget, type MergeSide, type SeedTask, type TaskToCopy } from './plan.ts';

const template = (code: string, name: string, nameFr: string, sameAs: string[] = []): StarterTask => ({
  code: code as StarterTask['code'],
  name,
  nameFr,
  intervalKm: 8000,
  intervalMonths: 12,
  category: 'engine',
  action: 'replace',
  sameAs,
});

const OIL = template('oil', 'Change oil', 'Vidange', ['Oil', 'Huile', 'Oil and filter']);
const AIR = template('air', 'Replace air filter', 'Remplacer le filtre à air', ['Air filter', 'Filtre à air']);
const CHAIN = template('chain', 'Replace chain', 'Remplacer la chaîne', ['Chain', 'Chaîne']);
const SPROCKETS = template('sprockets', 'Replace sprockets', 'Remplacer le pignon', ['Sprockets', 'Pignon et couronne']);
const TEMPLATES = [OIL, AIR, CHAIN, SPROCKETS];

const seedTask = (id: string, name: string, nameFr: string | null = null, templateCode: string | null = null): SeedTask => ({ id, name, nameFr, templateCode });

describe('seedPlan', () => {
  it('adds every template to an empty plan, in order', () => {
    expect(seedPlan([], TEMPLATES)).toEqual({ tag: [], add: TEMPLATES });
  });

  it('adopts an untagged Task by loose name and only tags it', () => {
    const plan = seedPlan([seedTask('t1', '  FILTRE   à  AIR ')], TEMPLATES);
    expect(plan.tag).toEqual([{ taskId: 't1', code: 'air' }]);
    expect(plan.add).toEqual([OIL, CHAIN, SPROCKETS]);
    expect(seedPlan([seedTask('t2', 'Oil')], TEMPLATES)).toEqual({ tag: [{ taskId: 't2', code: 'oil' }], add: [AIR, CHAIN, SPROCKETS] });
  });

  it('adopts by French name and by sameAs', () => {
    expect(seedPlan([seedTask('t1', 'Something else', 'Vidange')], TEMPLATES).tag).toEqual([{ taskId: 't1', code: 'oil' }]);
    expect(seedPlan([seedTask('t2', 'Oil and filter')], TEMPLATES).tag).toEqual([{ taskId: 't2', code: 'oil' }]);
  });

  it('lets a tagged Task block its template even when renamed', () => {
    const plan = seedPlan([seedTask('t1', 'My own oil job', null, 'oil')], TEMPLATES);
    expect(plan.tag).toEqual([]);
    expect(plan.add).toEqual([AIR, CHAIN, SPROCKETS]);
  });

  it('ignores a tagged Task’s name for another template', () => {
    const plan = seedPlan([seedTask('t1', 'Air filter', null, 'oil')], TEMPLATES);
    expect(plan.tag).toEqual([]);
    expect(plan.add).toEqual([AIR, CHAIN, SPROCKETS]);
  });

  it('does not adopt a Task twice: the second template is added', () => {
    const plan = seedPlan([seedTask('t1', 'Chain', 'Pignon et couronne')], TEMPLATES);
    expect(plan.tag).toEqual([{ taskId: 't1', code: 'chain' }]);
    expect(plan.add).toEqual([OIL, AIR, SPROCKETS]);
  });

  it('adopts the first of two matching untagged Tasks', () => {
    const tasks = [seedTask('t1', 'Oil', 'first'), seedTask('t2', 'Huile', 'second')];
    const plan = seedPlan(tasks, TEMPLATES);
    expect(plan.tag).toEqual([{ taskId: 't1', code: 'oil' }]);
    expect(plan.add).toEqual([AIR, CHAIN, SPROCKETS]);
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

const toCopy = (name: string, overrides: Partial<TaskToCopy> = {}): TaskToCopy => ({
  name,
  nameFr: null,
  action: 'inspect',
  intervalKm: 5000,
  intervalMonths: 6,
  category: 'chassis',
  notes: null,
  switchedOff: false,
  templateCode: null,
  ...overrides,
});
const target = (name: string, nameFr: string | null = null, templateCode: string | null = null): CopyTarget => ({ name, nameFr, templateCode });

describe('copyPlan', () => {
  it('keeps the source order and every field', () => {
    const source = [toCopy('Grease cable', { notes: 'Use lithium grease', switchedOff: true, templateCode: 'grease' }), toCopy('Wash', { nameFr: 'Laver' })];
    const { add } = copyPlan(source, []);
    expect(add).toEqual(source);
    expect(add[0]).toBe(source[0]);
  });

  it('skips the same loose name checked against the target’s name and nameFr', () => {
    const source = [toCopy('Check lights'), toCopy('Check Mirrors')];
    expect(copyPlan(source, [target('check  LIGHTS')]).add).toEqual([source[1]]);
    expect(copyPlan(source, [target('Other', 'check LIGHTS')]).add).toEqual([source[1]]);
  });

  it('skips the same non-null code even when the target Task was renamed', () => {
    const source = [toCopy('Change oil', { templateCode: 'oil' }), toCopy('Plain')];
    expect(copyPlan(source, [target('Home oil job', null, 'oil')]).add).toEqual([source[1]]);
  });

  it('compares the source’s name only, not its nameFr', () => {
    const source = [toCopy('Something', { nameFr: 'Check lights' })];
    expect(copyPlan(source, [target('Check lights')]).add).toEqual(source);
  });

  it('copies two source Tasks with the same name: the sets are not updated while copying', () => {
    const source = [toCopy('Check Lights'), toCopy('check  lights')];
    expect(copyPlan(source, []).add).toEqual(source);
  });
});

const side = (overrides: Partial<MergeSide> = {}): MergeSide => ({ baselineDate: null, baselineOdometer: null, notes: null, templateCode: null, ...overrides });

describe('mergeTasks', () => {
  it('lets the more recent baseline win, in both directions', () => {
    const old = side({ baselineDate: '2025-01-01', baselineOdometer: 5 });
    const recent = side({ baselineDate: '2026-03-01', baselineOdometer: 100 });
    expect(mergeTasks(old, recent)).toMatchObject({ baselineDate: '2026-03-01', baselineOdometer: 100 });
    expect(mergeTasks(recent, old)).toMatchObject({ baselineDate: '2026-03-01', baselineOdometer: 100 });
  });

  it('takes the duplicate’s baseline when kept has none, and keeps kept’s when the duplicate has none', () => {
    const dated = side({ baselineDate: '2026-03-01', baselineOdometer: 100 });
    expect(mergeTasks(side({ baselineOdometer: 5 }), dated)).toMatchObject({ baselineDate: '2026-03-01', baselineOdometer: 100 });
    expect(mergeTasks(dated, side({ baselineOdometer: 7 }))).toMatchObject({ baselineDate: '2026-03-01', baselineOdometer: 100 });
  });

  it('keeps kept’s baseline when the dates are equal', () => {
    const merged = mergeTasks(side({ baselineDate: '2025-01-01', baselineOdometer: 5 }), side({ baselineDate: '2025-01-01', baselineOdometer: 100 }));
    expect(merged).toMatchObject({ baselineDate: '2025-01-01', baselineOdometer: 5 });
  });

  it('joins the notes with a blank line, without repeats', () => {
    expect(mergeTasks(side({ notes: 'One' }), side({ notes: 'Two' })).notes).toBe('One\n\nTwo');
    expect(mergeTasks(side({ notes: 'Same' }), side({ notes: 'Same' })).notes).toBe('Same');
    expect(mergeTasks(side({ notes: null }), side({ notes: 'Two' })).notes).toBe('Two');
    expect(mergeTasks(side({ notes: 'One' }), side({ notes: '' })).notes).toBe('One');
  });

  it('gives null for empty or null notes', () => {
    expect(mergeTasks(side(), side()).notes).toBeNull();
    expect(mergeTasks(side({ notes: '' }), side({ notes: '' })).notes).toBeNull();
  });

  it('takes the duplicate’s code only when kept has none', () => {
    expect(mergeTasks(side(), side({ templateCode: 'chain' })).templateCode).toBe('chain');
    expect(mergeTasks(side({ templateCode: 'chain' }), side()).templateCode).toBe('chain');
    expect(mergeTasks(side({ templateCode: 'chain' }), side({ templateCode: 'coolant' })).templateCode).toBe('chain');
  });
});
