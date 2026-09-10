import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Save, Trash2, Zap } from "lucide-react";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import { SerialMultiPicker } from "@/components/SerialMultiPicker";
import { NegativeStockDialog } from "@/components/NegativeStockDialog";
import type { Customer, CustomerBranch } from "@/lib/crm";
import { branchToDocumentFields } from "@/lib/crm";
import { fetchBranches, inr, type BranchRow } from "@/lib/sales";
import { productShortName } from "@/lib/productNames";
import { istTodayIso } from "@/lib/dateRange";
import { useIsAdmin } from "@/lib/useRole";
import {
  findShortfalls,
  logNegativeOverrides,
  blockMessage,
  type Shortfall,
} from "@/lib/negativeStock";
import {
  emptyGeneralDcItem,
  gdcTotal,
  insertGeneralDc,
  updateGeneralDc,
  type GeneralDcItem,
  type GeneralDcRow,
} from "@/lib/generalDc";
import { SO_PREFILL_KEY, type FulfillmentLine } from "@/lib/documentFlow";
import { createGeneralDcFromSO } from "@/lib/documentFlow.writers";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";

export function GeneralDcForm({
  existing,
  sales_order_id,
  conversion_id,
  soPrefill: soPrefillProp,
}: {
  existing?: GeneralDcRow;
  sales_order_id?: string | null;
  conversion_id?: string | null;
  soPrefill?: { lines: FulfillmentLine[] & any[]; sales_order_no?: string | null; po_number?: string | null; orderedTotal?: number; fulfilledTotal?: number; balanceTotal?: number } | null;
}) {
  const isEdit = !!existing;
  const nav = useNavigate();
  const { isAdmin } = useIsAdmin();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState(existing?.branch_id ?? (soPrefillProp as any)?.branch_id ?? "");
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // SO prefill state (prop or sessionStorage)
  const [soPrefill, setSoPrefill] = useState<null | {
    sales_order_id: string;
    sales_order_no: string | null;
    po_number: string | null;
    lines: any[];
    orderedTotal?: number;
    fulfilledTotal?: number;
    balanceTotal?: number;
  }>(() => {
    if (soPrefillProp && (soPrefillProp as any).lines) {
      const p: any = soPrefillProp as any;
      return {
        sales_order_id: (sales_order_id as string) || p.sales_order_id || "",
        sales_order_no: p.sales_order_no || null,
        po_number: p.po_number || null,
        lines: p.lines,
        orderedTotal: p.orderedTotal,
        fulfilledTotal: p.fulfilledTotal,
        balanceTotal: p.balanceTotal,
      };
    }
    return null;
  });
  const [dcDate, setDcDate] = useState(existing?.dc_date ?? istTodayIso());
  const [returnable, setReturnable] = useState(!!existing?.returnable);
  const [expectedReturn, setExpectedReturn] = useState(existing?.expected_return_date ?? "");
  const [billing, setBilling] = useState(existing?.billing_address ?? "");
  const [shipping, setShipping] = useState(existing?.shipping_address ?? "");
  const [sameAsBilling, setSameAsBilling] = useState(
    isEdit ? (existing?.shipping_address ?? "") === (existing?.billing_address ?? "") : true,
  );
  const [purpose, setPurpose] = useState(existing?.purpose ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [terms, setTerms] = useState(existing?.terms ?? "");
  const [items, setItems] = useState<GeneralDcItem[]>(
    existing?.items?.length ? existing.items : [emptyGeneralDcItem()],
  );
  const [serialIdx, setSerialIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // FE-C3: synchronous re-entry lock
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);
  const [negOpen, setNegOpen] = useState(false);
  // Selected customer branch office (transient — not persisted to the document;
  // its address/POS/contact fields feed the sync effect below).
  const [branchOverride, setBranchOverride] = useState<CustomerBranch | null>(null);

  useEffect(() => {
    fetchBranches()
      .then((bs) => {
        setBranches(bs);
        if (existing?.branch_id) return;
        const def = bs.find((b) => b.is_default) || bs[0];
        if (def) setBranchId(def.id);
      })
      .catch((e) => toast.error(e.message));
    supabase
      .from("warehouses")
      .select("id,name")
      .eq("status", "Active")
      .order("name")
      .then(({ data }) => setWarehouses((data ?? []) as { id: string; name: string }[]));
  }, []);

  // If soPrefill prop present and not edit, prefill items from ThisQty slice
  useEffect(() => {
    if (isEdit) return;
    if (!soPrefillProp || !(soPrefillProp as any).lines) return;
    const lines: any[] = (soPrefillProp as any).lines;
    const mapped: GeneralDcItem[] = lines.map((l: any) => ({
      product_id: l.product_id ?? null,
      part_name: l.part_name ?? l.description ?? null,
      model_no: l.model_no ?? l.part_model_no ?? null,
      hsn: l.hsn ?? null,
      uom: l.unit ?? l.uom ?? "Nos",
      qty: Number(l.this_qty ?? l.qty ?? 0) || 0,
      unit_price: Number(l.rate ?? l.unit_price ?? 0) || 0,
      warehouse_id: l.warehouse_id ?? null,
      is_serialized: !!l.is_serialized,
      serial_numbers: Array.isArray(l.serial_numbers) ? l.serial_numbers : [],
    }));
    if (mapped.length > 0) setItems(mapped);
    if ((soPrefillProp as any).branch_id) setBranchId((soPrefillProp as any).branch_id);
    if ((soPrefillProp as any).po_number) setPurpose((soPrefillProp as any).purpose || "");
  }, [isEdit, soPrefillProp]);

  // SessionStorage fallback for direct navigation (sessionStorage SO_PREFILL_KEY)
  useEffect(() => {
    if (isEdit) return;
    if (soPrefill) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(SO_PREFILL_KEY); } catch { /* noop */ }
    if (!raw) return;
    // Only consume if it looks like a GDC conversion (or generic) — peek header
    let p: any;
    try { p = JSON.parse(raw); } catch { return; }
    const salesOrderId: string | null = p.sales_order_id || p.salesOrderId || p.so_id || null;
    // Heuristic: if payload has items that look like for GDC or invoice both use same key, we consume only if we are GDC form and payload hasn't been consumed by invoice new
    // For now, only consume if gdc-specific flag or if we can map
    // To avoid stealing invoice prefill, check if general_dc hint exists or if we're sure to handle
    // We'll consume but leave info toast if it was invoice-only; simplest: if salesOrderId exists, treat as SO prefill for GDC too
    if (!salesOrderId) return;
    try { sessionStorage.removeItem(SO_PREFILL_KEY); } catch { /* noop */ }
    const header = p.header || p;
    const rawLines: any[] = Array.isArray(p.lines) ? p.lines : Array.isArray(p.items) ? p.items : [];
    const enriched = rawLines.map((l: any, idx: number) => ({
      line_index: l.line_index != null ? Number(l.line_index) : idx,
      product_id: l.product_id ?? null,
      description: l.description ?? l.part_name ?? "",
      hsn: l.hsn ?? null,
      unit: l.unit ?? l.uom ?? "Nos",
      rate: Number(l.rate ?? l.unit_price ?? 0) || 0,
      discount_pct: Number(l.discount_pct ?? 0) || 0,
      gst_rate: Number(l.gst_rate ?? 0) || 0,
      warehouse_id: l.warehouse_id ?? null,
      serial_numbers: Array.isArray(l.serial_numbers) ? l.serial_numbers : [],
      is_serialized: !!(l.is_serialized),
      ordered_qty: Number(l.ordered_qty ?? l.qty ?? 0) || 0,
      fulfilled_before: Number(l.fulfilled_before ?? 0) || 0,
      balance: l.balance != null ? Number(l.balance) : Math.max(0, Number(l.ordered_qty ?? 0) - Number(l.fulfilled_before ?? 0)),
      this_qty: Number(l.this_qty ?? l.qty ?? 0) || 0,
      part_model_no: l.part_model_no ?? l.model_no ?? null,
      part_name: l.part_name ?? l.description ?? null,
    }));
    const orderedTotal = enriched.reduce((s: number, l: any) => s + (Number(l.ordered_qty) || 0), 0);
    const fulfilledTotal = enriched.reduce((s: number, l: any) => s + (Number(l.fulfilled_before) || 0), 0);
    const balanceTotal = enriched.reduce((s: number, l: any) => s + (Number(l.balance) || 0), 0);
    setSoPrefill({
      sales_order_id: salesOrderId,
      sales_order_no: p.sales_order_no ?? p.so_no ?? header.sales_order_no ?? null,
      po_number: header.po_number ?? p.po_number ?? null,
      lines: enriched,
      orderedTotal,
      fulfilledTotal,
      balanceTotal,
    });
    if (header.branch_id ?? p.branch_id) setBranchId(header.branch_id ?? p.branch_id);
    if (header.billing_address ?? p.billing_address) setBilling(header.billing_address ?? p.billing_address);
    if (header.shipping_address ?? p.shipping_address) {
      const ship = header.shipping_address ?? p.shipping_address;
      setShipping(ship);
      const bill = header.billing_address ?? p.billing_address ?? "";
      setSameAsBilling(ship === bill);
    }
    if (header.customer_id ?? p.customer_id) {
      const cid = header.customer_id ?? p.customer_id;
      supabase.from("customers").select("*").eq("id", cid).maybeSingle().then(({ data }) => { if (data) setCustomer(data as unknown as Customer); });
    }
    if (enriched.length > 0) {
      const mapped: GeneralDcItem[] = enriched.map((l: any) => ({
        product_id: l.product_id,
        part_name: l.part_name || l.description,
        model_no: l.part_model_no,
        hsn: l.hsn,
        uom: l.unit || "Nos",
        qty: Number(l.this_qty) || 0,
        unit_price: Number(l.rate) || 0,
        warehouse_id: l.warehouse_id,
        is_serialized: !!l.is_serialized,
        serial_numbers: Array.isArray(l.serial_numbers) ? l.serial_numbers : [],
      }));
      setItems(mapped);
    }
  }, [isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const skipAddrSync = useRef(isEdit);
  // Suppresses the "same as billing" sync effect for one commit after a
  // customer/branch selection applies a (possibly distinct) shipping address.
  const skipShipSync = useRef(false);

  // Sweep fix (B-08 class): an Issued GDC has already consumed stock, and
  // Cancelled/Converted are terminal — editing their items would silently
  // desync inventory. The DB guards status transitions; this guards edits.
  useEffect(() => {
    const st = existing?.status;
    if (st && ["Issued", "Cancelled", "Converted"].includes(st)) {
      toast.error(`This General DC is ${st} — stock is already posted. Editing is blocked.`);
      nav({ to: "/sales/general-dc/$id", params: { id: existing!.id } });
    }
  }, [existing?.status, existing?.id, nav]);
  useEffect(() => {
    if (!existing?.customer_id) return;
    supabase
      .from("customers")
      .select("*")
      .eq("id", existing.customer_id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCustomer(data as unknown as Customer);
      });
  }, [existing?.customer_id]);

  useEffect(() => {
    if (!customer) return;
    if (skipAddrSync.current) {
      skipAddrSync.current = false;
      return;
    }
    // A selected branch office supplies billing/shipping/contact in place of the
    // customer's main address (branch wins; customer fields are the fallback).
    if (branchOverride) {
      const bf = branchToDocumentFields(branchOverride);
      const bill =
        bf.billing_address ||
        customer.billing_address ||
        (customer as unknown as { address?: string }).address ||
        "";
      const ship =
        bf.shipping_address ||
        bf.billing_address ||
        (customer as unknown as { shipping_address?: string }).shipping_address ||
        bill;
      setBilling(bill);
      setShipping(ship);
      setSameAsBilling(!ship || ship === bill);
      // The branch may carry a distinct shipping address — do not let the
      // "same as billing" sync effect below override it in the same commit.
      skipShipSync.current = true;
      return;
    }
    const bill =
      customer.billing_address || (customer as unknown as { address?: string }).address || "";
    const ship = (customer as unknown as { shipping_address?: string }).shipping_address || bill;
    setBilling(bill);
    setShipping(ship);
    setSameAsBilling(!ship || ship === bill);
    skipShipSync.current = true;
  }, [customer?.id, branchOverride]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sameAsBilling && !skipShipSync.current) setShipping(billing);
    skipShipSync.current = false;
  }, [sameAsBilling, billing]);

  const total = useMemo(() => gdcTotal(items), [items]);
  const wname = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? null;

  function setItem(idx: number, patch: Partial<GeneralDcItem>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function validate(): string | null {
    if (!customer) return "Choose a customer";
    if (items.length === 0) return "Add at least one item";
    // SO prefill: enforce qty cap per line (like SoConversionSheet)
    const effectiveSoPrefill = soPrefill || (soPrefillProp as any);
    if (effectiveSoPrefill && Array.isArray((effectiveSoPrefill as any).lines)) {
      const lines: any[] = (effectiveSoPrefill as any).lines;
      for (let i = 0; i < items.length; i++) {
        const cap = lines[i]?.balance;
        if (cap != null && Number(items[i].qty) > Number(cap)) {
          return `Line ${i + 1}: quantity ${items[i].qty} exceeds balance ${cap} (Against SO)`;
        }
      }
      if (items.length !== lines.length) {
        // allow but warn via caller; for now permit extra lines as standalone
      }
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.product_id) return `Line ${i + 1}: pick a product`;
      if (!it.warehouse_id) return `Line ${i + 1}: select a warehouse`;
      const qtyNum = Number(it.qty);
      if (!(qtyNum > 0)) return `Line ${i + 1}: quantity must be greater than 0`;
      // B-10: serialized lines must bill whole units and match serials exactly.
      if (it.is_serialized) {
        if (!Number.isInteger(qtyNum)) {
          return `Line ${i + 1}: serialized products need a whole-number quantity (got ${qtyNum})`;
        }
        if (it.serial_numbers.length !== qtyNum) {
          return `Line ${i + 1}: select ${qtyNum} serial number(s)`;
        }
      }
    }
    const all = items.flatMap((it) => it.serial_numbers);
    if (new Set(all).size !== all.length) return "Duplicate serial numbers across lines";
    return null;
  }

  async function save(status: "Draft" | "Issued") {
    // FE-C3: Synchronous re-entry lock — prevents double-post on rapid click
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const err = validate();
      if (err) return toast.error(err);

    if (status === "Issued") {
      let short: Shortfall[] = [];
      try {
        short = await findShortfalls(
          items
            .filter((it) => !it.is_serialized && it.model_no)
            .map((it) => ({
              model: it.model_no as string,
              label: it.part_name || it.model_no,
              warehouseId: it.warehouse_id,
              warehouseName: wname(it.warehouse_id),
              qty: Number(it.qty) || 0,
            })),
        );
      } catch (e) {
        // B-16: never skip the stock check silently — warn loudly and stop.
        console.error("Stock availability check failed:", e);
        return toast.error(
          "Could not verify stock availability. Please retry — continuing without this check could oversell inventory.",
        );
      }
      if (short.length > 0) {
        if (!isAdmin) return toast.error(blockMessage(short[0]));
        setShortfalls(short);
        setNegOpen(true);
        return;
      }
    }
    await doSave(status, false, [], null);
    } finally {
      savingRef.current = false;
    }
  }

  async function doSave(
    status: "Draft" | "Issued",
    allowNegative: boolean,
    short: Shortfall[],
    reason: string | null,
  ) {
    if (!customer) return;
    // ── SO-linked path: delegate to ledger-aware writer ──────────────────
    const effectiveSoId: string | null = (sales_order_id as string | null) || (soPrefill?.sales_order_id as string | null) || ((soPrefillProp as any)?.sales_order_id as string | null) || null;
    const effectiveSoPrefill: any = soPrefill || (soPrefillProp as any) || null;
    if (effectiveSoId && !existing) {
      setSaving(true);
      try {
        // Build FulfillmentLine[] from soPrefill if available, else from items (treat ordered = qty)
        let linesForWriter: FulfillmentLine[];
        if (effectiveSoPrefill && Array.isArray(effectiveSoPrefill.lines) && effectiveSoPrefill.lines.length > 0) {
          linesForWriter = (effectiveSoPrefill.lines as any[]).map((l: any, idx: number) => ({
            line_index: Number(l.line_index ?? idx),
            product_id: l.product_id ?? null,
            ordered_qty: Number(l.ordered_qty ?? 0) || 0,
            fulfilled_before: Number(l.fulfilled_before ?? 0) || 0,
            balance: Number(l.balance ?? 0) || 0,
            this_qty: Number(items[idx]?.qty) || 0,
            warehouse_id: (items[idx]?.warehouse_id as string | null) ?? (l.warehouse_id as string | null) ?? null,
            serial_numbers: Array.isArray(items[idx]?.serial_numbers) ? items[idx].serial_numbers : Array.isArray(l.serial_numbers) ? l.serial_numbers : [],
            is_serialized: !!(items[idx]?.is_serialized ?? l.is_serialized),
          }));
        } else {
          // Fallback: treat each current item as a fulfillment line
          linesForWriter = items.map((it, idx) => ({
            line_index: idx,
            product_id: it.product_id,
            ordered_qty: Number(it.qty) || 0,
            fulfilled_before: 0,
            balance: Number(it.qty) || 0,
            this_qty: Number(it.qty) || 0,
            warehouse_id: it.warehouse_id,
            serial_numbers: it.serial_numbers || [],
            is_serialized: !!it.is_serialized,
          }));
        }
        // Cap check already done in validate, but double-guard
        for (let i = 0; i < linesForWriter.length; i++) {
          const fl: any = linesForWriter[i];
          if (Number(fl.this_qty) > Number(fl.balance)) throw new Error(`Line ${i + 1}: quantity ${fl.this_qty} exceeds balance ${fl.balance}`);
        }
        const r = await createGeneralDcFromSO(effectiveSoId, linesForWriter as any, {
          allow_negative_stock: allowNegative,
          returnable,
          expected_return_date: returnable ? (expectedReturn || undefined) : undefined,
          purpose: purpose || undefined,
          issueImmediately: status === "Issued",
        });
        if (allowNegative && short.length > 0) {
          try {
            await logNegativeOverrides({
              documentType: "dc",
              documentId: r.id,
              documentNo: r.dc_no,
              shortfalls: short,
              reason,
            });
          } catch (logErr) {
            console.error("Negative-stock override logging failed:", logErr);
            toast.error(`${r.dc_no} was saved, but recording the negative-stock approval failed (${(logErr as Error).message}).`);
          }
        }
        toast.success(`${r.dc_no} ${status === "Issued" ? "issued" : "saved as draft"} (Against SO)`);
        nav({ to: "/sales/general-dc/$id", params: { id: r.id } });
        return;
      } catch (e) {
        toast.error((e as Error).message || "Save failed");
        setSaving(false);
        return;
      } finally {
        setSaving(false);
      }
    }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const payload = {
        dc_date: dcDate,
        returnable,
        expected_return_date: returnable ? (expectedReturn || undefined) : undefined,
        customer_id: customer.id,
        customer_name: customer.company,
        billing_address: billing || null,
        shipping_address: shipping || null,
        purpose: purpose || null,
        branch_id: branchId || null,
        items,
        status,
        allow_negative_stock: allowNegative,
        notes: notes || null,
        terms: terms || null,
        created_by: existing?.created_by ?? u.user?.id ?? null,
        // preserve SO linkage if provided via props
        ...(sales_order_id ? { sales_order_id: sales_order_id as any } : {}),
        ...(conversion_id ? { conversion_id: conversion_id as any } : {}),
      };
      const row = existing
        ? await updateGeneralDc(existing.id, payload)
        : await insertGeneralDc(payload);
      if (allowNegative && short.length > 0) {
        try {
          await logNegativeOverrides({
            documentType: "dc",
            documentId: row.id,
            documentNo: row.dc_no,
            shortfalls: short,
            reason,
          });
        } catch (logErr) {
          // B-16: negative-stock overrides MUST leave an audit trail. The DC
          // itself is saved, so tell the user exactly what needs fixing.
          console.error("Negative-stock override logging failed:", logErr);
          toast.error(
            `${row.dc_no} was saved, but recording the negative-stock approval failed (${(logErr as Error).message}). Ask an admin to review this document.`,
          );
        }
      }
      toast.success(
        `${row.dc_no} ${status === "Issued" ? "issued" : isEdit ? "updated" : "saved as draft"}`,
      );
      nav({ to: "/sales/general-dc/$id", params: { id: row.id } });
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">
          {isEdit ? `Edit ${existing?.dc_no ?? "General DC"}` : "New General Delivery Challan"}
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={saving} onClick={() => save("Draft")}>
            <Save className="h-4 w-4 mr-1.5" />
            {isEdit ? "Save Changes" : "Save as Draft"}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => save("Issued")}>
            <Zap className="h-4 w-4 mr-1.5" />
            Issue
          </Button>
        </div>
      </div>

      {(soPrefill || (soPrefillProp as any)?.lines) && (
        <Card className="border-amber-200 bg-amber-50/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium">
              Against Sales Order{" "}
              {(soPrefill?.sales_order_id || (sales_order_id as string)) ? (
                <Link
                  to="/sales/orders/$id"
                  params={{ id: (soPrefill?.sales_order_id || sales_order_id) as string }}
                  className="font-mono underline decoration-dotted underline-offset-2 hover:text-amber-800"
                >
                  {soPrefill?.sales_order_no || (soPrefillProp as any)?.sales_order_no || (soPrefill?.sales_order_id || sales_order_id as string).slice(0, 8)}
                </Link>
              ) : (
                <span className="font-mono">{soPrefill?.sales_order_no || "—"}</span>
              )}
              {soPrefill?.po_number && <span className="font-mono text-xs ml-2">PO {soPrefill.po_number}</span>}
            </span>
            <span className="text-muted-foreground tabular-nums text-xs">
              Ordered <span className="font-semibold text-foreground">{soPrefill?.orderedTotal ?? (soPrefillProp as any)?.orderedTotal ?? "—"}</span>
              {" · "}Already <span className="font-semibold text-foreground">{soPrefill?.fulfilledTotal ?? (soPrefillProp as any)?.fulfilledTotal ?? "—"}</span>
              {" · "}Balance <span className="font-semibold text-amber-700">{soPrefill?.balanceTotal ?? (soPrefillProp as any)?.balanceTotal ?? "—"}</span>
              {" · "}This shipment <span className="font-semibold text-emerald-700">{items.reduce((s, it) => s + (Number(it.qty) || 0), 0)}</span>
            </span>
            <Badge variant="outline" className="bg-white text-amber-800 border-amber-200 text-[11px] ml-auto">SO-linked — qty capped at balance</Badge>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Header</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Dispatch Type *</Label>
            <div className="flex gap-4 h-9 items-center text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={!returnable} onChange={() => setReturnable(false)} />
                Non-Returnable
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={returnable} onChange={() => setReturnable(true)} />
                Returnable
              </label>
            </div>
          </div>
          <div>
            <Label className="text-xs">DC Date</Label>
            <Input type="date" value={dcDate} onChange={(e) => setDcDate(e.target.value)} />
          </div>
          {returnable && (
            <div>
              <Label className="text-xs">Expected Return Date</Label>
              <Input
                type="date"
                value={expectedReturn}
                onChange={(e) => setExpectedReturn(e.target.value)}
              />
            </div>
          )}
          <div>
            <Label className="text-xs">Branch (Seller)</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              <option value="">— select —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Customer *</Label>
            <CustomerPicker value={customer?.id} branchValue={branchOverride?.id} onChange={(_id, c, branch) => { setCustomer(c); setBranchOverride(branch || null); }} branched />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Purpose of Dispatch</Label>
            <Input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Demo unit at customer site"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Billing Address</Label>
            <Textarea rows={2} value={billing} onChange={(e) => setBilling(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Shipping Address</Label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={sameAsBilling}
                  onChange={(e) => setSameAsBilling(e.target.checked)}
                />
                Same as Billing Address
              </label>
            </div>
            <Textarea
              rows={2}
              value={shipping}
              disabled={sameAsBilling}
              onChange={(e) => setShipping(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Items</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setItems((a) => [...a, emptyGeneralDcItem()])}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add row
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-2 text-left w-8">#</th>
                  <th className="p-2 text-left min-w-[240px]">Product</th>
                  <th className="p-2 text-left w-40">Warehouse *</th>
                  <th className="p-2 text-right w-20">Qty</th>
                  <th className="p-2 text-left w-20">UOM</th>
                  <th className="p-2 text-right w-28">Unit Price</th>
                  <th className="p-2 text-right w-28">Amount</th>
                  <th className="p-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t align-top">
                    <td className="p-2 text-xs">{idx + 1}</td>
                    <td className="p-2 space-y-1">
                      <ProductMasterPicker
                        value={it.product_id}
                        excludeServices
                        onPick={(p) =>
                          setItem(idx, {
                            product_id: p.id,
                            part_name: productShortName(p),
                            model_no: p.model,
                            hsn: p.hsn || null,
                            uom: p.unit || "Nos",
                            unit_price: p.default_price != null ? Number(p.default_price) : 0,
                            is_serialized: !!(p as any).is_serialized,
                            serial_numbers: [],
                          })
                        }
                      />
                      {it.is_serialized && (
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant={
                              it.serial_numbers.length === Math.floor(Number(it.qty))
                                ? "outline"
                                : "secondary"
                            }
                            className="h-7 text-xs"
                            disabled={!it.warehouse_id || Number(it.qty) <= 0}
                            onClick={() => setSerialIdx(idx)}
                          >
                            Serials: {it.serial_numbers.length}/{Math.floor(Number(it.qty)) || 0}
                          </Button>
                          {it.serial_numbers.length > 0 && (
                            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[220px]">
                              {it.serial_numbers.join(", ")}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      <select
                        className="w-full h-8 rounded-md border bg-background px-1 text-xs"
                        value={it.warehouse_id || ""}
                        onChange={(e) =>
                          setItem(idx, { warehouse_id: e.target.value || null, serial_numbers: [] })
                        }
                      >
                        <option value="">— select —</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        step="1"
                        className="h-8 text-xs text-right"
                        value={it.qty}
                        max={(soPrefill?.lines as any[])?.[idx]?.balance ?? (soPrefillProp as any)?.lines?.[idx]?.balance ?? undefined}
                        onChange={(e) => {
                          const raw = Number(e.target.value);
                          const bal = (soPrefill?.lines as any[])?.[idx]?.balance ?? (soPrefillProp as any)?.lines?.[idx]?.balance;
                          if (bal != null && raw > Number(bal)) {
                            toast.error(`Line ${idx + 1}: quantity ${raw} exceeds balance ${bal}`);
                            setItem(idx, { qty: Number(bal) });
                            return;
                          }
                          setItem(idx, { qty: raw });
                        }}
                      />
                      {(soPrefill?.lines as any[])?.[idx] || (soPrefillProp as any)?.lines?.[idx] ? (
                        <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5 leading-none">
                          Ordered {((soPrefill?.lines as any[])?.[idx] ?? (soPrefillProp as any)?.lines?.[idx])?.ordered_qty ?? "?"} · Already {((soPrefill?.lines as any[])?.[idx] ?? (soPrefillProp as any)?.lines?.[idx])?.fulfilled_before ?? 0} · Bal {((soPrefill?.lines as any[])?.[idx] ?? (soPrefillProp as any)?.lines?.[idx])?.balance ?? "?"}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-2">
                      <Input
                        className="h-8 text-xs"
                        value={it.uom}
                        onChange={(e) => setItem(idx, { uom: e.target.value })}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        step="0.01"
                        className="h-8 text-xs text-right"
                        value={it.unit_price}
                        onChange={(e) => setItem(idx, { unit_price: Number(e.target.value) })}
                      />
                    </td>
                    <td className="p-2 text-right font-medium">
                      {inr((Number(it.qty) || 0) * (Number(it.unit_price) || 0))}
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setItems((a) => a.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end border-t p-3 text-sm font-semibold">
            Total Value: <span className="ml-2">{inr(total)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Notes &amp; Terms</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Terms</Label>
            <Textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {serialIdx !== null && items[serialIdx] && (
        <SerialMultiPicker
          open={serialIdx !== null}
          onOpenChange={(v) => !v && setSerialIdx(null)}
          qty={Math.floor(Number(items[serialIdx].qty)) || 0}
          warehouseId={items[serialIdx].warehouse_id}
          partModelNo={items[serialIdx].model_no}
          partName={items[serialIdx].part_name}
          value={items[serialIdx].serial_numbers}
          excludeSerials={items.flatMap((it, i) => (i === serialIdx ? [] : it.serial_numbers))}
          onConfirm={(sns) => setItem(serialIdx, { serial_numbers: sns })}
        />
      )}

      <NegativeStockDialog
        open={negOpen}
        onOpenChange={setNegOpen}
        shortfalls={shortfalls}
        onProceed={async (reason) => {
          setNegOpen(false);
          await doSave("Issued", true, shortfalls, reason || null);
        }}
      />
    </div>
  );
}
