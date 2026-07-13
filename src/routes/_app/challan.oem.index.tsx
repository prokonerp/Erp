import { createFileRoute } from "@tanstack/react-router";
import { ChallanListView } from "@/components/ChallanListView";

export const Route = createFileRoute("/_app/challan/oem/")({
  component: () => <ChallanListView docType="oem" newTo="/challan/new" />,
});
