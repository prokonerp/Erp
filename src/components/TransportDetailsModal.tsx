import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  DEFAULT_TRANSPORT,
  VEHICLE_REGEX,
  PIN_REGEX,
  type TransportDetails,
  type DispatchDetails,
  TRANSPORT_MODES,
  MODE_OF_TRANSPORT,
  computeTransactionType,
} from "@/lib/transport";
import {
  GSTIN_STATE_CODES,
  isValidGSTIN,
  validateGSTINChecksum,
  pinToState,
} from "@/lib/india";

// ── props ────────────────────────────────────────────────────────────────
export type TransportDetailsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: TransportDetails;
  onSave: (v: TransportDetails) => void;
  billAmt: number;
  taxableAmt: number;
  taxAmt: number;
};

// ── helpers ──────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const LAST_KEY = "prokon_last_transport";

function cloneTransport(v: TransportDetails): TransportDetails {
  return {
    ...v,
    dispatch_details: v.dispatch_details ? { ...v.dispatch_details } : null,
  };
}

function ensureDispatch(v: TransportDetails): DispatchDetails {
  if (v.dispatch_details) return { ...v.dispatch_details };
  return {
    name: null,
    place: null,
    address: null,
    addr1: null,
    pin_code: null,
    state: null,
    state_code: null,
    gstin: null,
  };
}

