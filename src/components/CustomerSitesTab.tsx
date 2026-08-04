import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchCustomerSites, type CustomerSite } from "@/lib/customerSites";

/**
 * Simple site list (name + address) for a customer, mirroring the Contacts tab pattern.
 * Rows are persisted immediately, so it needs a saved customer.
 */
export function CustomerSitesTab({ customerId, onChanged }: { customerId?: string | null; onChanged?: () => void }) {
  const [rows, setRows] = useState<CustomerSite[]>([]);
  const [draft, setDraft] = useState<{ site_name: string; address: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!customerId) return;
    try { setRows(await fetchCustomerSites(customerId)); } catch (e: any) { toast.error(e.message); }
  };
  useEffect(() => { load(); }, [customerId]);

  if (!customerId) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8 border rounded bg-muted/20">
        Save the customer first, then add sites (e.g. "Gurgaon Plant") here.
      </div>
    );
  }

  async function addSite() {
    if (!draft?.site_name.trim()) return toast.error("Site name is required");
    setBusy(true);
    const { error } = await supabase.from("customer_sites").insert({
      customer_id: customerId, site_name: draft.site_name.trim(), address: draft.address.trim() || null,
    } as any);
    setBusy(false);
    if (error) return toast.error(error.message);
    setDraft(null); load(); onChanged?.();
  }

  async function updateSite(id: string, patch: Partial<CustomerSite>) {
    setRows((r) => r.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function persist(s: CustomerSite) {
    const { error } = await supabase.from("customer_sites")
      .update({ site_name: s.site_name.trim(), address: s.address?.trim() || null } as any).eq("id", s.id);
    if (error) return toast.error(error.message);
    onChanged?.();
  }

  async function removeSite(id: string) {
    if (!confirm("Remove this site? Equipment linked to it will move to General / Unspecified.")) return;
    const { error } = await supabase.from("customer_sites").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Site removed"); load(); onChanged?.();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Locations where this customer's equipment is installed.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft({ site_name: "", address: "" })}>
          <Plus className="h-4 w-4 mr-1" />Add Site
        </Button>
      </div>

      {draft && (
        <div className="border rounded p-3 space-y-2 bg-muted/20">
          <Input placeholder="Site name * (e.g. Gurgaon Plant)" value={draft.site_name}
            onChange={(e) => setDraft({ ...draft, site_name: e.target.value })} />
          <Textarea placeholder="Address" rows={2} value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button type="button" size="sm" disabled={busy} onClick={addSite}>Save Site</Button>
          </div>
        </div>
      )}

      {rows.length === 0 && !draft && (
        <div className="text-center text-sm text-muted-foreground py-8 border rounded bg-muted/20">
          No sites yet. Equipment without a site shows under "General / Unspecified".
        </div>
      )}

      {rows.map((s) => (
        <div key={s.id} className="border rounded p-3 space-y-2 bg-muted/20">
          <div className="flex items-center gap-2">
            <Input value={s.site_name} onChange={(e) => updateSite(s.id, { site_name: e.target.value })} onBlur={() => persist(s)} />
            <Button type="button" size="icon" variant="ghost" onClick={() => removeSite(s.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
          <Textarea rows={2} placeholder="Address" value={s.address || ""}
            onChange={(e) => updateSite(s.id, { address: e.target.value })} onBlur={() => persist(s)} />
        </div>
      ))}
    </div>
  );
}
