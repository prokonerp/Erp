import { createFileRoute } from "@tanstack/react-router";
import { ChallanListView } from "@/components/ChallanListView";

export const Route = createFileRoute("/_app/challan/customer/")({
  component: () => <ChallanListView docType="customer" newTo="/challan/customer/new" />,
});
