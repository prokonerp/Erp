import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/crm/customers")({
  component: () => <Navigate to="/masters/customers" replace />,
});