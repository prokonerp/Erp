import { ReactNode } from "react";
import { usePermissions } from "@/lib/usePermissions";
import type { Action, ModuleKey } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

/**
 * Page-level gate. Renders `children` only when the signed-in user has the
 * permission; otherwise shows a "no access" notice. RLS stays authoritative.
 */
export function ModuleGate({
  module,
  action = "access",
  title = "Access restricted",
  children,
}: {
  module: ModuleKey;
  action?: Action;
  title?: string;
  children: ReactNode;
}) {
  const { loading, can } = usePermissions();
  if (loading) return <div className="p-8 text-muted-foreground">Checking access…</div>;
  if (can(module, action)) return <>{children}</>;
  return (
    <Card className="max-w-xl">
      <CardContent className="flex items-start gap-3 py-6">
        <ShieldAlert className="h-5 w-5 text-destructive mt-0.5" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">
            You don't have permission to view this section. Ask an administrator to enable it
            for your role under Masters → Users &amp; Roles.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}