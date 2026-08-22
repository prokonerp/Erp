import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

/**
 * Promise-based replacement for native window.confirm().
 *
 * Mount <ConfirmProvider /> once near the app root (it lives inside the
 * authenticated layout), then in any component:
 *
 * ```tsx
 * const confirm = useConfirm();
 *
 * async function onDelete() {
 *   const ok = await confirm({
 *     title: 'Delete "ACME"?',
 *     description: "This cannot be undone.",
 *     confirmLabel: "Delete",
 *     variant: "danger",
 *   });
 *   if (!ok) return;
 *   await doDelete();
 * }
 * ```
 *
 * Resolves `true` when the confirm button is clicked, `false` on cancel,
 * Escape or overlay dismissal — matching native confirm() semantics, so
 * existing `if (!confirm(...)) return;` flows translate 1:1.
 */

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (next) => {
      // If a dialog is somehow already open (double-invoke, race), resolve
      // it as cancelled before showing the new one.
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setOpts(next);
        setOpen(true);
      });
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) settle(false);
        }}
        title={opts?.title ?? ""}
        description={opts?.description}
        confirmLabel={opts?.confirmLabel}
        cancelLabel={opts?.cancelLabel}
        variant={opts?.variant}
        // Resolve immediately and let the caller run its action — mirrors
        // native confirm(), which returns before the action executes.
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  );
}

/** Access the app-wide confirm() function. Must be used under <ConfirmProvider />. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within <ConfirmProvider>");
  }
  return ctx;
}
