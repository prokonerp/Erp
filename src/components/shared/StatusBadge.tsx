import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * Semantic status badge — soft tinted fill, readable text, no rainbow noise.
 * Map any domain status to a tone once; colors stay consistent app-wide and
 * in dark mode. Use `statusTone()` helpers per domain (sales.ts already has
 * statusMeta) to translate raw strings to tones.
 */
const statusVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-transparent bg-muted text-muted-foreground",
        info: "border-transparent bg-sky-500/10 text-sky-700 dark:text-sky-300",
        success: "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        warning: "border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-300",
        danger: "border-transparent bg-red-500/10 text-red-700 dark:text-red-300",
        primary: "border-transparent bg-primary/10 text-primary",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof statusVariants>["tone"]>;

export function StatusBadge({
  tone,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof statusVariants>) {
  return (
    <Badge
      className={cn(statusVariants({ tone }), "shadow-none hover:bg-inherit", className)}
      {...props}
    >
      {children}
    </Badge>
  );
}
