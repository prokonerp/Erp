import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/new")({
  head: () => ({
    meta: [{ title: "Create New Gate Pass — Prokon" }],
  }),
  component: () => <Navigate to="/gatepass/new" />,
});
