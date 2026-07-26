import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_COMPANY_PROFILE,
  fetchCompanyProfile,
  saveCompanyProfile,
  type CompanyProfile,
} from "@/lib/companyProfile";

type Props = { canEdit: boolean };

export function CompanyProfileSettings({ canEdit }: Props) {
  const [p, setP] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchCompanyProfile().then(setP).catch(() => {}); }, []);

  const set = <K extends keyof CompanyProfile>(k: K, v: CompanyProfile[K]) =>
    setP((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await saveCompanyProfile({
        name: p.name,
        regd_address: p.regd_address,
        factory_address: p.factory_address,
        gstin: p.gstin,
        phone: p.phone,
        email: p.email,
        website: p.website,
        logo_url: p.logo_url,
        sales_office_address: p.sales_office_address,
        registered_office_address: p.registered_office_address,
        accent_color: p.accent_color,
        bank_name: p.bank_name,
        bank_account_name: p.bank_account_name,
        bank_account_number: p.bank_account_number,
        bank_ifsc: p.bank_ifsc,
        bank_branch: p.bank_branch,
      });
      toast.success("Company letterhead updated. Prints will use the new details.");
      const fresh = await fetchCompanyProfile();
      setP(fresh);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" /> Letterhead & Print Details
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Used on Delivery Challans, GRNs and printed PDFs. Only admins can edit.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-1">
            <Label>Company Name</Label>
            <Input value={p.name} disabled={!canEdit} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label>Registered Office Address</Label>
            <Textarea rows={2} value={p.regd_address} disabled={!canEdit}
              onChange={(e) => set("regd_address", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label>Sales Office Address <span className="text-muted-foreground text-xs">(optional — shown on document header)</span></Label>
            <Textarea rows={2} value={p.sales_office_address ?? ""} disabled={!canEdit}
              onChange={(e) => set("sales_office_address", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label>Factory Address</Label>
            <Textarea rows={2} value={p.factory_address ?? ""} disabled={!canEdit}
              onChange={(e) => set("factory_address", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>GSTIN</Label>
            <Input value={p.gstin ?? ""} disabled={!canEdit} onChange={(e) => set("gstin", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Phone</Label>
            <Input value={p.phone ?? ""} disabled={!canEdit} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input value={p.email ?? ""} disabled={!canEdit} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Website</Label>
            <Input value={p.website ?? ""} disabled={!canEdit} onChange={(e) => set("website", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label>Logo URL (optional override)</Label>
            <Input value={p.logo_url ?? ""} disabled={!canEdit}
              placeholder="Leave blank to use the default Prokon logo"
              onChange={(e) => set("logo_url", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Document Accent Color</Label>
            <div className="flex items-center gap-2">
              <Input type="color" className="h-9 w-14 p-1"
                value={p.accent_color ?? "#1f3864"} disabled={!canEdit}
                onChange={(e) => set("accent_color", e.target.value)} />
              <Input value={p.accent_color ?? "#1f3864"} disabled={!canEdit}
                onChange={(e) => set("accent_color", e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Used for header bars on printed Quotation & Purchase Order.</p>
          </div>
        </div>

        <div className="pt-3 border-t">
          <div className="text-sm font-semibold mb-2">Bank Details <span className="text-muted-foreground font-normal text-xs">(printed on Quotation & PO)</span></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Bank Name</Label>
              <Input value={p.bank_name ?? ""} disabled={!canEdit}
                onChange={(e) => set("bank_name", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Account Name</Label>
              <Input value={p.bank_account_name ?? ""} disabled={!canEdit}
                onChange={(e) => set("bank_account_name", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Account Number</Label>
              <Input value={p.bank_account_number ?? ""} disabled={!canEdit}
                onChange={(e) => set("bank_account_number", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>IFSC Code</Label>
              <Input value={p.bank_ifsc ?? ""} disabled={!canEdit}
                onChange={(e) => set("bank_ifsc", e.target.value)} />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label>Branch</Label>
              <Input value={p.bank_branch ?? ""} disabled={!canEdit}
                onChange={(e) => set("bank_branch", e.target.value)} />
            </div>
          </div>
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save Letterhead"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}