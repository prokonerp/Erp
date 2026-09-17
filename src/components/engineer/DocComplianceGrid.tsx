import { StatusBadge } from "@/components/shared/StatusBadge";

export function DocComplianceGrid({
  present,
  missing,
  isLoading,
}: {
  present: string[];
  missing: string[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {present.map((name) => (
          <StatusBadge key={name} tone="success">
            {name}
          </StatusBadge>
        ))}
        {missing.map((name) => (
          <StatusBadge key={name} tone="danger">
            {name}
          </StatusBadge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {present.length}/{present.length + missing.length} on file
      </p>
    </div>
  );
}
