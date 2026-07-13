import { createFileRoute } from "@tanstack/react-router";
import { ChallanForm } from "@/components/ChallanForm";

export const Route = createFileRoute("/_app/challan/new")({
  component: () => <ChallanForm />,
  head: () => ({ meta: [{ title: "New Delivery Challan — Prokon" }] }),
});