import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";

export type BranchOption = {
  id: string;
  company_id: string | null;
  name: string;
  code: string | null;
  address: string | null;
  city: string | null;
  state_name: string | null;
  state_code: string | null;
  pin_code: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  company?: { id: string; name: string; gstin: string | null; email: string | null; phone: string | null; address: string | null } | null;
};

interface Props {
  value: string | null | undefined;
  onChange: (id: string | null, branch: BranchOption | null) => void;
  required?: boolean;
  label?: string;
  disabled?: boolean;
}

export function BranchPicker({ value, onChange, required, label = "Prokon Branch", disabled }: Props) {
  const [branches, setBranches] = useState<BranchOption[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("branches")
        .select("id, company_id, name, code, address, city, state_name, state_code, pin_code, gstin, phone, email, active, company:companies(id,name,gstin,email,phone,address)")
        .order("name", { ascending: true });
      setBranches((data as any) ?? []);
    })();
  }, []);

  const activeBranches = branches.filter((b) => b.active !== false || b.id === value);

  return (
    <div>
      <Label className="text-xs">{label}{required && " *"}</Label>
      <select
        className="w-full h-9 rounded-md border bg-background px-2 text-sm"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => {
          const id = e.target.value || null;
          const b = branches.find((x) => x.id === id) ?? null;
          onChange(id, b);
        }}
      >
        <option value="">— Select Branch —</option>
        {activeBranches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.company?.name ? `${b.company.name} — ${b.name}` : b.name}
            {b.city ? ` (${b.city})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Fetch a single branch with company details for header rendering. */
export async function fetchBranchWithCompany(branchId: string | null | undefined): Promise<BranchOption | null> {
  if (!branchId) return null;
  const { data } = await supabase
    .from("branches")
    .select("id, company_id, name, code, address, city, state_name, state_code, pin_code, gstin, phone, email, active, company:companies(id,name,gstin,email,phone,address)")
    .eq("id", branchId)
    .maybeSingle();
  return (data as any) ?? null;
}

/** Merge branch header into a legacy company-like shape for PDF renderers. */
export function branchHeader(b: BranchOption | null | undefined) {
  if (!b) return null;
  const addr = [b.address, b.city, b.state_name, b.pin_code].filter(Boolean).join(", ");
  return {
    name: b.company?.name ?? b.name,
    branch_name: b.name,
    address: addr || b.company?.address || null,
    gstin: b.gstin ?? b.company?.gstin ?? null,
    phone: b.phone ?? b.company?.phone ?? null,
    email: b.email ?? b.company?.email ?? null,
    state_name: b.state_name,
    state_code: b.state_code,
    pin_code: b.pin_code,
  };
}