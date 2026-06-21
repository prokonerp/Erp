import { createFileRoute } from "@tanstack/react-router";
import { ChallanForm } from "@/components/ChallanForm";

export const Route = createFileRoute("/_app/challan/oem/new")({
  component: () => <ChallanForm docType="oem" />,
  head: () => ({ meta: [{ title: "New Delivery Challan — To OEM" }] }),
});
