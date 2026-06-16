import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FALLBACK_MODULES } from "./permissions";

export type AppModule = {
  key: string;
  label: string;
  sort_order: number;
  supports_import: boolean;
  is_active: boolean;
};

export function useModules(opts?: { includeInactive?: boolean }) {
  const [modules, setModules] = useState<AppModule[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data, error } = await supabase
      .from("app_modules")
      .select("key,label,sort_order,supports_import,is_active")
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) {
      setModules(
        FALLBACK_MODULES.map((m, i) => ({
          key: m.key,
          label: m.label,
          sort_order: (i + 1) * 10,
          supports_import: !!m.supports_import,
          is_active: true,
        })),
      );
    } else {
      const list = (data as AppModule[]).filter((m) => opts?.includeInactive || m.is_active);
      setModules(list);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.includeInactive]);

  return { modules, loading, reload: load };
}