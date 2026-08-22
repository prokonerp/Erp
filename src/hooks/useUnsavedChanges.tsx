import { useCallback, useEffect, useRef } from "react";
import { useBlocker } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type BlockerResolver = {
  status: "idle" | "blocked";
  proceed: (() => void) | undefined;
  reset: (() => void) | undefined;
};

/**
 * Hook that blocks navigation when a form is dirty.
 *
 * Returns a `blocker` (feed it to <UnsavedChangesPrompt />) and `markClean`,
 * which must be called synchronously BEFORE navigating after a successful
 * save. React state updates are async — clearing the dirty state and calling
 * navigate() in the same tick would otherwise still be seen as dirty by the
 * router's blocker and show a spurious "Leave without saving?" dialog.
 *
 * Usage:
 * ```tsx
 * const [dirty, setDirty] = useState(false);
 * const { blocker, markClean } = useUnsavedChanges(dirty);
 *
 * async function save() {
 *   await persist();
 *   markClean();
 *   setDirty(false);
 *   navigate({ to: "/detail", params: { id } });
 * }
 * ```
 */
export function useUnsavedChanges(isDirty: boolean) {
  // Mirror the dirty flag into a ref so the blocker's shouldBlockFn always
  // reads the live value, even within the same tick as a setState call.
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const markClean = useCallback(() => {
    dirtyRef.current = false;
  }, []);

  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current,
    disabled: !isDirty,
    withResolver: true,
    enableBeforeUnload: () => isDirty,
  });

  return { blocker: blocker as BlockerResolver, markClean };
}

/**
 * Renders a confirmation dialog when navigation is blocked by useUnsavedChanges.
 */
export function UnsavedChangesPrompt({
  blocker,
}: {
  blocker: BlockerResolver;
}) {
  if (blocker.status !== "blocked") return null;

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes. If you leave now, your progress will be
            lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset?.()}>
            Stay
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => blocker.proceed?.()}
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
