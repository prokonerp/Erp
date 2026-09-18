import { StatusBadge } from "@/components/shared/StatusBadge";
import { SignedFileLink } from "@/components/engineer/SignedFileLink";

export type DocLink = { name: string; path: string };

/**
 * Compact one-line compliance: present documents are clickable chips that
 * open the uploaded file (signed URL, new tab); missing blocks stay plain
 * danger chips. Clicks sign lazily — no pre-signing storm.
 */
export function DocComplianceGrid({
  docs,
  present,
  missing,
  isLoading,
}: {
  docs: DocLink[];
  present: string[];
  missing: string[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  const pathByName = new Map(docs.map((d) => [d.name, d.path]));
  const total = present.length + missing.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {present.map((name) => {
        const path = pathByName.get(name) ?? "";
        return path.trim() !== "" ? (
          <SignedFileLink
            key={name}
            path={path}
            label={name}
            title={`Open ${name}`}
            className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800 no-underline hover:bg-emerald-100 hover:no-underline"
          />
        ) : (
          <StatusBadge key={name} tone="success">
            {name}
          </StatusBadge>
        );
      })}
      {missing.map((name) => (
        <StatusBadge key={name} tone="danger">
          {name}
        </StatusBadge>
      ))}
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {present.length}/{total} on file
      </span>
    </div>
  );
}
