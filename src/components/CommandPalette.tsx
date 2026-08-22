import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { usePermissions } from "@/lib/usePermissions";
import { NAV_ITEMS, QUICK_ACTIONS } from "@/lib/navigation";

/**
 * Global command palette — ⌘K / Ctrl+K.
 * Fuzzy-jump to any nav page and quick-create records.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { can, isAdmin, loading: permLoading } = usePermissions();

  const goTo = useCallback(
    (to: string, search?: Record<string, string>) => {
      onOpenChange(false);
      // Small delay so the dialog closes before navigation.
      requestAnimationFrame(() => navigate({ to, search: search as any }));
    },
    [navigate, onOpenChange],
  );

  const visibleNav = permLoading
    ? NAV_ITEMS
    : NAV_ITEMS.filter((n) => {
        if (n.adminOnly) return isAdmin;
        if (n.module) return can(n.module, "read");
        return true;
      });

  const visibleActions = QUICK_ACTIONS.filter((a) =>
    a.adminOnly ? isAdmin : a.module === "*" || can(a.module as any, "create"),
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Create new">
          {visibleActions.map((a) => (
            <CommandItem
              key={a.label}
              value={`create ${a.label}`}
              onSelect={() => goTo(a.to, a.search)}
            >
              <a.icon className="mr-2 h-4 w-4" />
              {a.label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Go to">
          {visibleNav.map((n) => (
            <CommandItem
              key={`${n.to}-${n.matchSearchTab ?? ""}`}
              value={`go ${n.label}`}
              onSelect={() => goTo(n.to, n.search)}
            >
              <n.icon className="mr-2 h-4 w-4" />
              {n.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
