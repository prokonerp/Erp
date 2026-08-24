import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { changeOwnPassword } from "@/lib/admin-users.functions";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { validateStrongPassword, passwordStrength } from "@/lib/password";
import { Check, X } from "lucide-react";

export function ChangePasswordDialog({
  open,
  onOpenChange,
  forced = false,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  forced?: boolean;
  onChanged?: () => void;
}) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const call = useServerFn(changeOwnPassword);

  const check = validateStrongPassword(next);
  const { score, label } = passwordStrength(next);
  const meterColor =
    label === "Strong" ? "bg-emerald-500" : label === "Medium" ? "bg-amber-500" : "bg-red-500";
  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit() {
    if (!check.ok) return toast.error(check.errors[0]);
    if (next !== confirm) return toast.error("Passwords do not match");
    if (cur === next) return toast.error("New password must differ from current");
    setBusy(true);
    try {
      await call({ data: { current_password: cur, new_password: next } });
      toast.success("Password updated");
      // A password update revokes all sessions server-side, so the old
      // refresh token would die at a random moment mid-work. Re-authenticate
      // cleanly right away instead.
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        await supabase.auth.signOut();
        sessionStorage.setItem("password-changed", "1");
        window.location.href = "/auth";
        return;
      } catch {
        // fall through to normal close if local cleanup fails
      }
      setCur(""); setNext(""); setConfirm("");
      onChanged?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (forced && !v) return; // can't dismiss when forced
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md" onInteractOutside={(e) => forced && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          {forced && (
            <DialogDescription className="text-destructive">
              Your password has expired or must be changed. Please set a new password to continue.
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Current password</Label>
            <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          </div>
          <div>
            <Label className="text-xs">New password</Label>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            {next.length > 0 && (
              <div className="mt-1.5 space-y-1">
                <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
                  <div className={`h-full ${meterColor}`} style={{ width: `${(score / 5) * 100}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Strength: <span className="font-medium">{label}</span></span>
                </div>
                <ul className="text-xs space-y-0.5">
                  {[
                    { ok: next.length >= 8, label: "At least 8 characters" },
                    { ok: /[A-Z]/.test(next), label: "Uppercase letter" },
                    { ok: /[a-z]/.test(next), label: "Lowercase letter" },
                    { ok: /[0-9]/.test(next), label: "Number" },
                    { ok: /[^A-Za-z0-9]/.test(next), label: "Special character" },
                  ].map((r) => (
                    <li key={r.label} className={`flex items-center gap-1 ${r.ok ? "text-emerald-600" : "text-muted-foreground"}`}>
                      {r.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {r.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs">Confirm new password</Label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            {mismatch && <div className="text-xs text-destructive mt-1">Passwords do not match</div>}
          </div>
        </div>
        <DialogFooter>
          {!forced && (
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button onClick={submit} disabled={busy || !check.ok || !cur || mismatch || !confirm}>
            {busy ? "Saving…" : "Update password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}