import { createFileRoute } from "@tanstack/react-router";
import { ChallanForm } from "@/components/ChallanForm";

export const Route = createFileRoute("/_app/challan/customer/new")({
  component: () => <ChallanForm docType="customer" />,
  head: () => ({ meta: [{ title: "New Delivery Challan — To Customer" }] }),
});
