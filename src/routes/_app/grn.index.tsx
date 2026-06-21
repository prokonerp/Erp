import { createFileRoute } from "@tanstack/react-router";
import { GrnUnifiedList } from "@/components/GrnUnifiedList";

export const Route = createFileRoute("/_app/grn/")({
  component: () => <GrnUnifiedList />,
});