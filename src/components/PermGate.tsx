import { ReactNode } from "react";
import { usePermissions } from "@/lib/usePermissions";
import type { Action, ModuleKey } from "@/lib/permissions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Client-side permission wrapper. Renders `children` when the user has
 * `action` on `module`, otherwise renders `fallback` (or a disabled button).
 * RLS remains the authoritative check on the server — this only tightens UX.
 */
export function PermGate({
  module,
  action,
  children,
  fallback,
}: {
  module: ModuleKey;
  action?: Action;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { loading, can } = usePermissions();
  if (loading) return null;
  if (can(module, action ?? "read")) return <>{children}</>;
  return <>{fallback ?? null}</>;
}

/** Convenience button that disables (with tooltip) when the user lacks the permission. */
export function PermButton({
  module,
  action = "read",
  reason = "You don't have permission for this action.",
  children,
  ...rest
}: ButtonProps & { module: ModuleKey; action?: Action; reason?: string }) {
  const { loading, can } = usePermissions();
  const allowed = !loading && can(module, action);
  if (allowed) return <Button {...rest}>{children}</Button>;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button {...rest} disabled aria-disabled>
              {children}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}