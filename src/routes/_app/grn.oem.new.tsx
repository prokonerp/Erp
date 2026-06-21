import { createFileRoute } from "@tanstack/react-router";
import { GrnForm } from "@/components/GrnForm";

export const Route = createFileRoute("/_app/grn/oem/new")({
  component: () => <GrnForm category="oem" />,
  head: () => ({ meta: [{ title: "New GRN — From OEM" }] }),
});