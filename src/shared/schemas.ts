import { z } from 'zod';
import { cleanSpecs, PART_CATEGORIES, specsProblem } from './catalogue.ts';

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
export const specGroup = z.enum(['fluids', 'parts', 'torque', 'other']);
// What a Vehicle is built with (its Build), which decides its Standard Parts.
export const fuelType = z.enum(['petrol', 'flexfuel', 'diesel', 'hybrid', 'phev', 'electric']);
export const transmission = z.enum(['manual', 'automatic', 'dct', 'cvt', 'e_cvt', 'single_speed']);
export const drivetrain = z.enum(['fwd', 'rwd', 'awd']);
export const distribution = z.enum(['belt', 'chain', 'none']);
export const finalDrive = z.enum(['chain', 'belt', 'shaft', 'gear', 'none']);
export const cooling = z.enum(['liquid', 'air']);
export const documentOwnerKind = z.enum(['vehicle', 'service']);
export const documentType = z.enum(['registration', 'invoice', 'manual', 'photo', 'other']);
export const partUnit = z.enum(['piece', 'litre']);
/** What is done to the part: replace it, inspect it, clean it or adjust it. */
export const taskAction = z.enum(['replace', 'inspect', 'clean', 'adjust']);
/** Who did the work of a Service. */
export const performedBy = z.enum(['diy', 'garage', 'dealership']);
/** Maintenance of the plan, or a repair outside it. */
export const serviceKind = z.enum(['maintenance', 'repair']);
const quantity = z.number().positive().max(10_000);

const flag = z
  .boolean()
  .nullish()
  .transform((v) => v ?? false);

export const vehicleInput = z
  .object({
    kind: vehicleKind,
    name: z.string().trim().min(1).max(80),
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    year: z
      .number()
      .int()
      .min(1900)
      .max(2100)
      .nullish()
      .transform((v) => v ?? null),
    vin: optionalText(17),
    // The Build: which details are required, and which go together, depends on the kind and fuel (see catalogue.ts).
    fuel: fuelType.nullish().transform((v) => v ?? null),
    transmission: transmission.nullish().transform((v) => v ?? null),
    drivetrain: drivetrain.nullish().transform((v) => v ?? null),
    distribution: distribution.nullish().transform((v) => v ?? null),
    cooling: cooling.nullish().transform((v) => v ?? null),
    finalDrive: finalDrive.nullish().transform((v) => v ?? null),
    cylinders: z
      .number()
      .int()
      .min(1)
      .max(16)
      .nullish()
      .transform((v) => v ?? null),
    hasHydraulicClutch: flag,
    hasTurbo: flag,
    hasDirectInjection: flag,
    hasStartStop: flag,
    hasAdblue: flag,
    hasAc: flag,
    hasAirSuspension: flag,
  })
  .transform(cleanSpecs)
  .superRefine((v, ctx) => {
    const problem = specsProblem(v);
    if (problem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [problem.field],
        message: problem.issue === 'required' ? 'Required for this kind of vehicle' : 'Not possible with the other details',
      });
    }
  });

export const garagePageInput = z.object({ shown: z.boolean() });

export const sellInput = z.object({
  date: isoDate,
  odometer: odometer.nullish().transform((v) => v ?? null),
  price: z
    .number()
    .min(0)
    .max(10_000_000)
    .nullish()
    .transform((v) => v ?? null),
});

export const taskInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    nameFr: optionalText(120),
    intervalKm: z
      .number()
      .int()
      .positive()
      .max(1_000_000)
      .nullish()
      .transform((v) => v ?? null),
    intervalMonths: z
      .number()
      .int()
      .positive()
      .max(600)
      .nullish()
      .transform((v) => v ?? null),
    baselineDate: isoDate.nullish().transform((v) => v ?? null),
    baselineOdometer: odometer.nullish().transform((v) => v ?? null),
    /** The category the owner placed the Task in; empty is 'other'. */
    category: z
      .enum(PART_CATEGORIES)
      .nullish()
      .transform((v) => v ?? null),
    /** Instructions, torque and fluid reminders, standard part codes. */
    notes: optionalText(20_000),
    /** Paused on this Vehicle: no status and no reminder. */
    switchedOff: z.boolean().default(false),
    action: taskAction.default('replace'),
  })
  .refine((t) => t.intervalKm !== null || t.intervalMonths !== null, {
    message: 'An Interval needs a distance, a duration, or both',
    path: ['intervalKm'],
  });

export const copyTasksInput = z.object({ fromVehicleId: z.string().min(1) });

export const mergeTaskInput = z.object({ intoTaskId: z.string().min(1) });

/** For each detail a part depends on, the values it needs; at least one, or no Vehicle could ever have the part. */
const conditions = z.record(z.string(), z.array(z.string().min(1)).min(1, 'Tick at least one value'));

const intervalKm = z
  .number()
  .int()
  .positive()
  .max(1_000_000)
  .nullish()
  .transform((v) => v ?? null);
const intervalMonths = z
  .number()
  .int()
  .positive()
  .max(600)
  .nullish()
  .transform((v) => v ?? null);

