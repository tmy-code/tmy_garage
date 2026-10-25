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
export const vehicleSpecKind = z.enum(['torque', 'other']);
export const inspectionResult = z.enum(['passed', 'majorDefects', 'criticalDefects']);
export const defectSeverity = z.enum(['minor', 'major', 'critical']);
export const documentOwnerKind = z.enum(['vehicle', 'service', 'modification', 'inspection', 'policy', 'cover', 'claim']);
export const documentType = z.enum([
  'registration',
  'invoice',
  'inspectionReport',
  'manual',
  'photo',
  'policySchedule',
  'insuranceCertificate',
  'claimsStatement',
  'claimReport',
  'other',
]);
export const overnightParking = z.enum(['closedGarage', 'privateParking', 'street']);
export const coverLevel = z.enum(['thirdParty', 'thirdPartyExtended', 'comprehensive']);
export const responsibility = z.enum(['notAtFault', 'partlyAtFault', 'atFault']);
export const motorcycleLicence = z.enum(['A1', 'A2', 'A']);
export const partUnit = z.enum(['piece', 'litre']);
const quantity = z.number().positive().max(10_000);

export const vehicleInput = z.object({
  kind: vehicleKind,
  name: z.string().trim().min(1).max(80),
  make: optionalText(60),
  model: optionalText(60),
  year: z
    .number()
    .int()
    .min(1900)
    .max(2100)
    .nullish()
    .transform((v) => v ?? null),
  registration: optionalText(20),
  firstRegistration: isoDate.nullish().transform((v) => v ?? null),
  // Registration certificate facts a Quote Pack asks for.
  vin: optionalText(17),
  version: optionalText(80),
  fiscalPower: z
    .number()
    .int()
    .min(1)
    .max(200)
    .nullish()
    .transform((v) => v ?? null),
  nationalType: optionalText(10),
  purchaseDate: isoDate.nullish().transform((v) => v ?? null),
  overnightParking: overnightParking.nullish().transform((v) => v ?? null),
});

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
    officialIntervalKm: z
      .number()
      .int()
      .positive()
      .max(1_000_000)
      .nullish()
      .transform((v) => v ?? null),
    officialIntervalMonths: z
      .number()
      .int()
      .positive()
      .max(600)
      .nullish()
      .transform((v) => v ?? null),
    baselineDate: isoDate.nullish().transform((v) => v ?? null),
    baselineOdometer: odometer.nullish().transform((v) => v ?? null),
  })
  .refine((t) => t.intervalKm !== null || t.intervalMonths !== null, {
    message: 'An Interval needs a distance, a duration, or both',
    path: ['intervalKm'],
  });

export const copyTasksInput = z.object({ fromVehicleId: z.string().min(1) });

export const workshopInput = z.object({
  workshopNotes: optionalText(20_000),
  requiredParts: z.array(z.object({ partSpecId: z.string().min(1), quantity })).max(50),
  tools: z.array(z.string().trim().min(1).max(120)).max(50),
  specIds: z.array(z.string().min(1)).max(100),
});

export const vehicleSpecInput = z.object({
  kind: vehicleSpecKind,
  name: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(120),
  notes: optionalText(500),
});

export const partSpecInput = z.object({
  name: z.string().trim().min(1).max(120),
  characteristics: optionalText(500),
  partNumbers: optionalText(500),
  unit: partUnit,
  notFitted: z.boolean().default(false),
});

export const positionInput = z.object({ name: z.string().trim().min(1).max(80) });

export const partUsedInput = z.object({
  partSpecId: z
    .string()
    .min(1)
    .nullish()
    .transform((v) => v ?? null),
  positionId: z
    .string()
    .min(1)
    .nullish()
    .transform((v) => v ?? null),
  description: z.string().trim().min(1).max(200),
  partNumber: optionalText(120),
  quantity,
  unit: partUnit,
  price: z
    .number()
    .min(0)
    .max(1_000_000)
    .nullish()
    .transform((v) => v ?? null),
  supplier: optionalText(120),
});

export const serviceInput = z.object({
  id: clientId,
  vehicleId: z.string().min(1),
  date: isoDate,
  odometer,
  taskIds: z.array(z.string().min(1)).min(1, 'A Service completes at least one Maintenance Task'),
  notes: optionalText(2000),
  // Services queued on a phone before Parts Used existed arrive without them.
  partsUsed: z.array(partUsedInput).max(100).default([]),
});

export const odometerReadingInput = z.object({
  id: clientId,
  vehicleId: z.string().min(1),
  date: isoDate,
  odometer,
});

