import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/sales/orders")({
  component: SalesOrdersLayout,
});

function SalesOrdersLayout() {
  return <Outlet />;
}