/** A change to a built-in part. Without an Interval the built-in one stays; with one, it is the owner's. */
export const catalogueChangeInput = z
  .object({
    conditions,
    removed: z.boolean().default(false),
    /** The owner's own name, category or action for the task; left out keeps the built-in one. */
    name: optionalText(120),
    nameFr: optionalText(120),
    category: z
      .enum(PART_CATEGORIES)
      .nullish()
      .transform((v) => v ?? null),
    action: taskAction.nullish().transform((v) => v ?? null),
    intervalKm: z.number().int().positive().max(1_000_000).nullish(),
    intervalMonths: z.number().int().positive().max(600).nullish(),
  })
  .refine((p) => (p.intervalKm === undefined && p.intervalMonths === undefined) || (p.intervalKm ?? null) !== null || (p.intervalMonths ?? null) !== null, {
    message: 'An Interval needs a distance, a duration, or both',
    path: ['intervalKm'],
  });

export const ownPartInput = z
  .object({
    kind: vehicleKind,
    name: z.string().trim().min(1).max(120),
    nameFr: optionalText(120),
    category: z.enum(PART_CATEGORIES),
    action: taskAction.default('replace'),
    intervalKm,
    intervalMonths,
    conditions,
  })
  .refine((p) => p.intervalKm !== null || p.intervalMonths !== null, {
    message: 'An Interval needs a distance, a duration, or both',
    path: ['intervalKm'],
  });

export const specLineInput = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(200),
  group: specGroup,
  /** Empty is 'other'. */
  category: z
    .enum(PART_CATEGORIES)
    .nullish()
    .transform((v) => v ?? null),
});

/** A component used in a Service, with its brand and variant in the description. Older phones also send a price, a supplier and a link to a Part Spec: those are ignored. */
export const partUsedInput = z.object({
  description: z.string().trim().min(1).max(200),
  partNumber: optionalText(120),
  quantity,
  unit: partUnit,
});

export const serviceInput = z
  .object({
  id: clientId,
  vehicleId: z.string().min(1),
  date: isoDate,
  // Left out when the Service's Tasks are all time-based; the form asks for it when one counts distance.
  odometer: odometer.nullish().transform((v) => v ?? null),
  taskIds: z.array(z.string().min(1)).default([]),
  // A repair outside the plan has a title and a category instead of Tasks.
  kind: serviceKind.default('maintenance'),
  title: optionalText(120),
  category: z
    .enum(PART_CATEGORIES)
    .nullish()
    .transform((v) => v ?? null),
  notes: optionalText(2000),
  // Services queued on a phone before these existed arrive without them.
  performedBy: performedBy.default('diy'),
  totalCost: z
    .number()
    .min(0)
    .max(1_000_000)
    .nullish()
    .transform((v) => v ?? null),
  partsUsed: z.array(partUsedInput).max(100).default([]),
})
  .superRefine((s, ctx) => {
    if (s.kind === 'maintenance' && s.taskIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['taskIds'], message: 'A Service completes at least one Maintenance Task' });
    }
    if (s.kind === 'repair' && !s.title) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'A repair needs a title' });
  });

export const odometerReadingInput = z.object({
  id: clientId,
  vehicleId: z.string().min(1),
  date: isoDate,
  odometer,
});

/** Document details; the file itself is sent alongside as multipart form data. */
export const documentInput = z.object({
  type: documentType,
  title: optionalText(120),
  issueDate: isoDate.nullish().transform((v) => v ?? null),
  expiryDate: isoDate.nullish().transform((v) => v ?? null),
});

export const documentOwner = z.object({ ownerKind: documentOwnerKind, ownerId: z.string().min(1) });

/** What a browser hands over when it agrees to receive notifications (PushSubscription.toJSON()), plus its language. */
export const pushSubscriptionInput = z.object({
  endpoint: z.string().url().max(2000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  lang: z.enum(['en', 'fr']),
});

export const pushEndpointInput = z.object({ endpoint: z.string().max(2000) });

export type VehicleKind = z.infer<typeof vehicleKind>;
export type FuelType = z.infer<typeof fuelType>;
export type Transmission = z.infer<typeof transmission>;
export type Drivetrain = z.infer<typeof drivetrain>;
export type Distribution = z.infer<typeof distribution>;
export type FinalDrive = z.infer<typeof finalDrive>;
export type Cooling = z.infer<typeof cooling>;
export type DocumentOwnerKind = z.infer<typeof documentOwnerKind>;
export type DocumentType = z.infer<typeof documentType>;
export type SpecGroup = z.infer<typeof specGroup>;
export type PartUnit = z.infer<typeof partUnit>;
export type TaskAction = z.infer<typeof taskAction>;
export type PerformedBy = z.infer<typeof performedBy>;
export type ServiceKind = z.infer<typeof serviceKind>;
export type VehicleInput = z.infer<typeof vehicleInput>;
export type SellInput = z.infer<typeof sellInput>;
export type TaskInput = z.infer<typeof taskInput>;
export type ServiceInput = z.infer<typeof serviceInput>;
export type OdometerReadingInput = z.infer<typeof odometerReadingInput>;
