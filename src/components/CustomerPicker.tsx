import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users } from "lucide-react";
import type { Customer } from "@/lib/crm";

type Props = {
  onPick: (c: Customer) => void;
  label?: string;
};

export function CustomerPicker({ onPick, label = "Pick from Customer Master" }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    supabase.from("customers").select("*").order("company").limit(500).then(({ data }) => {
      setRows((data || []) as unknown as Customer[]);
    });
  }, [open]);

  const s = q.toLowerCase();
  const filtered = rows.filter((c) =>
    !s || [c.company, c.contact_name, c.phone, c.email, c.gst, c.city, c.state].some((v) => (v || "").toLowerCase().includes(s)),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Users className="h-4 w-4 mr-1" />{label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Select customer</DialogTitle></DialogHeader>
        <div className="mb-2">
          <Label className="text-xs">Search</Label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company, contact, phone, GSTIN…" />
        </div>
        <div className="border rounded-md max-h-[55vh] overflow-y-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Company</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead><TableHead>City</TableHead><TableHead>GSTIN</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/60" onClick={() => { onPick(c); setOpen(false); }}>
                  <TableCell className="font-medium">{c.company}</TableCell>
                  <TableCell>{c.contact_name || "—"}</TableCell>
                  <TableCell>{c.phone || "—"}</TableCell>
                  <TableCell>{c.city || c.state || "—"}</TableCell>
                  <TableCell className="text-xs font-mono">{c.gst || "—"}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No customers found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}