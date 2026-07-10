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
import { Trash2, Plus, KeyRound, Pencil, ShieldAlert, Boxes } from "lucide-react";
import { toast } from "sonner";
import { ModuleKey, ModulePerm, EMPTY_PERM } from "@/lib/permissions";
import { useModules, type AppModule } from "@/lib/useModules";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { computeActivityStatus, type ActivityStatus } from "@/lib/useActivityTracker";
import { ArrowUpDown } from "lucide-react";

function ActivityBadge({ status }: { status: ActivityStatus }) {
  const map: Record<ActivityStatus, { label: string; dot: string; cls: string }> = {
    active:  { label: "Active",  dot: "bg-emerald-500", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
    idle:    { label: "Idle",    dot: "bg-amber-500",   cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
    offline: { label: "Offline", dot: "bg-zinc-500",    cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" },
    never:   { label: "Never",   dot: "bg-zinc-300",    cls: "border-zinc-300/60 bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
  };
  const m = map[status];
  return (
    <Badge variant="outline" className={`gap-1.5 ${m.cls}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </Badge>
  );
}

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
  can_export: boolean;
  can_import: boolean;
};
type AppUser = {
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role_id: string | null;
  status: string;
  custom_permissions: any;
  last_login?: string | null;
  last_activity?: string | null;
  last_logout?: string | null;
  login_count?: number | null;
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
        <TabsTrigger value="modules">Modules</TabsTrigger>
      </TabsList>
      <TabsContent value="users" className="mt-4">
        <UsersSection />
      </TabsContent>
      <TabsContent value="roles" className="mt-4">
        <RolesSection />
      </TabsContent>
      <TabsContent value="modules" className="mt-4">
        <ModulesSection />
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
          can_export: !!row.can_export,
          can_import: !!row.can_import,
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
      next.can_export = false;
      next.can_import = false;
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
  const { modules } = useModules();
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Module</TableHead>
            <TableHead className="text-center">Access</TableHead>
            <TableHead className="text-center">View</TableHead>
            <TableHead className="text-center">Create</TableHead>
            <TableHead className="text-center">Edit</TableHead>
            <TableHead className="text-center">Delete</TableHead>
            <TableHead className="text-center">Export</TableHead>
            <TableHead className="text-center">Import</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {modules.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-sm text-muted-foreground">
                No modules defined yet. Add one from the Modules tab.
              </TableCell>
            </TableRow>
          ) : modules.map((m) => {
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
                {(["can_read", "can_create", "can_edit", "can_delete", "can_export"] as const).map((c) => (
                  <TableCell key={c} className="text-center">
                    <Checkbox
                      checked={!!p[c]}
                      disabled={disabled}
                      onCheckedChange={(v) => onChange(m.key, { [c]: !!v } as any)}
                    />
                  </TableCell>
                ))}
                <TableCell className="text-center">
                  {m.supports_import ? (
                    <Checkbox
                      checked={!!p.can_import}
                      disabled={disabled}
                      onCheckedChange={(v) => onChange(m.key, { can_import: !!v })}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
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
  const [activityFilter, setActivityFilter] = useState<ActivityStatus | "all">("all");
  const [sortBy, setSortBy] = useState<"activity" | "last_login" | "last_activity" | "login_count" | "name">("activity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const callListAuth = useServerFn(listAuthUsers);
  const callCreate = useServerFn(createAppUser);
  const callUpdate = useServerFn(updateAppUser);
  const callPwd = useServerFn(setUserPassword);
  const callDel = useServerFn(deleteAppUser);
  const [authLoading, setAuthLoading] = useState(true);

  async function load() {
    const [{ data: au }, { data: r }, { data: ur }] = await Promise.all([
      supabase.from("app_users").select("*").order("created_at", { ascending: false }),
      supabase.from("app_roles").select("*").order("name"),
      supabase.from("user_roles").select("user_id").eq("role", "admin"),
    ]);
    setAppUsers((au as AppUser[]) ?? []);
    setRoles((r as Role[]) ?? []);
    setAdminIds(new Set((ur ?? []).map((x: any) => x.user_id)));
    setAuthLoading(true);
    try {
      const res = await callListAuth();
      setAuthUsers(res.users);
      (window as any).__authUsers = res.users;
    } catch (e: any) {
      console.error("listAuthUsers failed:", e?.message ?? e);
      (window as any).__authErr = String(e?.message ?? e);
    } finally {
      setAuthLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const roleName = (id: string | null) => roles.find((r) => r.id === id)?.name ?? "—";
  const authMap = useMemo(() => {
    const m = new Map<string, { email: string | null; last_sign_in_at: string | null }>();
    authUsers.forEach((u) => m.set(u.id, { email: u.email, last_sign_in_at: u.last_sign_in_at ?? null }));
    return m;
  }, [authUsers]);

  const rows = useMemo(() => {
    const nowMs = Date.now();
    void tick; // recompute periodically
    const withStatus = appUsers.map((u) => ({
      u,
      status: computeActivityStatus({
        last_login: u.last_login ?? null,
        last_activity: u.last_activity ?? null,
        last_logout: u.last_logout ?? null,
      }, nowMs),
    }));
    const filtered = activityFilter === "all" ? withStatus : withStatus.filter((r) => r.status === activityFilter);
    const cmp = (a: typeof filtered[number], b: typeof filtered[number]) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const g = (v: string | null | undefined) => (v ? Date.parse(v) : 0);
      switch (sortBy) {
        case "name": return dir * ((a.u.name ?? "").localeCompare(b.u.name ?? ""));
        case "last_login": return dir * (g(a.u.last_login) - g(b.u.last_login));
        case "last_activity": return dir * (g(a.u.last_activity) - g(b.u.last_activity));
        case "login_count": return dir * ((a.u.login_count ?? 0) - (b.u.login_count ?? 0));
        case "activity":
        default: {
          const order: Record<ActivityStatus, number> = { active: 3, idle: 2, offline: 1, never: 0 };
          return dir * (order[a.status] - order[b.status]);
        }
      }
    };
    return [...filtered].sort(cmp);
  }, [appUsers, activityFilter, sortBy, sortDir, tick]);

  const toggleSort = (key: typeof sortBy) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("desc"); }
  };
  const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "—");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Users</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={activityFilter} onValueChange={(v) => setActivityFilter(v as any)}>
            <SelectTrigger className="h-8 w-[170px]">
              <SelectValue placeholder="Activity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All activity</SelectItem>
              <SelectItem value="active">🟢 Active</SelectItem>
              <SelectItem value="idle">🟡 Idle</SelectItem>
              <SelectItem value="offline">⚫ Offline</SelectItem>
              <SelectItem value="never">⚪ Never Logged In</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> New user
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("name")}>
                    Name <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("activity")}>
                    Activity <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead>
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("last_login")}>
                    Last Login <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead>
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("last_activity")}>
                    Last Activity <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead>Last Logout</TableHead>
                <TableHead>
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("login_count")}>
                    Logins <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-sm text-muted-foreground">
                    No users yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(({ u, status }) => {
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
                      <TableCell><ActivityBadge status={status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {u.last_login ? fmt(u.last_login) : (a?.last_sign_in_at ? fmt(a.last_sign_in_at) : (authLoading ? "Loading…" : "—"))}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(u.last_activity)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(u.last_logout)}</TableCell>
                      <TableCell className="text-xs tabular-nums">{u.login_count ?? 0}</TableCell>
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
          can_export: !!row.can_export,
          can_import: !!row.can_import,
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
        next.can_export = false; next.can_import = false;
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
/* ---------------- Modules registry ---------------- */
function ModulesSection() {
  const { modules, loading, reload } = useModules({ includeInactive: true });
  const [busy, setBusy] = useState(false);
  const [k, setK] = useState("");
  const [lbl, setLbl] = useState("");
  const [imp, setImp] = useState(false);

  async function add() {
    if (!k.trim() || !lbl.trim()) return toast.error("Key and label required");
    setBusy(true);
    const sort_order = (modules[modules.length - 1]?.sort_order ?? 0) + 10;
    const { error } = await supabase.from("app_modules").insert({
      key: k.trim().toLowerCase(),
      label: lbl.trim(),
      supports_import: imp,
      sort_order,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setK(""); setLbl(""); setImp(false);
    toast.success("Module added");
    reload();
  }

  async function toggle(m: AppModule, patch: Partial<AppModule>) {
    const { error } = await supabase.from("app_modules").update(patch).eq("key", m.key);
    if (error) return toast.error(error.message);
    reload();
  }

  async function remove(m: AppModule) {
    if (!confirm(`Delete module "${m.label}"? This will remove all role permissions for it.`)) return;
    const { error } = await supabase.from("app_modules").delete().eq("key", m.key);
    if (error) return toast.error(error.message);
    await supabase.from("role_module_permissions").delete().eq("module", m.key);
    toast.success("Deleted");
    reload();
  }

  return (
    <div className="grid md:grid-cols-[1fr_320px] gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modules</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead className="text-center">Supports Import</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modules.map((m) => (
                  <TableRow key={m.key}>
                    <TableCell className="font-mono text-xs">{m.key}</TableCell>
                    <TableCell>
                      <Input
                        defaultValue={m.label}
                        onBlur={(e) => e.target.value !== m.label && toggle(m, { label: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={m.supports_import}
                        onCheckedChange={(v) => toggle(m, { supports_import: v })}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={m.is_active}
                        onCheckedChange={(v) => toggle(m, { is_active: v })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => remove(m)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Boxes className="h-4 w-4" /> Add module
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <Label className="text-xs">Key (lowercase, no spaces)</Label>
            <Input value={k} onChange={(e) => setK(e.target.value)} placeholder="e.g. inventory" />
          </div>
          <div>
            <Label className="text-xs">Label</Label>
            <Input value={lbl} onChange={(e) => setLbl(e.target.value)} placeholder="e.g. Inventory" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={imp} onCheckedChange={setImp} id="imp" />
            <Label htmlFor="imp" className="text-sm">Supports CSV import</Label>
          </div>
          <Button size="sm" className="w-full" onClick={add} disabled={busy}>
            <Plus className="h-4 w-4 mr-1" /> Add module
          </Button>
          <div className="text-xs text-muted-foreground pt-2">
            New modules appear automatically in Roles &amp; Permissions and on the per-user
            override grid. Removing a module also drops its role permissions.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
