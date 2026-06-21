import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/challan")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Delivery Challans — Prokon" }] }),
});