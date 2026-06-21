import { createFileRoute } from "@tanstack/react-router";
import { GrnListView } from "@/components/GrnListView";

export const Route = createFileRoute("/_app/grn/customer/")({
  component: () => <GrnListView category="customer" newTo="/grn/customer/new" />,
  head: () => ({ meta: [{ title: "GRN — From Customer" }] }),
});