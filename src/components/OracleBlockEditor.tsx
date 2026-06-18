import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, FileText, Receipt, Lock, LockOpen, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { oracleIsComplete, oracleStatus, type OracleBlock } from "@/lib/indent";

type DefectivePart = { name?: string; model_no?: string; serial?: string; qty?: string | number };
type Warehouse = { id: string; name: string; code: string };
type StockRow = { id: string; part_name: string; part_model_no: string | null; part_serial_no: string | null; warehouse_id: string | null; warehouse_name?: string };

export function OracleBlockEditor({
  index, value, onChange, onRemove, defectiveParts, isAdmin = false,
}: {
  index: number;
  value: OracleBlock;
  onChange: (v: OracleBlock) => void;
  onRemove: () => void;
  defectiveParts: DefectivePart[];
  isAdmin?: boolean;
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [exchStock, setExchStock] = useState<StockRow[]>([]);
  const [recvStock, setRecvStock] = useState<StockRow[]>([]);
  const [shortageOpen, setShortageOpen] = useState(false);
  const [shortageMsg, setShortageMsg] = useState<string>("");
  const [shortageHasOther, setShortageHasOther] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const status = oracleStatus(value);
  const closed = status === "closed";
  const complete = oracleIsComplete(value);
  const locked = closed && !isAdmin;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("warehouses").select("id,name,code").eq("status", "Active").order("name");
      setWarehouses((data || []) as Warehouse[]);
    })();
  }, []);

  useEffect(() => {
    if (!value.exchange.warehouse_id) { setExchStock([]); return; }
    (async () => {
      const { data } = await supabase.from("ims_stock_items")
        .select("id,part_name,part_model_no,part_serial_no,warehouse_id")
        .eq("warehouse_id", value.exchange.warehouse_id)
        .eq("stock_status", "available")
        .order("part_name");
      setExchStock((data || []) as StockRow[]);
    })();
  }, [value.exchange.warehouse_id]);

  useEffect(() => {
    if (!value.received.warehouse_id) { setRecvStock([]); return; }
    (async () => {
      const { data } = await supabase.from("ims_stock_items")
        .select("id,part_name,part_model_no,part_serial_no,warehouse_id")
        .eq("warehouse_id", value.received.warehouse_id)
        .order("part_name");
      setRecvStock((data || []) as StockRow[]);
    })();
  }, [value.received.warehouse_id]);

  const set = (patch: Partial<OracleBlock>) => onChange({ ...value, ...patch });

  const confirmClose = async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id || null;
    const meta = (u.user?.user_metadata || {}) as { full_name?: string; name?: string };
    const name = meta.full_name || meta.name || u.user?.email || null;
    onChange({
      ...value,
      status: "closed",
      closed_by: uid,
      closed_by_name: name,
      closed_at: new Date().toISOString(),
    });
    setCloseOpen(false);
    toast.success(`Oracle #${index + 1} closed`);
  };

  const reopen = () => {
    onChange({ ...value, status: "open", closed_by: null, closed_by_name: null, closed_at: null });
    toast.success(`Oracle #${index + 1} reopened`);
  };

  // Defective dropdown: list ticket defective parts
  const defOptions = useMemo(
    () => defectiveParts.filter((p) => (p.model_no || "").trim() || (p.serial || "").trim() || (p.name || "").trim()),
    [defectiveParts],
  );

  // Exchange model options (distinct part_name + part_model_no) within selected warehouse
  const exchModels = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; label: string; part_name: string; model_no: string }[] = [];
    for (const s of exchStock) {
      const key = `${s.part_name}||${s.part_model_no || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: s.part_model_no ? `${s.part_name} — ${s.part_model_no}` : s.part_name, part_name: s.part_name, model_no: s.part_model_no || "" });
    }
    return out;
  }, [exchStock]);

  const exchSerials = useMemo(
    () => exchStock.filter((s) => s.part_name === value.exchange.model_no.split("||")[0] && (s.part_model_no || "") === (value.exchange.model_no.split("||")[1] || "")),
    [exchStock, value.exchange.model_no],
  );

  const recvModels = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; label: string }[] = [];
    for (const s of recvStock) {
      const key = `${s.part_name}||${s.part_model_no || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: s.part_model_no ? `${s.part_name} — ${s.part_model_no}` : s.part_name });
    }
    return out;
  }, [recvStock]);

  const recvSerials = useMemo(
    () => recvStock.filter((s) => s.part_name === value.received.model_no.split("||")[0] && (s.part_model_no || "") === (value.received.model_no.split("||")[1] || "")),
    [recvStock, value.received.model_no],
  );

  const checkStockAndValidate = async (qtyStr: string) => {
    const qty = parseInt(qtyStr, 10);
    if (!qty || !value.exchange.warehouse_id || !value.exchange.model_no) return;
    const [partName, modelNo] = value.exchange.model_no.split("||");
    const here = exchStock.filter((s) => s.part_name === partName && (s.part_model_no || "") === modelNo).length;
    if (qty <= here) return;
    // Check other warehouses
    const { data: others } = await supabase.from("ims_stock_items")
      .select("id,warehouse_id")
      .eq("stock_status", "available")
      .eq("part_name", partName)
      .neq("warehouse_id", value.exchange.warehouse_id);
    const otherCount = (others || []).filter((s) => true).length;
    const totalElsewhere = otherCount;
    if (totalElsewhere > 0) {
      setShortageHasOther(true);
      setShortageMsg(`Only ${here} available in selected warehouse. ${totalElsewhere} available across other warehouses.`);
    } else {
      setShortageHasOther(false);
      setShortageMsg(`Insufficient stock available across all warehouses. Purchase/Order required.`);
    }
    setShortageOpen(true);
  };

  return (
    <Card className={`border-2 ${closed ? "border-emerald-500/60 bg-emerald-500/5" : ""}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Oracle #{index + 1}</CardTitle>
          <Badge variant={closed ? "default" : "secondary"}>{closed ? "Closed" : "Open"}</Badge>
          {closed && (
            <span className="text-xs text-muted-foreground">
              by {value.closed_by_name || "—"} · {value.closed_at ? new Date(value.closed_at).toLocaleString() : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {closed ? (
            isAdmin ? (
              <Button variant="outline" size="sm" onClick={reopen}>
                <LockOpen className="h-4 w-4 mr-1" />Reopen
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground inline-flex items-center"><Lock className="h-3 w-3 mr-1" />Locked</span>
            )
          ) : (
            <Button
              variant="default"
              size="sm"
              disabled={!complete}
              title={complete ? "Close this Oracle" : "Fill all mandatory fields to enable"}
              onClick={() => setCloseOpen(true)}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />Close Oracle
            </Button>
          )}
          {!closed && (
            <Button variant="ghost" size="icon" onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
          )}
        </div>
      </CardHeader>
      <CardContent className={`space-y-4 ${locked ? "pointer-events-none opacity-80" : ""}`}>
        <div className="max-w-xs">
          <Label>Oracle Number</Label>
          <Input
            type="text"
            inputMode="numeric"
            value={value.oracle_no}
            onChange={(e) => set({ oracle_no: e.target.value.replace(/[^0-9]/g, "") })}
            placeholder="Enter Oracle # from external system"
            readOnly={locked}
          />
        </div>

        {/* Defective */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="text-sm font-semibold">A. Defective Parts (from Ticket)</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <Label>Defective Part</Label>
              <Select
                value={value.defective.def_serial_no || value.defective.def_model_no || ""}
                onValueChange={(v) => {
                  const found = defOptions.find((p) => (p.serial || p.model_no || "") === v);
                  if (found) {
                    set({ defective: {
                      def_model_no: found.model_no || "",
                      def_serial_no: found.serial || "",
                      qty: String(found.qty ?? value.defective.qty ?? ""),
                    } });
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder={defOptions.length ? "Select defective part from ticket" : "No defective parts captured in ticket"} /></SelectTrigger>
                <SelectContent>
                  {defOptions.map((p, idx) => {
                    const v = p.serial || p.model_no || `part-${idx}`;
                    const label = [p.name, p.model_no, p.serial].filter(Boolean).join(" · ");
                    return <SelectItem key={`${v}-${idx}`} value={v}>{label || `Part ${idx + 1}`}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Qty</Label><Input type="number" min={1} value={value.defective.qty} onChange={(e) => set({ defective: { ...value.defective, qty: e.target.value } })} /></div>
            <div><Label>DEF Part Model No</Label><Input value={value.defective.def_model_no} onChange={(e) => set({ defective: { ...value.defective, def_model_no: e.target.value } })} /></div>
            <div><Label>DEF Part Serial No</Label><Input className="font-mono" value={value.defective.def_serial_no} onChange={(e) => set({ defective: { ...value.defective, def_serial_no: e.target.value.toUpperCase() } })} /></div>
          </div>
        </div>

        {/* Exchange */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">B. Material Exchange (from IMS)</div>
            <Button variant="outline" size="sm" onClick={() => toast.info("Delivery Challan generation coming soon")}>
              <FileText className="h-4 w-4 mr-1" />Generate Delivery Challan
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label>Warehouse</Label>
              <Select
                value={value.exchange.warehouse_id}
                onValueChange={(v) => {
                  const w = warehouses.find((x) => x.id === v);
                  set({ exchange: { ...value.exchange, warehouse_id: v, warehouse_name: w?.name || "", model_no: "", serial_no: "" } });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Material Exchange Model</Label>
              <Select
                value={value.exchange.model_no}
                onValueChange={(v) => set({ exchange: { ...value.exchange, model_no: v, serial_no: "" } })}
                disabled={!value.exchange.warehouse_id}
              >
                <SelectTrigger><SelectValue placeholder={value.exchange.warehouse_id ? "Select model" : "Pick warehouse first"} /></SelectTrigger>
                <SelectContent>{exchModels.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Material Exchange Serial</Label>
              <Select
                value={value.exchange.serial_no}
                onValueChange={(v) => set({ exchange: { ...value.exchange, serial_no: v } })}
                disabled={!value.exchange.model_no}
              >
                <SelectTrigger><SelectValue placeholder={value.exchange.model_no ? "Select serial" : "Pick model first"} /></SelectTrigger>
                <SelectContent>{exchSerials.map((s) => <SelectItem key={s.id} value={s.part_serial_no || s.id}>{s.part_serial_no || "(no serial)"}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Qty</Label>
              <Input
                type="number" min={1}
                value={value.exchange.qty}
                onChange={(e) => set({ exchange: { ...value.exchange, qty: e.target.value } })}
                onBlur={(e) => checkStockAndValidate(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Received */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">C. Material Received (from IMS)</div>
            <Button variant="outline" size="sm" onClick={() => toast.info("GRN generation coming soon")}>
              <Receipt className="h-4 w-4 mr-1" />Generate GRN
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Warehouse</Label>
              <Select
                value={value.received.warehouse_id}
                onValueChange={(v) => {
                  const w = warehouses.find((x) => x.id === v);
                  set({ received: { ...value.received, warehouse_id: v, warehouse_name: w?.name || "", model_no: "", serial_no: "" } });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Material Rec Model No</Label>
              <Select
                value={value.received.model_no}
                onValueChange={(v) => set({ received: { ...value.received, model_no: v, serial_no: "" } })}
                disabled={!value.received.warehouse_id}
              >
                <SelectTrigger><SelectValue placeholder={value.received.warehouse_id ? "Select model" : "Pick warehouse first"} /></SelectTrigger>
                <SelectContent>{recvModels.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Material Rec Serial No</Label>
              <Select
                value={value.received.serial_no}
                onValueChange={(v) => set({ received: { ...value.received, serial_no: v } })}
                disabled={!value.received.model_no}
              >
                <SelectTrigger><SelectValue placeholder={value.received.model_no ? "Select serial" : "Pick model first"} /></SelectTrigger>
                <SelectContent>{recvSerials.map((s) => <SelectItem key={s.id} value={s.part_serial_no || s.id}>{s.part_serial_no || "(no serial)"}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Qty</Label><Input type="number" min={1} value={value.received.qty} onChange={(e) => set({ received: { ...value.received, qty: e.target.value } })} /></div>
            <div><Label>Material Rec Date</Label><Input type="date" value={value.received.received_date} onChange={(e) => set({ received: { ...value.received, received_date: e.target.value } })} /></div>
            <div className="md:col-span-3"><Label>Remarks</Label><Textarea rows={2} value={value.received.remarks} onChange={(e) => set({ received: { ...value.received, remarks: e.target.value } })} /></div>
          </div>
        </div>
      </CardContent>

      <AlertDialog open={shortageOpen} onOpenChange={setShortageOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{shortageHasOther ? "Stock shortage in selected warehouse" : "Insufficient stock"}</AlertDialogTitle>
            <AlertDialogDescription>
              {shortageMsg}
              {shortageHasOther ? " Create Stock Transfer Request?" : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {shortageHasOther && (
              <AlertDialogAction onClick={() => { window.location.href = "/ims/transfers/new"; }}>
                Create Transfer
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Oracle #{index + 1}?</AlertDialogTitle>
            <AlertDialogDescription>
              All Oracle activities have been completed. Are you sure you want to close this Oracle? Closed Oracle fields will be locked from further editing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmClose}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}