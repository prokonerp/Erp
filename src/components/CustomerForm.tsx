import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, Trash2, Check, ChevronsUpDown, Save, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCustomerBranches, masterKeys } from "@/hooks/useMasters";
import { type Customer, type CustomerBranch, type CustomerBranchInput, type AddressBlockInput, saveCustomerBranch, deleteCustomerBranch, customerBranchAddress, validateCustomerBranch } from "@/lib/crm";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { INDIAN_STATES, isValidGSTIN, stateFromGSTIN } from "@/lib/india";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { cn } from "@/lib/utils";

export const GST_TREATMENTS = ["Regular", "Composition", "Unregistered", "Consumer"] as const;
export type GstTreatment = typeof GST_TREATMENTS[number];

export const SALUTATIONS = ["Mr.", "Ms.", "Mrs.", "Dr.", "Mx."] as const;
export const COUNTRIES = ["India", "United States", "United Kingdom", "United Arab Emirates", "Singapore", "Australia", "Canada", "Germany", "France", "Nepal", "Bangladesh", "Sri Lanka", "Other"];
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUrpValue(v: string | null | undefined): boolean {
  return (v || "").trim().toUpperCase() === "URP";
}

export type CustomerType = "Business" | "Individual";

export type AddressBlock = {
  line1: string; line2: string; landmark: string; city: string; state: string; country: string; pincode: string;
};
export const emptyAddr: AddressBlock = { line1: "", line2: "", landmark: "", city: "", state: "", country: "India", pincode: "" };

export type ContactRow = {
  salutation: string; first_name: string; last_name: string; designation: string; department: string; email: string; area_code: string; phone: string;
};
export const emptyContact: ContactRow = { salutation: "Mr.", first_name: "", last_name: "", designation: "", department: "", email: "", area_code: "+91", phone: "" };

export type CustomerFormState = {
  customer_type: CustomerType;
  salutation: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  area_code: string;
  phone: string;
  gst: string;
  gst_status: GstTreatment;
  pan: string;
  billing: AddressBlock;
  shipping: AddressBlock;
  same_as_billing: boolean;
  place_of_supply: string;
  contacts: ContactRow[];
  sector: string;
  remarks: string;
};

export const emptyCustomerForm: CustomerFormState = {
  customer_type: "Business",
  salutation: "Mr.",
  first_name: "", last_name: "",
  company: "", email: "", area_code: "+91", phone: "",
  gst: "", gst_status: "Unregistered", pan: "",
  billing: { ...emptyAddr },
  shipping: { ...emptyAddr },
  same_as_billing: true,
  place_of_supply: "",
  contacts: [],
  sector: "",
  remarks: "",
};

export function panFromGstin(gst: string): string {
  const up = (gst || "").toUpperCase().trim();
  if (up.length < 12) return "";
  return up.slice(2, 12);
}

export function joinAddress(a: AddressBlock): string {
  return [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, a.country]
    .map((s) => (s || "").trim()).filter(Boolean).join(", ");
}

export function isValidPhone(p: string): boolean {
  return /^\d{10}$/.test((p || "").trim());
}

/** Map an existing Customer row into editable form state. */
export function customerToForm(c: Customer): CustomerFormState {
  const any = c as any;
  const billing: AddressBlock = {
    line1: any.billing_line1 || c.billing_address || c.address || "",
    line2: any.billing_line2 || "",
    landmark: any.billing_landmark || any.street || "",
    city: any.billing_city || any.city || "",
    state: any.billing_state || c.state || "",
    country: any.billing_country || any.country || "India",
    pincode: any.billing_pincode || "",
  };
  const shipping: AddressBlock = {
    line1: any.shipping_line1 || c.shipping_address || "",
    line2: any.shipping_line2 || "",
    landmark: any.shipping_landmark || "",
    city: any.shipping_city || "",
    state: any.shipping_state || "",
    country: any.shipping_country || "India",
    pincode: any.shipping_pincode || "",
  };
  const sameAsBilling = !any.shipping_line1 && (!c.shipping_address || c.shipping_address === (c.billing_address || c.address || ""));
  const rawGst = c.gst || "";
  const isLegacyUrp = isUrpValue(rawGst);
  let inferredStatus: GstTreatment = (any.gst_status as GstTreatment) || (rawGst && !isLegacyUrp ? "Regular" : "Unregistered");
  if (isLegacyUrp) inferredStatus = "Unregistered";
  return {
    customer_type: (any.customer_type as CustomerType) || "Business",
    salutation: any.salutation || "Mr.",
    first_name: any.first_name || "",
    last_name: any.last_name || "",
    company: c.company || "",
    email: c.email || "",
    area_code: any.phone_area_code || "+91",
    phone: c.phone || "",
    gst: c.gst || "",
    gst_status: inferredStatus,
    pan: any.pan || panFromGstin(c.gst || ""),
    billing,
    shipping: sameAsBilling ? billing : shipping,
    same_as_billing: sameAsBilling,
    place_of_supply: any.place_of_supply || "",
    contacts: Array.isArray(any.contacts) ? (any.contacts as ContactRow[]).map((x) => ({ ...emptyContact, ...x })) : [],
    sector: any.sector || "",
    remarks: c.remarks || "",
  };
}

