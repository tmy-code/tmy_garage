import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like 2026-10-24');
const odometer = z.number().int().min(0).max(5_000_000);
const clientId = z.string().min(8).max(64);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const vehicleKind = z.enum(['car', 'motorcycle']);

export const vehicleInput = z.object({
  kind: vehicleKind,
  name: z.string().trim().min(1).max(80),
  make: optionalText(60),
  model: optionalText(60),
  year: z.number().int().min(1900).max(2100).nullish().transform((v) => v ?? null),
  registration: optionalText(20),
});

export const sellInput = z.object({
  date: isoDate,
  odometer: odometer.nullish().transform((v) => v ?? null),
  price: z.number().min(0).max(10_000_000).nullish().transform((v) => v ?? null),
});

export const taskInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    intervalKm: z.number().int().positive().max(1_000_000).nullish().transform((v) => v ?? null),
    intervalMonths: z.number().int().positive().max(600).nullish().transform((v) => v ?? null),
    officialIntervalKm: z.number().int().positive().max(1_000_000).nullish().transform((v) => v ?? null),
    officialIntervalMonths: z.number().int().positive().max(600).nullish().transform((v) => v ?? null),
    baselineDate: isoDate.nullish().transform((v) => v ?? null),
    baselineOdometer: odometer.nullish().transform((v) => v ?? null),
  })
  .refine((t) => t.intervalKm !== null || t.intervalMonths !== null, {
    message: 'An Interval needs a distance, a duration, or both',
    path: ['intervalKm'],
  });

export const copyTasksInput = z.object({ fromVehicleId: z.string().min(1) });

export const serviceInput = z.object({
  id: clientId,
  vehicleId: z.string().min(1),
  date: isoDate,
  odometer,
  taskIds: z.array(z.string().min(1)).min(1, 'A Service completes at least one Maintenance Task'),
  notes: optionalText(2000),
});

export const odometerReadingInput = z.object({
  id: clientId,
  vehicleId: z.string().min(1),
  date: isoDate,
  odometer,
});

export type VehicleKind = z.infer<typeof vehicleKind>;
export type VehicleInput = z.infer<typeof vehicleInput>;
export type SellInput = z.infer<typeof sellInput>;
export type TaskInput = z.infer<typeof taskInput>;
export type ServiceInput = z.infer<typeof serviceInput>;
export type OdometerReadingInput = z.infer<typeof odometerReadingInput>;
