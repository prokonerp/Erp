import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Sun, Moon, Monitor, Clock } from "lucide-react";
import { usePermissions } from "@/lib/usePermissions";
import { NAV_ITEMS, QUICK_ACTIONS } from "@/lib/navigation";
import { useTheme, type Theme } from "@/lib/theme";

const RECENTS_KEY = "prokon:recent-pages";
const MAX_RECENTS = 5;
const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light (Navy Premium)", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
  { value: "system", label: "System theme", icon: Monitor },
];

/**
 * Best-matching nav label for a path (mirrors the header's longest-prefix rule).
 */
function labelForPath(path: string) {
  return [...NAV_ITEMS]
    .sort((a, b) => b.to.length - a.to.length)
    .find((n) => path === n.to || path.startsWith(n.to + "/"));
}

/**
 * Global command palette — ⌘K / Ctrl+K.
 * Fuzzy-jump to any nav page, quick-create records, re-open recent pages,
 * and switch the appearance theme — all from one place.
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
  const { setTheme, theme } = useTheme();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const [recents, setRecents] = useState<string[]>([]);

  // Load + prune stored recents to pages the user can currently see.
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as string[];
      setRecents(stored.filter((p) => NAV_ITEMS.some((n) => n.to === p)));
    } catch {
      setRecents([]);
    }
  }, []);

  // When the palette opens, push the current page onto the recents list.
  useEffect(() => {
    if (!open) return;
    setRecents((prev) => {
      const next = [currentPath, ...prev.filter((p) => p !== currentPath)].slice(0, MAX_RECENTS);
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / privacy-mode errors */
      }
      return next;
    });
  }, [open, currentPath]);

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
  const visiblePaths = useMemo(() => new Set(visibleNav.map((n) => n.to)), [visibleNav]);

  const visibleActions = QUICK_ACTIONS.filter((a) =>
    a.adminOnly ? isAdmin : a.module === "*" || can(a.module as any, "create"),
  );

  const recentItems = recents
    .filter((p) => visiblePaths.has(p))
    .map((p) => labelForPath(p))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .filter((n, i, arr) => arr.findIndex((x) => x.to === n.to) === i);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, actions, themes…" />
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

        {recentItems.length > 0 && (
          <CommandGroup heading="Recent">
            {recentItems.map((n) => (
              <CommandItem
                key={`recent-${n.to}-${n.matchSearchTab ?? ""}`}
                value={`recent ${n.label}`}
                onSelect={() => goTo(n.to, n.search)}
              >
                <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                {n.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

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

        <CommandSeparator />
        <CommandGroup heading="Theme">
          {THEMES.map((t) => (
            <CommandItem
              key={t.value}
              value={`theme ${t.label}`}
              onSelect={() => {
                setTheme(t.value);
                onOpenChange(false);
              }}
            >
              <t.icon className="mr-2 h-4 w-4" />
              {t.label}
              {theme === t.value && (
                <span className="ml-auto text-[11px] font-medium text-muted-foreground">Active</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
