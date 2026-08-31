/**
 * Centralized TanStack Query key factories.
 * Keep keys stable and serializable so cache invalidation is predictable.
 * Usage: queryKeys.indent.list({ status: "open" }) or indentKeys.detail(id)
 */

type Filters = Record<string, unknown> | unknown;
type PaginationParams = { page: number; pageSize: number } & Record<string, unknown>;

function paginationKey(base: readonly string[], params: PaginationParams) {
  return [...base, "paginated", params] as const;
}

// Generic helper to build a standard set: all / list / detail / paginated
function createKeyFactory<NS extends readonly string[]>(namespace: NS) {
  const all = [...namespace] as unknown as NS;
  return {
    all,
    list: (filters?: Filters) =>
      (filters !== undefined ? [...(all as unknown as readonly string[]), "list", filters] : [...(all as unknown as readonly string[]), "list"]) as readonly unknown[],
    detail: (id: string) => [...(all as unknown as readonly string[]), "detail", id] as const,
    paginated: (params: PaginationParams) => paginationKey(all as unknown as readonly string[], params),
    pagination: (params: PaginationParams) => paginationKey(all as unknown as readonly string[], params),
  } as const;
}

// Named factories — each mirrors one domain table / feature

export const masterKeys = createKeyFactory(["masters"] as const);
export const indentKeys = createKeyFactory(["indents"] as const);
export const ticketKeys = createKeyFactory(["tickets"] as const);
export const grnKeys = createKeyFactory(["grns"] as const);
export const dcKeys = createKeyFactory(["delivery_challans"] as const);
export const imsKeys = createKeyFactory(["ims"] as const);
export const challanKeys = createKeyFactory(["challans"] as const);

// Back-compat alias: some code historically used `challanKeys`, others `dcKeys` — both point to same domain.
export const stockKeys = createKeyFactory(["ims_stock_items"] as const);
export const txnKeys = createKeyFactory(["ims_transactions"] as const);

// Aggregate export for convenience
export const queryKeys = {
  master: masterKeys,
  indent: indentKeys,
  ticket: ticketKeys,
  grn: grnKeys,
  dc: dcKeys,
  ims: imsKeys,
  challan: challanKeys,
  stock: stockKeys,
  txn: txnKeys,
} as const;
