import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/ComingSoonPage";

export const Route = createFileRoute("/_app/grn/oem")({
  component: () => (
    <ComingSoonPage title="GRN — From OEM" category="grn:oem" />
  ),
  head: () => ({ meta: [{ title: "GRN from OEM — Prokon" }] }),
});