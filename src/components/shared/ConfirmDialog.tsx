import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * App-standard confirm dialog (replaces native window.confirm).
 *
 * - `variant="danger"` renders a destructive confirm button.
 * - `onConfirm` may be async; the button shows a spinner and the dialog
 *   stays open until it resolves. Close with `onOpenChange(false)` yourself
 *   after success, or pass `closeOnConfirm` to auto-close on resolve.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    try {
      setPending(true);
      await onConfirm();
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <Button
            onClick={handleConfirm}
            disabled={pending}
            className={cn(
              variant === "danger" &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
