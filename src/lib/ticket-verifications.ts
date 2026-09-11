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

export const equipmentMismatchSchema = z.object({
  corrected_model: z.string().trim().min(1, "Model No required"),
  corrected_serial: z.string().trim().min(1, "Serial No required"),
});

export type EquipmentMismatch = z.infer<typeof equipmentMismatchSchema>;

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
