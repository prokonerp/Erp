import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

export type ProfileInfo = {
  name: string | null;
  email: string | null;
  role_name: string | null;
  is_admin: boolean;
  last_sign_in_at: string | null;
  days_remaining: number;
  password_changed_at: string;
};

function initials(name: string | null, email: string | null) {
  const src = (name && name.trim()) || (email && email.split("@")[0]) || "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || src[0].toUpperCase();
}

export function UserProfileMenu({
  profile,
  onProfileChange,
}: {
  profile: ProfileInfo | null;
  onProfileChange?: () => void;
}) {
  const navigate = useNavigate();
  const [pwdOpen, setPwdOpen] = useState(false);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  const lastLogin = profile?.last_sign_in_at
    ? new Date(profile.last_sign_in_at).toLocaleString()
    : "—";
  const expiryWarn =
    profile && profile.days_remaining <= 7 && profile.days_remaining > 0
      ? `Password expires in ${profile.days_remaining} day${profile.days_remaining === 1 ? "" : "s"}`
      : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-2 px-2"
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {initials(profile?.name ?? null, profile?.email ?? null)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden sm:inline max-w-[140px] truncate">
              {profile?.name ?? profile?.email ?? "Account"}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="flex items-start gap-3 p-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback>{initials(profile?.name ?? null, profile?.email ?? null)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{profile?.name ?? "—"}</div>
              <div className="text-xs text-muted-foreground truncate">{profile?.email ?? "—"}</div>
              <div className="mt-1 flex items-center gap-1.5">
                {profile?.is_admin ? (
                  <Badge variant="default" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> Admin
                  </Badge>
                ) : profile?.role_name ? (
                  <Badge variant="secondary">{profile.role_name}</Badge>
                ) : (
                  <Badge variant="outline">No role</Badge>
                )}
              </div>
            </div>
          </div>
          <DropdownMenuSeparator />
          <div className="px-3 py-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3">
              <span>Last sign-in</span>
              <span className="text-foreground">{lastLogin}</span>
            </div>
            {expiryWarn && (
              <div className="mt-1 text-amber-600 dark:text-amber-400">{expiryWarn}</div>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            Account
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setPwdOpen(true)}>
            <KeyRound className="h-4 w-4 mr-2" /> Change password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog
        open={pwdOpen}
        onOpenChange={setPwdOpen}
        onChanged={onProfileChange}
      />
    </>
  );
}