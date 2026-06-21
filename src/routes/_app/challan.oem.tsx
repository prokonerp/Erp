import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/challan/oem")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Delivery Challan to OEM — Prokon" }] }),
});
