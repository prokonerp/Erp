import { createFileRoute } from "@tanstack/react-router";
import { ChallanUnifiedList } from "@/components/ChallanUnifiedList";

export const Route = createFileRoute("/_app/challan/")({
  component: () => <ChallanUnifiedList />,
});