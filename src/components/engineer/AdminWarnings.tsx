import { dedupeWarnings } from "@/lib/engineersAdmin";
import type { AdminWarning } from "@/lib/engineersAdmin";

export function AdminWarnings({ lists, className }: { lists: AdminWarning[][]; className?: string }) {
  const warnings = dedupeWarnings(lists);
  if (warnings.length === 0) return null;
  return (
    <ul
      role="status"
      aria-live="polite"
      className={
        className
          ? `space-y-1 rounded-lg border p-3 text-sm text-muted-foreground ${className}`
          : "space-y-1 rounded-lg border p-3 text-sm text-muted-foreground"
      }
    >
      {warnings.map((w) => (
        <li key={`${w.section}::${w.message}`}>
          <span className="font-medium text-foreground">{w.section}:</span> {w.message}
        </li>
      ))}
    </ul>
  );
}
