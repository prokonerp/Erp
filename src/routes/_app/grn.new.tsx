import { createFileRoute } from "@tanstack/react-router";
import { GrnForm } from "@/components/GrnForm";

export const Route = createFileRoute("/_app/grn/new")({
  component: () => <GrnForm />,
  head: () => ({ meta: [{ title: "New GRN — Prokon" }] }),
});