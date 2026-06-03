import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { toTitleCaseSmart } from "@/lib/text";

export const Route = createFileRoute("/_app/products")({
  component: ProductsPage,
  head: () => ({ meta: [{ title: "Products — Prokon Gatepass" }] }),
});

type Product = { id: string; name: string; unit: string };
const UNITS = ["Nos", "Pcs", "Set", "Box", "Mtr", "Kg", "Ltr", "Pkt"];

function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("Nos");

  const load = async () => {
    const { data, error } = await supabase.from("products").select("*").order("name");
    if (error) toast.error(error.message);
    else setProducts(data as Product[]);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim()) return toast.error("Enter product name");
    const { error } = await supabase.from("products").insert({ name: toTitleCaseSmart(name), unit });
    if (error) return toast.error(error.message);
    toast.success("Product added");
    setName(""); load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removed"); load();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Add Product</CardTitle></CardHeader>
        <CardContent className="flex gap-2 flex-wrap">
          <Input placeholder="Product name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1 min-w-[200px]" />
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={add}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Product Catalog ({products.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Unit</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.unit}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
              {products.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No products yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}