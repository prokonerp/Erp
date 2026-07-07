import { createFileRoute, Navigate } from "@tanstack/react-router";

// The Sales module surfaces the existing CRM Quotations page rather than
// duplicating the workflow. This route just redirects.
export const Route = createFileRoute("/_app/sales/quotations")({
  component: () => <Navigate to="/crm/quotations" />,
});