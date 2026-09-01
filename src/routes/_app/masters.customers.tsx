import { createFileRoute } from "@tanstack/react-router";
import { CustomerMasterPage } from "@/components/masters/CustomerMaster";

export const Route = createFileRoute("/_app/masters/customers")({
  component: CustomerMasterPage,
  head: () => ({ meta: [{ title: "Customer Master — Prokon" }] }),
});
