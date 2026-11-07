import type { DatabaseSync } from 'node:sqlite';
import type { IsoDate } from '../shared/dates.ts';
import { vehicleDue } from '../shared/due.ts';
import type { Snapshot } from '../shared/types.ts';

const API = 'https://api.todoist.com/api/v1';

export interface NewTodoistTask {
  content: string;
  description: string;
  dueDate: IsoDate;
}

/** The little of Todoist this app uses. `gone` means the task no longer exists there (deleted by the owner). */
export interface TodoistClient {
  create(task: NewTodoistTask): Promise<string>;
  setDueDate(id: string, dueDate: IsoDate): Promise<'ok' | 'gone'>;
  close(id: string): Promise<'ok' | 'gone'>;
}

/** Talks to Todoist with the owner's personal API token; without a project id, new tasks land in the Inbox. */
export function todoistClient(token: string, projectId?: string, fetchImpl: typeof fetch = fetch): TodoistClient {
  async function call(path: string, body?: unknown): Promise<Response> {
    const response = await fetchImpl(`${API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Other 4xx answers (404, or 400 for a task already completed) mean the task is out of reach: not worth retrying.
    if (!response.ok && (response.status >= 500 || response.status === 401 || response.status === 403 || response.status === 429)) {
      throw new Error(`Todoist answered ${response.status}`);
    }
    return response;
  }
  return {
    async create({ content, description, dueDate }) {
      const response = await call('/tasks', {
        content,
        description,
        due_date: dueDate,
        ...(projectId ? { project_id: projectId } : {}),
      });
      const { id } = (await response.json()) as { id?: string };
      if (!response.ok || !id) throw new Error(`Todoist could not create the task (${response.status})`);
      return String(id);
    },
    async setDueDate(id, dueDate) {
      const response = await call(`/tasks/${encodeURIComponent(id)}`, { due_date: dueDate });
      return response.ok ? 'ok' : 'gone';
    },
    async close(id) {
      const response = await call(`/tasks/${encodeURIComponent(id)}/close`);
      return response.ok ? 'ok' : 'gone';
    },
  };
}

export interface WantedTask {
  /** Names one occurrence: doing the job starts a new key, so the next one gets its own Todoist task. */
  key: string;
  content: string;
  description: string;
  dueDate: IsoDate;
}

/** The Maintenance Tasks that are due soon or overdue today, each with the date to show in Todoist. */
export function wantedTasks(snapshot: Snapshot, today: IsoDate): WantedTask[] {
  const wanted: WantedTask[] = [];
  for (const vehicle of snapshot.vehicles.filter((v) => v.status === 'owned')) {
    for (const d of vehicleDue(snapshot, vehicle.id, today).due) {
      if (d.status !== 'overdue' && d.status !== 'dueSoon') continue;
      const task = snapshot.tasks.find((t) => t.id === d.taskId);
      if (!task) continue;
      wanted.push({
        key: `task:${d.taskId}:${d.lastDone?.date ?? ''}`,
        content: `${vehicle.name} · ${task.name}`,
        description: 'Estimated date from the logbook. tmy_garage keeps it up to date and completes this task once the job is logged.',
        // A distance-only task with no projected date is shown as due today.
        dueDate: d.dueDate ?? today,
      });
    }
  }
  return wanted;
}

interface Linked {
  key: string;
  todoistId: string;
  dueDate: IsoDate;
}

/**
 * Brings Todoist in line with the logbook: a task is created when a Maintenance Task becomes due soon, its date follows the
 * estimate when that changes, and it is completed when the job is done (or the Task is paused or no longer due soon).
 * A task the owner deleted in Todoist is not created again. A failed call is retried on the next run.
 * Returns how many Todoist calls were made.
 */
export async function syncTodoist(
  db: DatabaseSync,
  client: TodoistClient,
  garageId: string,
  snapshot: Snapshot,
  today: IsoDate,
): Promise<number> {
  const linked = db
    .prepare('SELECT key, todoist_id AS todoistId, due_date AS dueDate FROM todoist_tasks WHERE garage_id = ?')
    .all(garageId) as unknown as Linked[];
  const wanted = wantedTasks(snapshot, today);
  const save = db.prepare(
    `INSERT INTO todoist_tasks (garage_id, key, todoist_id, due_date) VALUES (?, ?, ?, ?)
     ON CONFLICT (garage_id, key) DO UPDATE SET due_date = excluded.due_date`,
  );
  let calls = 0;

  for (const w of wanted) {
    const existing = linked.find((l) => l.key === w.key);
    try {
      if (!existing) {
        calls++;
        const id = await client.create(w);
        save.run(garageId, w.key, id, w.dueDate);
      } else if (existing.dueDate !== w.dueDate) {
        calls++;
        await client.setDueDate(existing.todoistId, w.dueDate);
        save.run(garageId, w.key, existing.todoistId, w.dueDate);
      }
    } catch (error) {
      console.error('Todoist sync failed', error);
    }
  }

  for (const l of linked) {
    if (wanted.some((w) => w.key === l.key)) continue;
    try {
      calls++;
      await client.close(l.todoistId);
      db.prepare('DELETE FROM todoist_tasks WHERE garage_id = ? AND key = ?').run(garageId, l.key);
    } catch (error) {
      console.error('Todoist sync failed', error);
    }
  }
  return calls;
}
