import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminEngKeys } from "@/lib/queryKeys";

/**
 * Single owner of engineer-movement freshness for the whole /eng shell.
 * One realtime channel + one 30s poller + focus refetch, mounted once in
 * the engineers layout — the per-hook channel this replaces opened one
 * connection per mounted page and churned the socket on every navigation.
 * Hooks below consume the shared react-query cache; without this provider
 * they degrade to load-once (no polling), never to broken.
 */
export function MovementLiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const qcRef = useRef(qc);
  qcRef.current = qc;

  useEffect(() => {
    const invalidate = () => {
      void qcRef.current.invalidateQueries({ queryKey: adminEngKeys.movement() });
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("rt-engineer-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "engineer_live_status" },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(invalidate, 250);
        },
      )
      .subscribe();
    const id = window.setInterval(invalidate, 30_000);
    const onFocus = () => invalidate();
    window.addEventListener("focus", onFocus);
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return <>{children}</>;
}
