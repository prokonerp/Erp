import {
  memo,
  useCallback,
  useRef,
  useDeferredValue,
  useState,
  useMemo,
  useEffect,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { TableSkeleton } from "./skeletons";
import { PaginationFooter } from "@/components/PaginationFooter";
import type { LucideIcon } from "lucide-react";

/**
 * Generic data table — one component for every list in the app.
 *
 * Usage:
 * ```tsx
 * <DataTable
 *   columns={columns}
 *   data={filtered}
 *   isLoading={isLoading}
 *   emptyIcon={Users}
 *   emptyTitle="No customers found"
 *   emptyHint="Try a different search."
 *   emptyAction={<Button onClick={startNew}>New Customer</Button>}
 *   footer={<PaginationFooter ... />}
 * />
 * ```
 */

export type ColumnDef<T> = {
  /** Accessor key (e.g. "company") or "_actions" for a custom-render-only column. */
  key: string;
  header: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  /** Custom render — receives the row and its index. Falls back to `row[key]`. */
  render?: (row: T, index: number) => ReactNode;
  className?: string;
  /** Compact text class for the header (e.g. "text-xs") */
  headerClassName?: string;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

type Density = "comfortable" | "compact";

const CELL_DENSITY: Record<Density, string> = {
  comfortable: "px-4 py-3",
  compact: "px-3 py-1.5",
};

const HEADER_DENSITY: Record<Density, string> = {
  comfortable: "px-4 py-2.5",
  compact: "px-3 py-1.5",
};

const DENSITY_STORAGE_KEY = "prokon-table-density";

/** Server-driven pagination — when provided DataTable renders PaginationFooter and skips client slicing. */
export type ServerPagination = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

const CLIENT_PAGE_SIZE = 50;

function readStoredDensity(): Density {
  if (typeof window === "undefined") return "comfortable";
  return window.localStorage.getItem(DENSITY_STORAGE_KEY) === "compact" ? "compact" : "comfortable";
}

/* ──────── MemoRow — memoized <tr> with CSS containment ──────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemoRowProps<T extends Record<string, any>> = {
  row: T;
  rowKeyStr: string;
  density: Density;
  columns: ColumnDef<T>[];
  onRowClick?: (row: T) => void;
  globalIndex: number;
  /** Serialized sort state for areEqual — busts memo only when sort changes */
  sortKey: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MemoRowInner<T extends Record<string, any>>({
  row,
  density,
  columns,
  onRowClick,
  globalIndex,
}: MemoRowProps<T>) {
  return (
    <tr
      style={
        { contentVisibility: "auto", containIntrinsicSize: "auto 48px" } as React.CSSProperties
      }
      className={cn(
        "border-b last:border-0 transition-colors",
        onRowClick && "cursor-pointer hover:bg-muted/40",
      )}
      onClick={onRowClick ? () => onRowClick(row) : undefined}
    >
      {columns.map((col) => {
        const isRight = col.align === "right";
        const content = col.render ? col.render(row, globalIndex) : row[col.key];
        return (
          <td
            key={col.key}
            className={cn(
              "whitespace-nowrap",
              CELL_DENSITY[density],
              isRight && "text-right tabular-nums",
              col.className,
            )}
          >
            {content ?? "—"}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * areEqual: rowKey equality + density + column keys length + sort key.
 * Also checks row reference and globalIndex/onRowClick to avoid stale renders
 * when the underlying record identity or pagination offset changes.
 */
const MemoRow = memo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MemoRowInner as unknown as React.FC<MemoRowProps<Record<string, any>>>,
  (prev, next) =>
    prev.rowKeyStr === next.rowKeyStr &&
    prev.density === next.density &&
    prev.columns.length === next.columns.length &&
    prev.sortKey === next.sortKey &&
    prev.row === next.row &&
    prev.globalIndex === next.globalIndex &&
    prev.onRowClick === next.onRowClick,
) as unknown as typeof MemoRowInner;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  isLoading = false,
  sort: controlledSort,
  onSortChange,
  rowKey = "id",
  onRowClick,
  density: controlledDensity,
  emptyIcon,
  emptyTitle = "No records found",
  emptyHint,
  emptyAction,
  footer,
  toolbar,
  totalRecords,
  serverPagination,
  className,
  cardClassName,
}: {
  columns: ColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  /** Controlled sort — if omitted, DataTable manages its own. */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Row key accessor — defaults to "id". */
  rowKey?: keyof T | ((row: T) => string);
  onRowClick?: (row: T) => void;
  density?: Density;
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
  footer?: ReactNode;
  toolbar?: ReactNode;
  /**
   * True total for server-paginated tables. When omitted the current
   * `data.length` is shown; pass this so paginated lists don't display
   * "50 records" for a 5,000-row dataset.
   */
  totalRecords?: number;
  /** When provided, DataTable renders PaginationFooter and skips client slicing. Keeps backward compat when omitted. */
  serverPagination?: ServerPagination;
  className?: string;
  cardClassName?: string;
}) {
  const [internalSort, setInternalSort] = useState<SortState>(null);
  const [internalDensity, setInternalDensity] = useState<Density>(readStoredDensity);

  const sort = controlledSort ?? internalSort;
  const density = controlledDensity ?? internalDensity;
  const sortKey = sort ? `${sort.key}:${sort.dir}` : "";

  const toggleSort = useCallback(
    (key: string) => {
      const next: SortState = (() => {
        if (!sort || sort.key !== key) return { key, dir: "asc" };
        if (sort.dir === "asc") return { key, dir: "desc" };
        return null;
      })();
      if (onSortChange) onSortChange(next);
      else setInternalSort(next);
    },
    [sort, onSortChange],
  );

  const changeDensity = useCallback((d: Density) => {
    setInternalDensity(d);
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, d);
    } catch {
      /* private mode etc. — non-fatal */
    }
  }, []);

  // Stabilize deps: avoid busting sortedData memo when callers recreate
  // columns array with same keys. Use a ref-tracked stable key string.
  const columnsKey = useMemo(() => columns.map((c) => c.key).join(","), [columns]);
  const columnsKeysRef = useRef(columnsKey);
  if (columnsKeysRef.current !== columnsKey) columnsKeysRef.current = columnsKey;
  const stableColumnsKey = columnsKeysRef.current;

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return data;
    return [...data].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sort.dir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    // stableColumnsKey tracks columns keys without busting on recreated arrays
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sort, stableColumnsKey]);

  // Deferred sort for large datasets — keeps UI responsive (typing/filter)
  // during expensive sorts. Falls back to immediate value for small tables.
  // Hook is unconditional (rules-of-hooks); effective value is conditional.
  const deferredSortedDataRaw = useDeferredValue(sortedData);
  const effectiveSortedData = sortedData.length > 200 ? deferredSortedDataRaw : sortedData;

  const getRowKey = useCallback(
    (row: T, index: number): string => {
      if (typeof rowKey === "function") return rowKey(row);
      return String(row[rowKey] ?? index);
    },
    [rowKey],
  );

  // ── Pagination / virtualization fallback ──────────────────────────
  // Server mode: caller passes serverPagination (page already sliced server-side)
  // Client fallback: when data > 100 rows and no serverPagination, slice client-side 50/page
  const needsClientPagination = !serverPagination && effectiveSortedData.length > 100;
  const [clientPage, setClientPage] = useState(0);
  const clientPageCount = needsClientPagination
    ? Math.max(1, Math.ceil(effectiveSortedData.length / CLIENT_PAGE_SIZE))
    : 1;

  useEffect(() => {
    setClientPage((p) => {
      const clamped = Math.min(p, Math.max(0, clientPageCount - 1));
      // when data shrinks to <= one page, always reset to 0 to avoid stale page 2/3
      if (effectiveSortedData.length <= CLIENT_PAGE_SIZE) return 0;
      return clamped;
    });
  }, [clientPageCount, effectiveSortedData.length]);

  const displayData = useMemo(() => {
    if (serverPagination) return effectiveSortedData; // already server-sliced
    if (!needsClientPagination) return effectiveSortedData;
    const start = clientPage * CLIENT_PAGE_SIZE;
    return effectiveSortedData.slice(start, start + CLIENT_PAGE_SIZE);
  }, [effectiveSortedData, serverPagination, needsClientPagination, clientPage]);

  const totalForDisplay = serverPagination?.total ?? totalRecords ?? effectiveSortedData.length;

  const serverPaginationNode = serverPagination ? (
    <PaginationFooter
      page={serverPagination.page}
      pageSize={serverPagination.pageSize}
      total={serverPagination.total}
      onPage={serverPagination.onPageChange}
    />
  ) : null;

  const clientPaginationNode = needsClientPagination ? (
    <PaginationFooter
      page={clientPage}
      pageSize={CLIENT_PAGE_SIZE}
      total={effectiveSortedData.length}
      onPage={setClientPage}
    />
  ) : null;

  const paginationNode = serverPaginationNode ?? clientPaginationNode;
  const hasFooterBar = !!(footer || paginationNode);

  return (
    <Card className={cn("overflow-hidden", cardClassName)}>
      {toolbar && (
        <CardHeader className="flex flex-row items-center justify-between gap-2 border-b p-3">
          {toolbar}
        </CardHeader>
      )}
      <CardContent className="p-0">
        <div
          className="max-h-[60vh] overflow-auto overscroll-contain scroll-pt-0"
          style={{ contain: "content" }}
        >
          {isLoading ? (
            <TableSkeleton rows={6} />
          ) : effectiveSortedData.length === 0 ? (
            <EmptyState icon={emptyIcon} title={emptyTitle} hint={emptyHint} action={emptyAction} />
          ) : (
            <table className={cn("w-full table-fixed text-sm", className)}>
              <thead className="sticky top-0 z-10 border-b bg-muted text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  {columns.map((col) => {
                    const isRight = col.align === "right";
                    const isActiveCol = sort?.key === col.key;
                    return (
                      <th
                        key={col.key}
                        className={cn(
                          "whitespace-nowrap font-medium",
                          HEADER_DENSITY[density],
                          isRight && "text-right",
                          col.headerClassName,
                        )}
                        aria-sort={
                          col.sortable
                            ? isActiveCol
                              ? sort!.dir === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                            : undefined
                        }
                      >
                        {col.sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                              isRight && "float-right",
                            )}
                          >
                            {col.header}
                            <SortIndicator
                              active={isActiveCol}
                              dir={isActiveCol ? sort!.dir : null}
                            />
                          </button>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1",
                              isRight && "float-right",
                            )}
                          >
                            {col.header}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {displayData.map((row, i) => {
                  // global index for render/key when client-paginated
                  const globalIndex = needsClientPagination ? clientPage * CLIENT_PAGE_SIZE + i : i;
                  return (
                    <MemoRow
                      key={getRowKey(row, globalIndex)}
                      row={row}
                      rowKeyStr={getRowKey(row, globalIndex)}
                      density={density}
                      columns={columns}
                      onRowClick={onRowClick}
                      globalIndex={globalIndex}
                      sortKey={sortKey}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {hasFooterBar && (
          <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2">
            <span className="text-xs text-muted-foreground">
              {totalForDisplay.toLocaleString()} record{totalForDisplay === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-3">
              <DensityToggle
                density={density}
                onChange={controlledDensity ? undefined : changeDensity}
              />
              {paginationNode}
              {footer}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────── Internal sub-components ──────── */

function SortIndicator({ active, dir }: { active: boolean; dir: "asc" | "desc" | null }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
  return dir === "asc" ? (
    <ChevronUp className="h-3 w-3 text-primary" />
  ) : (
    <ChevronDown className="h-3 w-3 text-primary" />
  );
}

function DensityToggle({
  density,
  onChange,
}: {
  density: Density;
  onChange?: (d: Density) => void;
}) {
  if (!onChange) return null;
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Row density">
      {(["comfortable", "compact"] as const).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={density === d}
          onClick={() => onChange(d)}
          className={cn(
            "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase transition-colors",
            density === d
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {d === "comfortable" ? "Relaxed" : "Compact"}
        </button>
      ))}
    </div>
  );
}
