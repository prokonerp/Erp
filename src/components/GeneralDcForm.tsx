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
import type { Customer } from "@/lib/crm";
import { fetchBranches, inr, type BranchRow } from "@/lib/sales";
import { productShortName } from "@/lib/productNames";
import { istTodayIso } from "@/lib/dateRange";
import { useIsAdmin } from "@/lib/useRole";
import { findShortfalls, logNegativeOverrides, blockMessage, type Shortfall } from "@/lib/negativeStock";
import { emptyGeneralDcItem, gdcTotal, insertGeneralDc, updateGeneralDc, type GeneralDcItem, type GeneralDcRow } from "@/lib/generalDc";

export function GeneralDcForm({ existing }: { existing?: GeneralDcRow }) {
  const isEdit = !!existing;
  const nav = useNavigate();
  const { isAdmin } = useIsAdmin();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState(existing?.branch_id ?? "");
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
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
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);
  const [negOpen, setNegOpen] = useState(false);

  useEffect(() => {
    fetchBranches()
      .then((bs) => {
        setBranches(bs);
        if (existing?.branch_id) return;
        const def = bs.find((b) => b.is_default) || bs[0];
        if (def) setBranchId(def.id);
      })
      .catch((e) => toast.error(e.message));
    supabase.from("warehouses").select("id,name").eq("status", "Active").order("name")
      .then(({ data }) => setWarehouses((data ?? []) as { id: string; name: string }[]));
  }, []);

  const skipAddrSync = useRef(isEdit);

  // Sweep fix (B-08 class): an Issued GDC has already consumed stock, and
  // Cancelled/Converted are terminal — editing their items would silently
  // desync inventory. The DB guards status transitions; this guards edits.
  useEffect(() => {
    const st = existing?.status;
    if (st && ["Issued", "Cancelled", "Converted"].includes(st)) {
      toast.error(`This General DC is ${st} — stock is already posted. Editing is blocked.`);
      nav({ to: "/sales/general-dc/$id", params: { id: existing!.id } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!existing?.customer_id) return;
    supabase.from("customers").select("*").eq("id", existing.customer_id).maybeSingle()
      .then(({ data }) => { if (data) setCustomer(data as unknown as Customer); });
  }, [existing?.customer_id]);

  useEffect(() => {
    if (!customer) return;
    if (skipAddrSync.current) { skipAddrSync.current = false; return; }
    const bill = customer.billing_address || (customer as unknown as { address?: string }).address || "";
    const ship = (customer as unknown as { shipping_address?: string }).shipping_address || bill;
    setBilling(bill);
    setShipping(ship);
    setSameAsBilling(!ship || ship === bill);
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sameAsBilling) setShipping(billing);
  }, [sameAsBilling, billing]);

  const total = useMemo(() => gdcTotal(items), [items]);
  const wname = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? null;

  function setItem(idx: number, patch: Partial<GeneralDcItem>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function validate(): string | null {
    if (!customer) return "Choose a customer";
    if (items.length === 0) return "Add at least one item";
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
  }

  async function doSave(
    status: "Draft" | "Issued",
    allowNegative: boolean,
    short: Shortfall[],
    reason: string | null,
  ) {
    if (!customer) return;
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const payload = {
        dc_date: dcDate,
        returnable,
        expected_return_date: returnable ? (expectedReturn || null) : null,
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
      toast.success(`${row.dc_no} ${status === "Issued" ? "issued" : isEdit ? "updated" : "saved as draft"}`);
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
        <h1 className="text-2xl font-bold">{isEdit ? `Edit ${existing?.dc_no ?? "General DC"}` : "New General Delivery Challan"}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={saving} onClick={() => save("Draft")}>
            <Save className="h-4 w-4 mr-1.5" />{isEdit ? "Save Changes" : "Save as Draft"}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => save("Issued")}>
            <Zap className="h-4 w-4 mr-1.5" />Issue
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Header</CardTitle></CardHeader>
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
              <Input type="date" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
            </div>
          )}
          <div>
            <Label className="text-xs">Branch (Seller)</Label>
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">— select —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Customer *</Label>
            <CustomerPicker value={customer?.id} onChange={(_id, c) => setCustomer(c)} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Purpose of Dispatch</Label>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Demo unit at customer site" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Billing Address</Label>
            <Textarea rows={2} value={billing} onChange={(e) => setBilling(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Shipping Address</Label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={sameAsBilling} onChange={(e) => setSameAsBilling(e.target.checked)} />
                Same as Billing Address
              </label>
            </div>
            <Textarea rows={2} value={shipping} disabled={sameAsBilling} onChange={(e) => setShipping(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Items</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setItems((a) => [...a, emptyGeneralDcItem()])}>
            <Plus className="h-4 w-4 mr-1" />Add row
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
                            is_serialized: !!p.serial_tracking,
                            serial_numbers: [],
                          })
                        }
                      />
                      {it.is_serialized && (
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant={it.serial_numbers.length === Math.floor(Number(it.qty)) ? "outline" : "secondary"}
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
                        onChange={(e) => setItem(idx, { warehouse_id: e.target.value || null, serial_numbers: [] })}
                      >
                        <option value="">— select —</option>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <Input type="number" step="1" className="h-8 text-xs text-right" value={it.qty}
                        onChange={(e) => setItem(idx, { qty: Number(e.target.value) })} />
                    </td>
                    <td className="p-2">
                      <Input className="h-8 text-xs" value={it.uom} onChange={(e) => setItem(idx, { uom: e.target.value })} />
                    </td>
                    <td className="p-2">
                      <Input type="number" step="0.01" className="h-8 text-xs text-right" value={it.unit_price}
                        onChange={(e) => setItem(idx, { unit_price: Number(e.target.value) })} />
                    </td>
                    <td className="p-2 text-right font-medium">{inr((Number(it.qty) || 0) * (Number(it.unit_price) || 0))}</td>
                    <td className="p-2 text-right">
                      <Button size="icon" variant="ghost" onClick={() => setItems((a) => a.filter((_, i) => i !== idx))}>
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
        <CardHeader className="pb-2"><CardTitle className="text-base">Notes &amp; Terms</CardTitle></CardHeader>
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