import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/records")({
  head: () => ({
    meta: [{ title: "Gate Pass History — Prokon" }],
  }),
  component: () => <Navigate to="/gatepass" />,
});
