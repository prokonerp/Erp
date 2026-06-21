import { createFileRoute } from "@tanstack/react-router";
import { GrnListView } from "@/components/GrnListView";

export const Route = createFileRoute("/_app/grn/oem/")({
  component: () => <GrnListView category="oem" newTo="/grn/oem/new" />,
  head: () => ({ meta: [{ title: "GRN — From OEM" }] }),
});