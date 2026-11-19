import { beforeEach, afterEach, expect } from 'vitest';
import type { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import type { MaintenanceTask, Snapshot, Vehicle } from '../shared/types.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';

export let db: DatabaseSync;
export let app: Hono;

export function call(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** What a test motorcycle and car are built with; tests override what they look at. */
export const BIKE = { kind: 'motorcycle', make: 'Exemple', model: 'Test', fuel: 'petrol', transmission: 'manual', cooling: 'liquid', finalDrive: 'chain', cylinders: 2 };
export const CAR = { kind: 'car', make: 'Exemple', model: 'Test', fuel: 'petrol', transmission: 'manual', drivetrain: 'fwd', distribution: 'chain' };

/** A motorcycle without the Maintenance Tasks a new vehicle starts with, so tests see only the Tasks they add. */
export async function createVehicle(name = 'Test bike'): Promise<Vehicle> {
  const res = await call('POST', '/api/vehicles', { ...BIKE, name });
  expect(res.status).toBe(201);
  const vehicle = (await res.json()) as Vehicle;
  db.prepare('DELETE FROM maintenance_tasks WHERE vehicle_id = ?').run(vehicle.id);
  return vehicle;
}

export async function createTask(vehicleId: string, overrides: object = {}): Promise<MaintenanceTask> {
  const res = await call('POST', `/api/vehicles/${vehicleId}/tasks`, {
    name: 'Oil change',
    intervalKm: 6000,
    intervalMonths: 12,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.json();
}

export async function snapshot(): Promise<Snapshot> {
  return (await call('GET', '/api/snapshot')).json();
}

/** Tests that need other app options (uploads folder, Notion stub) replace the shared app with this. */
export function setApp(next: Hono) {
  app = next;
}

/** Registers a fresh in-memory garage before each test; call once at the top of a test file. */
export function setupGarage() {
  beforeEach(() => {
    db = openDatabase(':memory:');
    app = createApp(db);
  });

  afterEach(() => db.close());
}
