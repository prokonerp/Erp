import { useIsAdmin } from "@/lib/useRole";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * App-wide banner shown when no admin exists yet. Reuses the exact
 * hasAnyAdmin/claimAdmin logic from useIsAdmin() (previously inline in Masters).
 */
export function ClaimAdminBanner() {
  const { loading, hasAnyAdmin, isOwner, claimAdmin } = useIsAdmin();
  // Only the designated workspace owner ever sees a claim CTA, and only while
  // no admin exists. Everyone else sees nothing at all.
  if (loading || hasAnyAdmin || !isOwner) return null;
  return (
    <Alert className="mb-4">
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>No admin exists yet. Claim admin to manage this workspace.</span>
        <Button
          size="sm"
          onClick={async () => {
            const { error } = await claimAdmin();
            if (error) alert(error);
            else window.location.reload();
          }}
        >
          Claim admin
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Renders `children` for admins; for non-admins (when an admin already exists)
 * shows a muted "Admin access required" note so the gap reads as a permissions
 * boundary rather than a missing feature. No role logic changes.
 */
export function AdminOnlySection({
  children,
  label = "Admin access required",
}: {
  children: ReactNode;
  label?: string;
}) {
  const { loading, isAdmin, hasAnyAdmin } = useIsAdmin();
  if (loading) return null;
  if (isAdmin) return <>{children}</>;
  if (!hasAnyAdmin) return null; // claim-admin banner already explains this state
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <ShieldAlert className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}
