import { useEffect } from "react";
import { useBlocker, useNavigate } from "@tanstack/react-router";
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
 * Usage:
 * ```tsx
 * const [dirty, setDirty] = useState(false);
 * const blocker = useUnsavedChanges(dirty);
 * ```
 */
export function useUnsavedChanges(isDirty: boolean) {
  const blockerRef = useBlocker({
    shouldBlockFn: () => isDirty,
    disabled: !isDirty,
    withResolver: true,
    enableBeforeUnload: () => isDirty,
  });

  return blockerRef as BlockerResolver;
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