type TabKey = "basic" | "gst" | "address" | "contacts";

/** Shared validation — returns null when valid, else message + the tab to focus.
 * URP is accepted as a sentinel for “GST unknown” — staff habit. When GST
 * field is literally “URP” (any case), skip GSTIN regex and required checks,
 * regardless of the selected treatment, so typing URP never blocks save.
 */
export function validateCustomerForm(form: CustomerFormState): { message: string; tab: TabKey } | null {
  if (form.customer_type === "Business" && !form.company.trim()) return { message: "Company Name is required for Business", tab: "basic" };
  if (!form.first_name.trim()) return { message: "First name is required", tab: "basic" };
  if (!isValidPhone(form.phone)) return { message: "Enter a valid 10-digit mobile number", tab: "basic" };
  if (!form.email.trim()) return { message: "Email is required", tab: "basic" };
  if (!EMAIL_REGEX.test(form.email.trim())) return { message: "Enter a valid email address", tab: "basic" };
  const isUrp = isUrpValue(form.gst);
  if (!isUrp) {
    if (form.gst_status !== "Unregistered" && form.gst_status !== "Consumer" && !form.gst.trim()) return { message: "GST Number is required for the selected GST treatment", tab: "gst" };
    if ((form.gst_status === "Regular" || form.gst_status === "Composition") && !isValidGSTIN(form.gst)) return { message: "Enter a valid 15-character GSTIN", tab: "gst" };
  }
  if (form.pan && !PAN_REGEX.test(form.pan.toUpperCase().trim())) return { message: "PAN must be 10 chars (AAAAA9999A)", tab: "gst" };
  for (let i = 0; i < form.contacts.length; i++) {
    const c = form.contacts[i];
    if (!c.first_name.trim()) return { message: `Contact #${i + 1}: first name required`, tab: "contacts" };
    if (c.email && !EMAIL_REGEX.test(c.email.trim())) return { message: `Contact #${i + 1}: invalid email`, tab: "contacts" };
    if (c.phone && !isValidPhone(c.phone)) return { message: `Contact #${i + 1}: phone must be 10 digits`, tab: "contacts" };
  }
  return null;
}

/**
 * M9 — derive the `gst` value for the payload.
 * Businesses with `Unregistered` treatment keep the legacy "URP" placeholder.
 * Individuals were previously always nulled, which silently dropped a valid
 * GSTIN. Now both types populate `gst` from the entered GSTIN whenever the
 * treatment is not "Unregistered" and not "Consumer" (i.e. Regular/Composition).
 * Validation lives in `validateCustomerForm` and is unchanged.
 * URP (any case) is treated as “GST unknown” — Business → “URP”, Individual → null,
 * regardless of the dropdown value, so staff typing URP never fails.
 */
function computeGstValue(form: CustomerFormState): string | null {
  const isUrp = isUrpValue(form.gst);
  if (isUrp) {
    return form.customer_type === "Business" ? "URP" : null;
  }
  if (form.gst_status === "Unregistered") {
    return form.customer_type === "Business" ? "URP" : null;
  }
  if (form.gst_status === "Consumer") {
    return null;
  }
  return upperTrim(form.gst) || null;
}

