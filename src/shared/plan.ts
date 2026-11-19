import type { MaintenanceTask } from './types.ts';
import type { StarterTask } from './catalogue.ts';
import { looseName } from './service-logging.ts';

/** The Maintenance Plan rules for seeding, copying and merging Tasks. Pure: the caller does the storing. */

/** Required here, unlike the optional field on a MaintenanceTask. */
type Code = { templateCode: string | null };

/** A Task the Vehicle already has, as seeding looks at it. */
export type SeedTask = Pick<MaintenanceTask, 'id' | 'name' | 'nameFr'> & Code;

export interface SeedPlan {
  /** Tasks without a tag that stand for a template: they get its code. */
  tag: { taskId: string; code: string }[];
  /** Templates no Task stands for yet, in template order. */
  add: StarterTask[];
}

/**
 * Works out what giving a Vehicle the plan templates means. A template a Task is already tagged with is left alone,
 * whatever the owner renamed that Task. A Task without a tag that is named like the template (its name, its French
 * name or a name it is also known by) is taken as that template's Task; each Task is taken once, the first one wins.
 * Every other template is added.
 */
export function seedPlan(tasks: readonly SeedTask[], templates: readonly StarterTask[]): SeedPlan {
  const tagged = new Set(tasks.map((t) => t.templateCode).filter((code) => code !== null));
  const untagged = tasks.filter((t) => t.templateCode === null);
  const plan: SeedPlan = { tag: [], add: [] };
  for (const s of templates) {
    if (tagged.has(s.code)) continue;
    const known = new Set([s.name, s.nameFr, ...s.sameAs].map(looseName));
    const same = untagged.find((t) => known.has(looseName(t.name)) || known.has(looseName(t.nameFr)));
    if (same) {
      plan.tag.push({ taskId: same.id, code: s.code });
      untagged.splice(untagged.indexOf(same), 1);
      continue;
    }
    plan.add.push(s);
  }
  return plan;
}

/** A Task the Vehicle receiving a copy already has. */
export type CopyTarget = Pick<MaintenanceTask, 'name' | 'nameFr'> & Code;

/** A Task of the Vehicle being copied from. */
export type TaskToCopy = Pick<MaintenanceTask, 'name' | 'nameFr' | 'action' | 'intervalKm' | 'intervalMonths' | 'category' | 'notes' | 'switchedOff'> & Code;

/**
 * Which of the source's Tasks to give the target: not one whose name the target has already (by name or French name),
 * nor one with the template code the target already has. The target's Tasks are checked as they were before the copy.
 * The copies start with no baseline: the caller sets none.
 */
export function copyPlan(source: readonly TaskToCopy[], target: readonly CopyTarget[]): { add: TaskToCopy[] } {
  const names = new Set(target.flatMap((t) => [looseName(t.name), looseName(t.nameFr)]));
  const codes = new Set(target.map((t) => t.templateCode).filter((code) => code !== null));
  return { add: source.filter((t) => !(names.has(looseName(t.name)) || (t.templateCode !== null && codes.has(t.templateCode)))) };
}

/** What merging looks at on a Task. */
export type MergeSide = Pick<MaintenanceTask, 'baselineDate' | 'baselineOdometer' | 'notes'> & Code;

/** What the kept Task becomes. */
export type MergedTask = MergeSide;

/**
 * Folds a duplicate Task into the one to keep: the more recent baseline wins (its odometer travels with its date), the
 * notes are joined without repeats, and the kept Task takes the duplicate's template code when it has none.
 */
export function mergeTasks(kept: MergeSide, duplicate: MergeSide): MergedTask {
  const duplicateWins = Boolean(duplicate.baselineDate) && (!kept.baselineDate || duplicate.baselineDate! > kept.baselineDate);
  const from = duplicateWins ? duplicate : kept;
  const notes = [kept.notes, duplicate.notes].filter((n, i, all) => n && all.indexOf(n) === i).join('\n\n') || null;
  return {
    baselineDate: from.baselineDate,
    baselineOdometer: from.baselineOdometer,
    notes,
    templateCode: kept.templateCode ?? duplicate.templateCode,
  };
}
