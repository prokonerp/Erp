import { createFileRoute } from "@tanstack/react-router";
import { GrnForm } from "@/components/GrnForm";

export const Route = createFileRoute("/_app/grn/customer/new")({
  component: () => <GrnForm category="customer" />,
  head: () => ({ meta: [{ title: "New GRN — From Customer" }] }),
});