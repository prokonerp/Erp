import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/grn/oem")({
  component: () => <Outlet />,
});