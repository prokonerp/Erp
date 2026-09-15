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
  customer_email: z.string().trim().email("Enter a valid email address").nullable().optional(),
  customer_address: z.string().trim().nullable().optional(),
  sector: z.string().trim().nullable().optional(),
  location: z.string().trim().nullable().optional(),
});

export type CustomerCorrected = z.infer<typeof customerCorrectedSchema>;

const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Customer verification is scoped to Email + Mobile only.
 *  The name/address/sector/location stay on the ticket snapshot for audit,
 *  but the engineer can only verify/correct email and phone. */
export const customerPerFieldSchema = z
  .object({
    emailIncorrect: z.boolean(),
    phoneIncorrect: z.boolean(),
    emailInput: z.string().trim().optional(),
    phoneInput: z.string().trim().optional(),
  })
  .refine((d) => d.emailIncorrect || d.phoneIncorrect, {
    message: "Mark at least one field as incorrect",
    path: ["emailIncorrect"],
  })
  .refine((d) => !d.emailIncorrect || validEmail(d.emailInput ?? ""), {
    message: "Enter a valid email address",
    path: ["emailInput"],
  })
  .refine((d) => !d.phoneIncorrect || /^\d{10}$/.test((d.phoneInput ?? "").trim()), {
    message: "Enter a valid 10-digit mobile number",
    path: ["phoneInput"],
  });

export type CustomerPerField = z.infer<typeof customerPerFieldSchema>;

export function resolveCustomerCorrection(
  snapshot: CustomerSnapshot,
  input: {
    emailIncorrect: boolean;
    phoneIncorrect: boolean;
    emailInput?: string;
    phoneInput?: string;
  },
): { corrected: CustomerCorrected; verdict: CustomerVerdict } {
  const parsed = customerPerFieldSchema.parse({
    emailIncorrect: input.emailIncorrect,
    phoneIncorrect: input.phoneIncorrect,
    emailInput: input.emailInput,
    phoneInput: input.phoneInput,
  });
  return {
    corrected: {
      // Name is context-only (not verifiable); snapshot value passes through.
      customer_name: snapshot.customer_name,
      customer_phone: parsed.phoneIncorrect
        ? parsed.phoneInput!.trim()
        : ((snapshot.customer_phone ?? "") as string),
      customer_email: parsed.emailIncorrect ? parsed.emailInput!.trim() : snapshot.customer_email,
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

export function canProceedToStep2(customerRow: { id: string } | null): boolean {
  return !!customerRow?.id;
}

export function canProceedToWork(
  customerRow: { id: string } | null,
  equipmentRow: { id: string } | null,
): boolean {
  return !!customerRow?.id && !!equipmentRow?.id;
}

export function buildEquipmentOriginal(t: { product?: string | null; serial_no?: string | null }): {
  original_model: string | null;
  original_serial: string | null;
} {
  return {
    original_model: t.product ?? null,
    original_serial: t.serial_no ?? null,
  };
}
