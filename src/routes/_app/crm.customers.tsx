import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/crm/customers")({
  component: () => <Navigate to="/masters/customers" replace />,
});

const empty: Partial<Customer> = {
  company: "", contact_name: "", phone: "", email: "",
  address: "", billing_address: "", shipping_address: "",
  state: "Haryana", gst: "", remarks: "",
};

function CustomersPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Customer>>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("customers").select("*").order("company");
    setRows((data || []) as unknown as Customer[]);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.company?.trim()) { toast.error("Company is required"); return; }
    const payload = {
      ...form,
      company: toTitleCaseSmart(form.company),
      contact_name: toTitleCaseSmart(form.contact_name || ""),
      email: (form.email || "").trim().toLowerCase(),
      gst: upperTrim(form.gst),
      billing_address: titleCaseAddress(form.billing_address || form.address || ""),
      shipping_address: titleCaseAddress(form.shipping_address || ""),
    };
    if (editingId) {
      const { error } = await supabase.from("customers").update(payload as any).eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success("Customer updated");
    } else {
      const { error } = await supabase.from("customers").insert(payload as any);
      if (error) return toast.error(error.message);
      toast.success("Customer added");
    }
    setOpen(false); setForm(empty); setEditingId(null); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete this customer?")) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };

  const edit = (c: Customer) => { setForm(c); setEditingId(c.id); setOpen(true); };

  const copyBillToShip = () => setForm((f) => ({ ...f, shipping_address: f.billing_address || f.address || "" }));

  const filtered = rows.filter((c) => {
    const s = q.toLowerCase();
    return !s || [c.company, c.contact_name, c.phone, c.email, c.gst, c.state].some((v) => (v || "").toLowerCase().includes(s));
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Customer master</CardTitle>
        <div className="flex gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <ExportButtons
            name="Prokon_Customers"
            title="Customer Master"
            rows={filtered}
            columns={[
              { header: "Company", get: (c) => c.company },
              { header: "Contact", get: (c) => c.contact_name || "" },
              { header: "Phone", get: (c) => c.phone || "" },
              { header: "Email", get: (c) => c.email || "" },
              { header: "GSTIN", get: (c) => c.gst || "" },
              { header: "State", get: (c) => c.state || "" },
              { header: "Billing Address", get: (c) => c.billing_address || c.address || "" },
              { header: "Shipping Address", get: (c) => c.shipping_address || "" },
              { header: "Remarks", get: (c) => c.remarks || "" },
            ]}
          />
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(empty); setEditingId(null); } }}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New</Button></DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editingId ? "Edit" : "New"} customer</DialogTitle></DialogHeader>
              <div className="grid md:grid-cols-2 gap-3">
                <div><Label>Company *</Label><Input value={form.company || ""} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
                <div><Label>Contact name</Label><Input value={form.contact_name || ""} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Email</Label><Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label>GSTIN</Label><Input value={form.gst || ""} onChange={(e) => setForm({ ...form, gst: e.target.value })} /></div>
                <div>
                  <Label>State (place of supply)</Label>
                  <Select value={form.state || ""} onValueChange={(v) => setForm({ ...form, state: v })}>
                    <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent>{INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between"><Label>Billing address</Label></div>
                  <Textarea rows={3} value={form.billing_address || form.address || ""} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label>Shipping address</Label>
                    <Button type="button" size="sm" variant="ghost" onClick={copyBillToShip}>Same as billing</Button>
                  </div>
                  <Textarea rows={3} value={form.shipping_address || ""} onChange={(e) => setForm({ ...form, shipping_address: e.target.value })} />
                </div>
                <div className="md:col-span-2"><Label>Remarks</Label><Input value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={save}>{editingId ? "Update" : "Add"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Company</TableHead><TableHead>Contact</TableHead><TableHead>State</TableHead>
            <TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead>GSTIN</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.company}</TableCell>
                <TableCell>{c.contact_name || "—"}</TableCell>
                <TableCell>{c.state || "—"}</TableCell>
                <TableCell>{c.phone || "—"}</TableCell>
                <TableCell>{c.email || "—"}</TableCell>
                <TableCell className="text-xs">{c.gst || "—"}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => edit(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => del(c.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No customers yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