/** Shared DB payload builder — identical for Masters page and inline modal. */
export function buildCustomerPayload(form: CustomerFormState): Record<string, any> {
  const billing = { ...form.billing };
  const shipping = form.same_as_billing ? { ...billing } : { ...form.shipping };
  const companyName = form.customer_type === "Business"
    ? toTitleCaseSmart(form.company)
    : toTitleCaseSmart([form.salutation, form.first_name, form.last_name].filter(Boolean).join(" "));
  const contactDisplay = toTitleCaseSmart([form.salutation, form.first_name, form.last_name].filter(Boolean).join(" "));
  // If staff typed literally “URP”, force status to Unregistered — historical DB invariant (all 1479 URP rows are Unregistered)
  const effectiveGstStatus: GstTreatment = isUrpValue(form.gst) ? "Unregistered" : form.gst_status;

  return {
    customer_type: form.customer_type,
    salutation: form.salutation || null,
    first_name: toTitleCaseSmart(form.first_name) || null,
    last_name: toTitleCaseSmart(form.last_name) || null,
    company: companyName,
    contact_name: contactDisplay,
    phone: form.phone.trim(),
    phone_area_code: form.area_code || "+91",
    email: form.email.trim().toLowerCase() || null,
    gst: computeGstValue({ ...form, gst_status: effectiveGstStatus }),
    gst_status: effectiveGstStatus,
    pan: form.pan ? upperTrim(form.pan) : null,
    place_of_supply: form.place_of_supply || null,
    sector: form.sector ? toTitleCaseSmart(form.sector) : null,
    state: billing.state || null,
    country: billing.country || "India",
    city: toTitleCaseSmart(billing.city) || null,
    street: billing.landmark || null,
    billing_line1: titleCaseAddress(billing.line1) || null,
    billing_line2: titleCaseAddress(billing.line2) || null,
    billing_landmark: toTitleCaseSmart(billing.landmark) || null,
    billing_city: toTitleCaseSmart(billing.city) || null,
    billing_state: billing.state || null,
    billing_country: billing.country || "India",
    billing_pincode: billing.pincode || null,
    shipping_line1: titleCaseAddress(shipping.line1) || null,
    shipping_line2: titleCaseAddress(shipping.line2) || null,
    shipping_landmark: toTitleCaseSmart(shipping.landmark) || null,
    shipping_city: toTitleCaseSmart(shipping.city) || null,
    shipping_state: shipping.state || null,
    shipping_country: shipping.country || "India",
    shipping_pincode: shipping.pincode || null,
    billing_address: joinAddress(billing) || null,
    shipping_address: joinAddress(shipping) || null,
    address: joinAddress(billing) || null,
    contacts: form.contacts.map((c) => ({
      salutation: c.salutation || null,
      first_name: toTitleCaseSmart(c.first_name),
      last_name: toTitleCaseSmart(c.last_name),
      designation: toTitleCaseSmart(c.designation),
      department: toTitleCaseSmart(c.department),
      email: c.email.trim().toLowerCase(),
      area_code: c.area_code || "+91",
      phone: c.phone.trim(),
    })),
    remarks: form.remarks || null,
  };
}

/**
 * M10 — non-null, reasonably-unique customer_code. The DB `id` is not known
 * pre-insert, so derive a `CUST-` prefixed suffix (matching the rest of the
 * codebase's `CUST-...` convention in ChallanForm/GrnForm) from a short uuid.
 */
function generateCustomerCode(): string {
  const rand = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    .replace(/-/g, "")
    .slice(0, 8);
  return `CUST-${rand}`;
}

/**
 * M10 — duplicate-prevention guard (insert only).
 * Returns a clear, non-destructive error message when an active match exists,
 * otherwise null. Queries by (company + phone) when both are present and by
 * GSTIN when a non-empty one was entered. `dup_exempt` rows are ignored (they
 * are intentional, sanctioned duplicates). If the lookup itself errors, we log
 * and return null so an infra problem never blocks a legitimate save.
 */
async function findDuplicateCustomer(form: CustomerFormState): Promise<string | null> {
  const rawGst = upperTrim(form.gst);
  const isUrp = isUrpValue(rawGst);
  // URP is a shared placeholder for 1479+ customers — never treat it as a unique GSTIN for dedupe
  const gst = isUrp ? "" : rawGst;
  const company =
    form.customer_type === "Business"
      ? toTitleCaseSmart(form.company)
      : toTitleCaseSmart([form.salutation, form.first_name, form.last_name].filter(Boolean).join(" "));
  const phone = (form.phone || "").trim();

  const queries: PromiseLike<{ data: any; error: any }>[] = [];
  if (gst) {
    queries.push(
      supabase.from("customers").select("id,company,phone,gst,dup_exempt").eq("gst", gst) as any,
    );
  }
  if (company && phone) {
    queries.push(
      supabase
        .from("customers")
        .select("id,company,phone,gst,dup_exempt")
        .eq("company", company)
        .eq("phone", phone) as any,
    );
  }
  if (!queries.length) return null;

  try {
    const results = await Promise.all(queries.map((q) => q));
    for (const { data, error } of results) {
      if (error) {
        console.error("[saveCustomer] duplicate lookup failed:", error.message);
        continue;
      }
      const match = (data || []).find((r: any) => !r.dup_exempt);
      if (match) {
        const byGst = gst && match.gst === gst;
        return `A customer already exists with the same ${
          byGst ? `GSTIN (${gst})` : "company name and phone number"
        } (${match.company || "—"}, ${match.phone || "—"}). Please reuse the existing record instead of creating a duplicate.`;
      }
    }
    return null;
  } catch (e: any) {
    console.error("[saveCustomer] duplicate lookup error:", e?.message || e);
    return null;
  }
}

