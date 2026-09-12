import { z } from "zod";

export type CustomerVerdict = "verified" | "incorrect";
export type EquipmentVerdict = "matched" | "mismatch";

export type CustomerSnapshot = {
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  sector: string | null;
  location: string | null;
};

export function buildCustomerSnapshot(t: {
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  sector?: string | null;
  location?: string | null;
}): CustomerSnapshot {
  return {
    customer_name: t.customer_name,
    customer_phone: t.customer_phone ?? null,
    customer_email: t.customer_email ?? null,
    customer_address: t.customer_address ?? null,
    sector: t.sector ?? null,
    location: t.location ?? null,
  };
}

export const customerCorrectedSchema = z.object({
  customer_name: z.string().trim().min(1, "Customer name required"),
  customer_phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "Enter a valid 10-digit mobile number"),
  customer_email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .nullable()
    .optional(),
  customer_address: z.string().trim().nullable().optional(),
  sector: z.string().trim().nullable().optional(),
  location: z.string().trim().nullable().optional(),
});

export type CustomerCorrected = z.infer<typeof customerCorrectedSchema>;

const nonEmpty = (v: unknown) =>
  typeof v === "string" && v.trim().length > 0;

const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export const customerPerFieldSchema = z
  .object({
    nameIncorrect: z.boolean(),
    phoneIncorrect: z.boolean(),
    nameInput: z.string().trim().optional(),
    phoneInput: z.string().trim().optional(),
    email: z.string().trim().nullable().optional(),
    address: z.string().trim().nullable().optional(),
    sector: z.string().trim().nullable().optional(),
    location: z.string().trim().nullable().optional(),
  })
  .refine(
    (d) =>
      d.nameIncorrect ||
      d.phoneIncorrect ||
      nonEmpty(d.email) ||
      nonEmpty(d.address) ||
      nonEmpty(d.sector) ||
      nonEmpty(d.location),
    {
      message: "Mark at least one field as incorrect",
      path: ["nameIncorrect"],
    },
  )
  .refine((d) => !d.nameIncorrect || (d.nameInput?.trim().length ?? 0) > 0, {
    message: "Customer name required",
    path: ["nameInput"],
  })
  .refine((d) => !d.phoneIncorrect || /^\d{10}$/.test((d.phoneInput ?? "").trim()), {
    message: "Enter a valid 10-digit mobile number",
    path: ["phoneInput"],
  })
  .refine((d) => d.email == null || d.email.trim().length === 0 || validEmail(d.email), {
    message: "Enter a valid email address",
    path: ["email"],
  });

export type CustomerPerField = z.infer<typeof customerPerFieldSchema>;

export function resolveCustomerCorrection(
  snapshot: CustomerSnapshot,
  input: {
    nameIncorrect: boolean;
    phoneIncorrect: boolean;
    nameInput?: string;
    phoneInput?: string;
    email?: string | null;
    address?: string | null;
    sector?: string | null;
    location?: string | null;
  },
): { corrected: CustomerCorrected; verdict: CustomerVerdict } {
  const parsed = customerPerFieldSchema.parse({
    nameIncorrect: input.nameIncorrect,
    phoneIncorrect: input.phoneIncorrect,
    nameInput: input.nameInput,
    phoneInput: input.phoneInput,
    email: input.email,
    address: input.address,
    sector: input.sector,
    location: input.location,
  });
  const pick = (v: string | null | undefined, fallback: string | null) =>
    v != null && v.trim().length > 0 ? v.trim() : fallback;
  return {
    corrected: {
      customer_name: parsed.nameIncorrect
        ? parsed.nameInput!.trim()
        : snapshot.customer_name,
      customer_phone: parsed.phoneIncorrect
        ? parsed.phoneInput!.trim()
        : ((snapshot.customer_phone ?? "") as string),
      customer_email: pick(parsed.email, snapshot.customer_email),
      customer_address: pick(parsed.address, snapshot.customer_address),
      sector: pick(parsed.sector, snapshot.sector),
      location: pick(parsed.location, snapshot.location),
    },
    verdict: "incorrect",
  };
}

export const equipmentMismatchSchema = z.object({
  corrected_model: z.string().trim().min(1, "Model No required"),
  corrected_serial: z.string().trim().min(1, "Serial No required"),
});

export type EquipmentMismatch = z.infer<typeof equipmentMismatchSchema>;

export const equipmentPerFieldSchema = z
  .object({
    modelIncorrect: z.boolean(),
    serialIncorrect: z.boolean(),
    modelInput: z.string().trim().optional(),
    serialInput: z.string().trim().optional(),
  })
  .refine((d) => d.modelIncorrect || d.serialIncorrect, {
    message: "Mark at least one field as incorrect",
    path: ["modelIncorrect"],
  })
  .refine((d) => !d.modelIncorrect || (d.modelInput?.length ?? 0) > 0, {
    message: "Model No required",
    path: ["modelInput"],
  })
  .refine((d) => !d.serialIncorrect || (d.serialInput?.length ?? 0) > 0, {
    message: "Serial No required",
    path: ["serialInput"],
  });

export type EquipmentPerField = z.infer<typeof equipmentPerFieldSchema>;

export function resolveEquipmentCorrection(
  original: { model: string | null | undefined; serial: string | null | undefined },
  input: {
    modelIncorrect: boolean;
    serialIncorrect: boolean;
    modelInput?: string;
    serialInput?: string;
  },
): { corrected_model: string | null; corrected_serial: string | null; verdict: EquipmentVerdict } {
  const parsed = equipmentPerFieldSchema.parse({
    modelIncorrect: input.modelIncorrect,
    serialIncorrect: input.serialIncorrect,
    modelInput: input.modelInput,
    serialInput: input.serialInput,
  });
  return {
    corrected_model: parsed.modelIncorrect
      ? (parsed.modelInput!.trim() as string)
      : ((original.model ?? null) as string | null),
    corrected_serial: parsed.serialIncorrect
      ? (parsed.serialInput!.trim() as string)
      : ((original.serial ?? null) as string | null),
    verdict: parsed.modelIncorrect || parsed.serialIncorrect ? "mismatch" : "matched",
  };
}

export function canProceedToStep2(
  customerRow: { id: string } | null,
): boolean {
  return !!customerRow?.id;
}

export function canProceedToWork(
  customerRow: { id: string } | null,
  equipmentRow: { id: string } | null,
): boolean {
  return !!customerRow?.id && !!equipmentRow?.id;
}

export function buildEquipmentOriginal(t: {
  product?: string | null;
  serial_no?: string | null;
}): { original_model: string | null; original_serial: string | null } {
  return {
    original_model: t.product ?? null,
    original_serial: t.serial_no ?? null,
  };
}
