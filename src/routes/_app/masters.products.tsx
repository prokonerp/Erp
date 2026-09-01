import { createFileRoute } from "@tanstack/react-router";
import { ProductMasterPage } from "@/components/masters/ProductMaster";

export const Route = createFileRoute("/_app/masters/products")({
  component: ProductMasterPage,
  head: () => ({ meta: [{ title: "Product Master — Prokon" }] }),
});