/** Saves (insert or update) and returns the persisted row. */
export async function saveCustomer(form: CustomerFormState, editingId?: string | null): Promise<Customer> {
  const payload = buildCustomerPayload(form);

  if (!editingId) {
    payload.customer_code = generateCustomerCode();
    const dupError = await findDuplicateCustomer(form);
    if (dupError) throw new Error(dupError);
  }

  const q = editingId
    ? supabase.from("customers").update(payload as any).eq("id", editingId).select("*").single()
    : supabase.from("customers").insert(payload as any).select("*").single();
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as unknown as Customer;
}

export function FieldRow({ label, required, labelClassName, children }: { label: string; required?: boolean; labelClassName?: string; children: React.ReactNode }) {
  return (
    <div className="grid md:grid-cols-[180px_1fr] items-start gap-2 md:gap-4">
      <Label className={cn("text-sm pt-2", required && "text-destructive", labelClassName)}>{label}{required && " *"}</Label>
      <div>{children}</div>
    </div>
  );
}

export function AddressEditor({ title, value, onChange }: { title: string; value: AddressBlock; onChange: (v: AddressBlock) => void }) {
  return (
    <div className="space-y-3">
      {title && <h3 className="font-medium text-sm">{title}</h3>}
      <Input placeholder="Address Line 1" value={value.line1} onChange={(e) => onChange({ ...value, line1: e.target.value })} />
      <Input placeholder="Address Line 2" value={value.line2} onChange={(e) => onChange({ ...value, line2: e.target.value })} />
      <Input placeholder="Landmark" value={value.landmark} onChange={(e) => onChange({ ...value, landmark: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="City" value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} />
        <Input placeholder="Pincode" inputMode="numeric" value={value.pincode} onChange={(e) => onChange({ ...value, pincode: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
      </div>
      <StateCombobox value={value.state} onChange={(s) => onChange({ ...value, state: s })} />
      <Select value={value.country} onValueChange={(c) => onChange({ ...value, country: c })}>
        <SelectTrigger><SelectValue placeholder="Country" /></SelectTrigger>
        <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

export function StateCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value || "Select state / UT"}
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command>
          <CommandInput placeholder="Search state…" />
          <CommandList>
            <CommandEmpty>No state found.</CommandEmpty>
            <CommandGroup>
              {INDIAN_STATES.map((s) => (
                <CommandItem key={s} value={s} onSelect={() => { onChange(s); setOpen(false); }}>
                  <Check className={cn("h-4 w-4 mr-2", value === s ? "opacity-100" : "opacity-0")} />
                  {s}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The full Customer Master field set (tabs). Controlled. */
export function CustomerFormFields({ form, setForm, tab, setTab, customerId }: {
  form: CustomerFormState;
  setForm: React.Dispatch<React.SetStateAction<CustomerFormState>>;
  tab: string;
  setTab: (t: string) => void;
  /** Present when editing an existing customer — enables the Branch Offices tab. */
  customerId?: string | null;
}) {
  const [emailError, setEmailError] = useState("");

  function onGstChange(v: string) {
    const up = v.toUpperCase().trim();
    // Staff habit: typing “URP” means GST unknown — auto-switch to Unregistered so save never fails
    if (isUrpValue(up)) {
      setForm((f) => ({
        ...f,
        gst: "URP",
        gst_status: "Unregistered",
      }));
      return;
    }
    const auto = stateFromGSTIN(up);
    setForm((f) => ({
      ...f,
      gst: up,
      pan: f.customer_type === "Business" && up.length >= 12 ? panFromGstin(up) : f.pan,
      billing: { ...f.billing, state: auto || f.billing.state },
      place_of_supply: auto || f.place_of_supply,
      gst_status: up.length >= 2 && auto ? "Regular" : f.gst_status,
    }));
  }
  function addContact() { setForm((f) => ({ ...f, contacts: [...f.contacts, { ...emptyContact }] })); }
  function updateContact(i: number, patch: Partial<ContactRow>) {
    setForm((f) => ({ ...f, contacts: f.contacts.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  }
  function removeContact(i: number) { setForm((f) => ({ ...f, contacts: f.contacts.filter((_, idx) => idx !== i) })); }

  return (
    <Tabs value={tab} onValueChange={setTab} className="px-6 pt-3">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="basic">Basic Details</TabsTrigger>
        <TabsTrigger value="gst">GST / PAN</TabsTrigger>
        <TabsTrigger value="address">Address</TabsTrigger>
        <TabsTrigger value="contacts">Contacts ({form.contacts.length})</TabsTrigger>
        {customerId && <TabsTrigger value="branches">Branch Offices</TabsTrigger>}
      </TabsList>

      <TabsContent value="basic" className="mt-4 space-y-4">
        <FieldRow label="Customer Type" required labelClassName="text-[#000000]">
          <RadioGroup
            value={form.customer_type}
            onValueChange={(v) => setForm((f) => v === "Individual" ? { ...f, customer_type: "Individual", gst: "", gst_status: "Unregistered" } : { ...f, customer_type: "Business" })}
            className="flex gap-6"
          >
            <label className="flex items-center gap-2 cursor-pointer text-sm text-[#000000]">
              <RadioGroupItem value="Business" /> Business
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-[#000000]">
              <RadioGroupItem value="Individual" /> Individual
            </label>
          </RadioGroup>
        </FieldRow>

        <FieldRow label="Primary Contact" required labelClassName="text-[#000000]">
          <div className="grid grid-cols-12 gap-2">
            <Select value={form.salutation} onValueChange={(v) => setForm({ ...form, salutation: v })}>
              <SelectTrigger className="col-span-3 text-[#000000]"><SelectValue placeholder="Salutation" /></SelectTrigger>
              <SelectContent>{SALUTATIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Input className="col-span-4 text-[#000000]" placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            <Input className="col-span-5 text-[#000000]" placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </div>
        </FieldRow>

        {form.customer_type === "Business" && (
          <FieldRow label="Company Name" required labelClassName="text-[#000000]">
            <Input className="text-[#000000]" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Legal / billing entity" />
          </FieldRow>
        )}

        <FieldRow label="Email" required labelClassName="text-[#000000]">
          <Input type="email" className="text-[#000000]" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setEmailError(""); }} placeholder="name@company.com" onBlur={() => { if (!form.email.trim()) setEmailError("Email is required"); else if (!EMAIL_REGEX.test(form.email.trim())) setEmailError("Enter a valid email address"); else setEmailError(""); }} />
          {emailError && <p className="text-[0.8rem] font-medium text-destructive mt-1">{emailError}</p>}
        </FieldRow>

        <FieldRow label="Phone" required labelClassName="text-[#000000]">
          <div className="grid grid-cols-12 gap-2">
            <Input className="col-span-3 font-mono text-[#000000]" value={form.area_code} onChange={(e) => setForm({ ...form, area_code: e.target.value })} placeholder="+91" />
            <Input
              className="col-span-9 text-[#000000]"
              inputMode="numeric"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
              placeholder="10-digit mobile"
            />
          </div>
        </FieldRow>

        <FieldRow label="Sector / Colony" labelClassName="text-[#000000]">
          <Input className="text-[#000000]" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} placeholder="e.g. Sector 61 / DLF Phase 3" />
        </FieldRow>
        <FieldRow label="City / Area" labelClassName="text-[#000000]">
          <Input className="text-[#000000]" value={form.billing.city} onChange={(e) => setForm({ ...form, billing: { ...form.billing, city: e.target.value } })} placeholder="City or area" />
        </FieldRow>
      </TabsContent>

      <TabsContent value="gst" className="mt-4 space-y-4">
        <FieldRow label="GST Treatment" required>
          <Select value={form.gst_status} onValueChange={(v) => setForm({ ...form, gst_status: v as GstTreatment })}>
            <SelectTrigger><SelectValue placeholder="Select a GST treatment" /></SelectTrigger>
            <SelectContent>{GST_TREATMENTS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </FieldRow>
        {(form.customer_type === "Business" || (form.customer_type === "Individual" && (form.gst_status === "Regular" || form.gst_status === "Composition"))) && (() => {
          const gstRequired = form.gst_status === "Regular" || form.gst_status === "Composition";
          const isUrp = isUrpValue(form.gst);
          return (
            <FieldRow label="GST Number" required={gstRequired}>
              <Input value={form.gst} onChange={(e) => onGstChange(e.target.value)} placeholder={gstRequired ? "15-char GSTIN — auto-fills state & PAN" : "Leave blank or type URP if GST is unknown"} maxLength={15} className="font-mono uppercase" />
              {!gstRequired && !isUrp && form.gst.trim() === "" && (
                <p className="text-xs text-muted-foreground mt-1">Blank will be saved as “URP” for Business.</p>
              )}
              {isUrp && (
                <p className="text-xs text-emerald-600 mt-1">“URP” = GST unknown — will be saved as Unregistered.</p>
              )}
            </FieldRow>
          );
        })()}
        <FieldRow label="Place of Supply">
          <StateCombobox value={form.place_of_supply} onChange={(s) => setForm({ ...form, place_of_supply: s })} />
        </FieldRow>
        <FieldRow label="PAN">
          <Input
            value={form.pan}
            onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase().slice(0, 10) })}
            placeholder="AAAAA9999A"
            maxLength={10}
            className="font-mono uppercase"
          />
        </FieldRow>
        <FieldRow label="Remarks">
          <Textarea rows={3} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        </FieldRow>
      </TabsContent>

      <TabsContent value="address" className="mt-4 space-y-4">
        <div className="grid md:grid-cols-2 gap-6">
          <AddressEditor
            title="Billing Address"
            value={form.billing}
            onChange={(b) => setForm({ ...form, billing: b, shipping: form.same_as_billing ? b : form.shipping })}
          />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">Shipping Address</h3>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={form.same_as_billing}
                  onCheckedChange={(v) => setForm({ ...form, same_as_billing: !!v, shipping: v ? form.billing : form.shipping })}
                />
                Same as Billing
              </label>
            </div>
            {!form.same_as_billing && (
              <AddressEditor title="" value={form.shipping} onChange={(s) => setForm({ ...form, shipping: s })} />
            )}
            {form.same_as_billing && (
              <div className="text-xs text-muted-foreground p-3 rounded border bg-muted/30">
                Shipping address will be copied from billing on save.
              </div>
            )}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="contacts" className="mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Add multiple persons of contact. Each must include a first name.</p>
          <Button type="button" variant="outline" size="sm" onClick={addContact}><Plus className="h-4 w-4 mr-1" />Add Contact</Button>
        </div>
        {form.contacts.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8 border rounded bg-muted/20">
            No additional contacts yet. The Primary Contact (Basic Details) acts as the default.
          </div>
        )}
        {form.contacts.map((c, i) => (
          <div key={i} className="border rounded p-3 space-y-2 bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Contact #{i + 1}</div>
              <Button type="button" size="icon" variant="ghost" onClick={() => removeContact(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              <Select value={c.salutation} onValueChange={(v) => updateContact(i, { salutation: v })}>
                <SelectTrigger><SelectValue placeholder="Salutation" /></SelectTrigger>
                <SelectContent>{SALUTATIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="First name *" value={c.first_name} onChange={(e) => updateContact(i, { first_name: e.target.value })} />
              <Input placeholder="Last name" value={c.last_name} onChange={(e) => updateContact(i, { last_name: e.target.value })} />
              <Input placeholder="Designation" value={c.designation} onChange={(e) => updateContact(i, { designation: e.target.value })} />
              <Input placeholder="Department" value={c.department} onChange={(e) => updateContact(i, { department: e.target.value })} />
              <Input type="email" placeholder="Email" value={c.email} onChange={(e) => updateContact(i, { email: e.target.value })} />
              <div className="grid grid-cols-12 gap-2">
                <Input className="col-span-4 font-mono" placeholder="+91" value={c.area_code} onChange={(e) => updateContact(i, { area_code: e.target.value })} />
                <Input
                  className="col-span-8"
                  inputMode="numeric"
                  placeholder="10-digit phone"
                  value={c.phone}
                  onChange={(e) => updateContact(i, { phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                />
              </div>
            </div>
          </div>
        ))}
      </TabsContent>

      {customerId && (
        <TabsContent value="branches" className="mt-4 space-y-3">
          <BranchOfficesEditor customerId={customerId} />
        </TabsContent>
      )}
    </Tabs>
  );
}

/**
 * Full Customer Master form inside a large Dialog.
 * Used by the Masters page and by the inline picker modal — one source of truth.
 */
export function CustomerFormDialog({
  open, onOpenChange, editing, initialCompany, onSaved, allowSaveAndNew = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: Customer | null;
  initialCompany?: string;
  onSaved: (customer: Customer, mode: "create" | "update") => void;
  allowSaveAndNew?: boolean;
}) {
  const [form, setForm] = useState<CustomerFormState>(emptyCustomerForm);
  const [tab, setTab] = useState("basic");
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the dialog is (re)opened — useEffect to avoid setState during render.
  useEffect(() => {
    if (open) {
      setForm(editing ? customerToForm(editing) : { ...emptyCustomerForm, company: (initialCompany || "").trim() });
      setTab("basic");
    }
  }, [open, editing?.id, initialCompany]); // editing id is stable; re-seed when dialog opens or target changes

  async function submit(addAnother: boolean) {
    const err = validateCustomerForm(form);
    if (err) { toast.error(err.message); setTab(err.tab); return; }
    setSaving(true);
    try {
      const saved = await saveCustomer(form, editing?.id ?? null);
      toast.success(editing ? "Customer updated" : "Customer added");
      onSaved(saved, editing ? "update" : "create");
      if (addAnother) {
        setForm({ ...emptyCustomerForm });
        setTab("basic");
      } else {
        onOpenChange(false);
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not save customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0" aria-describedby={undefined}>
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="text-xl">{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
          <DialogDescription className="sr-only">
            {editing ? "Update customer details" : "Add a new customer to the master list"}
          </DialogDescription>
        </DialogHeader>

        <CustomerFormFields form={form} setForm={setForm} tab={tab} setTab={setTab} customerId={editing?.id} />

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t bg-muted sticky bottom-0">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
          <div className="flex gap-2">
            {allowSaveAndNew && !editing && (
              <Button type="button" variant="outline" disabled={saving} onClick={() => submit(true)}><Plus className="h-4 w-4 mr-1" />Save & New</Button>
            )}
            <Button type="button" disabled={saving} onClick={() => submit(false)}>
              <Save className="h-4 w-4 mr-1" />{saving ? "Saving…" : editing ? "Update" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Customer Branch Offices
// ─────────────────────────────────────────────────────────────────────

const EMPTY_BRANCH_FORM: BranchFormState = {
  name: "",
  contact_name: "",
  phone: "",
  email: "",
  billing: { line1: "", line2: "", landmark: "", city: "", state: "", country: "India", pincode: "" },
  state: "",
  gstin: "",
  is_default: false,
};

/** Branch form state — billing is always materialized so the UI can edit it directly. */
type BranchFormState = CustomerBranchInput & { billing: AddressBlockInput };

function branchToForm(b: CustomerBranch): BranchFormState {
  return {
    name: b.name,
    contact_name: b.contact_name ?? "",
    phone: b.phone ?? "",
    email: b.email ?? "",
    billing: {
      line1: b.billing_line1 ?? "",
      line2: b.billing_line2 ?? "",
      landmark: b.billing_landmark ?? "",
      city: b.billing_city ?? "",
      state: b.billing_state ?? "",
      country: b.billing_country ?? "India",
      pincode: b.billing_pincode ?? "",
    },
    state: b.state ?? "",
    gstin: b.gstin ?? "",
    is_default: b.is_default,
  };
}

function BranchOfficesEditor({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const { data: branches = [], isLoading } = useCustomerBranches(customerId);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerBranch | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function confirmSetDefault(b: CustomerBranch) {
    try {
      await saveCustomerBranch(customerId, branchToForm(b), b.id);
      queryClient.invalidateQueries({ queryKey: masterKeys.customerBranches(customerId) });
      toast.success(`"${b.name}" set as default`);
    } catch (e: any) {
      toast.error(e?.message || "Could not update branch");
    }
  }

  async function handleDelete() {
    if (!confirmId) return;
    try {
      await deleteCustomerBranch(confirmId);
      queryClient.invalidateQueries({ queryKey: masterKeys.customerBranches(customerId) });
      toast.success("Branch office deleted");
    } catch (e: any) {
      toast.error(e?.message || "Could not delete branch");
    }
    setConfirmId(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Branch Offices</p>
          <p className="text-xs text-muted-foreground">
            One legal entity can have multiple branch locations. Select the branch when creating quotations, POs, invoices, etc.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(null); setAddOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Branch
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading branches…</p>}
      {!isLoading && branches.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-6 border rounded bg-muted/20">
          No branch offices yet. Add one to associate a location (address, POS state) with this customer.
        </div>
      )}
      {branches.length > 0 && (
        <div className="space-y-2">
          {branches.map((b) => (
            <div key={b.id} className="flex items-start justify-between gap-3 border rounded p-3 bg-muted/20">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{b.name}</span>
                  {b.is_default && (
                    <span className="text-[10px] uppercase tracking-wide bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5">
                      Default
                    </span>
                  )}
                  {((b.state || b.billing_state) && (
                    <span className="text-xs text-muted-foreground">· {b.state || b.billing_state}</span>
                  ))}
                </div>
                {customerBranchAddress(b) && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{customerBranchAddress(b)}</p>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
                  {b.contact_name ? <span>{b.contact_name}</span> : null}
                  {b.phone ? <span>{b.phone}</span> : null}
                  {b.email ? <span>{b.email}</span> : null}
                  {((b.gstin || "").trim() ? <span className="font-mono">{b.gstin}</span> : null)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!b.is_default && (
                  <Button type="button" size="icon" variant="ghost" title="Set as default" onClick={() => confirmSetDefault(b)}>
                    <Check className="h-4 w-4" />
                  </Button>
                )}
                <Button type="button" size="icon" variant="ghost" title="Edit branch" onClick={() => { setEditing(b); setAddOpen(true); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" title="Delete branch" onClick={() => setConfirmId(b.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <BranchOfficeFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        customerId={customerId}
        editing={editing}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: masterKeys.customerBranches(customerId) });
          setAddOpen(false);
        }}
      />
      <ConfirmDialog
        open={!!confirmId}
        title="Delete branch office?"
        description="This removes the branch office and its address information. Documents already created are not affected."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onOpenChange={(o) => { if (!o) setConfirmId(null); }}
      />
    </div>
  );
}

function BranchOfficeFormDialog({
  open, onOpenChange, customerId, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerId: string;
  editing: CustomerBranch | null;
  onSaved: (b: CustomerBranch) => void;
}) {
  const [form, setForm] = useState<BranchFormState>(EMPTY_BRANCH_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(editing ? branchToForm(editing) : { ...EMPTY_BRANCH_FORM });
  }, [open, editing?.id]);

  async function submit() {
    const err = validateCustomerBranch(form);
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      const saved = await saveCustomerBranch(customerId, form, editing?.id ?? null);
      toast.success(editing ? "Branch office updated" : "Branch office added");
      onSaved(saved);
    } catch (e: any) {
      toast.error(e?.message || "Could not save branch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Branch Office" : "Add Branch Office"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Branch name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Delhi Branch" />
            </div>
            <div className="space-y-1.5">
              <Label>State (Place of Supply)</Label>
              <Select value={form.state ?? ""} onValueChange={(v) => setForm({ ...form, state: v })}>
                <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Contact person</Label>
              <Input value={form.contact_name ?? ""} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input inputMode="numeric" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 12) })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Billing address</Label>
            <Textarea
              value={form.billing.line1}
              onChange={(e) => setForm({ ...form, billing: { ...form.billing, line1: e.target.value } })}
              placeholder="Line 1 (street, area)…"
            />
            <Input value={form.billing.line2} onChange={(e) => setForm({ ...form, billing: { ...form.billing, line2: e.target.value } })} placeholder="Line 2 (opt.)" />
            <div className="grid grid-cols-3 gap-2">
              <Input value={form.billing.city} onChange={(e) => setForm({ ...form, billing: { ...form.billing, city: e.target.value } })} placeholder="City" />
              <Input value={form.billing.state} onChange={(e) => setForm({ ...form, billing: { ...form.billing, state: e.target.value } })} placeholder="State" />
              <Input inputMode="numeric" value={form.billing.pincode} onChange={(e) => setForm({ ...form, billing: { ...form.billing, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) } })} placeholder="Pincode" />
            </div>
            <Input value={form.billing.country} onChange={(e) => setForm({ ...form, billing: { ...form.billing, country: e.target.value } })} placeholder="Country (default India)" />
          </div>
          <div className="space-y-1.5">
            <Label>GSTIN (branch specific, optional)</Label>
            <Input className="font-mono uppercase" value={form.gstin ?? ""} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="e.g. 07AAACP1234F1Z5" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={!!form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v === true })} />
            Set as default branch office
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t pt-4 mt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
          <Button type="button" size="sm" disabled={saving} onClick={submit}>
            <Save className="h-4 w-4 mr-1" />{saving ? "Saving…" : editing ? "Update" : "Add Branch"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
