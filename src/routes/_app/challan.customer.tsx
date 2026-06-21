import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/challan/customer")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Delivery Challan to Customer — Prokon" }] }),
});
