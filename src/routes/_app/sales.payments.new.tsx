import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerPicker } from "@/components/CustomerPicker";
import type { Customer } from "@/lib/crm";
import { PAYMENT_MODES, inr, type InvoiceRow, type PaymentMode } from "@/lib/sales";

type Search = { invoice_id?: string };

export const Route = createFileRoute("/_app/sales/payments/new")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    invoice_id: typeof s.invoice_id === "string" ? s.invoice_id : undefined,
  }),
  component: NewPayment,
  head: () => ({ meta: [{ title: "Record Payment — Prokon" }] }),
});

function NewPayment() {
  const nav = useNavigate();
  const { invoice_id } = useSearch({ from: "/_app/sales/payments/new" });

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<PaymentMode>("bank");
  const [amount, setAmount] = useState(0);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (invoice_id) {
      supabase.from("invoices").select("*, customer:customers(*)").eq("id", invoice_id).maybeSingle().then(({ data }) => {
        if (!data) return;
        setCustomer((data as any).customer);
        const due = Math.max(0, Number((data as any).total) - Number((data as any).total_paid));
        setAmount(due);
      });
    }
  }, [invoice_id]);

  useEffect(() => {
    if (!customer) { setInvoices([]); return; }
    supabase
      .from("invoices")
      .select("*")
      .eq("customer_id", customer.id)
      .in("status", ["issued", "partial"])
      .order("invoice_date", { ascending: true })
      .then(({ data }) => {
        const list = ((data ?? []) as unknown as InvoiceRow[]);
        setInvoices(list);
        if (invoice_id) {
          const inv = list.find((x) => x.id === invoice_id);
          if (inv) {
            const due = Math.max(0, Number(inv.total) - Number(inv.total_paid));
            setAlloc({ [inv.id]: due });
          }
        }
      });
  }, [customer?.id, invoice_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalAllocated = useMemo(() => Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0), [alloc]);

  function autoAllocate() {
    let remaining = Number(amount) || 0;
    const next: Record<string, number> = {};
    for (const inv of invoices) {
      const due = Math.max(0, Number(inv.total) - Number(inv.total_paid));
      const take = Math.min(due, remaining);
      if (take > 0) next[inv.id] = Math.round(take * 100) / 100;
      remaining -= take;
      if (remaining <= 0) break;
    }
    setAlloc(next);
  }

  async function save() {
    if (!customer) return toast.error("Select a customer");
    if (!(amount > 0)) return toast.error("Amount must be > 0");
    if (totalAllocated > amount + 0.01) return toast.error("Allocated more than payment amount");
    setSaving(true);
    try {
      const { data: pay, error } = await supabase.from("payments_received").insert({
        payment_date: date,
        customer_id: customer.id,
        mode,
        reference,
        amount,
        unallocated: amount,
        notes,
      }).select("id, payment_no").single();
      if (error) throw error;
      const allocs = Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([iid, amt]) => ({
        payment_id: pay.id, invoice_id: iid, amount: Number(amt),
      }));
      if (allocs.length) {
        const { error: e2 } = await supabase.from("payment_allocations").insert(allocs);
        if (e2) throw e2;
      }
      toast.success(`Payment ${pay.payment_no} recorded`);
      nav({ to: "/sales/payments" });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-2xl font-bold">Record Payment</h1>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Payment Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs">Customer *</Label>
            <CustomerPicker value={customer?.id} onChange={(_id, c) => setCustomer(c)} />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm uppercase" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Amount *</Label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Reference (UTR / Cheque #)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs">Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Allocate to Invoices</CardTitle>
          <Button size="sm" variant="outline" onClick={autoAllocate}>Auto-allocate</Button>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Invoice #</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Paid</th>
                <th className="p-2 text-right">Due</th>
                <th className="p-2 text-right w-32">Allocate</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No open invoices for this customer.</td></tr>
              ) : invoices.map((inv) => {
                const due = Math.max(0, Number(inv.total) - Number(inv.total_paid));
                return (
                  <tr key={inv.id} className="border-t">
                    <td className="p-2 font-mono text-xs">{inv.invoice_no}</td>
                    <td className="p-2">{inv.invoice_date}</td>
                    <td className="p-2 text-right">{inr(inv.total)}</td>
                    <td className="p-2 text-right">{inr(inv.total_paid)}</td>
                    <td className="p-2 text-right text-amber-700">{inr(due)}</td>
                    <td className="p-2 text-right">
                      <Input type="number" step="0.01" className="h-8 text-right text-xs" value={alloc[inv.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [inv.id]: Number(e.target.value) })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted/50 text-sm">
              <tr>
                <td colSpan={5} className="p-2 text-right font-medium">Allocated</td>
                <td className={"p-2 text-right font-bold " + (totalAllocated > amount + 0.01 ? "text-destructive" : "text-emerald-700")}>{inr(totalAllocated)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="p-2 text-right font-medium">Payment Amount</td>
                <td className="p-2 text-right font-bold">{inr(amount)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="p-2 text-right font-medium">Unallocated</td>
                <td className={"p-2 text-right font-bold " + (amount - totalAllocated > 0 ? "text-amber-700" : "text-muted-foreground")}>{inr(Math.max(0, amount - totalAllocated))}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving}>Save Payment</Button>
      </div>
    </div>
  );
}