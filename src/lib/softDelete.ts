import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ArchivableTable = "tickets" | "indents" | "amcs";

/** Mark a record as soft-deleted. Returns the supabase error if any. */
export async function softDelete(table: ArchivableTable, id: string) {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id ?? null;
  const patch = {
    is_deleted: true,
    deleted_at: new Date().toISOString(),
    deleted_by: uid,
  } as never;
  return supabase.from(table as never).update(patch).eq("id", id);
}

/** Restore a soft-deleted record. */
export async function restoreRecord(table: ArchivableTable, id: string) {
  const patch = {
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
  } as never;
  return supabase.from(table as never).update(patch).eq("id", id);
}

/** Hard-delete a record (admin Archive only). */
export async function purgeRecord(table: ArchivableTable, id: string) {
  return supabase.from(table as never).delete().eq("id", id);
}

/**
 * Subscribe to all changes on a table and call `refetch` (debounced) whenever
 * a row changes. Useful for keeping dashboard counts live.
 */
export function useRealtimeRefetch(tables: ArchivableTable[] | ArchivableTable, refetch: () => void) {
  const list = Array.isArray(tables) ? tables : [tables];
  const cb = useRef(refetch);
  cb.current = refetch;
  const key = list.slice().sort().join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channels = list.map((t) =>
      supabase
        .channel(`rt-${t}-${Math.random().toString(36).slice(2, 8)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => cb.current(), 250);
        })
        .subscribe(),
    );
    return () => {
      if (timer) clearTimeout(timer);
      channels.forEach((c) => supabase.removeChannel(c));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}