import { createFileRoute } from "@tanstack/react-router";
import { GrnListView } from "@/components/GrnListView";

export const Route = createFileRoute("/_app/grn/general/")({
  component: () => <GrnListView category="general" newTo="/grn/general/new" />,
  head: () => ({ meta: [{ title: "GRN — General" }] }),
});