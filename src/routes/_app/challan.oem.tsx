import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/ComingSoonPage";

export const Route = createFileRoute("/_app/challan/oem")({
  component: () => (
    <ComingSoonPage title="Delivery Challan — To OEM" category="challan:oem" />
  ),
  head: () => ({ meta: [{ title: "Delivery Challan to OEM — Prokon" }] }),
});