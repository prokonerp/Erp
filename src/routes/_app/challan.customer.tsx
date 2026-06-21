import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/ComingSoonPage";

export const Route = createFileRoute("/_app/challan/customer")({
  component: () => (
    <ComingSoonPage title="Delivery Challan — To Customer" category="challan:customer" />
  ),
  head: () => ({ meta: [{ title: "Delivery Challan to Customer — Prokon" }] }),
});