import { createFileRoute, redirect } from "@tanstack/react-router";

// Products module has moved under Masters → Products.
// This route exists only to redirect old links to the new location.
export const Route = createFileRoute("/_app/products")({
  beforeLoad: () => {
    throw redirect({ to: "/masters/products" });
  },
  component: () => null,
});