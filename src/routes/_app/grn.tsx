import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/grn")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Goods Receipt Notes — Prokon" }] }),
});