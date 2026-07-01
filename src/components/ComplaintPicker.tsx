import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { toTitleCaseSmart } from "@/lib/text";

type Row = { id: string; name: string; active: boolean };

export function ComplaintPicker({
  value,
  onChange,
  placeholder = "Select complaint…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("complaint_master" as never)
      .select("id,name,active")
      .order("name");
    const list = ((data ?? []) as Row[]).filter((r) => r.active !== false);
    // Ensure current value is present even if inactive/legacy
    if (value && !list.some((r) => r.name.toLowerCase() === value.toLowerCase())) {
      list.unshift({ id: `legacy-${value}`, name: value, active: true });
    }
    setRows(list);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [value]);

  const handleChange = (v: string) => {
    if (v === "__add_new__") {
      setName("");
      setOpen(true);
      return;
    }
    onChange(v);
  };

  const save = async () => {
    const clean = toTitleCaseSmart(name.trim());
    if (!clean) { toast.error("Enter a complaint name"); return; }
    const dup = rows.find((r) => r.name.toLowerCase() === clean.toLowerCase());
    if (dup) { onChange(dup.name); setOpen(false); return; }
    setSaving(true);
    const { error } = await supabase
      .from("complaint_master" as never)
      .insert({ name: clean } as never);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Complaint added");
    setOpen(false);
    onChange(clean);
    load();
  };

  return (
    <>
      <Select value={value || ""} onValueChange={handleChange}>
        <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {rows.map((r) => (
            <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
          ))}
          <SelectItem value="__add_new__">
            <span className="flex items-center gap-1 text-primary"><Plus className="h-3 w-3" /> Add new complaint…</span>
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add New Complaint</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Complaint Name</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fan Not Working"
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}