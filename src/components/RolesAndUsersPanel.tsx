import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  listAuthUsers,
  createAppUser,
  updateAppUser,
  setUserPassword,
  deleteAppUser,
} from "@/lib/admin-users.functions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, Plus, KeyRound, Pencil, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { MODULES, ModuleKey, ModulePerm, EMPTY_PERM, FULL_PERM } from "@/lib/permissions";

type Role = { id: string; name: string; description: string | null; is_system: boolean };
type Perm = {
  id: string;
  role_id: string;
  module: string;
  enable_access: boolean;
  can_read: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
};
type AppUser = {
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role_id: string | null;
  status: string;
  custom_permissions: any;
};

export function RolesAndUsersPanel({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" /> Admins only
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Roles and user management is restricted to admins.
        </CardContent>
      </Card>
    );
  }
  return (
    <Tabs defaultValue="users" className="w-full">
      <TabsList>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="roles">Roles &amp; Permissions</TabsTrigger>
      </TabsList>
      <TabsContent value="users" className="mt-4">
        <UsersSection />
      </TabsContent>
      <TabsContent value="roles" className="mt-4">
        <RolesSection />
      </TabsContent>
    </Tabs>
  );
}

/* ---------------- Roles + permission matrix ---------------- */
function RolesSection() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add role state
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  async function load() {
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("app_roles").select("*").order("name"),
      supabase.from("role_module_permissions").select("*"),
    ]);
    setRoles((r as Role[]) ?? []);
    setPerms((p as Perm[]) ?? []);
    if (!selected && r && r.length) setSelected((r as Role[])[0].id);
  }
  useEffect(() => {
    load();
  }, []);

  async function addRole() {
    if (!newName.trim()) return toast.error("Role name required");
    setBusy(true);
    const { data, error } = await supabase
      .from("app_roles")
      .insert({ name: newName.trim(), description: newDesc.trim() || null })
      .select()
      .single();
    setBusy(false);
    if (error) return toast.error(error.message);
    setNewName("");
    setNewDesc("");
    toast.success("Role created");
    setSelected(data!.id);
    await load();
  }

  async function deleteRole(r: Role) {
    if (r.is_system) return toast.error("System roles cannot be deleted");
    if (!confirm(`Delete role "${r.name}"?`)) return;
    const { error } = await supabase.from("app_roles").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    if (selected === r.id) setSelected(null);
    load();
  }

  const role = roles.find((r) => r.id === selected) ?? null;
  const permFor = (mod: ModuleKey): ModulePerm => {
    const row = perms.find((p) => p.role_id === selected && p.module === mod);
    return row
      ? {
          enable_access: row.enable_access,
          can_read: row.can_read,
          can_create: row.can_create,
          can_edit: row.can_edit,
          can_delete: row.can_delete,
        }
      : EMPTY_PERM;
  };

  async function updatePerm(mod: ModuleKey, patch: Partial<ModulePerm>) {
    if (!selected) return;
    if (role?.name === "Admin") return toast.info("Admin role is full-access");
    const current = permFor(mod);
    const next = { ...current, ...patch };
    if (!next.enable_access) {
      next.can_read = false;
      next.can_create = false;
      next.can_edit = false;
      next.can_delete = false;
    }
    const { error } = await supabase
      .from("role_module_permissions")
      .upsert(
        { role_id: selected, module: mod, ...next },
        { onConflict: "role_id,module" },
      );
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            {roles.map((r) => (
              <div
                key={r.id}
                className={`flex items-center justify-between rounded-md border px-2 py-1.5 cursor-pointer ${
                  selected === r.id ? "bg-muted" : ""
                }`}
                onClick={() => setSelected(r.id)}
              >
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  {r.description && (
                    <div className="text-xs text-muted-foreground">{r.description}</div>
                  )}
                </div>
                {!r.is_system && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteRole(r);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="border-t pt-3 space-y-2">
            <Label className="text-xs">New role</Label>
            <Input
              placeholder="Role name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Textarea
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
            />
            <Button size="sm" className="w-full" onClick={addRole} disabled={busy}>
              <Plus className="h-4 w-4 mr-1" /> Add role
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Permissions {role && <span className="text-muted-foreground">— {role.name}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!role ? (
            <div className="text-sm text-muted-foreground">Select a role.</div>
          ) : role.name === "Admin" ? (
            <div className="text-sm text-muted-foreground">
              Admin role has full access to all modules and cannot be restricted.
            </div>
          ) : (
            <PermissionMatrix
              getPerm={permFor}
              onChange={updatePerm}
              readOnly={false}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PermissionMatrix({
  getPerm,
  onChange,
  readOnly,
}: {
  getPerm: (mod: ModuleKey) => ModulePerm;
  onChange: (mod: ModuleKey, patch: Partial<ModulePerm>) => void;
  readOnly: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Module</TableHead>
            <TableHead className="text-center">Access</TableHead>
            <TableHead className="text-center">Read</TableHead>
            <TableHead className="text-center">Create</TableHead>
            <TableHead className="text-center">Edit</TableHead>
            <TableHead className="text-center">Delete</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {MODULES.map((m) => {
            const p = getPerm(m.key);
            const disabled = readOnly || !p.enable_access;
            return (
              <TableRow key={m.key}>
                <TableCell className="font-medium">{m.label}</TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={p.enable_access}
                    disabled={readOnly}
                    onCheckedChange={(v) => onChange(m.key, { enable_access: v })}
                  />
                </TableCell>
                {(["can_read", "can_create", "can_edit", "can_delete"] as const).map((c) => (
                  <TableCell key={c} className="text-center">
                    <Checkbox
                      checked={p[c]}
                      disabled={disabled}
                      onCheckedChange={(v) => onChange(m.key, { [c]: !!v } as any)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---------------- Users section ---------------- */
function UsersSection() {
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [authUsers, setAuthUsers] = useState<
    { id: string; email: string | null; last_sign_in_at: string | null | undefined }[]
  >([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [pwdFor, setPwdFor] = useState<AppUser | null>(null);

  const callListAuth = useServerFn(listAuthUsers);
  const callCreate = useServerFn(createAppUser);
  const callUpdate = useServerFn(updateAppUser);
  const callPwd = useServerFn(setUserPassword);
  const callDel = useServerFn(deleteAppUser);

  async function load() {
    const [{ data: au }, { data: r }, { data: ur }] = await Promise.all([
      supabase.from("app_users").select("*").order("created_at", { ascending: false }),
      supabase.from("app_roles").select("*").order("name"),
      supabase.from("user_roles").select("user_id").eq("role", "admin"),
    ]);
    setAppUsers((au as AppUser[]) ?? []);
    setRoles((r as Role[]) ?? []);
    setAdminIds(new Set((ur ?? []).map((x: any) => x.user_id)));
    try {
      const res = await callListAuth();
      setAuthUsers(res.users);
    } catch (e: any) {
      // ignore
    }
  }
  useEffect(() => {
    load();
  }, []);

  const roleName = (id: string | null) => roles.find((r) => r.id === id)?.name ?? "—";
  const authMap = useMemo(() => {
    const m = new Map<string, { email: string | null; last_sign_in_at: string | null }>();
    authUsers.forEach((u) => m.set(u.id, u));
    return m;
  }, [authUsers]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Users</CardTitle>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> New user
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    No users yet.
                  </TableCell>
                </TableRow>
              ) : (
                appUsers.map((u) => {
                  const a = authMap.get(u.user_id);
                  const admin = adminIds.has(u.user_id);
                  return (
                    <TableRow key={u.user_id}>
                      <TableCell>{u.name ?? "—"}</TableCell>
                      <TableCell>{u.email ?? a?.email ?? "—"}</TableCell>
                      <TableCell>{u.phone ?? "—"}</TableCell>
                      <TableCell>{admin ? "Admin" : roleName(u.role_id)}</TableCell>
                      <TableCell>
                        <span className={u.status === "inactive" ? "text-muted-foreground" : "text-foreground"}>
                          {u.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a?.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => { setEditing(u); setOpen(true); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setPwdFor(u)}>
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={async () => {
                              if (!confirm(`Delete user ${u.email ?? u.user_id}?`)) return;
                              try {
                                await callDel({ data: { user_id: u.user_id } });
                                toast.success("Deleted");
                                load();
                              } catch (e: any) {
                                toast.error(e.message ?? "Failed");
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <UserDialog
        open={open}
        onOpenChange={setOpen}
        user={editing}
        roles={roles}
        perms={[]}
        isAdminFlag={editing ? adminIds.has(editing.user_id) : false}
        onSave={async (payload) => {
          try {
            if (editing) {
              await callUpdate({ data: { user_id: editing.user_id, ...payload } });
            } else {
              if (!payload.email || !payload.password) throw new Error("Email and password required");
              await callCreate({ data: payload as any });
            }
            toast.success("Saved");
            setOpen(false);
            load();
          } catch (e: any) {
            toast.error(e.message ?? "Failed");
          }
        }}
      />

      <PasswordDialog
        user={pwdFor}
        onClose={() => setPwdFor(null)}
        onSave={async (pwd) => {
          if (!pwdFor) return;
          try {
            await callPwd({ data: { user_id: pwdFor.user_id, password: pwd } });
            toast.success("Password updated");
            setPwdFor(null);
          } catch (e: any) {
            toast.error(e.message ?? "Failed");
          }
        }}
      />
    </Card>
  );
}

function UserDialog({
  open,
  onOpenChange,
  user,
  roles,
  isAdminFlag,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: AppUser | null;
  roles: Role[];
  perms: Perm[];
  isAdminFlag: boolean;
  onSave: (payload: any) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState<string | "">("");
  const [status, setStatus] = useState("active");
  const [adminFlag, setAdminFlag] = useState(false);
  const [useCustom, setUseCustom] = useState(false);
  const [customMap, setCustomMap] = useState<Partial<Record<ModuleKey, ModulePerm>>>({});
  const [rolePerms, setRolePerms] = useState<Perm[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? "");
    setEmail(user?.email ?? "");
    setPhone(user?.phone ?? "");
    setPassword("");
    setRoleId(user?.role_id ?? "");
    setStatus(user?.status ?? "active");
    setAdminFlag(isAdminFlag);
    const cp = user?.custom_permissions;
    setUseCustom(cp && typeof cp === "object" && Object.keys(cp).length > 0);
    setCustomMap(cp && typeof cp === "object" ? cp : {});
  }, [open, user, isAdminFlag]);

  useEffect(() => {
    (async () => {
      if (!roleId) return setRolePerms([]);
      const { data } = await supabase
        .from("role_module_permissions")
        .select("*")
        .eq("role_id", roleId);
      setRolePerms((data as Perm[]) ?? []);
    })();
  }, [roleId]);

  const getPerm = (mod: ModuleKey): ModulePerm => {
    if (useCustom && customMap[mod]) return customMap[mod]!;
    const row = rolePerms.find((p) => p.module === mod);
    return row
      ? {
          enable_access: row.enable_access,
          can_read: row.can_read,
          can_create: row.can_create,
          can_edit: row.can_edit,
          can_delete: row.can_delete,
        }
      : EMPTY_PERM;
  };
  const onChangePerm = (mod: ModuleKey, patch: Partial<ModulePerm>) => {
    if (!useCustom) return;
    setCustomMap((m) => {
      const cur = m[mod] ?? getPerm(mod);
      const next = { ...cur, ...patch };
      if (!next.enable_access) {
        next.can_read = false; next.can_create = false; next.can_edit = false; next.can_delete = false;
      }
      return { ...m, [mod]: next };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{user ? "Edit user" : "New user"}</DialogTitle>
        </DialogHeader>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input type="email" value={email} disabled={!!user} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{user ? "Reset password (use key icon)" : "Password"}</Label>
            <Input
              type="password"
              value={password}
              disabled={!!user}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={user ? "—" : "min 6 chars"}
            />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              <option value="">—</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </div>
          <div className="md:col-span-2 flex items-center gap-2 border-t pt-3">
            <Switch checked={adminFlag} onCheckedChange={setAdminFlag} id="adm" />
            <Label htmlFor="adm" className="text-sm">Grant full Admin privileges (overrides role)</Label>
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <Switch checked={useCustom} onCheckedChange={setUseCustom} id="cp" disabled={adminFlag} />
            <Label htmlFor="cp" className="text-sm">Use custom permissions (override role)</Label>
          </div>
          {!adminFlag && (
            <div className="md:col-span-2">
              <PermissionMatrix
                getPerm={getPerm}
                onChange={onChangePerm}
                readOnly={!useCustom}
              />
              {!useCustom && (
                <div className="text-xs text-muted-foreground mt-1">
                  Showing permissions inherited from selected role. Toggle "Use custom permissions" to override.
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() =>
              onSave({
                name: name || null,
                email: email || undefined,
                phone: phone || null,
                password: password || undefined,
                role_id: roleId || null,
                status,
                is_admin: adminFlag,
                custom_permissions: useCustom ? customMap : null,
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({
  user,
  onClose,
  onSave,
}: {
  user: AppUser | null;
  onClose: () => void;
  onSave: (pwd: string) => Promise<void>;
}) {
  const [pwd, setPwd] = useState("");
  useEffect(() => {
    setPwd("");
  }, [user]);
  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set password — {user?.email ?? user?.name}</DialogTitle>
        </DialogHeader>
        <div>
          <Label className="text-xs">New password</Label>
          <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="min 6 chars" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(pwd)} disabled={pwd.length < 6}>Update</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}