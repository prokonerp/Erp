import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/indent")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Indent — Prokon" }] }),
});