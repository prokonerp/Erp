import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/hooks/useConfirm";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export function UserRolesPanel({ isAdmin }: { isAdmin: boolean }) {  const confirm = useConfirm();

  const [rows, setRows] = useState<any[]>([]);
  const [uid, setUid] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  async function load() {
    const { data, error } = await supabase.from("user_roles").select("id,user_id,role,created_at").order("created_at", { ascending: false }).limit(200);
    if (error) toast.error(error.message);
    setRows(data ?? []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!uid.trim()) return toast.error("Enter a user ID");
    const { error } = await supabase.from("user_roles").insert({ user_id: uid.trim(), role });
    if (error) return toast.error(error.message);
    toast.success("Role assigned");
    setUid("");
    load();
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Remove this role?",
      description: "The role is unassigned from the user but the role itself is kept.",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("user_roles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Users &amp; Roles</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && (
          <div className="border rounded-md p-3 bg-muted/30 grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-2 items-end">
            <div>
              <Label className="text-xs">User ID (UUID)</Label>
              <Input value={uid} onChange={(e) => setUid(e.target.value)} placeholder="auth user id" />
            </div>
            <div>
              <Label className="text-xs">Role</Label>
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={role} onChange={(e) => setRole(e.target.value as any)}>
                <option value="admin">admin</option>
                <option value="user">user</option>
              </select>
            </div>
            <Button onClick={add}><Plus className="h-4 w-4 mr-1" />Assign</Button>
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          Tip: get a user's ID from Backend → Auth → Users, then assign roles here.
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Assigned</TableHead>
                {isAdmin && <TableHead className="w-20">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={isAdmin ? 4 : 3} className="text-sm text-muted-foreground">No roles assigned yet.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.user_id}</TableCell>
                  <TableCell className="text-sm">{r.role}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}