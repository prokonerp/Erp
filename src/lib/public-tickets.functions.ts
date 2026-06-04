import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  customer_name: z.string().trim().min(2).max(120),
  customer_phone: z.string().trim().min(7).max(20),
  customer_email: z.string().trim().email().max(255).optional().or(z.literal("")),
  customer_address: z.string().trim().max(500).optional().or(z.literal("")),
  location: z.string().trim().max(120).optional().or(z.literal("")),
  product: z.string().trim().max(120).optional().or(z.literal("")),
  serial_no: z.string().trim().max(80).optional().or(z.literal("")),
  call_type: z.enum(["OOW", "Installation", "Warranty", "AMC", "PM Call", "New Sale Delivery", "CCTV"]),
  complaint: z.string().trim().min(5).max(2000),
  captcha_answer: z.number().int(),
  captcha_expected: z.number().int(),
  attachments: z.array(z.object({
    path: z.string().min(1).max(500),
    kind: z.enum(["serial_photo", "issue_photo", "other"]).default("other"),
  })).max(5).optional().default([]),
});

function tc(s: string) {
  return s.trim().replace(/\s+/g, " ").toLowerCase()
    .replace(/\b([a-z])([a-z0-9'’-]*)/g, (_, a, r) => a.toUpperCase() + r);
}

export const submitPublicTicket = createServerFn({ method: "POST" })
  .inputValidator((input) => schema.parse(input))
  .handler(async ({ data }) => {
    if (data.captcha_answer !== data.captcha_expected) {
      throw new Error("Captcha verification failed. Please try again.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = {
      customer_name: tc(data.customer_name),
      customer_phone: data.customer_phone.replace(/\D/g, ""),
      customer_email: (data.customer_email || "").toLowerCase() || null,
      customer_address: data.customer_address ? tc(data.customer_address) : null,
      location: data.location ? tc(data.location) : null,
      product: data.product ? tc(data.product) : null,
      serial_no: data.serial_no ? data.serial_no.toUpperCase() : null,
      call_type: data.call_type,
      complaint: data.complaint.trim(),
      status: "New",
      remarks: "Submitted via public customer form",
      attachments: data.attachments ?? [],
    };
    const { data: row, error } = await supabaseAdmin
      .from("tickets")
      .insert(payload as never)
      .select("case_id")
      .single();
    if (error) throw new Error(error.message);
    return { case_id: (row as { case_id: string }).case_id };
  });