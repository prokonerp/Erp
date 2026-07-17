## Oracle #–Driven Indent Flow

Extend the existing OEM ticket → Indent flow so that each Oracle # on the defective parts grid drives its own action (View existing indent vs. Create), and add a Multi‑Oracle → Single Indent path. Existing backend logic (`buildOraclesFromDefectiveParts`, `set_indent_no`, `validate_indent_oem_ticket`, `syncTicketGoodPartsFromIndent`) stays intact.

### What changes for the user

- Defective Parts table on the ticket page gains a **Select** checkbox and a per‑row **Action** column:
  - Row has Oracle # + indent exists → **View Indent** (opens `/indent/$id`).
  - Row has Oracle # but no indent → **Create Indent** (prefiltered to that oracle).
  - Row has no Oracle # → **Create Indent** (blank oracle, manual entry allowed).
- New **Create Combined Indent** button above the table, enabled when 2+ rows are checked → opens `/indent/new` with those oracles preselected and merged into a single indent.
- Attempting to create a second indent for an already‑mapped Oracle # is blocked with a toast that offers to open the existing one.

### Database

New mapping table so lookup is O(1) and multi‑oracle indents are first‑class:

```text
indent_oracle_map
-----------------
id            uuid PK
indent_id     uuid  FK indents(id) on delete cascade
ticket_id     uuid  FK tickets(id) on delete cascade
oracle_no     text  not null
created_at    timestamptz default now()
unique (ticket_id, oracle_no)   -- one oracle per ticket → one indent
index  (indent_id)
```

- Backfill from existing `indents.oracles_data` (one row per non‑empty `oracle_no`).
- Trigger on `indents` (AFTER INSERT/UPDATE of `oracles_data`) rebuilds this indent's rows in the map from its current `oracles_data`, so the map stays authoritative without app‑side bookkeeping.
- RLS: same policy shape as `indents` (authenticated read/insert; service_role all).

### API surface (TanStack server functions in `src/lib/indent.functions.ts`)

- `getIndentByTicketOracle({ ticket_id, oracle_no })` → `{ indent_id, indent_no, status, oracle_no } | null`. Uses `indent_oracle_map` + join to `indents`.
- `listIndentMapForTicket({ ticket_id })` → `Array<{ oracle_no, indent_id, indent_no, status }>` used to hydrate the whole defective parts table in one call.
- Both use `requireSupabaseAuth`; RLS enforces access.

### Route changes

- `/indent/new` search schema extended:
  - `ticket_id?: string`
  - `oracle_no?: string` — single oracle (may be `"NEW"` meaning "blank oracle, allow manual entry")
  - `oracle_list?: string` — comma‑separated list for combined indent
- Loader logic in `src/routes/_app/indent.new.tsx`:
  - When `oracle_list` present → filter defective parts to those oracles, call `buildOraclesFromSelectedList` (see below) to build one OracleBlock per selected oracle.
  - When `oracle_no` present and not `NEW` → filter to that oracle only.
  - When `oracle_no === "NEW"` or absent → keep current behavior (all defective parts, empty oracle allowed).
  - Before render, call `listIndentMapForTicket`; if any requested oracle is already mapped → toast + `navigate` to that indent (prevents duplicates on refresh/back‑nav).

### Library changes (`src/lib/indent.ts`)

- Add `buildOraclesFromSelectedList(parts, oracleList: string[])` — same grouping rules as `buildOraclesFromDefectiveParts` but restricted to the provided oracle numbers (case‑insensitive trim match). Reused by the route loader.
- `syncTicketGoodPartsFromIndent` unchanged.

### Ticket page (`src/routes/_app/tickets.$id.tsx`)

- Defective Parts grid:
  - Add leading checkbox column; disabled when row has no Oracle # (combined indents require an oracle).
  - Add trailing Action column driven by the map hydrated via `listIndentMapForTicket` (React Query, keyed by `ticket_id`).
  - "Create Combined Indent" button above the grid; disabled unless ≥2 checked rows with distinct oracle numbers.
- Existing "Create Indent" toggle/button removed and replaced by the per‑row action + combined button, so entry points are unified.

### Validation & edge cases

- DB `unique (ticket_id, oracle_no)` on the map is the ultimate guard against duplicate mapping across concurrent users.
- Server function `getIndentByTicketOracle` returns `null` on no match so the UI can fall back to Create.
- Duplicate oracle numbers on the same ticket are normalized (trim + case‑insensitive) before insert; the trigger deduplicates in the map rebuild.
- Ticket reopened: mapping persists because it lives on `indent_oracle_map`, not on ticket state.
- Blank oracle rows: allowed in `oracles_data` but never written to the map (map requires non‑empty `oracle_no`).

### Testing checklist

1. Row with existing Oracle # + indent → View Indent opens `/indent/$id`.
2. Row with Oracle # and no indent → Create Indent prefills to that oracle only.
3. Row with blank Oracle # → Create Indent opens with manual entry allowed.
4. Select 3 rows → Create Combined Indent → single indent with 3 OracleBlocks, all 3 rows in `indent_oracle_map`.
5. Attempt to create a duplicate for a mapped oracle → blocked, user is redirected to the existing indent.
6. Refresh the ticket page → View/Create buttons remain correct (map is source of truth).
7. Closing an oracle still triggers `syncTicketGoodPartsFromIndent` and writes back to `good_parts_details`.

### Out of scope

- Changes to `set_indent_no`, `validate_indent_oem_ticket`, or the challan/GRN generation flows.
- Editing the auto‑generated Supabase client/types.
