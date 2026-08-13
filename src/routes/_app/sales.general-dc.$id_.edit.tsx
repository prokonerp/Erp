import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GeneralDcForm } from "@/components/GeneralDcForm";
import { getGeneralDc, type GeneralDcRow } from "@/lib/generalDc";
import { usePermissions } from "@/lib/usePermissions";

export const Route = createFileRoute("/_app/sales/general-dc/$id_/edit")({
  component: EditGeneralDc,
  head: () => ({
    meta: [
      { title: "Edit General Delivery Challan — Prokon ERP" },
      { name: "description", content: "Update a draft general delivery challan before it is issued." },
      { property: "og:title", content: "Edit General Delivery Challan — Prokon ERP" },
      { property: "og:description", content: "Update a draft general delivery challan before it is issued." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function EditGeneralDc() {
  const { id } = useParams({ from: "/_app/sales/general-dc/$id_/edit" });
  const nav = useNavigate();
  const { loading, can } = usePermissions();
  const [dc, setDc] = useState<GeneralDcRow | null>(null);

  useEffect(() => {
    getGeneralDc(id)
      .then((row) => {
        if (row.status !== "Draft") {
          toast.error("Only Draft challans can be edited.");
          nav({ to: "/sales/general-dc/$id", params: { id } });
          return;
        }
        setDc(row);
      })
      .catch((e) => toast.error(e.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!can("general_dc", "edit")) {
    return <div className="p-6 text-muted-foreground">You don't have permission to edit General Delivery Challans.</div>;
  }
  if (!dc) return <div className="p-6 text-muted-foreground">Loading…</div>;
  return <GeneralDcForm existing={dc} />;
}
