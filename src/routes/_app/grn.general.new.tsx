import { createFileRoute } from "@tanstack/react-router";
import { GrnForm } from "@/components/GrnForm";

export const Route = createFileRoute("/_app/grn/general/new")({
  component: () => <GrnForm category="general" />,
  head: () => ({ meta: [{ title: "New GRN — General" }] }),
});