// ── component ───────────────────────────────────────────────────────────
export default function TransportDetailsModal({
  open,
  onOpenChange,
  value,
  onSave,
  billAmt,
  taxableAmt,
  taxAmt,
}: TransportDetailsModalProps) {
  const [draft, setDraft] = React.useState<TransportDetails>(() =>
    cloneTransport(value),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [transporterPromptOpen, setTransporterPromptOpen] = React.useState(false);
  const [newTransporterName, setNewTransporterName] = React.useState("");
  const [newTransporterId, setNewTransporterId] = React.useState("");
  const dispatchStateCode = React.useMemo(
    () => draft.dispatch_details?.state_code ?? "",
    [draft.dispatch_details?.state_code],
  );

  // M8 fix: only reset on open transition (dep [open] + ref) — avoids stale closure where
  // parent `value` changes while modal is open would clobber in-progress draft edits.
  const valueRef = React.useRef(value);
  valueRef.current = value;
  React.useEffect(() => {
    if (open) {
      setDraft(cloneTransport(valueRef.current));
      setErrors({});
      setTransporterPromptOpen(false);
    }
  }, [open]);

  const pinStateHelper = React.useMemo(() => {
    const pin = draft.pin_code?.trim() ?? "";
    if (!pin || !PIN_REGEX.test(pin)) return null;
    return pinToState(pin);
  }, [draft.pin_code]);

  const dispatchPinHelper = React.useMemo(() => {
    const pin = draft.dispatch_details?.pin_code?.trim() ?? "";
    if (!pin || !PIN_REGEX.test(pin)) return null;
    return pinToState(pin);
  }, [draft.dispatch_details?.pin_code]);

  const transactionBadge = React.useMemo(() => {
    // value.transaction_type is already computed via computeTransactionType upstream;
    // show <<Select Automatically>> style when missing (should not happen with DEFAULT_TRANSPORT)
    const tt = draft.transaction_type;
    if (!tt) return "<<Select Automatically>>";
    try {
      // re-derive via helper if possible (buyer GSTIN not available here, fallback to draft)
      // keep displayed value as draft.transaction_type for parity
      void computeTransactionType;
      return tt;
    } catch {
      return tt;
    }
  }, [draft.transaction_type]);

  const setField = <K extends keyof TransportDetails>(
    key: K,
    val: TransportDetails[K],
  ) => {
    setDraft((prev) => ({ ...prev, [key]: val }));
  };

  const setDispatchField = <K extends keyof DispatchDetails>(
    key: K,
    val: DispatchDetails[K],
  ) => {
    setDraft((prev) => ({
      ...prev,
      dispatch_details: { ...ensureDispatch(prev), [key]: val },
    }));
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    // PIN 6-digit
    if (draft.pin_code && !PIN_REGEX.test(draft.pin_code.trim())) {
      next.pin_code = "PIN must be 6 digits (1-9xxxxxx)";
    }
    const dd = draft.dispatch_details;
    if (dd?.pin_code && !PIN_REGEX.test(dd.pin_code.trim())) {
      next.dispatch_pin = "Dispatch PIN must be 6 digits";
    }

    // Vehicle regex
    if (draft.vehicle_no) {
      const v = draft.vehicle_no.trim().toUpperCase();
      if (!VEHICLE_REGEX.test(v)) {
        next.vehicle_no = "Invalid vehicle no. e.g. HR55AB1234";
      }
    }
    // mandatory if Transport=Self & unregistered (no transporter_id)
    const isSelf = draft.transport_mode === "Self";
    const hasTransporter = Boolean(
      draft.transporter_id && draft.transporter_id.trim(),
    );
    if (isSelf && !hasTransporter && !draft.vehicle_no?.trim()) {
      next.vehicle_no = "Vehicle No. required when Transport is Self & unregistered";
    }

    // Distance clamp 1-4000
    if (draft.distance_km != null) {
      const n = Number(draft.distance_km);
      if (!isFinite(n) || n < 1 || n > 4000) {
        next.distance_km = "Distance must be 1-4000 km";
      }
    }

    // GSTIN validate for dispatch GSTIN if present
    if (dd?.gstin) {
      const g = dd.gstin.trim().toUpperCase();
      if (!isValidGSTIN(g)) {
        next.dispatch_gstin = "Invalid GSTIN format";
      } else if (!validateGSTINChecksum(g)) {
        next.dispatch_gstin = "GSTIN checksum failed";
      }
    }

    // GR/RR Date sanity (optional but must be valid date if present)
    if (draft.gr_rr_date) {
      const d = new Date(draft.gr_rr_date);
      if (isNaN(d.getTime())) next.gr_rr_date = "Invalid date";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = () => {
    if (!validate()) {
      toast.error("Please fix validation errors");
      return;
    }
    // clamp distance on save
    let distance = draft.distance_km;
    if (distance != null) {
      const n = Math.round(Number(distance));
      if (isFinite(n)) {
        if (n < 1) distance = 1;
        else if (n > 4000) distance = 4000;
        else distance = n;
      }
    }
    // normalize vehicle to uppercase
    const vehicle = draft.vehicle_no
      ? draft.vehicle_no.trim().toUpperCase()
      : draft.vehicle_no;

    // normalize GSTIN — single source: draft.dispatch_details already holds state_code/state via setDispatchField
    const dd = draft.dispatch_details
      ? {
          ...draft.dispatch_details,
          gstin: draft.dispatch_details.gstin
            ? draft.dispatch_details.gstin.trim().toUpperCase()
            : draft.dispatch_details.gstin,
        }
      : null;

    const out: TransportDetails = {
      ...draft,
      vehicle_no: vehicle,
      distance_km: distance,
      pin_code: draft.pin_code ? draft.pin_code.trim() : draft.pin_code,
      station_to_place: draft.station_to_place?.trim() || null,
      dispatch_details: dd,
    };

    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(out));
    } catch {
      // ignore
    }
    onSave(out);
    onOpenChange(false);
    toast.success("Transport details saved");
  };

  const handlePickFromDatabase = () => {
    try {
      const raw = localStorage.getItem(LAST_KEY);
      if (!raw) {
        toast.message("No previous transport details found");
        return;
      }
      const parsed = JSON.parse(raw) as TransportDetails;
      // merge last into draft (keep compliance read-only fields? spec says copy from last — copy all)
      setDraft(cloneTransport(parsed));
      toast.success("Loaded last transport details — review and press F2-Done to save");
    } catch {
      toast.error("Failed to load last transport details");
    }
  };

  const handleAddTransporter = () => {
    const name = newTransporterName.trim();
    const id = newTransporterId.trim().toUpperCase();
    if (!name && !id) {
      toast.error("Enter transporter name or GSTIN/ID");
      return;
    }
    if (id && !isValidGSTIN(id) && id.length < 3) {
      // allow non-GSTIN transporter IDs (as per "GSTIN/ID prompt") — just require non-empty
      // but if it looks like GSTIN (15 chars) validate
      if (id.length === 15 && !validateGSTINChecksum(id)) {
        toast.error("GSTIN checksum failed");
        return;
      }
    }
    if (id.length === 15) {
      if (!isValidGSTIN(id)) {
        toast.error("Invalid GSTIN format");
        return;
      }
      if (!validateGSTINChecksum(id)) {
        toast.error("GSTIN checksum failed");
        return;
      }
    }
    setDraft((prev) => ({
      ...prev,
      transporter_name: name || prev.transporter_name,
      transporter_id: id || prev.transporter_id,
    }));
    setTransporterPromptOpen(false);
    setNewTransporterName("");
    setNewTransporterId("");
    toast.success("Transporter added");
  };

  const handleValidateDispatchGstin = () => {
    const g = draft.dispatch_details?.gstin?.trim().toUpperCase() ?? "";
    if (!g) {
      toast.error("Enter GSTIN to validate");
      return;
    }
    if (!isValidGSTIN(g)) {
      toast.error("Invalid GSTIN format");
      return;
    }
    if (!validateGSTINChecksum(g)) {
      toast.error("GSTIN checksum failed");
      return;
    }
    toast.success("GSTIN is valid");
    // auto-fill state from GSTIN prefix
    const code = g.slice(0, 2);
    const stateName = GSTIN_STATE_CODES[code];
    if (stateName) {
      setDispatchField("state", stateName);
      setDispatchField("state_code", code);
    }
  };

  // keyboard: Esc quit, F2 done, F4 pick from DB
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      } else if (e.key === "F2") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "F4") {
        e.preventDefault();
        handlePickFromDatabase();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="bg-[#FFF7ED] p-0 gap-0 max-w-3xl sm:max-w-[860px] overflow-hidden border-orange-200 max-h-[92vh] flex flex-col"
      >
        {/* orange header */}
        <div className="bg-[#EA580C] px-4 py-2.5 shrink-0">
          <DialogHeader className="space-y-0">
            <DialogTitle className="text-white text-[15px] font-semibold tracking-wide text-left">
              Transport Details
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* scrollable body */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">
          {/* Row 1: Transport + Mode of Transport */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Transport</Label>
              <div className="flex gap-2">
                <Select
                  value={draft.transport_mode}
                  onValueChange={(v) =>
                    setField("transport_mode", v as TransportDetails["transport_mode"])
                  }
                >
                  <SelectTrigger className="flex-1 bg-white">
                    <SelectValue placeholder="Select transport" />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSPORT_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 bg-white border-orange-300 text-orange-700 hover:bg-orange-50 whitespace-nowrap"
                  onClick={() => setTransporterPromptOpen((v) => !v)}
                >
                  Add New
                </Button>
              </div>
              {(draft.transporter_name || draft.transporter_id) && (
                <p className="text-[11px] text-muted-foreground truncate">
                  {draft.transporter_name ?? "—"}
                  {draft.transporter_id ? ` · ${draft.transporter_id}` : ""}
                </p>
              )}
              {transporterPromptOpen && (
                <div className="rounded-md border bg-white p-3 space-y-2 shadow-sm">
                  <p className="text-xs font-medium">Add transporter — GSTIN / ID</p>
                  <div className="grid grid-cols-1 gap-2">
                    <Input
                      placeholder="Transporter Name"
                      value={newTransporterName}
                      onChange={(e) => setNewTransporterName(e.target.value)}
                      className="h-8 bg-white"
                    />
                    <Input
                      placeholder="GSTIN / Transporter ID (15-char GSTIN or ID)"
                      value={newTransporterId}
                      onChange={(e) => setNewTransporterId(e.target.value.toUpperCase())}
                      className="h-8 bg-white font-mono text-xs"
                      maxLength={15}
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setTransporterPromptOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="button" size="sm" onClick={handleAddTransporter}>
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Mode of Transport</Label>
              <Select
                value={draft.mode_of_transport}
                onValueChange={(v) =>
                  setField("mode_of_transport", v as TransportDetails["mode_of_transport"])
                }
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OF_TRANSPORT.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2: GR/RR No + GR/RR Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="gr-rr-no" className="text-xs font-medium">
                GR / RR No
              </Label>
              <Input
                id="gr-rr-no"
                value={draft.gr_rr_no ?? ""}
                onChange={(e) => setField("gr_rr_no", e.target.value || null)}
                placeholder="GR/RR No"
                className="h-8 bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gr-rr-date" className="text-xs font-medium">
                GR / RR Date
              </Label>
              <Input
                id="gr-rr-date"
                type="date"
                value={draft.gr_rr_date ?? ""}
                onChange={(e) => setField("gr_rr_date", e.target.value || null)}
                className="h-8 bg-white"
              />
              {errors.gr_rr_date && (
                <p className="text-[11px] text-destructive">{errors.gr_rr_date}</p>
              )}
            </div>
          </div>

          {/* Row 3: Vehicle No + Station/To Place */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-no" className="text-xs font-medium">
                Vehicle No <span className="text-destructive">*</span>
                <span className="font-normal text-muted-foreground ml-1">
                  (mandatory if Self & unregistered)
                </span>
              </Label>
              <Input
                id="vehicle-no"
                value={draft.vehicle_no ?? ""}
                onChange={(e) => setField("vehicle_no", e.target.value.toUpperCase() || null)}
                placeholder="HR55AB1234"
                className="h-8 bg-white font-mono text-xs tracking-wider"
                maxLength={12}
              />
              {errors.vehicle_no ? (
                <p className="text-[11px] text-destructive">{errors.vehicle_no}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">Format: AA11AA1234</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="station" className="text-xs font-medium">
                Station / To Place
              </Label>
              <Input
                id="station"
                value={draft.station_to_place ?? ""}
                onChange={(e) => setField("station_to_place", e.target.value || null)}
                placeholder="Destination station / place"
                className="h-8 bg-white"
              />
            </div>
          </div>

          {/* Row 4: PIN Code + Distance KM */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pin-code" className="text-xs font-medium">
                PIN Code
              </Label>
              <Input
                id="pin-code"
                value={draft.pin_code ?? ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setField("pin_code", v || null);
                }}
                placeholder="6-digit PIN"
                className="h-8 bg-white font-mono text-xs"
                maxLength={6}
                inputMode="numeric"
              />
              {errors.pin_code ? (
                <p className="text-[11px] text-destructive">{errors.pin_code}</p>
              ) : pinStateHelper ? (
                <p className="text-[11px] text-emerald-700">State: {pinStateHelper}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">6 digits, PIN→state helper</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="distance" className="text-xs font-medium">
                Distance KM
              </Label>
              <Input
                id="distance"
                type="number"
                min={1}
                max={4000}
                value={draft.distance_km ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") setField("distance_km", null);
                  else {
                    const n = Number(raw);
                    if (isFinite(n)) {
                      const clamped = Math.min(4000, Math.max(1, Math.round(n)));
                      // allow typing out-of-range but show warning; clamp display on blur is handled on save
                      setField("distance_km", n as unknown as number);
                      void clamped;
                    }
                  }
                }}
                placeholder="1-4000"
                className="h-8 bg-white"
              />
              {errors.distance_km ? (
                <p className="text-[11px] text-destructive">{errors.distance_km}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">1–4000 km</p>
              )}
            </div>
          </div>

          {/* Row 5: Sub Type + Transaction Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sub-type" className="text-xs font-medium">
                Sub Type
              </Label>
              <Input
                id="sub-type"
                value={draft.sub_type ?? ""}
                onChange={(e) => setField("sub_type", e.target.value || null)}
                placeholder="Supply"
                className="h-8 bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Transaction Type</Label>
              <div className="flex items-center h-8 rounded-md border bg-white px-3 text-sm">
                {draft.transaction_type ? (
                  <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
                    {transactionBadge}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground italic text-xs">
                    &lt;&lt;Select Automatically&gt;&gt;
                  </span>
                )}
                <span className="ml-2 text-[11px] text-muted-foreground">
                  auto via computeTransactionType
                </span>
              </div>
              <Select
                value={draft.transaction_type}
                onValueChange={(v) =>
                  setField("transaction_type", v as TransportDetails["transaction_type"])
                }
              >
                <SelectTrigger className="bg-white h-8 text-xs">
                  <SelectValue placeholder="<<Select Automatically>>" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="B2B">B2B</SelectItem>
                  <SelectItem value="B2C">B2C</SelectItem>
                  <SelectItem value="SEZWP">SEZWP</SelectItem>
                  <SelectItem value="SEZWOP">SEZWOP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 6: E-Invoice Reqd + E-Way Reqd */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">E-Invoice Reqd (Y/N)</Label>
              <Select
                value={draft.e_invoice_reqd}
                onValueChange={(v) => setField("e_invoice_reqd", v as "Y" | "N")}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Y">Y — Yes</SelectItem>
                  <SelectItem value="N">N — No</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Auto from computeEInvoiceRequired (editable)
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">E-Way Reqd (Y/N)</Label>
              <Select
                value={draft.e_way_reqd ?? undefined}
                onValueChange={(v) => setField("e_way_reqd", v as "Y" | "N")}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Y">Y — Yes</SelectItem>
                  <SelectItem value="N">N — No</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Auto when Bill Amt ≥ ₹50,000</p>
            </div>
          </div>

          {/* Row 7: Generate E-Way within E-Invoice + Update Port Address */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-2 rounded-md border bg-white px-3 py-2">
              <Checkbox
                id="gen-eway"
                checked={draft.generate_eway_within_einvoice}
                onCheckedChange={(v) =>
                  setField("generate_eway_within_einvoice", Boolean(v))
                }
              />
              <Label htmlFor="gen-eway" className="text-xs font-medium cursor-pointer">
                Generate E-Way within E-Invoice
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="port-addr" className="text-xs font-medium">
                Update Port Address
              </Label>
              <Input
                id="port-addr"
                value={draft.update_port_address ?? ""}
                onChange={(e) => setField("update_port_address", e.target.value || null)}
                placeholder="Port address (Export/SEZ)"
                className="h-8 bg-white"
              />
            </div>
          </div>

          <Separator className="bg-orange-100" />

          {/* Dispatch Details boxed fieldset */}
          <fieldset className="rounded-lg border border-orange-200 bg-white/60 p-3 space-y-3">
            <legend className="px-2 text-xs font-semibold text-orange-800">
              Dispatch Details
            </legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="disp-name" className="text-xs font-medium">
                  Name
                </Label>
                <Input
                  id="disp-name"
                  value={draft.dispatch_details?.name ?? ""}
                  onChange={(e) => setDispatchField("name", e.target.value || null)}
                  placeholder="Dispatch name"
                  className="h-8 bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disp-place" className="text-xs font-medium">
                  Place
                </Label>
                <Input
                  id="disp-place"
                  value={draft.dispatch_details?.place ?? ""}
                  onChange={(e) => setDispatchField("place", e.target.value || null)}
                  placeholder="Place"
                  className="h-8 bg-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="disp-addr" className="text-xs font-medium">
                  Address
                </Label>
                <Input
                  id="disp-addr"
                  value={
                    draft.dispatch_details?.address ??
                    draft.dispatch_details?.addr1 ??
                    ""
                  }
                  onChange={(e) => {
                    setDispatchField("address", e.target.value || null);
                    // keep addr1 in sync for doc parity
                    setDispatchField("addr1", e.target.value || null);
                  }}
                  placeholder="Dispatch address"
                  className="h-8 bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disp-pin" className="text-xs font-medium">
                  PIN
                </Label>
                <Input
                  id="disp-pin"
                  value={draft.dispatch_details?.pin_code ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setDispatchField("pin_code", v || null);
                  }}
                  placeholder="6-digit PIN"
                  className="h-8 bg-white font-mono text-xs"
                  maxLength={6}
                  inputMode="numeric"
                />
                {errors.dispatch_pin ? (
                  <p className="text-[11px] text-destructive">{errors.dispatch_pin}</p>
                ) : dispatchPinHelper ? (
                  <p className="text-[11px] text-emerald-700">State: {dispatchPinHelper}</p>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">State</Label>
                <Select
                  value={dispatchStateCode}
                  onValueChange={(v) => {
                    const name = GSTIN_STATE_CODES[v] ?? null;
                    setDispatchField("state_code", v || null);
                    setDispatchField("state", name);
                  }}
                >
                  <SelectTrigger className="bg-white h-8">
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(GSTIN_STATE_CODES).map(([code, name]) => (
                      <SelectItem key={code} value={code}>
                        {code} — {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disp-gstin" className="text-xs font-medium">
                  GSTIN
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="disp-gstin"
                    value={draft.dispatch_details?.gstin ?? ""}
                    onChange={(e) =>
                      setDispatchField("gstin", e.target.value.toUpperCase() || null)
                    }
                    placeholder="22AAAAA0000A1Z5"
                    className="h-8 bg-white font-mono text-xs tracking-wider flex-1"
                    maxLength={15}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 bg-white"
                    onClick={handleValidateDispatchGstin}
                  >
                    Validate
                  </Button>
                </div>
                {errors.dispatch_gstin && (
                  <p className="text-[11px] text-destructive">{errors.dispatch_gstin}</p>
                )}
              </div>
            </div>
          </fieldset>

          <Separator className="bg-orange-100" />

          {/* Compliance display-only */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              Compliance — pasted via other modals (display only)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">E-Way Bill No</Label>
                <Input
                  value={draft.eway_bill_no ?? ""}
                  readOnly
                  placeholder="12-digit EWB (paste via E-Way modal)"
                  className="h-8 bg-muted font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">E-Way Bill Date</Label>
                <Input
                  value={draft.eway_bill_date ?? ""}
                  readOnly
                  placeholder="YYYY-MM-DD"
                  className="h-8 bg-muted text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">E-Way Valid Till</Label>
                <Input
                  value={draft.eway_bill_valid_till ?? ""}
                  readOnly
                  placeholder="YYYY-MM-DD"
                  className="h-8 bg-muted text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">E-Invoice Ack No</Label>
                <Input
                  value={draft.einvoice_ack_no ?? ""}
                  readOnly
                  placeholder="15-digit Ack No"
                  className="h-8 bg-muted font-mono text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">E-Invoice Ack Date</Label>
                <Input
                  value={draft.einvoice_ack_date ?? ""}
                  readOnly
                  placeholder="YYYY-MM-DD"
                  className="h-8 bg-muted text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">IRN (64-hex)</Label>
                <Input
                  value={draft.einvoice_irn ?? ""}
                  readOnly
                  placeholder="IRN — pasted via E-Invoice modal"
                  className="h-8 bg-muted font-mono text-[11px]"
                />
              </div>
            </div>
            {draft.einvoice_qr && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Signed QR</Label>
                <Input
                  value={draft.einvoice_qr}
                  readOnly
                  className="h-8 bg-muted font-mono text-[11px] truncate"
                />
              </div>
            )}
          </div>
        </div>

        {/* purple footer sums — centered */}
        <div className="shrink-0 bg-[#6D28D9] px-4 py-2 text-center text-white text-xs font-medium tracking-wide">
          Bill Amt : ₹{fmt(billAmt)} ; Taxable Amt : ₹{fmt(taxableAmt)} ; Tax Amt : ₹{fmt(taxAmt)}
        </div>

        {/* bottom buttons */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-4 py-3 bg-white border-t">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="text-xs">
            Esc-Quit
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handlePickFromDatabase}
            className="text-xs border-dashed"
          >
            F4-Pick From Database
          </Button>
          <Button type="button" onClick={handleSave} className="bg-[#EA580C] hover:bg-[#C2410C] text-white text-xs">
            F2-Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Re-export DEFAULT for convenience
export { DEFAULT_TRANSPORT };
