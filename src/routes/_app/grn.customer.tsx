import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/ComingSoonPage";

export const Route = createFileRoute("/_app/grn/customer")({
  component: () => (
    <ComingSoonPage title="GRN — From Customer" category="grn:customer" />
  ),
  head: () => ({ meta: [{ title: "GRN from Customer — Prokon" }] }),
});