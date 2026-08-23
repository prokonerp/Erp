import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { istTodayIso } from "@/lib/dateRange";
import { ProductPicker } from "@/components/ProductPicker";
import { FormShell, FormSection, FormGrid, FormField, StickyMobileActions } from "@/components/form-kit";
import { BranchPicker } from "@/components/BranchPicker";
import { useEffect } from "react";
import { getCurrentUserName } from "@/lib/currentUser";

type Item = { product_id: string; product: string; serial_no: string; quantity: string; unit: string; remarks: string };

const empty = (): Item => ({ product_id: "", product: "", serial_no: "", quantity: "1", unit: "Nos", remarks: "" });

export function GatepassNewForm() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([empty()]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [form, setForm] = useState({
    person_name: "", person_company: "", contact_no: "", vehicle_no: "",
    destination: "", purpose: "", return_type: "Non-Returnable",
    prepared_by: "", authorised_by: "", remarks: "",
    gatepass_date: istTodayIso(),
    gatepass_time: new Date().toTimeString().slice(0, 5),
  });
  const [busy, setBusy] = useState(false);

  // Auto-populate Prepared By with the current logged-in user's name.
  useEffect(() => {
    (async () => {
      const name = await getCurrentUserName();
      if (!name) return;
      setForm((f) => (f.prepared_by ? f : { ...f, prepared_by: name }));
    })();
  }, []);

  const updateItem = (i: number, patch: Partial<Item>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const submit = async () => {
    if (!branchId) return toast.error("Please select a Prokon Branch");
    if (!form.person_name.trim()) return toast.error("Person name is required");
    const cleanItems = items.filter((it) => it.product.trim());
    if (cleanItems.length === 0) return toast.error("Select at least one product from Product Master");
    if (cleanItems.some((it) => !it.product_id)) return toast.error("Each item must be picked from Product Master");
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const cased = {
      ...form,
      person_name: toTitleCaseSmart(form.person_name),
      person_company: toTitleCaseSmart(form.person_company),
      destination: toTitleCaseSmart(form.destination),
      purpose: toTitleCaseSmart(form.purpose),
      prepared_by: toTitleCaseSmart(form.prepared_by),
      authorised_by: toTitleCaseSmart(form.authorised_by),
      vehicle_no: upperTrim(form.vehicle_no),
      remarks: titleCaseAddress(form.remarks),
    };
    const { data, error } = await supabase.from("gatepasses").insert({
      ...cased,
      challan_no: "", // trigger fills it
      branch_id: branchId,
      items: cleanItems.map((it) => ({
        ...it,
        product: toTitleCaseSmart(it.product),
        serial_no: upperTrim(it.serial_no),
        remarks: toTitleCaseSmart(it.remarks),
      })),
      created_by: userData.user?.id ?? null,
    } as never).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Gatepass created");
    navigate({ to: "/gatepass/$id", params: { id: (data as { id: string }).id } });
  };

  return (
    <FormShell
      title="New Gatepass"
      description="Record material movement out of the premises."
      actions={
        <Button type="button" size="sm" onClick={submit} disabled={busy} className="gap-1.5">
          <Save className="h-4 w-4" />
          <span className="hidden sm:inline">Save &amp; Print</span>
          <span className="sm:hidden">Save</span>
        </Button>
      }
    >
      <FormSection title="Gatepass Details" defaultOpen>
        <FormGrid>
          <FormField size="md" label="Prokon Branch" required>
            <BranchPicker value={branchId} onChange={(id) => setBranchId(id)} required label="" />
          </FormField>
          <FormField size="sm" label="Date">
            <Input type="date" value={form.gatepass_date} onChange={(e) => setForm({ ...form, gatepass_date: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Time">
            <Input type="time" value={form.gatepass_time} onChange={(e) => setForm({ ...form, gatepass_time: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Type">
            <Select value={form.return_type} onValueChange={(v) => setForm({ ...form, return_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Returnable">Returnable</SelectItem>
                <SelectItem value="Non-Returnable">Non-Returnable</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField size="sm" label="Vehicle No.">
            <Input value={form.vehicle_no} onChange={(e) => setForm({ ...form, vehicle_no: e.target.value })} />
          </FormField>
          <FormField size="md" label="Person Taking Material" required>
            <Input value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
          </FormField>
          <FormField size="md" label="Company / Department">
            <Input value={form.person_company} onChange={(e) => setForm({ ...form, person_company: e.target.value })} />
          </FormField>
          <FormField size="md" label="Contact No.">
            <Input value={form.contact_no} onChange={(e) => setForm({ ...form, contact_no: e.target.value })} />
          </FormField>
          <FormField size="md" label="Destination">
            <Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} />
          </FormField>
          <FormField size="full" label="Purpose">
            <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection
        title="Items"
        description={`${items.length} row(s)`}
        defaultOpen
        right={
          <Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, empty()])} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Row
          </Button>
        }
      >
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="w-full text-sm border-separate border-spacing-0 min-w-[720px]">
            <thead className="sticky top-0 z-10 bg-muted/60">
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 w-10">#</th>
                <th className="px-2 py-1.5 min-w-[220px]">Product</th>
                <th className="px-2 py-1.5">Serial No.</th>
                <th className="px-2 py-1.5 w-20">Qty</th>
                <th className="px-2 py-1.5 w-20">Unit</th>
                <th className="px-2 py-1.5 min-w-[160px]">Remarks</th>
                <th className="px-2 py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="align-top">
                  <td className="px-2 py-1.5 text-center text-xs text-muted-foreground border-t border-border/60">{i + 1}</td>
                  <td className="px-2 py-1.5 border-t border-border/60">
                    <ProductPicker
                      value={it.product_id}
                      required
                      onChange={(id, p) => updateItem(i, {
                        product_id: id || "",
                        product: p?.name || "",
                        unit: p?.unit || it.unit || "Nos",
                      })}
                    />
                  </td>
                  <td className="px-2 py-1.5 border-t border-border/60"><Input value={it.serial_no} onChange={(e) => updateItem(i, { serial_no: e.target.value })} /></td>
                  <td className="px-2 py-1.5 border-t border-border/60"><Input type="number" min="1" value={it.quantity} onChange={(e) => updateItem(i, { quantity: e.target.value })} /></td>
                  <td className="px-2 py-1.5 border-t border-border/60"><Input value={it.unit} onChange={(e) => updateItem(i, { unit: e.target.value })} /></td>
                  <td className="px-2 py-1.5 border-t border-border/60"><Input value={it.remarks} onChange={(e) => updateItem(i, { remarks: e.target.value })} /></td>
                  <td className="px-2 py-1.5 border-t border-border/60 text-right">
                    <Button type="button" size="icon" variant="ghost" onClick={() => setItems(items.filter((_, idx) => idx !== i))} disabled={items.length === 1} aria-label="Remove row">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FormSection>

      <FormSection title="Approvals & Notes">
        <FormGrid>
          <FormField size="md" label="Prepared By">
            <Input value={form.prepared_by} onChange={(e) => setForm({ ...form, prepared_by: e.target.value })} />
          </FormField>
          <FormField size="md" label="Authorised By">
            <Input value={form.authorised_by} onChange={(e) => setForm({ ...form, authorised_by: e.target.value })} />
          </FormField>
          <FormField size="full" label="Remarks">
            <Textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2} />
          </FormField>
        </FormGrid>
      </FormSection>

      <StickyMobileActions>
        <Button type="button" size="sm" onClick={submit} disabled={busy} className="flex-1 gap-1.5">
          <Save className="h-4 w-4" /> Save &amp; Print
        </Button>
      </StickyMobileActions>
    </FormShell>
  );
}
