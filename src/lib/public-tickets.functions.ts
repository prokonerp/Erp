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
  captcha_answer: z.number().int().optional().default(0),
  captcha_expected: z.number().int().optional().default(0),
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // --- Reverse-link: resolve existing customer + auto-create installed_equipment ---
    // Mirrors the internal flow in src/routes/_app/tickets.new.tsx -> getOrCreateEquipmentForTicket
    // but resolves customer by phone/name (public form has no customer_id picker).
    let customerId: string | null = null;
    let equipmentId: string | null = null;

    try {
      const phoneDigits = (data.customer_phone || "").replace(/\D/g, "");
      const nameNorm = (data.customer_name || "").trim().toLowerCase();

      if (phoneDigits || nameNorm) {
        // Fetch candidates — bounded to 5000 which covers the full master for this project
        // Phone in masters may be stored with spaces/dashes, so we normalise in JS.
        const { data: customers } = await supabaseAdmin
          .from("customers")
          .select("id,company,contact_name,phone")
          .limit(5000);

        if (customers && customers.length) {
          const normPhone = (p: string | null) => (p || "").replace(/\D/g, "");
          let hit: { id: string } | null = null;

          // 1) Exact full-digit phone match (most reliable)
          if (phoneDigits) {
            hit = (customers as { id: string; phone: string | null }[]).find(
              (c) => normPhone(c.phone) !== "" && normPhone(c.phone) === phoneDigits,
            ) || null;
          }
          // 2) Last-10 digit fallback (handles +91 / 0 prefix differences)
          if (!hit && phoneDigits.length >= 10) {
            const last10 = phoneDigits.slice(-10);
            hit = (customers as { id: string; phone: string | null }[]).find(
              (c) => normPhone(c.phone).slice(-10) === last10 && normPhone(c.phone).length >= 10,
            ) || null;
          }
          // 3) Exact company name (case-insensitive) — matches backfill SQL logic
          if (!hit && nameNorm) {
            hit = (customers as { id: string; company: string | null }[]).find(
              (c) => (c.company || "").trim().toLowerCase() === nameNorm,
            ) || null;
          }
          // 4) Exact contact_name fallback
          if (!hit && nameNorm) {
            hit = (customers as unknown as { id: string; contact_name: string | null }[]).find(
              (c) => (c.contact_name || "").trim().toLowerCase() === nameNorm,
            ) || null;
          }

          if (hit) customerId = hit.id;
        }
      }
    } catch (e) {
      console.warn("[submitPublicTicket] customer resolve failed (non-fatal):", e);
    }

    // Reverse-link to Installed Equipment - only when we have a known customer + model + serial
    // Same guard as internal tickets: customer_id && serial && product must all be present.
    if (customerId && (data.product || "").trim() && (data.serial_no || "").trim()) {
      try {
        const modelRaw = tc(data.product || "").trim();
        const serialUpper = (data.serial_no || "").trim().toUpperCase();
        let productId: string | null = null;

        // Optional: resolve product_id from Product Master (exact model match, case-insensitive)
        try {
          const { data: prod } = await supabaseAdmin
            .from("products")
            .select("id,model")
            .eq("active", true)
            .ilike("model", modelRaw)
            .limit(1);
          const p = (prod as { id: string }[] | null)?.[0];
          if (p) productId = p.id;
        } catch {
          // product_id stays null — model_no text is still stored
        }

        // Reuse if (customer, serial) already exists — serials are stored UPPER
        const { data: existing } = await supabaseAdmin
          .from("installed_equipment")
          .select("id")
          .eq("customer_id", customerId)
          .eq("serial_no", serialUpper)
          .maybeSingle();

        const ex = existing as { id: string } | null;
        if (ex?.id) {
          equipmentId = ex.id;
        } else {
          const { data: inserted, error: insErr } = await supabaseAdmin
            .from("installed_equipment")
            .insert({
              customer_id: customerId,
              product_id: productId,
              model_no: modelRaw,
              serial_no: serialUpper,
              warranty_months: 0,
            } as never)
            .select("id")
            .single();

          if (!insErr && inserted) {
            equipmentId = (inserted as { id: string }).id;
          } else if (insErr) {
            // Race: another request inserted same serial in between — try to fetch again
            const msg = (insErr as { message?: string })?.message || "";
            const isDup = /duplicate|unique|already exists/i.test(msg);
            if (isDup) {
              const { data: retry } = await supabaseAdmin
                .from("installed_equipment")
                .select("id")
                .eq("customer_id", customerId)
                .eq("serial_no", serialUpper)
                .maybeSingle();
              const r2 = retry as { id: string } | null;
              if (r2?.id) equipmentId = r2.id;
              else console.warn("[submitPublicTicket] equipment dup without row:", msg);
            } else {
              console.warn("[submitPublicTicket] equipment insert failed (non-fatal):", msg);
            }
          }
        }
      } catch (e) {
        console.warn("[submitPublicTicket] getOrCreate equipment failed (non-fatal):", e);
      }
    }

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
      raised_by_type: "external",
      raised_by_name: tc(data.customer_name),
      remarks: "Submitted via public customer form",
      attachments: data.attachments ?? [],
      // Link to masters when we could resolve the customer/equipment
      customer_id: customerId,
      equipment_id: equipmentId,
    };
    const { data: row, error } = await supabaseAdmin
      .from("tickets")
      .insert(payload as never)
      .select("case_id")
      .single();
    if (error) throw new Error(error.message);
    return { case_id: (row as { case_id: string }).case_id };
  });