export const inspectionInput = z.object({
  date: isoDate,
  odometer,
  centre: optionalText(120),
  result: inspectionResult,
  nextDueDate: isoDate.nullish().transform((v) => v ?? null),
  notes: optionalText(2000),
  defects: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(300),
        severity: defectSeverity,
        fixedServiceId: z
          .string()
          .min(1)
          .nullish()
          .transform((v) => v ?? null),
      }),
    )
    .max(100),
});

export const modificationInput = z.object({
  name: z.string().trim().min(1).max(120),
  fittedDate: isoDate,
  fittedOdometer: odometer.nullish().transform((v) => v ?? null),
  removedDate: isoDate.nullish().transform((v) => v ?? null),
  positionId: z
    .string()
    .min(1)
    .nullish()
    .transform((v) => v ?? null),
  declaredToInsurer: z.boolean(),
  notes: optionalText(2000),
});

/** Document details; the file itself is sent alongside as multipart form data. */
export const documentInput = z.object({
  type: documentType,
  title: optionalText(120),
  issueDate: isoDate.nullish().transform((v) => v ?? null),
  expiryDate: isoDate.nullish().transform((v) => v ?? null),
});

export const documentOwner = z.object({ ownerKind: documentOwnerKind, ownerId: z.string().min(1) });

const money = z
  .number()
  .min(0)
  .max(1_000_000)
  .nullish()
  .transform((v) => v ?? null);

export const driverInput = z.object({
  name: z.string().trim().min(1).max(80),
  birthDate: isoDate.nullish().transform((v) => v ?? null),
  carLicenceDate: isoDate.nullish().transform((v) => v ?? null),
  motorcycleLicenceDate: isoDate.nullish().transform((v) => v ?? null),
  motorcycleLicence: motorcycleLicence.nullish().transform((v) => v ?? null),
  notes: optionalText(2000),
});

export const policyInput = z.object({
  insurer: z.string().trim().min(1).max(80),
  policyNumber: optionalText(40),
  startDate: isoDate,
  cancelledDate: isoDate.nullish().transform((v) => v ?? null),
  driverIds: z.array(z.string().min(1)).max(10),
  notes: optionalText(2000),
});

const coverTerms = {
  level: coverLevel,
  guarantees: optionalText(500),
  excess: money,
};

export const termInput = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    notes: optionalText(2000),
    covers: z
      .array(
        z.object({
          vehicleId: z.string().min(1),
          ...coverTerms,
          premium: money,
          crm: z
            .number()
            .min(0.5)
            .max(3.5)
            .nullish()
            .transform((v) => v ?? null),
          notes: optionalText(500),
        }),
      )
      .min(1, 'A Policy Term covers at least one Vehicle')
      .max(20),
  })
  .refine((t) => t.endDate > t.startDate, { message: 'The renewal date must be after the start date', path: ['endDate'] });

export const claimInput = z.object({
  vehicleId: z.string().min(1),
  driverId: z
    .string()
    .min(1)
    .nullish()
    .transform((v) => v ?? null),
  date: isoDate,
  responsibility,
  amount: money,
  description: z.string().trim().min(1).max(300),
  notes: optionalText(2000),
});

export const quoteInput = z.object({
  insurer: z.string().trim().min(1).max(80),
  date: isoDate,
  ...coverTerms,
  premium: z.number().min(0).max(1_000_000),
  validUntil: isoDate.nullish().transform((v) => v ?? null),
  notes: optionalText(2000),
});

/** What a browser hands over when it agrees to receive notifications (PushSubscription.toJSON()), plus its language. */
export const pushSubscriptionInput = z.object({
  endpoint: z.string().url().max(2000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  lang: z.enum(['en', 'fr']),
});

export const pushEndpointInput = z.object({ endpoint: z.string().max(2000) });

export type VehicleKind = z.infer<typeof vehicleKind>;
export type OvernightParking = z.infer<typeof overnightParking>;
export type CoverLevel = z.infer<typeof coverLevel>;
export type Responsibility = z.infer<typeof responsibility>;
export type MotorcycleLicence = z.infer<typeof motorcycleLicence>;
export type InspectionResult = z.infer<typeof inspectionResult>;
export type DefectSeverity = z.infer<typeof defectSeverity>;
export type DocumentOwnerKind = z.infer<typeof documentOwnerKind>;
export type DocumentType = z.infer<typeof documentType>;
export type VehicleSpecKind = z.infer<typeof vehicleSpecKind>;
export type PartUnit = z.infer<typeof partUnit>;
export type VehicleInput = z.infer<typeof vehicleInput>;
export type SellInput = z.infer<typeof sellInput>;
export type TaskInput = z.infer<typeof taskInput>;
export type ServiceInput = z.infer<typeof serviceInput>;
export type OdometerReadingInput = z.infer<typeof odometerReadingInput>;
export type TermInput = z.infer<typeof termInput>;
export type ClaimInput = z.infer<typeof claimInput>;
