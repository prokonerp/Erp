import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPage } from "@/components/ComingSoonPage";

export const Route = createFileRoute("/_app/grn/general")({
  component: () => (
    <ComingSoonPage title="GRN — General" category="grn:general" />
  ),
  head: () => ({ meta: [{ title: "GRN General — Prokon" }] }),
});